import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { apply as routePlugin } from '../lib/router.js'
const runtime = process.argv[2] ?? process.env.DSH_DESKTOP_RUNTIME
if (!runtime) throw new Error('Pass the official Desktop app.asar/dsh runtime path')
const require = createRequire(`${runtime}/package.json`)
const { Context } = require('@deepseek-ai/cordis')
const Llm = require('@deepseek-ai/dsh-llm')
const load = name => require(`@deepseek-ai/dsh-${name}`).default
const ctx = new Context()
await ctx.plugin(load('llm'))
await ctx.plugin(load('session'))
await ctx.plugin(load('session-projection'))
await ctx.plugin(load('system-prompt'))
await ctx.plugin(load('tools'))
await ctx.plugin(load('agent'))
await ctx.plugin(load('agent-loop'), { agents: [] })
const routes = {
  defaultExecution: { provider: 'fixture-executor', model: 'fast' },
  defaultPlanning: { provider: 'fixture-planner', model: 'deep' },
  sessionOverrides: {},
}
ctx.provide('adaptivePlanSettings', {
  get: () => routes,
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
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) { this.requests.push(options); const row = this.script.shift(); assert.ok(row, 'unexpected extra call'); yield* row }
}
const adapter = new Fixture()
ctx.llm.registerAdapter(['fixture-executor', 'fixture-planner', 'native-selection'], adapter)
const agent = await ctx.agentLoop.create('adaptive-desktop-fixture', { provider: 'native-selection', model: 'should-never-run' })
await agent.ctx.plugin({ apply: routePlugin, inject: ['tools', 'adaptivePlanSettings'] })
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
console.log('Official Desktop 0.2.0-rc.2 runtime: same-context exec → planner → exec and native-selection override PASS')
await ctx.fiber.dispose()
process.exit(0)
