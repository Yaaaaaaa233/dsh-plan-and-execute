import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, routesForSession, createRouteSnapshots } from '../lib/router.js'
import { EXECUTION_ROUTE_OPTION, EXECUTOR_PERSONA } from '../lib/delegation.js'

function fixture() {
  const listeners = new Map()
  const definitions = new Map()
  let guard
  const settings = {
    defaultExecution: { provider: 'exec', model: 'fast', reasoningEffort: 'low' },
    defaultPlanning: { provider: 'plan', model: 'deep', reasoningEffort: 'high' },
    sessionOverrides: {},
    get(key) { return key === 'dsh-mids-fast' ? this : undefined },
    async update(_key, patch) {
      this.sessionOverrides = { ...this.sessionOverrides, ...patch.sessionOverrides }
    },
  }
  const snapshots = createRouteSnapshots(() => settings)
  apply({
    on(name, fn) { listeners.set(name, fn) },
    adaptivePlanSettings: {
      get: () => settings,
      ...snapshots,
      async freeze(sessionId, routes) { settings.sessionOverrides[sessionId] = structuredClone(routes) },
    },
    tools: {
      guard(fn) { guard = fn },
      register(definition) { definitions.set(definition.name, definition) },
    },
  })
  const agent = {
    session: { id: 'session-1' },
    steered: [],
    steer(message) { this.steered.push(message) },
  }
  const signal = new AbortController().signal
  const preStep = (turn, step) => listeners.get('agent/pre-step')(
    { agent, turn, step, signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
  const route = (turn, step, base = {}) => listeners.get('agent/request')(
    { agent, turn, step, signal }, async () => base,
  )
  const call = (name, args = {}) => definitions.get(name).execute(args, { agent })
  const allowed = name => guard({ agent, name }) === undefined
  return { listeners, definitions, snapshots, agent, signal, preStep, route, call, allowed, settings }
}

test('simple turns use the configured execution model and keep its reasoning effort', async () => {
  const h = fixture()
  const selected = { provider: 'mimo', model: 'mimo-v2.6-pro', reasoningEffort: 'high' }
  assert.deepEqual(await h.route(1, 1, selected), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
  assert.equal((await h.preStep(1, 1)).messages.length, 1)
  assert.deepEqual(await h.route(1, 2, selected), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
  assert.deepEqual(await h.route(2, 1, selected), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
  assert.deepEqual(h.settings.sessionOverrides['session-1'], {
    mode: 'fast',
    compaction: 'current',
    execution: { provider: 'exec', model: 'fast', reasoningEffort: 'low' },
    planning: { provider: 'plan', model: 'deep', reasoningEffort: 'high' },
  })
})

test('compression defaults freeze per session; current-turn compression and idle manual compression use the appropriate snapshot', async () => {
  const h = fixture()
  h.settings.defaultCompaction = 'planning'
  h.agent.status = 'running'
  await h.route(1, 1)
  const service = h.snapshots
  assert.equal(service.forCompaction(h.agent).compaction, 'planning')
  h.settings.sessionOverrides['session-1'] = {
    ...h.settings.sessionOverrides['session-1'], compaction: 'current',
    planning: { provider: 'new', model: 'planner' },
  }
  assert.equal(service.forCompaction(h.agent).compaction, 'planning')
  h.agent.status = 'idle'
  assert.equal(service.forCompaction(h.agent).compaction, 'current')
  h.agent.status = 'running'
  await h.preStep(2, 1)
  assert.equal(service.forCompaction(h.agent).planning.model, 'planner')
  assert.equal(service.forCompaction(h.agent).compaction, 'current')
  h.settings.defaultCompaction = 'planning'
  h.settings.sessionOverrides.legacy = { execution: h.settings.defaultExecution, planning: h.settings.defaultPlanning }
  assert.equal(routesForSession(h.settings, 'legacy').compaction, 'current')
})

test('complex turn routes the configured planner then executor in one Agent', async () => {
  const h = fixture()
  await h.route(1, 1)
  assert.equal((await h.call('mids_plan')).phase, 'planning')
  assert.equal(h.allowed('read'), true)
  assert.equal(h.allowed('write'), false)
  assert.equal(h.allowed('mids_submit_plan'), true)
  assert.deepEqual(await h.route(1, 2), { provider: 'plan', model: 'deep', reasoningEffort: 'high' })
  await h.call('mids_submit_plan', { plan: 'Inspect, edit, verify.' })
  assert.equal(h.allowed('write'), false, 'other calls in the MiMo tool batch stay blocked')
  await h.preStep(1, 3)
  assert.equal(h.allowed('write'), true)
  assert.deepEqual(await h.route(1, 3), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
  assert.equal(h.allowed('mids_plan'), false)
})

test('plain planning-model text hands the same turn back to the execution model', async () => {
  const h = fixture()
  await h.route(1, 1)
  await h.call('mids_plan')
  h.listeners.get('agent/turn-stopping')({ agent: h.agent, turn: 1, signal: h.signal })
  assert.equal(h.agent.steered.length, 1)
  assert.deepEqual(await h.route(1, 3), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
})

test('a saved session route overrides plugin defaults for both phases', async () => {
  const h = fixture()
  h.settings.sessionOverrides['session-1'] = {
    execution: { provider: 'custom', model: 'execute', reasoningEffort: 'max' },
    planning: { provider: 'other', model: 'planner' },
  }
  assert.deepEqual(await h.route(1, 1), { provider: 'custom', model: 'execute', reasoningEffort: 'max' })
  await h.call('mids_plan')
  assert.deepEqual(await h.route(1, 2), { provider: 'other', model: 'planner' })
})

test('first-turn defaults are frozen for later turns, and built-in defaults cover missing settings', async () => {
  const h = fixture()
  await h.route(1, 1)
  h.settings.defaultExecution = { provider: 'new', model: 'default-changed' }
  assert.deepEqual(await h.route(2, 1), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
  assert.deepEqual(routesForSession(undefined, 'unknown'), {
    mode: 'fast',
    compaction: 'current',
    execution: { provider: 'deepseek-official', model: 'deepseek-flash' },
    planning: { provider: 'mimo', model: 'mimo-v2.6-pro' },
  })
})

test('expert lead uses the planner on every turn and delegates rather than implementing', async () => {
  const h = fixture()
  h.settings.defaultMode = 'expert'
  assert.deepEqual(await h.route(1, 1), { provider: 'plan', model: 'deep', reasoningEffort: 'high' })
  assert.match((await h.preStep(1, 1)).messages[0].content[0].text, /Expert mode/)
  assert.equal(h.allowed('subagent'), true)
  assert.equal(h.allowed('write'), false)
  assert.equal(h.allowed('bash'), false)
  assert.equal(h.allowed('mids_plan'), false)
  assert.equal(h.allowed('read'), true)
  h.settings.defaultMode = 'fast'
  assert.deepEqual(await h.route(2, 1), { provider: 'plan', model: 'deep', reasoningEffort: 'high' })
  assert.equal(h.settings.sessionOverrides['session-1'].mode, 'expert')
})

test('legacy snapshots remain fast even after the default changes to expert', async () => {
  const h = fixture()
  h.settings.defaultMode = 'expert'
  h.settings.sessionOverrides['session-1'] = {
    execution: h.settings.defaultExecution, planning: h.settings.defaultPlanning,
  }
  assert.deepEqual(await h.route(1, 1), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
  assert.equal(h.allowed('subagent'), false)
})

test('an expert child with inherited planner options is forced to execution on every request and cannot delegate', async () => {
  const h = fixture()
  h.settings.sessionOverrides.parent = {
    mode: 'expert', execution: h.settings.defaultExecution, planning: h.settings.defaultPlanning,
  }
  h.agent.session.header = { parentSession: 'parent' }
  h.agent.options = { subagentDepth: 1, provider: 'plan', model: 'deep' }
  assert.deepEqual(await h.route(1, 1, h.agent.options), {
    subagentDepth: 1, provider: 'exec', model: 'fast', reasoningEffort: 'low',
  })
  assert.equal(h.allowed('write'), true)
  assert.equal(h.allowed('subagent'), false)
  assert.equal(h.allowed('mids_plan'), false)
  assert.deepEqual(await h.route(2, 1), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
  assert.equal(h.settings.sessionOverrides['session-1'], undefined)
})

test('saved changes stay pending within a turn and refresh both routes and mode on the next turn', async () => {
  const h = fixture()
  await h.route(1, 1)
  const changed = {
    mode: 'expert',
    execution: { provider: 'new-exec', model: 'new-fast', reasoningEffort: 'medium' },
    planning: { provider: 'new-plan', model: 'new-deep', reasoningEffort: 'max' },
  }
  h.settings.sessionOverrides['session-1'] = changed
  await h.call('mids_plan')
  assert.deepEqual(await h.route(1, 2), h.settings.defaultPlanning)
  assert.equal(h.allowed('subagent'), false)
  await h.call('mids_submit_plan', { plan: 'Old turn plan' })
  await h.preStep(1, 3)
  assert.deepEqual(await h.route(1, 3), h.settings.defaultExecution)

  await h.preStep(2, 1)
  assert.deepEqual(await h.route(2, 1), changed.planning)
  assert.equal(h.allowed('subagent'), true)
  assert.equal(h.allowed('write'), false)
  h.settings.sessionOverrides['session-1'] = { ...changed, mode: 'fast' }
  assert.deepEqual(await h.route(2, 2), changed.planning)
  assert.deepEqual(await h.route(3, 1), changed.execution)
  await h.call('mids_plan')
  assert.deepEqual(await h.route(3, 2), changed.planning)
})

test('live and cold-resumed children retain their creation model after their parent is reconfigured', async () => {
  for (const cold of [false, true]) {
    const h = fixture()
    const original = structuredClone(h.settings.defaultExecution)
    h.agent.session.header = { parentSession: 'parent' }
    h.agent.options = cold ? {} : { [EXECUTION_ROUTE_OPTION]: original }
    if (cold) h.agent.session.snapshotEvents = () => [{
      type: 'subagent/descriptor', data: {
        mode: 'continuable', persona: EXECUTOR_PERSONA,
        agentProvider: original.provider, agentModel: original.model,
        agentReasoningEffort: original.reasoningEffort,
      },
    }]
    // A queued child can start only after its parent configuration has changed.
    h.settings.sessionOverrides.parent = {
      mode: 'expert', execution: { provider: 'new', model: 'changed' }, planning: h.settings.defaultPlanning,
    }
    assert.deepEqual(await h.route(1, 1), original)
    h.settings.sessionOverrides.parent.execution = { provider: 'newer', model: 'changed-again' }
    assert.deepEqual(await h.route(2, 1), original)
    assert.equal(h.allowed('write'), true)
    assert.equal(h.allowed('subagent'), false)
  }
})
