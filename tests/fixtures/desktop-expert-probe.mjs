import { writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
// Load only as a plugin inside an isolated official Desktop Host.
const home=process.env.DSH_HOME
if(!home || !/^\/(?:private\/)?tmp\/dsh-adaptive-plan-/.test(home)) throw new Error('Expert probe requires an isolated /tmp/dsh-adaptive-plan-* DSH_HOME')
const testDir=path.dirname(home)
const project=path.join(testDir,'project')
const runtime=process.env.DSH_DESKTOP_RUNTIME ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'
const require=createRequire(`${runtime}/package.json`)
const Llm=require('@deepseek-ai/dsh-llm')
const RESULT=path.join(testDir,'expert-verification.json')
export const inject=['agentPresets','settings','adaptivePlanSettings','agents','llm','subagents']
const text=t=>[
 {type:'block-start',index:0,blockType:'text'}, {type:'text-delta',index:0,text:t},
 {type:'block-end',index:0,block:{type:'text',text:t}}, {type:'finish',reason:{kind:'stop'}},
]
const call=(name,args)=>{const id=Llm.ToolCallId(crypto.randomUUID()),json=JSON.stringify(args);return[
 {type:'block-start',index:0,blockType:'tool-call'}, {type:'tool-call-delta',index:0,id,name,argumentsDelta:json},
 {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:json}}, {type:'finish',reason:{kind:'tool-calls'}},
]}
export function apply(ctx){
 void ctx.root.loader.await().then(async()=>{
  const roster=await ctx.agentPresets.list()
  assert.equal(roster.find(x=>x.id==='mids-fast')?.broken,undefined)
  const executor={provider:'fixture-executor',model:'fast',reasoningEffort:'low'}
  const planner={provider:'fixture-planner',model:'deep',reasoningEffort:'high'}
  await ctx.settings.mutate('dsh-mids-fast',[
   {op:'set',path:['defaultMode'],value:'expert'},
   {op:'set',path:['defaultExecution'],value:executor},
   {op:'set',path:['defaultPlanning'],value:planner},
  ])
  assert.equal(ctx.adaptivePlanSettings.get().defaultMode,'expert')
  const requests=[],failures=[],children=[]
  ctx.on('agent/error',({error})=>failures.push(String(error)))
  ctx.on('subagent/start',info=>children.push(info.id))
  class Fixture extends Llm.LlmAdapter{
   async resolveModel(provider,model){return{provider,id:model,name:model,reasoning:{efforts:[{id:'low',name:'Low'},{id:'high',name:'High'}],defaultEffort:'low'}}}
   async *stream(options){
    if(options.messages.some(row=>row.source?.kind==='dsh-session-title-llm')){yield*text('Fixture title');return}
    requests.push(options)
    writeFileSync(path.join(testDir,'request-debug.json'),JSON.stringify(requests.map(row=>({provider:row.provider,model:row.model,toolResults:row.messages.filter(m=>m.role==='tool'),last:row.messages.at(-1)})),null,2))
    if(options.provider==='fixture-executor'){
     if(!JSON.stringify(options.messages).includes('tool-call')){yield*call('write',{file_path:path.join(project,`executor-proof-${crypto.randomUUID()}.txt`),content:'Written by fixed execution route'});return}
     yield*text('EXECUTOR_VERIFIED: implemented and checked');return
    }
    assert.equal(options.provider,'fixture-planner','native/default model must never receive a request')
    const full=JSON.stringify(options.messages)
    if(!full.includes('tool-call')){yield*call('subagent',{description:'Fixture implementation',prompt:'Implement settled fixture plan; report acceptance checks.',run_in_background:full.includes('TEST_BACKGROUND')});return}
    yield*text('PLANNER_ACCEPTED: reviewed executor results')
   }
  }
  ctx.llm.registerAdapter(['fixture-executor','fixture-planner','fixture-native'],new Fixture())
  mkdirSync(project,{recursive:true})
  const create=async label=>ctx.agents.create({
   sessionId:`fixture-${label}-${crypto.randomUUID()}`,
   meta:{cwd:project,agentPreset:'mids-fast'},
   agentOptions:{provider:'fixture-native',model:'must-not-run',reasoningEffort:'high'},
   setup:async scope=>{await ctx.agentPresets.mount(scope,'mids-fast')},
  })
  const run=async(handle,prompt)=>{
   handle.agent.followup(Llm.createUserMessage({content:[{type:'text',text:prompt}],source:{kind:'user'}}))
   await Promise.race([handle.agent.whenIdle(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('fixture timed out')),15000))])
  }
  const first=await create('foreground')
  await run(first,'TEST_FOREGROUND: implementation is authorized; delegate a settled plan and review the result.')
  assert.equal(failures.length,0,failures.join(';'))
  assert.equal(requests[0].provider,'fixture-planner')
  assert.equal(requests.at(-1).provider,'fixture-planner')
  assert.equal(requests.filter(row=>row.provider==='fixture-executor').length,2)
  assert.equal(requests.find(row=>row.provider==='fixture-executor').reasoningEffort,'low')
  assert.match(JSON.stringify(requests.at(-1).messages),/EXECUTOR_VERIFIED/)
  const second=await create('background')
  await run(second,'TEST_BACKGROUND: delegate independent implementation in the background.')
  const child=(await ctx.subagents.listChildren(second.agent.session.id)).find(row=>row.mode==='continuable')
  assert.ok(child,'official runtime must record the continuable child')
  await Promise.race([new Promise(resolve=>{
   const check=()=>{if(requests.filter(row=>row.provider==='fixture-executor').length>=4)resolve();else setTimeout(check,30)};check()
  }),new Promise((_,reject)=>setTimeout(()=>reject(new Error('background child did not run')),5000))])
  await ctx.subagents.sendMessage(second.agent,child.id,[{type:'text',text:'Verify the same execution route on the follow-up turn.'}],{signal:new AbortController().signal})
  await Promise.race([new Promise(resolve=>{
   const check=()=>{if(requests.filter(row=>row.provider==='fixture-executor').length>=5)resolve();else setTimeout(check,30)};check()
  }),new Promise((_,reject)=>setTimeout(()=>reject(new Error('continued child did not run')),5000))])
  assert.equal(failures.length,0,failures.join(';'))
  assert.ok(requests.flatMap(row=>row.messages).filter(row=>row.role==='tool').every(row=>row.isError!==true),'all runtime tool calls must succeed')
  assert.ok(readdirSync(project).filter(name=>name.startsWith('executor-proof-')).length>=2,'executors must perform real workspace writes')
  assert.ok(requests.filter(row=>row.provider==='fixture-executor').every(row=>row.reasoningEffort==='low'))
  assert.ok(requests.filter(row=>row.provider==='fixture-planner').every(row=>row.reasoningEffort==='high'))
  writeFileSync(RESULT,JSON.stringify({ok:true,foreground:'planner -> explicit executor -> planner acceptance',background:'continuable child + follow-up executor',requests:requests.map(({provider,model,reasoningEffort})=>({provider,model,reasoningEffort})),presets:roster.map(({id,broken})=>({id,broken}))},null,2))
 }).catch(error=>writeFileSync(RESULT,JSON.stringify({ok:false,error:String(error),stack:error.stack},null,2)))
}
