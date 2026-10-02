# 旧版配置迁移

官方 Desktop 的 profile 是 `$DSH_HOME/profiles/desktop`，默认 DSH_HOME 为 `~/.dsh`。插件设置已从共享 `settings.yaml` 改为当前 profile 的 `cordis.patch.yml`。

1. 完全退出 Desktop。
2. 备份 `profiles/desktop/package.json`、`cordis.patch.yml` 和 `pnpm-lock.yaml`。
3. 安装新包。
4. 如果旧 `settings.yaml` 或 `settings.yaml.imported` 有 `dsh-mids-fast` 节，将其中 `defaultExecution`、`defaultPlanning`、`sessionOverrides` 合并到下面的配置行。已存在同 ID 的行时编辑它，避免重复插入；不要用旧文件覆盖整个 Desktop patch。

```yaml
- id: dsh-mids-fast
  name: dsh-plan-and-execute
  config:
    defaultExecution:
      provider: deepseek-official
      model: deepseek-flash
    defaultPlanning:
      provider: mimo
      model: mimo-v2.6-pro
    sessionOverrides: {}
```

`sessionOverrides` 的键是原始会话 ID，值包含 `execution` 和 `planning` 两条路线。每条路线使用 `provider`、`model` 和可选 `reasoningEffort`。保持原会话 ID 不变才能恢复该会话的配置。

不要迁移整份凭据文件，也不要把个人 profile patch 提交到仓库。模型目录需要在官方 Desktop 中可用；若提供商或模型 ID 已变化，在新会话弹窗中重新选择即可。

## 从 dsh-adaptive-plan 更新

`0.3.1` 的新包名为 `dsh-plan-and-execute`，界面简称 **P&E**。两个包使用相同的兼容预设 ID，不能同时启用。

1. 完全退出 Desktop，备份当前 profile 的 `package.json`、`cordis.patch.yml` 和 `pnpm-lock.yaml`。
2. 执行 `dsh plugin --profile desktop remove dsh-adaptive-plan`，再安装 `dsh-plan-and-execute-0.3.1.tgz`。
3. 检查 `cordis.patch.yml` 中 `id: dsh-mids-fast` 的行，将其 `name` 改成 `dsh-plan-and-execute`。保留原 `config`（默认模式、模型路线及 `sessionOverrides`）；若安装过程中该行被移除，从备份中恢复此行并使用新 `name`。
4. 重新打开 Desktop，在插件页面确认新包已启用。

预设 ID `mids-fast`、设置 ID `dsh-mids-fast`、工具名与历史消息来源类型继续保留，因此既有会话与已固定的配置可以继续使用。

## 快速与专家模式

`0.3.0` 新增 `defaultMode: fast | expert` 和每个 `sessionOverrides` 条目的 `mode`。缺少模式的旧会话保持快速模式。新会话配置窗口可保存模式。`0.3.4` 起已有会话也可修改模式与模型组合，保存后下一轮生效；旧配置无需迁移。迁移旧 Mids 的规划/执行路线后，在新会话选择专家即可；旧 Web 自建预设文件无需修改。

## 上下文压缩方式

`0.3.6` 增加 `defaultCompaction: current | planning` 和会话配置中的 `compaction`。`current` 表示官方的最近实际请求模型；`planning` 表示本会话规划模型，仅作用于主会话。旧会话缺少该字段时保持 `current`，即使新会话默认值改为 `planning`。无需迁移旧配置，可在会话弹窗中显式保存。

默认值、会话值与模型组合通过同一设置操作保存。切换后不改变历史记录、正常请求路由或已派出子智能体；当前轮快照下一轮更新，空闲时 `/compact` 读取已保存配置。

## 回退

完全退出 Desktop，移除 `dsh-plan-and-execute` 并重新启动，可恢复官方预设与模型控件。需要恢复安装前配置时，先另行备份安装后新保存的配置，再使用之前的 profile 备份。旧 Web 使用插件 `0.1.9`，与 Desktop 的包管理目录独立。
