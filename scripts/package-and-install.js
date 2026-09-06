/**
 * pack:install — 每次打包自动 patch 版本号 +1,打包 VSIX 并安装到 VS Code。
 * 对标 Eide Extend 的 package-vsix.ps1 约定:每个包都有新版本号,避免同版本覆盖安装的文件锁/状态卡点。
 *
 * 流程:package.json version x.y.z -> x.y.(z+1) → npx vsce package → code --install-extension。
 * 注意:只在显式跑 `npm run pack:install` 时升版本;`webpack`/`compile`/`test` 不碰版本。
 *
 * 用法:npm run pack:install
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function bumpPatch(version) {
    const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(String(version || '').trim());
    if (!m) {
        throw new Error(`not a semver x.y.z version: '${version}'`);
    }
    return `${m[1]}.${m[2]}.${Number(m[3]) + 1}${m[4]}`;
}

function main() {
    const root = path.resolve(__dirname, '..');
    const pkgPath = path.join(root, 'package.json');

    const raw = fs.readFileSync(pkgPath, 'utf8');
    const current = JSON.parse(raw).version;
    const name = JSON.parse(raw).name;
    const next = bumpPatch(current);

    // 外科手术式替换版本行,保持文件其余格式零 diff
    const updated = raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
    if (updated === raw) {
        throw new Error('version field not found in package.json');
    }
    fs.writeFileSync(pkgPath, updated);
    console.log(`version: ${current} -> ${next}`);

    execSync('npx vsce package', { cwd: root, stdio: 'inherit', shell: true });

    const vsix = path.join(root, `${name}-${next}.vsix`);
    if (!fs.existsSync(vsix)) {
        throw new Error(`expected vsix not found: ${vsix}`);
    }
    execSync(`code --install-extension "${vsix}"`, { cwd: root, stdio: 'inherit', shell: true });
    console.log(`installed ${name}-${next} (Reload Window in VS Code to activate)`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`FAILED: ${error && error.message ? error.message : error}`);
        process.exit(1);
    }
}

module.exports = { bumpPatch };
