# DSH Adaptive Plan（按需规划）

DeepSeek Harness Web 插件。执行模型先判断每次请求是否需要规划：简单任务直接完成；复杂任务在同一会话中调用规划模型制定方案，再由执行模型实施和验证。执行模型和规划模型都可从 DSH 已配置的模型中选择，也可分别设置思考程度。

*Adaptive Plan routes each request through a configurable execution model. It calls a configurable planning model only when planning would help, then returns to the execution model in the same conversation.*

目前针对 DSH `0.1.6-alpha.1` 开发和测试。后续 Web 界面版本可能需要适配。

## 使用方式

在新会话选择 **按需规划** 后，会弹出独立的模型配置窗口。关闭窗口而不保存时使用插件默认值。开始对话后，该会话的模型组合固定；输入栏的状态控件只展示当前配置和最近调用的模型。

- **执行模型**：判断当前任务是否需要规划，并负责完成任务。默认 `deepseek-official/deepseek-flash`。
- **规划模型**：仅在复杂任务需要规划时调用。默认 `mimo/mimo-v2.6-pro`。

两个默认模型需要已在 DSH 中配置。可在 **设置 → 插件 → 插件配置 → 按需规划** 修改新会话的默认模型，也可在尚未开始的会话里单独选择。会话配置会持久保存，删除会话时会清除对应配置。

选中此模式时，插件会暂时隐藏并屏蔽 DSH 原生模型按钮；切换到其他模式后恢复原按钮。插件使用 DSH 提供的插槽和插件组合，不修改官方源码。

## 安装

将仓库安装到 Web profile，然后重启 DSH：

```sh
dsh plugin --profile web add github:Yaaaaaaa233/dsh-adaptive-plan
```

也可以克隆仓库、在仓库根目录打包后安装：

```sh
npm pack
dsh plugin --profile web add ./dsh-adaptive-plan-0.1.9.tgz
```

如遇 `ERR_PNPM_UNEXPECTED_STORE`，在安装命令中用 `--store-dir` 指向当前 profile 已在使用的 pnpm store。移除插件的命令是 `dsh plugin --profile web remove dsh-adaptive-plan`；移除后也需要重启 DSH。

### 从 Mids·快速迁移

先移除旧包，再安装新包，以免两个包同时注册同一个预设：

```sh
dsh plugin --profile web remove dsh-mids-fast
dsh plugin --profile web add github:Yaaaaaaa233/dsh-adaptive-plan
```

旧预设 ID `mids-fast`、工具名 `mids_plan` / `mids_submit_plan` 和设置命名空间 `dsh-mids-fast` 暂时保留。这使已有会话和已保存的模型选择可以继续使用；界面名称改为 **按需规划**。迁移前建议备份 DSH 设置。

## 路由过程

1. 执行模型收到请求并判断任务复杂度。
2. 简单任务由执行模型直接处理。
3. 复杂任务调用 `mids_plan`，规划模型在同一会话中检查上下文并提交计划。
4. 下一次模型调用返回执行模型，实施并验证计划。

规划阶段只允许只读检查和提交计划，不允许修改文件、运行命令或委派子 Agent。两个模型共享 DSH 正常维护的会话历史和上下文。规划判断来自执行模型的指令，并非独立分类器或固定概率阈值。

## 开发

```sh
npm ci
npm test
npm pack --dry-run
```

## 当前限制

- 原生模型按钮的屏蔽依赖 DSH `0.1.6-alpha.1` 的输入栏 DOM 结构。如果上游结构变化，状态控件会提示屏蔽失败。
- `/model` 命令及直接调用模型选择 API 仍可更改 DSH 原生选择，但此预设的实际调用继续使用插件保存的执行/规划模型组合。
- 规划阶段的运行状态保存在进程内存中；如果此时重启 DSH，下一轮会从执行模型的判断阶段开始。
- 设置服务不可用或只读时仍可使用内置默认模型，但无法持久保存会话单独配置。
- 在设置里禁用插件后，需重启 DSH 才能完全刷新预设列表。
