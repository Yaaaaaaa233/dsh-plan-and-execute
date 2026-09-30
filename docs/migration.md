# 旧版配置迁移

官方 Desktop 的 profile 是 `$DSH_HOME/profiles/desktop`，默认 DSH_HOME 为 `~/.dsh`。插件设置已从共享 `settings.yaml` 改为当前 profile 的 `cordis.patch.yml`。

1. 完全退出 Desktop。
2. 备份 `profiles/desktop/package.json`、`cordis.patch.yml` 和 `pnpm-lock.yaml`。
3. 安装新包。
4. 如果旧 `settings.yaml` 或 `settings.yaml.imported` 有 `dsh-mids-fast` 节，将其中 `defaultExecution`、`defaultPlanning`、`sessionOverrides` 合并到下面的配置行。已存在同 ID 的行时编辑它，避免重复插入；不要用旧文件覆盖整个 Desktop patch。

```yaml
- id: dsh-mids-fast
  name: dsh-adaptive-plan
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

## 快速与专家模式

`0.3.0` 新增 `defaultMode: fast | expert` 和每个 `sessionOverrides` 条目的 `mode`。缺少模式的旧会话保持快速模式。新会话配置窗口可保存模式，开始对话后与模型组合一起固定。迁移旧 Mids 的规划/执行路线后，在新会话选择专家即可；旧 Web 自建预设文件无需修改。

## 回退

完全退出 Desktop，移除 `dsh-adaptive-plan` 并重新启动，可恢复官方预设与模型控件。需要恢复安装前配置时，先另行备份安装后新保存的配置，再使用之前的 profile 备份。旧 Web 使用插件 `0.1.9`，与 Desktop 的包管理目录独立。
