import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, routesForSession } from '../lib/router.js'

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
  apply({
    on(name, fn) { listeners.set(name, fn) },
    adaptivePlanSettings: {
      get: () => settings,
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
  return { listeners, definitions, agent, signal, preStep, route, call, allowed, settings }
}

test('simple turns use the configured execution model and keep its reasoning effort', async () => {
  const h = fixture()
  const selected = { provider: 'mimo', model: 'mimo-v2.6-pro', reasoningEffort: 'high' }
  assert.deepEqual(await h.route(1, 1, selected), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
  assert.equal((await h.preStep(1, 1)).messages.length, 1)
  assert.deepEqual(await h.route(1, 2, selected), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
  assert.deepEqual(await h.route(2, 1, selected), { provider: 'exec', model: 'fast', reasoningEffort: 'low' })
  assert.deepEqual(h.settings.sessionOverrides['session-1'], {
    execution: { provider: 'exec', model: 'fast', reasoningEffort: 'low' },
    planning: { provider: 'plan', model: 'deep', reasoningEffort: 'high' },
  })
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
    execution: { provider: 'deepseek-official', model: 'deepseek-flash' },
    planning: { provider: 'mimo', model: 'mimo-v2.6-pro' },
  })
})
