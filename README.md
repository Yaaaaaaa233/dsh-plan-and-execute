# DSH Plan and Execute（P&E）

官方 **DeepSeek Harness Desktop** 插件，合并原 Mids·快速与 Mids 的两种分工。两条路线可以分别选择模型和思考程度。

- **快速**：优先由执行模型判断，复杂任务再交给规划模型；执行模型在同一会话实施和验证。
- **专家**：全部判断、讨论、规划和验收交给规划模型；执行交给使用执行模型的子智能体。

本版 `0.3.3` 适配 DSH **`0.2.0-rc.2`**。目前在 macOS Apple Silicon 上验证；其他桌面平台尚未验证。旧 Web `0.1.6-alpha.1` 请继续使用插件 `0.1.9`，不要安装本版。

## 使用

1. 在新会话的 Agent 预设中选择 **P&E**。
2. 自动弹出独立配置窗口，选择 **快速 / 专家**，再分别设置执行模型、规划模型及思考程度。
3. 点击蓝色 **保存为当前会话配置** 按钮保存并关闭；没有改动时也可直接保存。**恢复默认配置** 仅将选项恢复为用户保存的默认值，检查后再保存；**设置为默认配置** 同时保存默认组合与当前会话配置，并关闭窗口。按 Esc 或点击窗口外可放弃未保存的修改。
4. 开始对话后，会话的模式和模型组合固定，输入栏显示模式及主会话最近调用的模型。

默认执行路线是 `deepseek-official/deepseek-flash`，默认规划路线是 `mimo/mimo-v2.6-pro`。这两个模型需要已在 DSH 中配置。默认组合可在 **设置 → 内置插件 → P&E** 修改。

普通模式直接使用 DSH 原有模型控件。P&E模式通过官方 `conversation.input.model` 插槽展示专属状态控件，不再通过 DOM/CSS 隐藏按钮。弹窗使用官方 Modal，颜色、圆角和紧凑布局遵循全局主题令牌。

## 安装

先启动官方 Desktop 一次初始化 profile，再**完全退出**桌面端，然后执行：

```sh
dsh plugin --profile desktop add /绝对路径/dsh-plan-and-execute-0.3.3.tgz
```

macOS 也可使用应用自带的命令，无需另装 Node 或 pnpm：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add /绝对路径/dsh-plan-and-execute-0.3.3.tgz
```

完成后重新打开桌面端。遇到 `ERR_PNPM_UNEXPECTED_STORE` 时，在本次安装命令中增加 `--store-dir`，指向该 **desktop profile** 正在使用的 store。无需修改全局 pnpm 配置，也不要直接沿用 Web profile 的 store 路径。

在全局 **插件** 页面确认 `dsh-plan-and-execute` 已启用，再完全重启 Desktop。尤其是在安装中断后重试时，包可能已安装但尚未启用。本包没有安装脚本；如果 pnpm 已完成依赖解析却一直不退出，可以退出安装进程后，在同一命令中增加 `--ignore-scripts --reporter=append-only` 重试。

移除：

```sh
dsh plugin --profile desktop remove dsh-plan-and-execute
```

整个插件安装、移除或开关后，完全重启 Desktop 是当前可靠的生效方式。本版未承诺整包热更新。

## 从旧名称迁移

`0.3.1` 将包名从 `dsh-adaptive-plan` 改为 `dsh-plan-and-execute`，会话预设和设置页统一显示 **P&E**。已有 Desktop 安装的更新步骤与配置保留方法见 [迁移说明](docs/migration.md#从-dsh-adaptive-plan-更新)。

## 从旧 Mids·快速迁移

包名为 `dsh-plan-and-execute`，界面名为 **P&E**。原预设 ID `mids-fast`、工具名 `mids_plan` / `mids_submit_plan` 和设置入口 ID `dsh-mids-fast` 继续保留。

- Desktop 与旧 Web 使用不同的插件 profile，应安装到 `desktop`。
- 如果 Desktop profile 中已有 `dsh-mids-fast` 包，先移除旧包，以免重复注册预设。
- 新设置保存在当前 profile 的 `cordis.patch.yml`。旧 `settings.yaml.imported` 中的 `dsh-mids-fast` 节不会因为安装插件自动重新导入；迁移方法见 [迁移说明](docs/migration.md)。
- 已保存的会话配置可迁移，修改默认值不影响已固定组合的会话。

## 路由

**快速**：执行模型收到每次用户请求并判断是否需要规划。需要规划时调用 `mids_plan`；规划模型通过只读工具了解上下文，并调用 `mids_submit_plan`；下一步重新使用执行模型。规划模型仅输出文字方案时，也会交还执行模型。

**专家**：主会话每轮都使用规划模型。主会话只能检查、讨论与派工；实现和运行命令交给执行子智能体。派工显式传入执行模型、思考程度及独立 persona，预检模型后才创建子会话，不继承规划模型的实际调用路线。子智能体禁止再次派工。默认等待执行结果；独立工作可使用后台子智能体，并通过官方 `send_message`、`list_agents`、`interrupt_agent` 跟进。后台结束通知由官方运行时提供。

快速模式的两模型读取同一个 Agent 的正常会话历史。专家模式的主会话保留完整历史，spawn 子智能体接收自包含任务与方案，使用独立上下文。规划判断来自执行模型的指令，不是独立分类器或固定概率阈值。规划阶段禁止写文件、运行命令和派出子 Agent。

## 开发与验证

```sh
npm ci --legacy-peer-deps
npm run check
npm test
npm pack --ignore-scripts
```

实际官方 Agent 运行循环的离线验证见 [验证记录](docs/verification.md)。兼容性基于 [官方 Desktop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/README.md) 与相同版本源码。

## 限制

- `/model` 命令或直接调用原生 API 仍可改变原生选择；P&E的实际请求继续使用已固定的插件路线。
- 阶段状态保存在内存中。如果在规划期间重启 Desktop，下一次请求重新由执行模型判断。
- 配置写入失败时，本轮仍使用内存快照；跨重启固定组合需要可写的插件设置。
- 模型控件使用官方单项插槽的优先级机制，并把普通会话交给原有控件。与同样替换该插槽的第三方插件组合尚未验证。
- 专家主会话禁止直接编辑文件或运行命令；验证命令由执行子智能体运行，主会话审阅结果。子智能体沿用官方权限继承与审批限制，模型切换不扩大权限。
- 原有未记录模式的会话保持快速模式；修改默认模式只影响尚未固定配置的新会话。

MIT License。
