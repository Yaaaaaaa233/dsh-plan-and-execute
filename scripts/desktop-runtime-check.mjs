import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { apply as routePlugin, inject as routeInject, createRouteSnapshots } from '../lib/router.js'
const runtime = process.argv[2] ?? process.env.DSH_DESKTOP_RUNTIME
if (!runtime) throw new Error('Pass the official Desktop app.asar/dsh runtime path')
const require = createRequire(`${runtime}/package.json`)
const { Context } = require('@deepseek-ai/cordis')
const Llm = require('@deepseek-ai/dsh-llm')
const load = name => { const module = require(`@deepseek-ai/dsh-${name}`); return module.default ?? module }
const ctx = new Context()
await ctx.plugin(load('llm'))
await ctx.plugin(load('session'))
await ctx.plugin(load('session-projection'))
await ctx.plugin(load('system-prompt'))
await ctx.plugin(load('tools'))
await ctx.plugin(load('agent'))
await ctx.plugin(load('agent-loop'), { agents: [] })
await ctx.plugin(load('subagent'))
await ctx.plugin(load('subagent-spawn-in-process'))
// The full Desktop bundle declares these tool names globally. A lightweight
// in-process fixture must also declare them for official child restrictions.
for (const name of ['subagent', 'mids_plan', 'mids_submit_plan']) ctx.tools.register({
  name, description: 'Fixture declaration; the P&E scope supplies the implementation.',
  parameters: { type: 'object', properties: {} },
  output: { schema: { type: 'object', properties: {} }, render: () => [] },
  async execute() { throw new Error('unscoped fixture tool must never run') },
})
const routes = {
  defaultExecution: { provider: 'fixture-executor', model: 'fast' },
  defaultPlanning: { provider: 'fixture-planner', model: 'deep' },
  sessionOverrides: {},
}
ctx.provide('adaptivePlanSettings', {
  get: () => routes,
  ...createRouteSnapshots(() => routes),
  freeze: async (id, pair) => { routes.sessionOverrides[id] = structuredClone(pair) },
})
function text(text) { return [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } },
] }
function call(name, args) { const id = Llm.ToolCallId(crypto.randomUUID()); const json = JSON.stringify(args); return [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: json } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
] }
class Fixture extends Llm.LlmAdapter {
  requests = []
  script = [text('simple done'), call('mids_plan', {}), call('mids_submit_plan', { plan: 'Plan: inspect, implement, verify.' }), text('executed'), text('next simple done')]
  async resolveModel(provider, model) { return {
    provider, id: model, name: model,
    ...(model.startsWith('new-') ? { reasoning: {
      efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low',
    } } : {}),
  } }
  async *stream(options) { this.requests.push(options); this.onRequest?.(options); const row = this.script.shift(); assert.ok(row, 'unexpected extra call'); yield* row }
}
const adapter = new Fixture()
ctx.llm.registerAdapter(['fixture-executor', 'fixture-planner', 'native-selection'], adapter)
const agent = await ctx.agentLoop.create('adaptive-desktop-fixture', { provider: 'native-selection', model: 'should-never-run' })
await agent.ctx.plugin({ apply: routePlugin, inject: routeInject })
const { installModelSelection } = require('@deepseek-ai/dsh-agent')
installModelSelection(agent.ctx, { current: { provider: 'native-selection', model: 'should-never-run' } })
const errors = []
ctx.on('agent/error', ({error}) => errors.push(String(error)))
async function send(text) {
  agent.followup(Llm.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await Promise.race([agent.whenIdle(), new Promise((_, reject) => setTimeout(() => reject(new Error('agent timed out')), 8000))])
}
await send('simple original user context')
await send('complex original user context')
await send('simple again')
assert.deepEqual(errors, [])
assert.deepEqual(adapter.requests.map(row => row.provider), ['fixture-executor','fixture-executor','fixture-planner','fixture-executor','fixture-executor'])
const texts = row => JSON.stringify(row.messages)
assert.match(texts(adapter.requests[2]), /simple original user context/)
assert.match(texts(adapter.requests[2]), /complex original user context/)
assert.match(texts(adapter.requests[3]), /Plan: inspect, implement, verify/)
assert.equal(adapter.script.length, 0)

// Save while a real turn is in flight. Its remaining planning/execution steps
// must use the old pair, and the following turn must observe the saved mode.
const changed = {
  mode: 'expert',
  execution: { provider: 'fixture-executor', model: 'new-fast', reasoningEffort: 'low' },
  planning: { provider: 'fixture-planner', model: 'new-deep', reasoningEffort: 'high' },
}
adapter.script.push(call('mids_plan', {}), call('mids_submit_plan', { plan: 'Original pair completes this turn.' }), text('old turn executed'), text('new expert turn'))
adapter.onRequest = () => {
  routes.sessionOverrides[agent.session.id] = structuredClone(changed)
  adapter.onRequest = undefined
}
await send('complex turn with a configuration change during execution')
await send('use the new expert configuration')
assert.deepEqual(errors, [])
assert.deepEqual(adapter.requests.slice(5).map(({provider,model,reasoningEffort}) => ({provider,model,...reasoningEffort ? {reasoningEffort} : {}})), [
  {provider:'fixture-executor',model:'fast'},
  {provider:'fixture-planner',model:'deep'},
  {provider:'fixture-executor',model:'fast'},
  changed.planning,
])
assert.match(texts(adapter.requests.at(-1)), /simple original user context/)
assert.match(texts(adapter.requests.at(-1)), /Expert mode/)
assert.deepEqual(errors, [])
assert.equal(adapter.script.length, 0)

// The real spawn service accepts the creation pin. Changing the parent while
// it is planning must not alter a child delegated by this same expert turn.
adapter.script.push(call('subagent', { description: 'Verify creation route', prompt: 'Reply with completion.' }), text('child completed'), text('expert accepted'))
adapter.onRequest = () => {
  routes.sessionOverrides[agent.session.id] = {
    mode: 'fast', execution: { provider: 'fixture-executor', model: 'newer-fast', reasoningEffort: 'high' },
    planning: { provider: 'fixture-planner', model: 'newer-deep', reasoningEffort: 'low' },
  }
  adapter.onRequest = undefined
}
await send('delegate using the current expert turn configuration')
assert.deepEqual(errors, [])
assert.deepEqual(adapter.requests.at(-1).messages.filter(row => row.role === 'tool' && row.isError).map(row => row.content), [])
assert.deepEqual(adapter.requests.slice(9).map(({provider,model,reasoningEffort}) => ({provider,model,reasoningEffort})), [
  changed.planning, changed.execution, changed.planning,
])
assert.equal(adapter.script.length, 0)
console.log('Official Desktop 0.2.0-rc.2 runtime: shared context, native route override, active-turn snapshot and next-turn configuration change PASS')
await ctx.fiber.dispose()
process.exit(0)
