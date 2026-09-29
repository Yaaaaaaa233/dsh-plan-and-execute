window.__ModuleLoader__.load({
  id: 'dsh-adaptive-plan',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { IconDataOutline16, IconChevronDownOutline14 } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const inject = [
      'slots', 'sessions', 'remote', 'remote.session',
      'remote.settings', 'settingsScope',
    ]
    // Keep the existing preset ID so sessions created by Mids·快速 still resolve.
    const FAST_PRESET = 'mids-fast'
    const SETTINGS_NAMESPACE = 'dsh-mids-fast'
    const DEFAULTS = {
      execution: { provider: 'deepseek-official', model: 'deepseek-flash' },
      planning: { provider: 'mimo', model: 'mimo-v2.6-pro' },
    }

    const buttonStyle = {
      minHeight: 30, padding: '4px 9px', borderRadius: 7,
      border: '1px solid var(--dsw-alias-border, #7775)',
      color: 'var(--dsw-alias-text-secondary, #777)',
      background: 'var(--dsw-alias-surface, Canvas)', fontSize: 12,
      cursor: 'pointer',
    }
    const modelTriggerStyle = {
      display: 'inline-flex', alignItems: 'center', gap: 4,
      minWidth: 0, maxWidth: 'min(360px, 45cqw)', height: 28,
      padding: '0 4px 0 8px', border: 'none', borderRadius: 24,
      color: 'var(--dsw-alias-label-secondary, #777)',
      background: 'transparent', fontSize: 13, lineHeight: '20px', fontWeight: 500,
      cursor: 'pointer',
    }
    const selectStyle = {
      width: '100%', minHeight: 34, padding: '4px 8px', borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border, #7775))',
      color: 'var(--dsw-alias-label-primary, inherit)',
      background: 'var(--dsw-specific-menu, Canvas)',
    }
    function pairFromSettings(value, sessionId) {
      const override = value?.sessionOverrides?.[sessionId]
      return {
        execution: override?.execution ?? value?.defaultExecution ?? DEFAULTS.execution,
        planning: override?.planning ?? value?.defaultPlanning ?? DEFAULTS.planning,
      }
    }

    function flattenCatalog(catalog) {
      return catalog?.groups.flatMap(group => group.models.map(model => ({
        provider: group.id,
        model: model.id,
        label: `${group.name} · ${model.name}`,
        reasoning: model.reasoning,
      }))) ?? []
    }

    function choiceKey(route) {
      return JSON.stringify([route.provider, route.model])
    }

    function modelName(route, catalog) {
      if (!route) return '模型载入中'
      const group = catalog?.groups.find(row => row.id === route.provider)
      return group?.models.find(row => row.id === route.model)?.name ?? route.model
    }

    function effortName(route, catalog) {
      const model = catalog?.groups.find(row => row.id === route?.provider)?.models
        .find(row => row.id === route?.model)
      if (!model?.reasoning) return ''
      const effort = route.reasoningEffort ?? model.reasoning.defaultEffort
      if (!effort) return '默认思考'
      return model.reasoning.efforts.find(row => row.id === effort)?.name ?? effort
    }

    function routeSummary(route, catalog) {
      const effort = effortName(route, catalog)
      return `${modelName(route, catalog)}${effort ? ` · ${effort}` : ''}`
    }

    function routeWithModel(route, choice) {
      const next = { provider: choice.provider, model: choice.model }
      if (choice.reasoning?.defaultEffort) next.reasoningEffort = choice.reasoning.defaultEffort
      return next
    }

    function RouteFields({ route, catalog, catalogState, onChange, busy = false }) {
      const choices = flattenCatalog(catalog)
      const activeKey = choiceKey(route)
      const active = choices.find(row => choiceKey(row) === activeKey)
      const reasoning = active?.reasoning
      return h('div', { style: { display: 'grid', gap: 8 } },
        h('label', { style: { display: 'grid', gap: 4 } },
          h('span', null, '模型'),
          h('select', {
            'aria-label': '模型',
            style: selectStyle,
            disabled: busy || choices.length === 0,
            value: activeKey,
            onChange: event => {
              const choice = choices.find(row => choiceKey(row) === event.target.value)
              if (choice) onChange(routeWithModel(route, choice))
            },
          }, [
            ...(active ? [] : [h('option', { key: 'missing', value: activeKey },
              `${route.provider} · ${route.model}（当前目录中不可用）`)]),
            ...choices.map(choice => h('option', {
              key: choiceKey(choice), value: choiceKey(choice),
            }, choice.label)),
          ]),
        ),
        reasoning && h('label', { style: { display: 'grid', gap: 4 } },
          h('span', null, '思考程度'),
          h('select', {
            'aria-label': '思考程度',
            style: selectStyle,
            disabled: busy,
            value: route.reasoningEffort ?? reasoning.defaultEffort ?? '',
            onChange: event => onChange({
              provider: route.provider,
              model: route.model,
              ...(event.target.value ? { reasoningEffort: event.target.value } : {}),
            }),
          }, [
            ...(!reasoning.defaultEffort
              ? [h('option', { key: 'default', value: '' }, '服务商默认')]
              : []),
            ...reasoning.efforts.map(level => h('option', {
              key: level.id, value: level.id,
            }, level.name)),
          ]),
        ),
        choices.length === 0 && h('div', {
          role: 'status',
          style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #777)' },
        },
          catalogState?.status === 'loading'
            ? '正在加载可用模型…'
            : catalogState?.error
              ? `模型目录加载失败：${catalogState.error}`
              : catalog?.failures?.length
                ? `暂无可选模型。${catalog.failures.map(row => `${row.name}：${row.message}`).join('；')}`
                : catalogState?.status === 'ready'
                  ? '模型目录中没有可选模型。请先在 DSH 的模型设置中配置模型。'
                  : '模型目录尚未加载。'),
      )
    }

    function createDialogStore() {
      let snapshot = { open: false, sessionId: null, revision: 0 }
      const listeners = new Set()
      const publish = next => {
        snapshot = next
        for (const listener of listeners) listener()
      }
      return {
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        getSnapshot() { return snapshot },
        open(sessionId) {
          publish({ open: true, sessionId, revision: snapshot.revision + 1 })
        },
        close() {
          if (!snapshot.open) return
          publish({ open: false, sessionId: null, revision: snapshot.revision })
        },
      }
    }

    function createPresetStore() {
      const selected = new Map()
      const listeners = new Set()
      const publish = () => { for (const listener of listeners) listener() }
      return {
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        getSnapshot(sessionId) { return selected.get(sessionId) },
        select(sessionId, preset) {
          if (selected.get(sessionId) === preset) return
          selected.set(sessionId, preset)
          publish()
        },
        clearMatching(list) {
          let changed = false
          for (const [sessionId, preset] of selected) {
            if (list.byId[sessionId]?.projectionValues?.agentPreset !== preset) continue
            selected.delete(sessionId)
            changed = true
          }
          if (changed) publish()
        },
      }
    }

    function eligibleFastSession(list, sessions, presetStore) {
      const sessionId = list.current
      const summary = sessionId === undefined ? undefined : list.byId[sessionId]
      if (summary?.blank !== true ||
        (presetStore?.getSnapshot(sessionId) ?? summary?.projectionValues?.agentPreset) !== FAST_PRESET) return null
      if (sessions?.subagentAddress?.(sessionId) !== undefined) return null
      if (sessions?.binding?.(sessionId)?.session?.getSnapshot?.()?.promptAttempted === true) return null
      return sessionId
    }

    function watchMidsSessions(sessions, dialogStore, presetStore) {
      let previous = eligibleFastSession(sessions.list.getSnapshot(), sessions, presetStore)
      return sessions.list.subscribe(() => {
        const list = sessions.list.getSnapshot()
        presetStore?.clearMatching(list)
        const current = eligibleFastSession(list, sessions, presetStore)
        const dialog = dialogStore.getSnapshot()
        if (dialog.open && dialog.sessionId !== current) dialogStore.close()
        if (current !== null && current !== previous && dialog.sessionId !== current) dialogStore.open(current)
        previous = current
      })
    }

    // Temporary Web UI shim. The DSH renderer gives every slot a stable
    // data-slot wrapper; its display:contents means the status button's direct
    // sibling is still inside the right slot, not the model selector.
    function shieldNativePicker(marker, onShielded = () => {}) {
      const rightSlot = marker?.closest('[data-slot="conversation.input.right"]')
      const row = rightSlot?.parentElement
      if (!row) { onShielded(false); return () => {} }
      let target = null
      let original = null
      const release = () => {
        if (!target) return
        if (!original.inert) target.removeAttribute('inert')
        target.style.display = original.display
        target.removeAttribute('data-mids-fast-native-blocked')
        target = null
        original = null
      }
      const sync = () => {
        const candidate = rightSlot.nextElementSibling
        const next = candidate?.getAttribute('data-slot') === 'conversation.input.model'
          ? candidate : null
        if (next === target) return
        release()
        if (next) {
          const button = next.querySelector('button[aria-haspopup="menu"]')
          if (button?.getAttribute('aria-expanded') === 'true') button.click()
          target = next
          original = {
            inert: target.hasAttribute('inert'),
            display: target.style.display,
          }
          target.setAttribute('inert', '')
          target.style.display = 'none'
          target.setAttribute('data-mids-fast-native-blocked', '')
        }
        onShielded(Boolean(target))
      }
      const Observer = row.ownerDocument.defaultView?.MutationObserver
      const observer = Observer ? new Observer(sync) : null
      observer?.observe(row, { childList: true })
      sync()
      return () => { observer?.disconnect(); release() }
    }

    function MidsStatus({
      sessionId, useSessions, useSession, useProjection,
      settingsScope, catalogStore, loadCatalog, dialogStore, presetStore, subagent,
    }) {
      const summary = useSessions(state => state.byId[sessionId])
      const session = useSession(state => state)
      const projected = useProjection('modelSelection')
      const settings = React.useSyncExternalStore(
        listener => settingsScope.subscribe(listener),
        () => settingsScope.getSnapshot(),
        () => settingsScope.getSnapshot(),
      )
      React.useSyncExternalStore(
        catalogStore.subscribe, catalogStore.getSnapshot, catalogStore.getSnapshot,
      )
      const selectedPreset = React.useSyncExternalStore(
        presetStore.subscribe,
        () => presetStore.getSnapshot(sessionId),
        () => presetStore.getSnapshot(sessionId),
      )
      const [shielded, setShielded] = React.useState(null)
      const marker = React.useRef(null)
      const isFast = (selectedPreset ?? summary?.projectionValues?.agentPreset) === FAST_PRESET
      const started = summary?.blank === false || session?.promptAttempted === true
      React.useEffect(() => {
        if (!isFast || subagent) return
        loadCatalog().catch(() => {})
      }, [isFast, subagent, loadCatalog])
      React.useLayoutEffect(() => {
        if (!isFast || subagent) return
        return shieldNativePicker(marker.current, setShielded)
      }, [isFast, subagent])
      if (!isFast || subagent) return null

      const catalog = catalogStore.value()
      const pair = pairFromSettings(settings.value, sessionId)
      const text = '按需规划 · 执行 ' + modelName(pair.execution, catalog)
        + ' · 规划 ' + modelName(pair.planning, catalog)
      const visibleText = '按需规划 · ' + modelName(pair.execution, catalog)
      const recent = projected?.lastUsed
        ? '；最近调用 ' + routeSummary(projected.lastUsed, catalog) : ''
      return h('button', {
        ref: marker,
        type: 'button',
        'data-mids-fast-status': '',
        disabled: started,
        title: text + recent + (shielded === false ? '；原生模型按钮未能屏蔽' : ''),
        'aria-label': text + (started ? '，本会话模型配置已固定' : '，点击配置模型'),
        onClick: () => dialogStore.open(sessionId),
        style: {
          ...modelTriggerStyle,
          maxWidth: 'min(185px, 30cqw)',
          cursor: started ? 'default' : 'pointer',
          opacity: started ? 0.8 : 1,
          color: shielded === false
            ? 'var(--dsw-alias-label-warning, #ad6722)'
            : 'var(--dsw-alias-label-secondary, #777)',
        },
      },
        h(IconDataOutline16, { size: 16 }),
        h('span', {
          style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, visibleText),
        !started && h(IconChevronDownOutline14, null),
      )
    }

    function MidsDialog({
      dialogStore, sessions, presetStore, settingsScope, catalogStore, loadCatalog, saveSettings,
    }) {
      const dialog = React.useSyncExternalStore(
        dialogStore.subscribe, dialogStore.getSnapshot, dialogStore.getSnapshot,
      )
      const list = React.useSyncExternalStore(
        listener => sessions.list.subscribe(listener),
        () => sessions.list.getSnapshot(),
        () => sessions.list.getSnapshot(),
      )
      const settings = React.useSyncExternalStore(
        listener => settingsScope.subscribe(listener),
        () => settingsScope.getSnapshot(),
        () => settingsScope.getSnapshot(),
      )
      React.useSyncExternalStore(
        catalogStore.subscribe, catalogStore.getSnapshot, catalogStore.getSnapshot,
      )
      const [draft, setDraft] = React.useState(() => pairFromSettings(settings.value, dialog.sessionId))
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const panel = React.useRef(null)
      const active = dialog.open && eligibleFastSession(list, sessions, presetStore) === dialog.sessionId
      const catalog = catalogStore.value()
      const catalogState = catalogStore.state()

      React.useEffect(() => {
        if (!active) return
        setDraft(pairFromSettings(settingsScope.getSnapshot().value, dialog.sessionId))
        setDirty(false)
        setError(null)
        loadCatalog().catch(reason => setError(String(reason?.message ?? reason)))
      }, [active, dialog.revision, dialog.sessionId, loadCatalog])
      React.useEffect(() => {
        if (!active || dirty || !settings.value) return
        setDraft(pairFromSettings(settings.value, dialog.sessionId))
      }, [active, dirty, settings.revision, settings.value, dialog.sessionId])
      React.useEffect(() => {
        if (!active) return
        const previousFocus = document.activeElement
        panel.current?.focus()
        return () => { previousFocus?.focus?.() }
      }, [active, dialog.revision])

      if (!active) return null
      const change = (role, route) => {
        setDraft(current => ({ ...current, [role]: route }))
        setDirty(true)
      }
      const close = () => { if (!busy) dialogStore.close() }
      const save = async () => {
        if (!dirty || busy || settings.status !== 'ready' || !settings.writable
          || catalogState.status !== 'ready') return
        const current = sessions.list.getSnapshot()
        const bound = sessions.binding?.(dialog.sessionId)?.session?.getSnapshot?.()
        if (eligibleFastSession(current, sessions, presetStore) !== dialog.sessionId || bound?.promptAttempted === true) {
          setError('会话已经开始，不能再修改模型')
          return
        }
        setBusy(true)
        setError(null)
        try {
          await saveSettings([{
            op: 'set', path: ['sessionOverrides', dialog.sessionId], value: draft,
          }], { unfenced: true })
          dialogStore.close()
        } catch (reason) {
          setError(String(reason?.message ?? reason))
        } finally {
          setBusy(false)
        }
      }
      const onKeyDown = event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return }
        if (event.key !== 'Tab') return
        const controls = [...panel.current.querySelectorAll('button:not([disabled]), select:not([disabled])')]
        if (controls.length === 0) return
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus()
        }
      }
      const canSave = dirty && !busy && settings.status === 'ready'
        && settings.writable && catalogState.status === 'ready'
      const status = settings.status !== 'ready'
        ? '插件设置尚未就绪，可以关闭窗口使用默认模型'
        : !settings.writable
          ? '插件设置为只读，无法保存自定义模型'
          : catalogState.status === 'loading'
            ? '正在加载可用模型…'
            : catalogState.error
              ? '模型目录加载失败：' + catalogState.error
              : null
      return h('div', {
        'data-mids-fast-backdrop': '',
        onMouseDown: event => { if (event.target === event.currentTarget) close() },
        style: {
          position: 'fixed', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center',
          padding: 16, background: 'rgba(0, 0, 0, 0.48)', pointerEvents: 'auto',
        },
      }, h('div', {
        ref: panel, tabIndex: -1, role: 'dialog', 'aria-modal': true,
        'aria-labelledby': 'mids-fast-dialog-title', onKeyDown,
        style: {
          width: 'min(620px, 100%)', maxHeight: 'min(80vh, 760px)', overflowY: 'auto',
          padding: 22, borderRadius: 16,
          background: 'var(--dsw-alias-bg-layer-1, Canvas)',
          color: 'var(--dsw-alias-label-primary, CanvasText)',
          border: '1px solid var(--dsw-alias-border-l1, #7775)',
          boxShadow: 'var(--dsw-shadow-lv3, 0 12px 40px #0005)',
          display: 'grid', gap: 16,
        },
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12 } },
          h('div', null,
            h('h2', { id: 'mids-fast-dialog-title', style: { margin: 0, fontSize: 18 } },
              '配置按需规划模型'),
            h('p', { style: { margin: '6px 0 0', fontSize: 13, opacity: 0.75 } },
              '关闭窗口将使用当前默认模型；开始对话后本会话的配置固定。'),
          ),
          h('button', {
            type: 'button', onClick: close, disabled: busy,
            'aria-label': '关闭模型配置',
            style: { ...buttonStyle, alignSelf: 'start' },
          }, '关闭'),
        ),
        ...[
          ['execution', '执行模型'],
          ['planning', '规划模型'],
        ].map(([role, label]) => h('section', { key: role, style: { display: 'grid', gap: 8 } },
          h('h3', { style: { margin: 0, fontSize: 14 } }, label),
          h(RouteFields, {
            route: draft[role], catalog, catalogState, busy,
            onChange: route => change(role, route),
          }),
        )),
        status && h('p', { role: 'status', style: { margin: 0, fontSize: 12 } }, status),
        error && h('p', { role: 'alert', style: { margin: 0, color: '#c44', fontSize: 12 } }, error),
        catalogState.status === 'error' && h('button', {
          type: 'button', style: buttonStyle,
          onClick: () => loadCatalog(true).catch(reason => setError(String(reason?.message ?? reason))),
        }, '重试加载模型'),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
          h('button', { type: 'button', onClick: close, disabled: busy, style: buttonStyle },
            '使用默认配置'),
          h('button', {
            type: 'button', onClick: () => { void save() }, disabled: !canSave,
            style: { ...buttonStyle, opacity: canSave ? 1 : 0.55 },
          }, busy ? '保存中…' : '保存此会话配置'),
        ),
      ))
    }

    function DefaultsCard({ settingsScope, loadCatalog, catalogStore, saveSettings }) {
      const snapshot = React.useSyncExternalStore(
        fn => settingsScope.subscribe(fn),
        () => settingsScope.getSnapshot(),
        () => settingsScope.getSnapshot(),
      )
      const catalogVersion = React.useSyncExternalStore(
        catalogStore.subscribe, catalogStore.getSnapshot, catalogStore.getSnapshot,
      )
      const catalog = catalogStore.value()
      const catalogState = catalogStore.state()
      const [draft, setDraft] = React.useState(() => ({
        execution: { ...DEFAULTS.execution }, planning: { ...DEFAULTS.planning },
      }))
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        loadCatalog().catch(reason => setError(String(reason?.message ?? reason)))
      }, [loadCatalog, catalogVersion])
      React.useEffect(() => {
        if (dirty || !snapshot.value) return
        setDraft({
          execution: { ...snapshot.value.defaultExecution },
          planning: { ...snapshot.value.defaultPlanning },
        })
      }, [snapshot.value, dirty])

      const change = (key, route) => {
        setDraft(current => ({ ...current, [key]: route }))
        setDirty(true)
      }
      const save = async () => {
        setBusy(true)
        setError(null)
        try {
          await saveSettings([
            { op: 'set', path: ['defaultExecution'], value: draft.execution },
            { op: 'set', path: ['defaultPlanning'], value: draft.planning },
          ])
          setDirty(false)
        } catch (reason) {
          setError(String(reason?.message ?? reason))
        } finally {
          setBusy(false)
        }
      }

      return h('section', { style: {
        padding: 18, border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)', marginBottom: 14,
      } },
        h('h3', { style: { margin: '0 0 6px' } }, '按需规划默认模型'),
        h('p', { style: { margin: '0 0 16px', color: 'var(--dsw-alias-text-secondary, #777)', fontSize: 13 } },
          '新会话未单独配置时使用这两条路线。执行模型判断复杂度并负责执行；规划模型只在复杂任务中调用。'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 18 } },
          ...[
            ['execution', '默认执行模型'],
            ['planning', '默认规划模型'],
          ].map(([key, label]) => h('div', { key },
            h('h4', { style: { margin: '0 0 8px' } }, label),
            h(RouteFields, {
              route: draft[key], catalog, catalogState, busy,
              onChange: route => change(key, route),
            }),
          )),
        ),
        error && h('div', { role: 'alert', style: { color: '#c44', marginTop: 10 } }, error),
        (catalogState.status === 'error' || (catalog?.failures?.length ?? 0) > 0) && h('button', {
          type: 'button',
          style: { ...buttonStyle, maxWidth: 'none', height: 'auto', padding: '6px 8px' },
          onClick: () => {
            setError(null)
            loadCatalog(true).catch(reason => setError(String(reason?.message ?? reason)))
          },
        }, '重试加载模型'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 } },
          h('button', {
            type: 'button', disabled: busy || !dirty || snapshot.status !== 'ready' || !snapshot.writable,
            style: buttonStyle, onClick: () => void save(),
          }, busy ? '保存中…' : '保存默认模型'),
          snapshot.status === 'unavailable' && h('span', { style: { fontSize: 12, color: '#a66' } }, '当前设置服务不可写'),
        ),
      )
    }

    function apply(ctx) {
      let catalog = null
      let loading = null
      let catalogStatus = 'idle'
      let catalogError = null
      let catalogRevision = 0
      const catalogListeners = new Set()
      const catalogStore = {
        subscribe(listener) { catalogListeners.add(listener); return () => catalogListeners.delete(listener) },
        getSnapshot() { return catalogRevision },
        value() { return catalog },
        state() { return { status: catalogStatus, error: catalogError } },
      }
      const publishCatalog = () => {
        catalogRevision += 1
        for (const listener of catalogListeners) listener()
      }
      const invalidateCatalog = () => {
        catalog = null
        loading = null
        catalogStatus = 'idle'
        catalogError = null
        publishCatalog()
      }
      const loadCatalog = (force = false) => {
        if (force) {
          catalog = null
          loading = null
          catalogStatus = 'idle'
          catalogError = null
          publishCatalog()
        }
        if (catalog) return Promise.resolve(catalog)
        if (loading) return loading
        catalogStatus = 'loading'
        catalogError = null
        publishCatalog()
        loading = ctx.remote.session.modelCatalog().then(result => {
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
          catalog = result.value
          catalogStatus = 'ready'
          catalogError = null
          publishCatalog()
          return catalog
        }).catch(reason => {
          catalogStatus = 'error'
          catalogError = String(reason?.message ?? reason)
          publishCatalog()
          throw reason
        }).finally(() => { loading = null })
        return loading
      }
      const settingsScope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE })
      const saveSettings = async (ops, { unfenced = false } = {}) => {
        const revision = unfenced ? undefined : settingsScope.getSnapshot().revision
        const result = await ctx.remote.settings.mutate(SETTINGS_NAMESPACE, ops, revision)
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      }
      const dialogStore = createDialogStore()
      const presetStore = createPresetStore()
      const isSubagent = sessionId => ctx.sessions.subagentAddress(sessionId) !== undefined

      ctx.on('connection/reset', invalidateCatalog)
      ctx.remote.$on('llm/adapters-updated', invalidateCatalog)
      ctx.effect(() => ctx.remote.$on('agent-preset/selected', (sessionId, preset) => {
        presetStore.select(sessionId, preset)
        const list = ctx.sessions.list.getSnapshot()
        if (list.current !== sessionId) return
        if (preset === FAST_PRESET && eligibleFastSession(list, ctx.sessions, presetStore) === sessionId) {
          dialogStore.open(sessionId)
        } else if (dialogStore.getSnapshot().sessionId === sessionId) {
          dialogStore.close()
        }
      }), 'dsh-adaptive-plan: track preset changes')
      ctx.remote.$on('settings/document-updated', (namespace) => {
        if (namespace === SETTINGS_NAMESPACE) return
        invalidateCatalog()
      })

      ctx.effect(() => watchMidsSessions(ctx.sessions, dialogStore, presetStore),
        'dsh-adaptive-plan: open model dialog for a blank Adaptive Plan session')

      ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'dsh-adaptive-plan-status',
        order: 1000000,
        inject: sessionId => ({
          dialogStore,
          presetStore,
          settingsScope,
          loadCatalog,
          catalogStore,
          subagent: isSubagent(sessionId),
        }),
      }, MidsStatus)), 'dsh-adaptive-plan:status')

      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-adaptive-plan-dialog',
        order: 100,
        inject: () => ({
          dialogStore,
          sessions: ctx.sessions,
          presetStore,
          settingsScope,
          catalogStore,
          loadCatalog,
          saveSettings,
        }),
      }, MidsDialog)), 'dsh-adaptive-plan:dialog')

      ctx.effect(() => ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: SETTINGS_NAMESPACE,
        inject: () => ({ settingsScope, loadCatalog, catalogStore, saveSettings }),
      }, DefaultsCard)), 'dsh-adaptive-plan:defaults')

    }

    module.exports = {
      apply, inject, choiceKey, RouteFields, createDialogStore, createPresetStore,
      watchMidsSessions, shieldNativePicker, MidsStatus, MidsDialog,
    }
    return module.exports
  },
})
