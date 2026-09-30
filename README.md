# DSH Adaptive Plan（按需规划 / Mids·快速）

官方 **DeepSeek Harness Desktop** 插件。执行模型先判断任务复杂度：简单任务直接完成；复杂任务调用规划模型，在同一会话内制定方案，再返回执行模型实施和验证。两条路线可以分别选择模型和思考程度。

本版 `0.2.2` 适配 DSH **`0.2.0-rc.2`**。目前在 macOS Apple Silicon 上验证；其他桌面平台尚未验证。旧 Web `0.1.6-alpha.1` 请继续使用插件 `0.1.9`，不要安装本版。

## 使用

1. 在新会话的 Agent 预设中选择 **按需规划**。
2. 自动弹出独立的模型配置窗口，分别设置执行模型、规划模型及思考程度。
3. 关闭窗口会保留当前配置；未单独保存过配置时使用插件默认值。
4. 开始对话后，会话的模型组合固定，输入栏只显示实际最近调用的模型。

默认执行路线是 `deepseek-official/deepseek-flash`，默认规划路线是 `mimo/mimo-v2.6-pro`。这两个模型需要已在 DSH 中配置。默认组合可在 **设置 → 内置插件 → 按需规划** 修改。

普通模式直接使用 DSH 原有模型控件。按需规划模式通过官方 `conversation.input.model` 插槽展示专属状态控件，不再通过 DOM/CSS 隐藏按钮。弹窗使用官方 Modal，颜色、圆角和紧凑布局遵循全局主题令牌。

## 安装

先启动官方 Desktop 一次初始化 profile，再**完全退出**桌面端，然后执行：

```sh
dsh plugin --profile desktop add /绝对路径/dsh-adaptive-plan-0.2.2.tgz
```

macOS 也可使用应用自带的命令，无需另装 Node 或 pnpm：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add /绝对路径/dsh-adaptive-plan-0.2.2.tgz
```

完成后重新打开桌面端。遇到 `ERR_PNPM_UNEXPECTED_STORE` 时，在本次安装命令中增加 `--store-dir`，指向该 **desktop profile** 正在使用的 store。无需修改全局 pnpm 配置，也不要直接沿用 Web profile 的 store 路径。

在全局 **插件** 页面确认 `dsh-adaptive-plan` 已启用，再完全重启 Desktop。尤其是在安装中断后重试时，包可能已安装但尚未启用。本包没有安装脚本；如果 pnpm 已完成依赖解析却一直不退出，可以退出安装进程后，在同一命令中增加 `--ignore-scripts --reporter=append-only` 重试。

移除：

```sh
dsh plugin --profile desktop remove dsh-adaptive-plan
```

整个插件安装、移除或开关后，完全重启 Desktop 是当前可靠的生效方式。本版未承诺整包热更新。

## 从旧 Mids·快速迁移

包名为 `dsh-adaptive-plan`，界面名为 **按需规划**。原预设 ID `mids-fast`、工具名 `mids_plan` / `mids_submit_plan` 和设置入口 ID `dsh-mids-fast` 继续保留。

- Desktop 与旧 Web 使用不同的插件 profile，应安装到 `desktop`。
- 如果 Desktop profile 中已有 `dsh-mids-fast` 包，先移除旧包，以免重复注册预设。
- 新设置保存在当前 profile 的 `cordis.patch.yml`。旧 `settings.yaml.imported` 中的 `dsh-mids-fast` 节不会因为安装插件自动重新导入；迁移方法见 [迁移说明](docs/migration.md)。
- 已保存的会话配置可迁移，修改默认值不影响已固定组合的会话。

## 路由

执行模型收到每次用户请求并判断是否需要规划。需要规划时调用 `mids_plan`；规划模型通过只读工具了解上下文，并调用 `mids_submit_plan`；下一步重新使用执行模型。规划模型仅输出文字方案时，也会交还执行模型。

两模型读取同一个 Agent 的正常会话历史。规划判断来自执行模型的指令，不是独立分类器或固定概率阈值。规划阶段禁止写文件、运行命令和派出子 Agent。

## 开发与验证

```sh
npm ci --legacy-peer-deps
npm run check
npm test
npm pack --ignore-scripts
```

实际官方 Agent 运行循环的离线验证见 [验证记录](docs/verification.md)。兼容性基于 [官方 Desktop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/README.md) 与相同版本源码。

## 限制

- `/model` 命令或直接调用原生 API 仍可改变原生选择；按需规划的实际请求继续使用已固定的插件路线。
- 阶段状态保存在内存中。如果在规划期间重启 Desktop，下一次请求重新由执行模型判断。
- 配置写入失败时，本轮仍使用内存快照；跨重启固定组合需要可写的插件设置。
- 模型控件使用官方单项插槽的优先级机制，并把普通会话交给原有控件。与同样替换该插槽的第三方插件组合尚未验证。
- 当前预设保留原版工具组成，不提供额外的子 Agent 委派工具。

MIT License。
