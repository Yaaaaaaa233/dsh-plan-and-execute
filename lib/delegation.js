export const EXECUTOR_PERSONA = 'You are an execution subagent. Implement the delegated task in the working directory. Follow repository instructions and your fixed permission scope, verify the result, and report changed files, checks, and remaining limitations. Do not delegate or change models.'
export const EXECUTION_ROUTE_OPTION = 'planAndExecuteExecutionRoute'

/** Delegate through the official runtime, with a user-owned route rather than inherited planner options. */
export function installDelegation(ctx, routesForAgent, isChild) {
  ctx.tools.register({
    name: 'subagent',
    description: 'Expert mode: delegate a self-contained implementation or verification task to the configured execution model. Include the settled plan, files and acceptance checks. Defaults to foreground; background children return an id, support send_message, and notify you when they settle. Model selection is fixed by the user.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        description: { type: 'string', description: 'Short task label.' },
        prompt: { type: 'string', description: 'Complete task, plan, constraints and acceptance checks. The spawned child has no parent conversation history.' },
        run_in_background: { type: 'boolean', description: 'Set true for independent background work; false or omission waits for the result.' },
      },
      required: ['description', 'prompt'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['foreground', 'continuable'] },
          subagentId: { type: 'string' },
          runId: { type: 'string' },
          output: { type: 'array', items: { type: 'object' } },
        },
        required: ['kind'],
      },
      render: (_args, value) => value.kind === 'continuable'
        ? [{ type: 'text', text: `Execution subagent ${value.subagentId} is running. Use send_message for follow-up; its completion will be reported to this conversation.` }]
        : value.output,
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!exec.agent || isChild(exec.agent)) throw new Error('Only the expert session lead may delegate')
      const routes = await routesForAgent(exec.agent)
      if (routes.mode !== 'expert') throw new Error('Execution delegation is available only in expert mode')
      if (['provider', 'model', 'reasoning_effort'].some(key => args[key] !== undefined)) {
        throw new Error('Execution model selection is fixed by the user')
      }
      if (typeof args.prompt !== 'string' || !args.prompt.trim()
        || typeof args.description !== 'string' || !args.description.trim()) {
        throw new Error('A non-empty task label and prompt are required')
      }
      if (args.run_in_background !== undefined && typeof args.run_in_background !== 'boolean') {
        throw new Error('run_in_background must be a boolean')
      }
      await ctx.llm.resolveCallConfig(routes.execution, exec.signal)
      exec.signal.throwIfAborted()
      const request = {
        parent: exec.agent, label: args.description,
        prompt: [{ type: 'text', text: args.prompt }],
        // The live child carries a creation snapshot. Continuable cold resume
        // restores the same route from the official descriptor and persona.
        agentOptions: { ...routes.execution, [EXECUTION_ROUTE_OPTION]: { ...routes.execution } },
        persona: EXECUTOR_PERSONA,
        toolFilter: { deny: ['subagent', 'mids_plan', 'mids_submit_plan'] },
        maxDepth: 1,
      }
      if (args.run_in_background === true) {
        const started = await ctx.subagents.startContinuable({
          provider: 'spawn', label: args.description, request, signal: exec.signal,
        })
        return { kind: 'continuable', subagentId: started.childId }
      }
      const run = await ctx.subagents.start('spawn', { ...request, signal: exec.signal })
      const [result] = await Promise.allSettled([run.result])
      const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
      const failures = []
      if (result.status === 'rejected') failures.push(result.reason)
      else if (result.value.stopReason !== 'completed') {
        const partial = result.value.output.filter(block => block.type === 'text').map(block => block.text).join('\n')
        failures.push(new Error(`Execution subagent stopped: ${result.value.stopReason}. ${partial}`))
      }
      if (disposal.status === 'rejected') failures.push(disposal.reason)
      if (failures.length) throw new AggregateError(failures, failures.map(error => String(error)).join('; '))
      return { kind: 'foreground', runId: run.id, output: result.value.output }
    },
  })
}
