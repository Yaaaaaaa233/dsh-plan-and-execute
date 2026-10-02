import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlanningCompaction } from '../lib/compaction-policy.js'

class Basic {
  static inject = ['llm', 'tokenMeter', 'sessions']
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.config = Object.freeze({ maxTokens: 20, modelPolicies: [], ...config })
  }
  async compactIfNeeded(agent, trigger, signal) {
    return { trigger, signal, info: await this.ctx.llm.resolveModelInfo('exec', 'fast'), config: this.config }
  }
  async summarize(input, agent, signal) {
    const target = this.config.summarizationProvider
      ? { provider: this.config.summarizationProvider, model: this.config.summarizationModel }
      : agent.session.requestHeader().config
    const options = { ...target, messages: [...input.messages, { role: 'user', content: [] }],
      maxTokens: this.config.maxTokens, purpose: 'compaction', signal }
    const chunks = []
    for await (const chunk of this.ctx.llm.stream(options)) chunks.push(chunk)
    return { provider: target.provider, model: target.model, chunks }
  }
}
const Engine = createPlanningCompaction(Basic)
function fixture() {
  let routes = { compaction: 'planning', planning: { provider: 'plan', model: 'deep', reasoningEffort: 'high' } }
  const requests = []
  const windows = { exec: 1000, plan: 500, other: 400 }
  const ctx = {
    adaptivePlanSettings: { forCompaction: () => routes },
    llm: {
      async resolveModelInfo(provider) { return { context: { contextWindow: windows[provider] } } },
      async *stream(options) { requests.push(options); yield { text: 'checkpoint' } },
    },
    tokenMeter: {
      measure() { return { totalTokens: 30, surfaceTokens: 20, nodes: [{ seq: 1, tokens: 20 }] } },
      estimateMessage() { return 5 },
    },
  }
  const agent = { status: 'idle', options: {}, session: {
    id: 's', header: {}, requestHeader: () => ({ config: { provider: 'exec', model: 'fast' } }),
    eventAt: seq => seq, deriveEventMessage: () => ({ id: 'old', role: 'user', content: [] }),
  } }
  const engine = new Engine(ctx)
  const input = { messages: [{ id: 'old', role: 'user', content: [] }] }
  const signal = new AbortController().signal
  return { ctx, agent, engine, input, requests, windows, signal, setRoutes: value => { routes = value } }
}

test('planning summary preserves exact target, selected effort, purpose and cancellation without changing shared services', async () => {
  const f = fixture()
  const config = f.engine.config
  const llm = f.ctx.llm
  const result = await f.engine.summarize(f.input, f.agent, f.signal)
  assert.equal(result.provider, 'plan')
  assert.equal(result.model, 'deep')
  assert.equal(f.requests[0].reasoningEffort, 'high')
  assert.equal(f.requests[0].purpose, 'compaction')
  assert.equal(f.requests[0].signal, f.signal)
  assert.equal(f.engine.config, config)
  assert.equal(f.ctx.llm, llm)
})

test('current policy and execution children retain the official summary route', async () => {
  const f = fixture()
  f.setRoutes({ compaction: 'current' })
  assert.equal((await f.engine.summarize(f.input, f.agent)).provider, 'exec')
  f.setRoutes({ compaction: 'planning', planning: { provider: 'plan', model: 'deep' } })
  f.agent.session.header.parentSession = 'parent'
  assert.equal((await f.engine.summarize(f.input, f.agent)).provider, 'exec')
  assert.equal((await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal)).info.context.contextWindow, 1000)
})

test('automatic pressure uses the smaller capacity and never increases the current model limit', async () => {
  const f = fixture()
  const result = await f.engine.compactIfNeeded(f.agent, 'pressure', f.signal)
  assert.equal(result.info.context.contextWindow, 500)
  assert.equal(result.trigger, 'pressure')
  assert.equal(result.signal, f.signal)
  f.windows.plan = 2000
  assert.equal((await f.engine.compactIfNeeded(f.agent, 'context-overflow', f.signal)).info.context.contextWindow, 1000)
})

test('unknown capacity and oversized summary fail before any model request', async () => {
  const f = fixture()
  delete f.windows.plan
  await assert.rejects(f.engine.summarize(f.input, f.agent), /contextWindow/)
  f.windows.plan = 40
  await assert.rejects(f.engine.summarize(f.input, f.agent), /超过规划模型/)
  assert.equal(f.requests.length, 0)
})

test('concurrent summaries use independent routes and model policy overrides cannot replace the selected planner', async () => {
  const f = fixture()
  const engine = new Engine(f.ctx, { modelPolicies: [{ provider: 'exec', model: 'fast', summarizationProvider: 'legacy', summarizationModel: 'old' }] })
  const first = engine.summarize(f.input, f.agent)
  f.setRoutes({ compaction: 'planning', planning: { provider: 'other', model: 'new' } })
  const second = engine.summarize(f.input, f.agent)
  const results = await Promise.all([first, second])
  assert.deepEqual(results.map(value => value.provider), ['plan', 'other'])
  assert.equal(engine.config.modelPolicies[0].summarizationProvider, 'legacy')
})
