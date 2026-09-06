/**
 * clangd support provider (registration entry).
 *
 * 旧版实现:在 cpptools 未安装时,把 CompileFlags/CompilationDatabase 写进项目级 `.clangd`。
 * 新版实现(clangd 集成管线,见 clangdIntegration.ts):
 *  - 项目级 `.clangd` 在 clangd 侧会覆盖用户级 config.yaml,且旧生成的数据库里是
 *    clangd 无法解析的工具链原始命令,因此不再生成,旧文件会被迁移备份;
 *  - 改为生成 `.eide-clangd/compile_commands.json`(clangd 友好命令)+
 *    用户级 config.yaml 受管块 + 工作区 clangd.arguments;
 *  - 与 cpptools 不再互斥(两者读取的配置互不干扰),仍受
 *    `EIDE.Option.EnableClangdConfigGenerator` 开关控制。
 */
import { AbstractProject } from './EIDEProject';
import { updateClangdIntegration } from './clangdIntegration';

export function onRegisterClangdProvider(prj: AbstractProject) {
    prj.on('cppConfigChanged', () => {
        updateClangdIntegration(prj);
    });
}
