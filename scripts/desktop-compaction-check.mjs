import { createRequire } from 'node:module'
import path from 'node:path'
import assert from 'node:assert/strict'
import { apply as router, inject as routeInject, createRouteSnapshots } from '../lib/router.js'
import { createPlanningCompaction } from '../lib/compaction-policy.js'

const runtime = process.argv[2] ?? process.env.DSH_DESKTOP_RUNTIME
if (!runtime) throw new Error('Pass the official Desktop app.asar/dsh runtime path')
const require = createRequire(`${runtime}/package.json`)
const { Context } = require('@deepseek-ai/cordis')
const Llm = require('@deepseek-ai/dsh-llm')
const Basic = require('@deepseek-ai/dsh-compaction-basic').default
const load = name => { const module = require(`@deepseek-ai/dsh-${name}`); return module.default ?? module }
const ctx = new Context()
if (process.argv[3]) {
  const Boot = require('@deepseek-ai/dsh-app-boot')
  const profile = Boot.loadProfileDirectory('fixture', process.argv[3], `${runtime}/package.json`, { userLayer: false })
  const resolution = await Boot.createRuntimeResolution({ installAnchor: `${runtime}/package.json`, profile, home: path.resolve(process.argv[3], '../..') })
  await ctx.plugin(Boot.PluginPackages, { resolution })
}
const Engine = process.argv[3]
  ? createRequire(`${process.argv[3]}/package.json`)('dsh-plan-and-execute/compaction').default
  : createPlanningCompaction(Basic)
for (const name of ['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent', 'token-meter', 'subagent', 'subagent-spawn-in-process']) {
  await ctx.plugin(load(name))
}
await ctx.plugin(load('agent-loop'), { agents: [] })
const settings = {
  defaultCompaction: 'planning',
  defaultExecution: { provider: 'fixture-executor', model: 'fast' },
  defaultPlanning: { provider: 'fixture-planner', model: 'deep', reasoningEffort: 'high' },
  sessionOverrides: {},
}
ctx.provide('adaptivePlanSettings', {
  get: () => settings,
  ...createRouteSnapshots(() => settings),
  freeze: async (id, routes) => { settings.sessionOverrides[id] = structuredClone(routes) },
})
const requests = []
const errors = []
const signal = new AbortController().signal
const text = value => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
class Fixture extends Llm.LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model,
      context: { contextWindow: model === 'tiny' ? 100 : provider === 'fixture-executor' ? 12000 : 6000 },
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }
  }
  async *stream(options) {
    requests.push(options)
    if (options.purpose === 'compaction') {
      assert.match(JSON.stringify(options.messages.at(-1)), /compaction engine/)
      yield* text('Checkpoint: user constraints retained; completed work verified; next step is execution.')
    } else {
      this.onNormal?.(options)
      yield* text('Executed and verified.')
    }
  }
}
const adapter = new Fixture()
ctx.llm.registerAdapter(['fixture-executor', 'fixture-planner'], adapter)
ctx.on('agent/error', ({ error }) => errors.push(String(error)))
async function create(id, options = {}) {
  const agent = await ctx.agentLoop.create(id, { provider: 'fixture-executor', model: 'fast', ...options })
  await agent.ctx.plugin({ apply: router, inject: routeInject })
  return agent
}
async function send(agent, value) {
  agent.followup(Llm.createUserMessage({ content: [{ type: 'text', text: value }], source: { kind: 'user' } }))
  await Promise.race([agent.whenIdle(), new Promise((_, reject) => setTimeout(() => reject(new Error('fixture timed out')), 8000))])
  assert.deepEqual(errors, [])
}
async function seed(agent) {
  for (let i = 0; i < 3; i++) await send(agent, `Requirement ${i}: ` + 'Preserve decisions and constraints. '.repeat(160))
}
const engines = new WeakMap()
async function mount(agent, config) {
  const scope = agent.ctx.isolate('compaction')
  await scope.plugin(Engine, config)
  engines.set(agent, scope.get('compaction'))
}
const policy = { headroomTokens: 64, maxTokens: 64, retainRatio: 0.16, thresholdRatio: 0.7 }

const manual = await create('pe-manual-compaction')
await mount(manual, { ...policy, auto: false })
await seed(manual)
let result = await engines.get(manual).compactNow(manual, signal)
assert.ok(result)
let summaries = manual.session.snapshotEvents().filter(event => event.type === 'compaction/summary')
assert.equal(summaries.at(-1).data.provider, 'fixture-planner')
assert.equal(summaries.at(-1).data.model, 'deep')
assert.equal(requests.at(-1).reasoningEffort, 'high')
assert.match(JSON.stringify(manual.session.deriveMessages()), /compacted-summary/)
await send(manual, 'Continue after the planning-model checkpoint.')
assert.equal(requests.at(-1).provider, 'fixture-executor')
assert.match(JSON.stringify(requests.at(-1).messages), /Checkpoint: user constraints/)

// Idle manual compression sees saved settings immediately, without an extra turn.
settings.sessionOverrides[manual.session.id].planning = { provider: 'fixture-planner', model: 'new-deep', reasoningEffort: 'low' }
await engines.get(manual).compactNow(manual, signal)
assert.equal(requests.at(-1).model, 'new-deep')
assert.equal(requests.at(-1).reasoningEffort, 'low')
settings.sessionOverrides[manual.session.id].compaction = 'current'
await send(manual, 'A fresh executed exchange ' + 'context '.repeat(160))
await engines.get(manual).compactNow(manual, signal)
assert.equal(requests.at(-1).provider, 'fixture-executor')

const automatic = await create('pe-auto-compaction')
await seed(automatic)
const pressure = ctx.get('tokenMeter').measure(automatic.session).totalTokens
assert.ok(pressure > 6000 * policy.thresholdRatio && pressure < 12000 * policy.thresholdRatio)
await mount(automatic, policy)
await send(automatic, 'Keep implementing with an earlier planning-window compaction.')
assert.ok(automatic.session.snapshotEvents().some(event => event.type === 'compaction/summary' && event.data.provider === 'fixture-planner'))
assert.equal(requests.at(-1).provider, 'fixture-executor')

// The routing snapshot stays old during a live turn even if settings are saved.
const snapshot = await create('pe-compression-snapshot')
await mount(snapshot, { ...policy, auto: false })
await seed(snapshot)
adapter.onNormal = () => {
  settings.sessionOverrides[snapshot.session.id] = { ...settings.sessionOverrides[snapshot.session.id], compaction: 'current' }
  adapter.onNormal = undefined
  assert.equal(snapshot.ctx.get('adaptivePlanSettings').forCompaction(snapshot).compaction, 'planning')
}
await send(snapshot, 'Configuration change during this turn.')
assert.equal(snapshot.ctx.get('adaptivePlanSettings').forCompaction(snapshot).compaction, 'current')

const child = await create('pe-child-compaction', { subagentDepth: 1 })
await mount(child, { ...policy, auto: false })
await seed(child)
await engines.get(child).compactNow(child, signal)
assert.equal(requests.at(-1).provider, 'fixture-executor')

// Reject an already oversized manual input; no partial checkpoint is committed.
await send(snapshot, 'Another exchange ' + 'context '.repeat(160))
settings.sessionOverrides[snapshot.session.id] = {
  ...settings.sessionOverrides[snapshot.session.id], compaction: 'planning',
  planning: { provider: 'fixture-planner', model: 'tiny' },
}
const before = requests.length
const generation = snapshot.session.surface.replaceGeneration
await assert.rejects(engines.get(snapshot).compactNow(snapshot, signal), error => {
  assert.match(String(error.cause), /超过规划模型/)
  return true
})
assert.equal(requests.length, before)
assert.equal(snapshot.session.surface.replaceGeneration, generation)
assert.equal(snapshot.session.snapshotEvents().at(-1).type, 'compaction/end')
assert.ok(snapshot.session.snapshotEvents().at(-1).data.error)

console.log(`Official Desktop 0.2.0-rc.2: planner manual/automatic compaction, earlier capacity trigger (${pressure} tokens), saved route/effort, current policy, child isolation, accurate checkpoint log and safe oversized failure PASS`)
await ctx.fiber.dispose()
process.exit(0)
