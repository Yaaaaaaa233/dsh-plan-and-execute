import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

function loadClient() {
  let registration
  const window = { __ModuleLoader__: { load(value) { registration = value } } }
  vm.runInNewContext(clientSource, { window })
  const hookValues = []
  let hookCursor = 0
  const React = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      return { type, props: { ...props, children: children.length === 1 ? children[0] : children } }
    },
    useState(initial) {
      const index = hookCursor++
      if (!(index in hookValues)) hookValues[index] = typeof initial === 'function' ? initial() : initial
      return [hookValues[index], next => {
        hookValues[index] = typeof next === 'function' ? next(hookValues[index]) : next
      }]
    },
    useEffect() {},
    useLayoutEffect() {},
    useRef(initial) { return { current: initial } },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
  }
  const icons = { IconDataOutlineRegular() {}, IconChevronDownOutlineRegular() {}, Modal() {}, Menu() {}, Button: 'button' }
  const exported = registration.factory(id => {
    if (id === 'react') return React
    if (id === 'react-dom') return { createPortal: node => node }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return icons
    throw new Error(`unexpected client module: ${id}`)
  })
  return {
    client: exported,
    render(component) {
      hookCursor = 0
      return component()
    },
  }
}

test('model route option keys round-trip provider and model ids without delimiter ambiguity', () => {
  const { client } = loadClient()
  const first = { provider: 'provider/with/slashes', model: 'model:with:punctuation' }
  const second = { provider: 'provider/with', model: 'slashes/model:with:punctuation' }
  assert.notEqual(client.choiceKey(first), client.choiceKey(second))
  assert.equal(client.choiceKey(first).includes('\0'), false)
})

test('choosing an actual model option updates the selected route', () => {
  const { client } = loadClient()
  const chosen = { provider: 'provider-a', model: 'model-a' }
  const catalog = {
    groups: [{
      id: chosen.provider,
      name: 'Provider A',
      models: [{ id: chosen.model, name: 'Model A', reasoning: { efforts: [], defaultEffort: 'high' } }],
    }],
  }
  let selected
  const element = client.RouteFields({
    route: { provider: 'provider-b', model: 'model-b' },
    catalog,
    onChange: value => { selected = value },
  })
  const modelSelect = element.props.children[0].props.children[1]
  modelSelect.props.onChange({ target: { value: client.choiceKey(chosen) } })
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), { ...chosen, reasoningEffort: 'high' })
})

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) return node.map(child => findNode(child, predicate)).find(Boolean)
  if (predicate(node)) return node
  return findNode([node.props?.children, node.props?.footer], predicate)
}

test('new blank Adaptive Plan session opens its dialog, while ordinary and started sessions do not', () => {
  const { client } = loadClient()
  const dialog = client.createDialogStore()
  let listener
  let list = {
    byId: { s1: { retainedBy: { mainView: 1 }, blank: true, projectionValues: { agentPreset: 'standard' } } },
  }
  const sessions = { list: {
    getSnapshot: () => list,
    subscribe: fn => { listener = fn; return () => { listener = undefined } },
  } }
  const stop = client.watchMidsSessions(sessions, dialog)
  assert.equal(dialog.getSnapshot().open, false)
  list = { byId: { s1: {
    retainedBy: { mainView: 1 }, blank: true, projectionValues: { agentPreset: 'mids-fast' },
  } } }
  listener()
  assert.equal(dialog.getSnapshot().sessionId, 's1')
  list = { byId: { s1: {
    retainedBy: { mainView: 1 }, blank: false, projectionValues: { agentPreset: 'mids-fast' },
  } } }
  listener()
  assert.equal(dialog.getSnapshot().open, false)
  list = { byId: { s2: {
    retainedBy: { mainView: 1 }, blank: true, projectionValues: { agentPreset: 'standard' },
  } } }
  listener()
  assert.equal(dialog.getSnapshot().open, false)
  stop()
})

test('preset selection event updates the status before the session projection catches up', () => {
  const { client } = loadClient()
  const store = client.createPresetStore()
  let updates = 0
  const stop = store.subscribe(() => { updates++ })
  store.select('s1', 'mids-fast')
  assert.equal(store.getSnapshot('s1'), 'mids-fast')
  store.clearMatching({ byId: { s1: { projectionValues: { agentPreset: 'standard' } } } })
  assert.equal(store.getSnapshot('s1'), 'mids-fast')
  store.clearMatching({ byId: { s1: { projectionValues: { agentPreset: 'mids-fast' } } } })
  assert.equal(store.getSnapshot('s1'), undefined)
  assert.equal(updates, 2)
  stop()
})

test('independent Adaptive Plan dialog saves selected execution and planning routes', async () => {
  const h = loadClient()
  const catalog = {
    groups: [
      { id: 'exec', name: 'Exec', models: [{
        id: 'fast', name: 'Fast', reasoning: {
          defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
        },
      }, { id: 'other', name: 'Other' }] },
      { id: 'plan', name: 'Plan', models: [{ id: 'planner', name: 'Planner' }, { id: 'alternate', name: 'Alternate' }] },
    ],
    failures: [],
  }
  const settingsValue = {
    defaultExecution: { provider: 'exec', model: 'fast' },
    defaultPlanning: { provider: 'plan', model: 'planner' },
    sessionOverrides: {},
  }
  const snapshot = { status: 'ready', writable: true, revision: 1, value: settingsValue }
  const writes = []
  const dialogStore = h.client.createDialogStore()
  dialogStore.open('session-1')
  const props = {
    dialogStore,
    sessions: {
      list: {
        subscribe: () => () => {},
        getSnapshot: () => ({ byId: { 'session-1': {
          retainedBy: { mainView: 1 }, blank: true, projectionValues: { agentPreset: 'mids-fast' },
        } } }),
      },
      binding: () => ({ session: { getSnapshot: () => ({ promptAttempted: false }) } }),
    },
    settingsScope: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    loadCatalog: async () => catalog,
    catalogStore: {
      subscribe: () => () => {}, getSnapshot: () => 1,
      value: () => catalog, state: () => ({ status: 'ready', error: null }),
    },
    saveSettings: async ops => { writes.push(ops) },
  }
  const render = () => h.render(() => h.client.MidsDialog(props))
  let fields = []
  const collectFields = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(collectFields); return }
    if (node.type === h.client.RouteFields) fields.push(node)
    collectFields(node.props?.children)
  }
  collectFields(render())
  assert.equal(fields.length, 2)
  fields[0].props.onChange({ provider: 'exec', model: 'fast', reasoningEffort: 'high' })
  fields[1].props.onChange({ provider: 'plan', model: 'alternate' })
  const save = findNode(render(), node => node.type === 'button'
    && node.props.children === '保存此会话配置')
  assert.equal(save.props.disabled, false)
  save.props.onClick()
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(writes.length, 1)
  const savedPair = writes[0][0].value
  assert.deepEqual(JSON.parse(JSON.stringify(savedPair.execution)), {
    provider: 'exec', model: 'fast', reasoningEffort: 'high',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(savedPair.planning)), {
    provider: 'plan', model: 'alternate',
  })
  assert.equal(dialogStore.getSnapshot().open, false)
})

test('Adaptive Plan dialog can close without saving when plugin settings are unavailable', () => {
  const h = loadClient()
  const dialogStore = h.client.createDialogStore()
  dialogStore.open('blank-session')
  const props = {
    dialogStore,
    sessions: { list: {
      subscribe: () => () => {},
      getSnapshot: () => ({ byId: { 'blank-session': {
        retainedBy: { mainView: 1 }, blank: true, projectionValues: { agentPreset: 'mids-fast' },
      } } }),
    } },
    settingsScope: {
      subscribe: () => () => {},
      getSnapshot: () => ({ status: 'loading', writable: false, revision: 1, value: null }),
    },
    loadCatalog: async () => ({ groups: [] }),
    catalogStore: {
      subscribe: () => () => {}, getSnapshot: () => 1,
      value: () => null, state: () => ({ status: 'loading', error: null }),
    },
    saveSettings: async () => { throw new Error('save should be disabled') },
  }
  const modal = h.render(() => h.client.MidsDialog(props))
  assert.ok(modal)
  const save = findNode(modal, node => node.type === 'button'
    && node.props.children === '保存此会话配置')
  assert.equal(save.props.disabled, true)
  const close = findNode(modal, node => node.type === 'button'
    && node.props.children === '保持当前配置')
  close.props.onClick()
  assert.equal(dialogStore.getSnapshot().open, false)
})

test('official model seat delegates unchanged to its registered occupant outside Adaptive Plan', () => {
  const { client } = loadClient()
  const Native = () => null
  const directory = { route: 'original' }
  const t = key => `native.${key}`
  const presets = client.createPresetStore()
  const props = {
    sessionId: 's1', locked: true,
    useSessions: select => select({ byId: { s1: { projectionValues: { agentPreset: 'standard' } } } }),
    presetStore: presets, locale: { bind: () => t },
    slots: {
      subscribe: () => () => {}, getVersion: () => 1,
      entries: () => [{ component: client.ModelSeat }, {
        component: Native, locale: 'model', inject: sessionId => ({ directory, available: sessionId === 's1' }),
      }],
    },
  }
  const original = client.ModelSeat(props)
  assert.equal(original.type, Native)
  assert.equal(original.props.directory, directory)
  assert.equal(original.props.t, t)
  assert.equal(original.props.locked, true)
  presets.select('s1', 'mids-fast')
  assert.equal(client.ModelSeat(props).type, client.MidsStatus, 'selection event takes effect before projection update')
  presets.select('s1', 'standard')
  assert.equal(client.ModelSeat(props).type, Native)
})

test('started Adaptive Plan session exposes a disabled status with the actual last-used model', () => {
  const { client } = loadClient()
  const node = client.MidsStatus({
    sessionId: 'started', subagent: false, locked: false,
    useSessions: select => select({ byId: { started: { retainedBy: { mainView: 1 }, blank: false, projectionValues: { agentPreset: 'mids-fast' } } } }),
    useSession: select => select({ promptAttempted: true }),
    useProjection: () => ({ lastUsed: { provider: 'plan', model: 'planner' } }),
    settingsScope: { subscribe: () => () => {}, getSnapshot: () => ({ value: null }) },
    catalogStore: { subscribe: () => () => {}, getSnapshot: () => 1, value: () => ({ groups: [{ id: 'plan', models: [{id:'planner', name:'Current Planner'}] }] }) },
    presetStore: client.createPresetStore(), dialogStore: client.createDialogStore(), loadCatalog: async () => {},
  })
  assert.equal(node.props.disabled, true)
  assert.equal(findNode(node, row => row.type === 'span').props.children, '按需规划 · Current Planner')
})
