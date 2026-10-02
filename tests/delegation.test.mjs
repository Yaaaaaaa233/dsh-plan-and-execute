import assert from 'node:assert/strict'
import test from 'node:test'
import { installDelegation, EXECUTION_ROUTE_OPTION } from '../lib/delegation.js'

function fixture() {
  let tool
  const requests = []
  const preflight = []
  let disposed = 0
  const ctx = {
    tools: { register: row => { tool = row } },
    llm: { resolveCallConfig: async row => { preflight.push(row) } },
    subagents: {
      start: async (provider, request) => {
        requests.push({provider, request})
        return {id:'child', result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:'done'}]}),
          dispose:async()=>{disposed++} }
      },
      startContinuable: async spec => { requests.push(spec); return {childId:'continuable-child'} },
    },
  }
  const routes = { mode:'expert', execution:{provider:'executor',model:'fast',reasoningEffort:'low'} }
  installDelegation(ctx, async () => routes, agent => agent.child === true)
  const exec={agent:{options:{provider:'planner',model:'deep',reasoningEffort:'high'}},signal:new AbortController().signal}
  const args={description:'Implement task',prompt:'Settled plan and acceptance checks'}
  return {ctx, tool, routes, exec, args, requests, preflight, disposed:()=>disposed}
}

test('foreground child creation explicitly pins executor route and effort, independently of parent options', async () => {
  const h=fixture()
  const result=await h.tool.execute(h.args,h.exec)
  assert.equal(result.kind,'foreground')
  assert.equal(h.disposed(),1)
  assert.deepEqual(h.requests[0].request.agentOptions,{...h.routes.execution,[EXECUTION_ROUTE_OPTION]:h.routes.execution})
  assert.deepEqual(h.preflight,[h.routes.execution])
  assert.equal(h.requests[0].request.maxDepth,1)
  assert.match(h.requests[0].request.persona,/execution subagent/)
  assert.equal(h.requests[0].request.toolFilter.deny.includes('subagent'),true)
})

test('background child pins the same route and returns a continuable child id', async () => {
  const h=fixture()
  assert.deepEqual(await h.tool.execute({...h.args,run_in_background:true},h.exec),{
    kind:'continuable',subagentId:'continuable-child',
  })
  assert.deepEqual(h.requests[0].request.agentOptions,{...h.routes.execution,[EXECUTION_ROUTE_OPTION]:h.routes.execution})
  assert.equal(h.requests[0].provider,'spawn')
})

test('invalid execution route fails before spawning; fast mode, child delegation and model-authored overrides are rejected', async () => {
  const h=fixture()
  await assert.rejects(h.tool.execute({...h.args,model:'deep'},h.exec),/fixed by the user/)
  await assert.rejects(h.tool.execute(h.args,{...h.exec,agent:{child:true}}),/session lead/)
  h.routes.mode='fast'
  await assert.rejects(h.tool.execute(h.args,h.exec),/expert mode/)
  h.routes.mode='expert'
  h.ctx.llm.resolveCallConfig=async()=>{throw new Error('invalid execution model')}
  await assert.rejects(h.tool.execute(h.args,h.exec),/invalid execution model/)
  assert.equal(h.requests.length,0)
})

test('failed executor retains partial output and disposes the foreground run', async () => {
  const h=fixture()
  let disposed=false
  h.ctx.subagents.start=async()=>({id:'child',result:Promise.resolve({stopReason:'error',output:[{type:'text',text:'partial report'}]}),dispose:async()=>{disposed=true}})
  await assert.rejects(h.tool.execute(h.args,h.exec),/partial report/)
  assert.equal(disposed,true)
})
