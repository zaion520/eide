/*
    MIT License

    Copyright (c) 2019 github0null

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
*/

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { ExeModule } from '../../lib/node-utility/Executable';
import { ProjectExplorer } from '../EIDEProjectExplorer';
import { GlobalEvent } from '../GlobalEvents';
import { executeTool } from './mcp_impl';
import {
    appendMcpLog,
    attachFrameReader,
    getHealthUrl,
    getMcpBundleId,
    healthCheckTimeoutMs,
    IpcMessage,
    ipcConnectTimeoutMs,
    ipcPingIntervalMs,
    isMcpHealthCompatible,
    McpHealthResponse,
    McpProjectInfo,
    sendMessage,
    getLogPath
} from './mcp_protocol';

let socket: net.Socket | undefined;
let pingTimer: NodeJS.Timeout | undefined;
let reconnectTimer: NodeJS.Timeout | undefined;
/** 断线重连参数:3s 起步、指数退避、封顶 60s、带 jitter(避免多窗口同步重连风暴) */
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
let reconnectAttempt = 0;
/** 当前会话的连接参数(mcpClientConnect 的入参快照,供自动重连复用) */
let connectParams: { httpPort: number; extensionPath: string; extensionVersion: string } | undefined;
let reconnectEnabled = false;
/** 连接建立(true)或用户主动断开(false);用于 socket close 回调里区分两种场景 */
let everConnected = false;
let projectExplorer: ProjectExplorer | undefined;
let instanceId: string | undefined;
/** setupProjectSync 的 GlobalEvent 监听器是否已注册(重连不重复注册) */
let projectSyncInited = false;

function logInfo(msg: string): void {
    GlobalEvent.log_info(msg);
}

function logError(msg: string, err?: unknown): void {
    GlobalEvent.log_error(msg);
    if (err instanceof Error) {
        GlobalEvent.log_error(err);
    } else if (err !== undefined) {
        GlobalEvent.log_error(String(err));
    }
}

function collectProjects(explorer: ProjectExplorer): McpProjectInfo[] {
    const projects: McpProjectInfo[] = [];
    explorer.foreachProjects((prj) => {
        projects.push({ uid: prj.getUid(), name: prj.getProjectName() });
        return undefined;
    });
    return projects;
}

async function checkProxyHealth(httpPort: number): Promise<McpHealthResponse | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), healthCheckTimeoutMs);
    try {
        const res = await fetch(getHealthUrl(httpPort), { signal: controller.signal });
        if (!res.ok) {
            return undefined;
        }
        const body = await res.json() as McpHealthResponse;
        if (!body.ok || body.httpPort !== httpPort) {
            return undefined;
        }
        return body;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}

function waitForProxyHealth(httpPort: number, timeoutMs: number): Promise<McpHealthResponse | undefined> {
    const deadline = Date.now() + timeoutMs;
    return new Promise(resolve => {
        const tick = async () => {
            const health = await checkProxyHealth(httpPort);
            if (health) {
                resolve(health);
                return;
            }
            if (Date.now() >= deadline) {
                resolve(undefined);
                return;
            }
            setTimeout(tick, 200);
        };
        void tick();
    });
}

function spawnEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    return env;
}

function spawnProxy(serverJs: string, httpPort: number, version: string, bundleId: string): void {

    const exe = new ExeModule();

    const logPath = getLogPath(httpPort);

    exe.on('close', (info) => {
        appendMcpLog(logPath, `exited. code=${info.code}`);
    });
    exe.on('errLine', (line) => {
        appendMcpLog(logPath, line);
    });
    exe.on('error', (err) => {
        appendMcpLog(logPath, `${err.name}: ${err.message}` + (err.stack ? `\n${err.stack}` : ''));
    });

    exe.Run(serverJs, [
        '--port', String(httpPort),
        '--version', version,
        '--bundle-id', bundleId
    ], {
        detached: true,
        stdio: 'pipe',
        env: spawnEnv(),
        execArgv: []
    });
}

async function stopProxy(pid: number): Promise<void> {
    try {
        process.kill(pid, 'SIGTERM');
    } catch {
        // already stopped
    }
}

async function waitForProxyGone(httpPort: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const health = await checkProxyHealth(httpPort);
        if (!health) {
            return;
        }
        await new Promise(r => setTimeout(r, 200));
    }

    const health = await checkProxyHealth(httpPort);
    if (health) {
        try {
            process.kill(health.pid, 'SIGKILL');
        } catch {
            // ignore
        }
        await new Promise(r => setTimeout(r, 500));
    }
}

async function ensureProxyRunning(
    httpPort: number,
    serverJs: string,
    extensionVersion: string,
    bundleId: string
): Promise<McpHealthResponse> {
    let health = await checkProxyHealth(httpPort);

    // 健康复查:首次失败可能只是 proxy 忙(扩展宿主主线程被长任务阻塞时,健康检查
    // 3s 超时误判 proxy 已死,spawn 第二个进程撞端口 EADDRINUSE——历史日志 27 次)。
    // 短间隔复查确认真的无响应后才 spawn
    if (!health) {
        for (let i = 0; i < 3 && !health; i++) {
            await new Promise(r => setTimeout(r, 500));
            health = await checkProxyHealth(httpPort);
        }
    }

    if (health && !isMcpHealthCompatible(health, extensionVersion, bundleId)) {
        logInfo(
            `MCP proxy outdated (running=${health.version ?? 'unknown'}/${health.bundleId ?? 'unknown'}, ` +
            `expected=${extensionVersion}/${bundleId}), restarting...`
        );
        await stopProxy(health.pid);
        await waitForProxyGone(httpPort, ipcConnectTimeoutMs);
        health = undefined;
    }

    if (!health) {
        spawnProxy(serverJs, httpPort, extensionVersion, bundleId);
        health = await waitForProxyHealth(httpPort, ipcConnectTimeoutMs);
        if (!health) {
            throw new Error('MCP proxy failed to start');
        }
    }

    // 升级重载场景:旧 proxy 停止与新 proxy 起来的窗口期内,健康轮询可能仍命中
    // 残留的旧实例(实测 3.27.62→3.27.63 升级首窗触发)。此处不再直接抛错断连,
    // 而是重走一轮"停旧→起新→等健康";若新实例仍不匹配,才判定为真实失败
    if (!isMcpHealthCompatible(health, extensionVersion, bundleId)) {
        logInfo(
            `MCP proxy stale after restart (running=${health.version}/${health.bundleId}, ` +
            `expected=${extensionVersion}/${bundleId}), retrying...`
        );
        await stopProxy(health.pid);
        await waitForProxyGone(httpPort, ipcConnectTimeoutMs);
        spawnProxy(serverJs, httpPort, extensionVersion, bundleId);
        health = await waitForProxyHealth(httpPort, ipcConnectTimeoutMs);
        if (!health) {
            throw new Error('MCP proxy failed to start (after stale-instance retry)');
        }
        if (!isMcpHealthCompatible(health, extensionVersion, bundleId)) {
            throw new Error(
                `MCP proxy version mismatch after restart (running=${health.version}/${health.bundleId}, ` +
                `expected=${extensionVersion}/${bundleId})`
            );
        }
    }

    return health;
}

async function connectIpc(ipcPort: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const s = net.connect({ host: '127.0.0.1', port: ipcPort });
        const timer = setTimeout(() => {
            s.destroy();
            reject(new Error('IPC connect timeout'));
        }, ipcConnectTimeoutMs);

        s.once('connect', () => {
            clearTimeout(timer);
            resolve(s);
        });
        s.once('error', err => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function sendRegister(sock: net.Socket, explorer: ProjectExplorer): void {
    sendMessage(sock, {
        type: 'register',
        instanceId: instanceId!,
        projects: collectProjects(explorer)
    });
}

function startPing(sock: net.Socket): void {
    if (pingTimer) {
        clearInterval(pingTimer);
    }
    pingTimer = setInterval(() => {
        sendMessage(sock, { type: 'ping' });
    }, ipcPingIntervalMs);
}

function setupMessageHandler(sock: net.Socket, explorer: ProjectExplorer): void {
    attachFrameReader(sock, async (msg: IpcMessage) => {
        if (msg.type === 'toolCall') {
            try {
                const result = await executeTool(msg.tool, msg.args, explorer);
                sendMessage(sock, { type: 'toolResult', requestId: msg.requestId, result });
            } catch (err) {
                sendMessage(sock, {
                    type: 'toolResult',
                    requestId: msg.requestId,
                    result: {
                        isError: true,
                        content: [{ type: 'text', text: `Tool error: ${err}` }]
                    }
                });
            }
        } else if (msg.type === 'ping') {
            sendMessage(sock, { type: 'pong' });
        }
    });
}

function setupProjectSync(sock: net.Socket, explorer: ProjectExplorer): void {
    const pushProjects = () => {
        if (sock.destroyed) {
            return;
        }
        sendMessage(sock, { type: 'projects', projects: collectProjects(explorer) });
    };
    // 重连会重复调用 connect() → setupProjectSync,监听器只注册一次(以首个存活 socket 为准)
    if (!projectSyncInited) {
        projectSyncInited = true;
        GlobalEvent.on('project.opened', pushProjects);
        GlobalEvent.on('project.closed', pushProjects);
        GlobalEvent.on('project.activeStatusChanged', pushProjects);
    }
}

export function mcpClientInit(explorer: ProjectExplorer, sessionId: string): void {
    projectExplorer = explorer;
    instanceId = sessionId;
}

export async function mcpClientConnect(
    httpPort: number,
    extensionPath: string,
    extensionVersion: string
): Promise<void> {
    if (!projectExplorer || !instanceId) {
        throw new Error('mcp client not inited');
    }

    const serverJs = path.join(extensionPath, 'dist', 'mcp_server.js');
    if (!fs.existsSync(serverJs)) {
        throw new Error(`MCP proxy not found: ${serverJs}`);
    }

    connectParams = { httpPort, extensionPath, extensionVersion };
    reconnectEnabled = true;
    await connect(httpPort, extensionPath, extensionVersion);
}

/** 真正的连接流程(spawn/复用 proxy + IPC 注册),首连与自动重连共用 */
async function connect(httpPort: number, extensionPath: string, extensionVersion: string): Promise<void> {
    if (!projectExplorer || !instanceId) {
        throw new Error('mcp client not inited');
    }

    const serverJs = path.join(extensionPath, 'dist', 'mcp_server.js');
    if (!fs.existsSync(serverJs)) {
        throw new Error(`MCP proxy not found: ${serverJs}`);
    }

    const bundleId = getMcpBundleId(serverJs);
    const health = await ensureProxyRunning(httpPort, serverJs, extensionVersion, bundleId);

    if (socket) {
        // 上一轮残连接(重连成功前 socket 尚未 close)清理掉,避免泄漏。
        // 销毁会触发其 close 回调,先暂停 reconnectEnabled 防止误调度重连
        const stale = socket;
        socket = undefined;
        const wasEnabled = reconnectEnabled;
        reconnectEnabled = false;
        stale.destroy();
        reconnectEnabled = wasEnabled;
    }

    socket = await connectIpc(health.ipcPort);
    setupMessageHandler(socket, projectExplorer);
    sendRegister(socket, projectExplorer);
    setupProjectSync(socket, projectExplorer);
    startPing(socket);

    socket.on('close', () => {
        logInfo('Disconnected from MCP proxy');
        // 用户主动断开(mcpClientDisconnect)不重连;意外断线(proxy 崩溃/升级重启)自动重连
        if (reconnectEnabled) {
            scheduleReconnect();
        }
    });
    socket.on('error', (err) => {
        logError('MCP proxy connection error', err);
    });

    everConnected = true;
    reconnectAttempt = 0; // 重连成功,退避归零

    logInfo(`Connected to MCP proxy (ipc=${health.ipcPort})`);
}

/** 指数退避重连:3s 起步 ×2,封顶 60s,±25% jitter */
function scheduleReconnect(): void {
    if (reconnectTimer) {
        return; // 已在重连队列中
    }
    const params = connectParams;
    if (!params || !projectExplorer) {
        return;
    }
    const backoff = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt), RECONNECT_MAX_MS);
    const jitter = backoff * (0.75 + Math.random() * 0.5); // 75%~125%
    reconnectAttempt++;
    logInfo(`MCP proxy disconnected, retrying in ${Math.round(jitter)}ms (attempt ${reconnectAttempt})`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void connect(params.httpPort, params.extensionPath, params.extensionVersion)
            .catch(err => {
                logError('MCP reconnect failed, will retry', err);
                scheduleReconnect(); // 失败继续退避
            });
    }, jitter);
}

export async function mcpClientDisconnect(): Promise<void> {
    reconnectEnabled = false; // 主动断开:停掉重连与在途的退避计时
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
    }
    if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = undefined;
    }
    if (socket) {
        const s = socket;
        socket = undefined;
        return new Promise(resolve => {
            s.once('close', resolve);
            s.destroy();
            setTimeout(resolve, 500);
        });
    }
}
