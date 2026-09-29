import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

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
  const icons = { IconDataOutline16() {}, IconChevronDownOutline14() {}, Menu() {} }
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
  return findNode(node.props?.children, predicate)
}

test('new blank Adaptive Plan session opens its dialog, while ordinary and started sessions do not', () => {
  const { client } = loadClient()
  const dialog = client.createDialogStore()
  let listener
  let list = {
    current: 's1',
    byId: { s1: { blank: true, projectionValues: { agentPreset: 'standard' } } },
  }
  const sessions = { list: {
    getSnapshot: () => list,
    subscribe: fn => { listener = fn; return () => { listener = undefined } },
  } }
  const stop = client.watchMidsSessions(sessions, dialog)
  assert.equal(dialog.getSnapshot().open, false)
  list = { current: 's1', byId: { s1: {
    blank: true, projectionValues: { agentPreset: 'mids-fast' },
  } } }
  listener()
  assert.equal(dialog.getSnapshot().sessionId, 's1')
  list = { current: 's1', byId: { s1: {
    blank: false, projectionValues: { agentPreset: 'mids-fast' },
  } } }
  listener()
  assert.equal(dialog.getSnapshot().open, false)
  list = { current: 's2', byId: { s2: {
    blank: true, projectionValues: { agentPreset: 'standard' },
  } } }
  listener()
  assert.equal(dialog.getSnapshot().open, false)
  stop()
})

test('native model slot is hidden only while the Adaptive Plan shield is mounted', async () => {
  const { client } = loadClient()
  const dom = new JSDOM('<div id="row"><div data-slot="conversation.input.right"><button id="marker"></button></div><div id="native" data-slot="conversation.input.model" style="display: contents"><div><button aria-haspopup="menu">Original</button></div></div><span>Other</span></div>')
  const doc = dom.window.document
  const marker = doc.getElementById('marker')
  const native = doc.getElementById('native')
  const states = []
  const stop = client.shieldNativePicker(marker, value => states.push(value))
  assert.equal(native.hasAttribute('inert'), true)
  assert.equal(native.style.display, 'none')
  assert.equal(doc.querySelector('span').hasAttribute('inert'), false)
  assert.deepEqual(states, [true])
  native.remove()
  await new Promise(resolve => dom.window.queueMicrotask(resolve))
  assert.equal(states.at(-1), false)
  stop()
  assert.equal(native.hasAttribute('inert'), false)
  assert.equal(native.style.display, 'contents')
  dom.window.close()
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

test('mounted Adaptive Plan status shields the stock selector and restores it after leaving the preset', async () => {
  const dom = new JSDOM('<div id="app"></div>')
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  try {
    const React = require('react')
    const { act } = React
    const { createRoot } = require('react-dom/client')
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    let registration
    vm.runInNewContext(clientSource, {
      window: { __ModuleLoader__: { load(value) { registration = value } } },
    })
    const client = registration.factory(id => {
      if (id === 'react') return React
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return {
        IconDataOutline16: () => null, IconChevronDownOutline14: () => null,
      }
      throw new Error(`unexpected client module: ${id}`)
    })
    const dialogStore = client.createDialogStore()
    const presetStore = client.createPresetStore()
    const snapshot = { status: 'ready', writable: true, revision: 1, value: null }
    let preset = 'standard'
    const props = {
      sessionId: 's1',
      useSessions: select => select({ byId: { s1: {
        blank: true, projectionValues: { agentPreset: preset },
      } } }),
      useSession: select => select({ promptAttempted: false }),
      useProjection: () => ({}),
      settingsScope: { subscribe: () => () => {}, getSnapshot: () => snapshot },
      catalogStore: {
        subscribe: () => () => {}, getSnapshot: () => 1,
        value: () => ({ groups: [] }),
      },
      loadCatalog: async () => ({ groups: [] }),
      dialogStore,
      presetStore,
      subagent: false,
    }
    const root = createRoot(dom.window.document.getElementById('app'))
    const render = () => React.createElement('div', null,
      React.createElement('div', { 'data-slot': 'conversation.input.right', style: { display: 'contents' } },
        React.createElement(client.MidsStatus, props)),
      React.createElement('div', { id: 'native', 'data-slot': 'conversation.input.model', style: { display: 'contents' } },
        React.createElement('div', null, React.createElement('button', { 'aria-haspopup': 'menu' }, 'Original'))),
    )
    await act(async () => { root.render(render()) })
    const native = dom.window.document.getElementById('native')
    assert.equal(native.style.display, 'contents')
    assert.equal(dom.window.document.querySelector('[data-mids-fast-status]'), null)
    await act(async () => { presetStore.select('s1', 'mids-fast') })
    assert.equal(native.style.display, 'none')
    const status = dom.window.document.querySelector('[data-mids-fast-status]')
    await act(async () => { status.click() })
    assert.equal(dialogStore.getSnapshot().open, true)
    preset = 'mids-fast'
    await act(async () => { root.render(render()) })
    await act(async () => { presetStore.clearMatching({ byId: { s1: { projectionValues: { agentPreset: preset } } } }) })
    assert.equal(native.style.display, 'none')
    await act(async () => { presetStore.select('s1', 'standard') })
    assert.equal(native.hasAttribute('inert'), false)
    assert.equal(native.style.display, 'contents')
    assert.equal(dom.window.document.querySelector('[data-mids-fast-status]'), null)
    preset = 'standard'
    await act(async () => { root.render(render()) })
    await act(async () => { root.unmount() })
  } finally {
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    dom.window.close()
  }
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
        getSnapshot: () => ({ current: 'session-1', byId: { 'session-1': {
          blank: true, projectionValues: { agentPreset: 'mids-fast' },
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
      getSnapshot: () => ({ current: 'blank-session', byId: { 'blank-session': {
        blank: true, projectionValues: { agentPreset: 'mids-fast' },
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
    && node.props.children === '使用默认配置')
  close.props.onClick()
  assert.equal(dialogStore.getSnapshot().open, false)
})
