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

## 0.3.4 会话内更改配置（2026-10-01）

- 27 项 Node 测试通过：新增已开始／运行中会话保存、当前轮快照、下一轮刷新两条路线与模式、已有子智能体路线及冷恢复描述符的验证。
- 官方 `0.2.0-rc.2` 进程内 Agent Loop 使用本地模拟模型，验证执行途中保存专家组合后，原轮仍按旧执行 → 旧规划 → 旧执行运行，下一轮使用新规划模型和思考程度，历史上下文仍在。
- 同一官方运行循环调用真实 spawn 服务：专家轮途中再次保存新组合，当前轮新派出的前台子智能体仍使用原执行路线，主会话继续原规划路线验收；所有工具调用成功。
- 后台子智能体的创建快照和冷恢复读取使用单元测试验证；本轮未重新验证官方后台恢复的完整流程。
- 仅创建进程内临时会话，没有调用外部模型、改动个人 profile 或重启正在运行的 Desktop。原生界面的点击操作尚待安装后验证。

## 0.3.5 状态控件显示（2026-10-01）

- 28 项 Node 测试与模块语法检查通过；新增简称规则验证，保留自定义显示名称、版本和变体标识。
- 隐藏的 Electron `39.8.10` 渲染预览使用生产 `MidsStatus` 输出与官方 `0.2.0-rc.2` 输入栏 CSS、紧凑布局测量函数，检查 280、340、480、600、800、900px 六种宽度，均无横向溢出，权限和模型控件保持同一行。
- 480／900px 下 DS V4.1 F 完整显示，600px 下 MiMo V2.6 Pro 完整显示；340px 下省略模型文字，280px 下采用官方图标模式；长自定义名称保持省略提示。
- 悬停提示保留完整名称与执行／规划思考程度。该预览验证的是控件布局；个人 Desktop 安装后的实际 UI 与其他主题组合尚待验证。

## 0.3.6 可选规划模型压缩（2026-10-02）

- 36 项 Node 行为测试与六个模块语法检查通过，覆盖配置保存／恢复／默认值、旧配置兼容、当前轮快照、空闲手动压缩、跨会话隔离、模型与思考程度、较小窗口、超限检查以及子智能体保留原行为。
- 在官方 `0.2.0-rc.2` 的真实 Agent Loop、Session、Token Meter 和 Basic Compaction 后端中使用离线模拟适配器：手动压缩由规划模型生成，`compaction/summary` 正确记录提供商和模型，后续执行请求收到官方 checkpoint 并继续使用执行模型。
- 保存规划模型与思考程度后，空闲手动压缩立即使用新组合；切回 current 后使用最近实际请求模型。当前轮保存更改仍保留旧快照，空闲后读取新配置。
- 执行模型窗口为 12000、规划模型为 6000 时，4991 tokens 的有效上下文已触发自动压缩，随后执行继续使用执行模型。只靠执行模型的原阈值此时不会触发。
- 执行子智能体的手动压缩仍使用执行模型。对已经超过规划模型窗口的历史，摘要 API 不会被调用，surface replacement generation 不变，失败事务以 `compaction/end` 正确关闭。
- 候选 tgz 已用官方 CLI 离线安装到隔离临时 desktop profile；安装沿用该临时 profile 的 pnpm store，没有修改全局配置。再通过官方 Runtime Resolution 加载 tgz 中实际导出的 compaction 类，重复上述运行时检查通过。
- 正常规划／执行、当前轮固定与下一轮改模型的原官方运行循环验证继续通过。本轮没有安装到个人 profile、打开或重启桌面窗口，也没有外部模型请求。

真实 Mimo／DeepSeek API 的摘要质量、费用、缓存及精确 token 容量尚未验证；安装后的个人桌面 UI 和其他平台尚待确认。容量检查沿用官方估算器，巨幅输入仍可能超限并要求用户换更大窗口或恢复 current。

重现压缩运行时测试：

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals scripts/desktop-compaction-check.mjs \
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh"
```

可追加隔离 profile 的绝对路径，以官方 Runtime Resolution 加载该 profile 已安装的实际包进行相同检查；脚本只创建进程内临时会话，不写入 profile 或调用外部 API。

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
