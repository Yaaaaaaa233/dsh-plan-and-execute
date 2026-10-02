import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, apply } from '../lib/index.js'

test('volatile settings retain old snapshots and isolate active compression routes between sessions', () => {
  const config = Config({ defaultCompaction: 'planning', sessionOverrides: { legacy: {
    execution: { provider: 'exec', model: 'fast' }, planning: { provider: 'plan', model: 'deep' },
  } } })
  let api
  apply({ inject() {}, on() {}, provide(_name, value) { api = value } }, config)
  const legacy = { status: 'idle', session: { id: 'legacy' } }
  const fresh = { status: 'idle', session: { id: 'fresh' } }
  assert.equal(api.forCompaction(legacy).compaction, 'current')
  assert.equal(api.forCompaction(fresh).compaction, 'planning')
  legacy.status = fresh.status = 'running'
  api.capture(legacy, { compaction: 'current', planning: { provider: 'plan', model: 'old' } })
  api.capture(fresh, { compaction: 'planning', planning: { provider: 'plan', model: 'new' } })
  assert.equal(api.forCompaction(legacy).planning.model, 'old')
  assert.equal(api.forCompaction(fresh).planning.model, 'new')
  assert.equal(Config({}).defaultCompaction.get(), 'current')
  assert.throws(() => Config({ defaultCompaction: 'invalid' }))
})
