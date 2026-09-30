# 官方 Desktop 验证

环境：2026-09-30，macOS Apple Silicon，官方 DeepSeek Harness `0.2.0-rc.2`。

## 已验证

- `npm run check`：四个运行模块通过语法检查。
- `npm test`：21 个测试覆盖模型/思考选择、独立弹窗保存、未就绪时关闭、即时模式切换、普通模式委托原控件、开始后的禁用状态、执行/规划路线与会话快照。
- 临时 DSH_HOME 安装打包产物，官方 Desktop Host 成功启动。
- 实际预设服务同时列出 standard、ptc、minimal、cordis、mids-fast，均无加载失败。
- 实际 Settings Config 表单接受默认路线与会话路线写入，Host 提供的值即时更新。
- 实际官方 Agent Loop 离线模拟：简单执行、复杂执行 → 规划 → 执行、下一轮简单执行；规划模型收到之前的用户上下文，执行模型收到已提交方案；原生模型选择未改变实际调用路线。
- 实际 Desktop profile 安装并启用 `0.2.1`，旧 Mids 会话恢复为「按需规划」预设，既有会话的模型状态不可点击。
- 原生界面新会话切换到按需规划时自动弹窗；执行模型、规划模型及思考程度均可选择，保存后弹窗关闭，组合写入当前 profile。
- 切回标准模式后恢复原生模型控件，模型和思考程度菜单可以正常打开。
- 设置 → 内置插件 → 按需规划显示默认组合配置卡片。
- 原有余额挂件、自定义外观继续显示；权限与模型状态保持同一行。未修改官方应用源码或用户的全局主题。

## 0.3.0 专家模式

在隔离的官方 Desktop Host 中安装候选包并使用真实预设注册与 Agent 工厂：

- 默认模式、会话模式均通过官方 Settings Config 写入。
- 规划模型 → 前台执行子智能体 → 规划模型验收，执行子智能体实际调用官方 `write` 写入临时工作区。
- 后台 continuable 子智能体及 `send_message` 后续执行继续使用执行模型，官方运行时记录其身份并通知主会话。
- 主会话请求固定使用规划模型与其思考程度；所有子智能体请求固定使用执行模型与其思考程度。
- 所有实际工具调用成功，普通官方预设仍正常加载。
- 修复路由上下文消息的来源字段，使用插件专属 producer kind，符合官方 v4 会话持久化格式。

可重复验证的 Host 测试插件位于 `tests/fixtures/desktop-expert-probe.mjs`：仅允许隔离的 `/tmp/dsh-adaptive-plan-*` 或 `/private/tmp/dsh-adaptive-plan-*` DSH_HOME，加载时修改该临时 profile 的测试路线并生成验证结果；不得放入个人 profile。

以上路由验证使用本地模拟适配器，不产生收费的模型请求，不传输用户会话。

## 重现实际运行循环验证

在 macOS 官方应用已安装的情况下：

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals scripts/desktop-runtime-check.mjs \
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh"
```

脚本创建进程内临时会话与适配器，不打开应用窗口，也不访问用户 DSH_HOME。

## 范围

真实 DeepSeek/Mimo API 的规划质量与跨模型消息格式尚未做付费端到端测试。Windows、Linux、Intel macOS、其他 DSH 版本和抢占模型插槽的第三方 UI 插件组合未验证。
