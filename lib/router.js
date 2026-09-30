import { randomUUID } from 'node:crypto'
import { DEFAULT_ROUTES } from './defaults.js'
import { installDelegation } from './delegation.js'

export const name = 'adaptive-plan-router'
export const inject = ['tools', 'adaptivePlanSettings', 'subagents', 'llm']

const PLANNER_TOOLS = new Set([
  'mids_submit_plan', 'read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch',
])
const EXPERT_TOOLS = new Set([
  ...PLANNER_TOOLS, 'subagent', 'send_message', 'interrupt_agent', 'list_agents',
  'ask_user_question', 'todo_write', 'present', 'skill',
])

export function isExecutionChild(agent) {
  return agent?.session?.header?.parentSession !== undefined || (agent?.options?.subagentDepth ?? 0) > 0
}

function message(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'dsh-adaptive-plan', form: 'notice', summary: text.slice(0, 120) },
  }
}

function stateFor(states, agent, turn) {
  let state = states.get(agent)
  if (state === undefined) {
    state = { turn, phase: 'dispatch', planned: false, planSubmitted: false }
    states.set(agent, state)
  } else if (state.turn !== turn) {
    state.turn = turn
    state.phase = 'dispatch'
    state.planned = false
    state.planSubmitted = false
  }
  return state
}

function copyRoute(route, fallback) {
  const selected = route && typeof route.provider === 'string' && typeof route.model === 'string'
    ? route
    : fallback
  return {
    provider: selected.provider,
    model: selected.model,
    ...(typeof selected.reasoningEffort === 'string' && selected.reasoningEffort !== ''
      ? { reasoningEffort: selected.reasoningEffort }
      : {}),
  }
}

export function routesForSession(settings, sessionId) {
  const override = sessionId === undefined ? undefined : settings?.sessionOverrides?.[sessionId]
  return {
    // Legacy saved sessions remain fast when the new default changes.
    mode: (override ? override.mode : settings?.defaultMode) === 'expert' ? 'expert' : 'fast',
    execution: copyRoute(override?.execution ?? settings?.defaultExecution, DEFAULT_ROUTES.execution),
    planning: copyRoute(override?.planning ?? settings?.defaultPlanning, DEFAULT_ROUTES.planning),
  }
}

export function routeForPhase(phase, routes = DEFAULT_ROUTES) {
  return phase === 'planning' ? routes.planning : routes.execution
}

/** One scoped controller; the same Agent switches routes, so both models read one transcript. */
export function apply(ctx) {
  const states = new WeakMap()
  const settingsApi = ctx.adaptivePlanSettings

  const freezeRoutes = async agent => {
    const sessionId = agent?.session?.id
    const settings = settingsApi.get()
    if (isExecutionChild(agent)) {
      return routesForSession(settings, agent.session.header?.parentSession ?? sessionId)
    }
    const routes = routesForSession(settings, sessionId)
    if (sessionId === undefined
      || settings?.sessionOverrides?.[sessionId] !== undefined) return routes

    // Snapshot defaults on the first model request so editing plugin defaults
    // later cannot silently alter a conversation that has already begun.
    try {
      await settingsApi.freeze(sessionId, routes)
    } catch {
      // The in-memory Agent still keeps this snapshot for the current run. A
      // missing/read-only settings provider may prevent durable freezing.
    }
    return routes
  }
  const frozenRoutes = async agent => {
    const state = states.get(agent)
    if (state?.routes) return state.routes
    const routes = await freezeRoutes(agent)
    if (state) state.routes = routes
    return routes
  }
  installDelegation(ctx, frozenRoutes, isExecutionChild)

  // The Web Session controller installs its own selection before mounting a
  // preset. Wrapping that listener lets this preset own the effective route.
  ctx.on('agent/request', async ({ agent, turn }, next) => {
    const requested = await next()
    const state = stateFor(states, agent, turn)
    state.routes ??= await freezeRoutes(agent)
    const route = isExecutionChild(agent) ? state.routes.execution
      : state.routes.mode === 'expert' ? state.routes.planning
        : routeForPhase(state.phase, state.routes)
    const { provider: _provider, model: _model, reasoningEffort: _effort, ...base } = requested
    return { ...base, ...route }
  }, { prepend: true })

  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
    const state = stateFor(states, agent, turn)
    state.routes ??= await freezeRoutes(agent)
    // The previous model step has fully settled now. A planning-model batch may
    // contain other calls after mids_submit_plan; keep all of them read-only.
    if (state.phase === 'planning' && state.planSubmitted) state.phase = 'executing'
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    let instruction
    if (isExecutionChild(agent)) {
      instruction = 'Execution subagent: carry out and verify the delegated task using your fixed execution model. Do not request planning or delegate. Report results and permission limitations to the session lead.'
    } else if (state.routes.mode === 'expert') {
      instruction = 'Expert mode: you are the planning model and session lead for every turn. Own discussion, decisions, planning, supervision and acceptance. Inspect with read-only tools. Once the approach is settled and execution is authorized, delegate implementation and verification to subagent; it is forced to the configured execution model. Give each child a self-contained prompt with files, constraints and acceptance checks. Parallelize only independent work. Review results and request corrections through send_message or a focused new child. Do not implement directly, call mids_plan or mids_submit_plan, or change models.'
    } else if (state.phase === 'planning') {
      instruction = 'Planning phase: inspect with read-only tools if needed. Produce a concrete, concise implementation plan and call mids_submit_plan with it. Do not edit files or delegate.'
    } else if (state.phase === 'executing') {
      instruction = 'Execution phase: implement and verify the plan above. Do not request another plan in this turn.'
    } else if (step === 1) {
      instruction = 'Execution-model dispatch phase: assess this request. Handle straightforward work directly. For work needing substantial multi-step design, inspect enough context and call mids_plan once; the planning model will plan in this same conversation, then you will execute.'
    }
    return instruction === undefined
      ? decision
      : { ...decision, messages: [...decision.messages, message(instruction)] }
  })

  ctx.on('agent/turn-stopping', ({ agent, turn, signal }) => {
    const state = stateFor(states, agent, turn)
    if (isExecutionChild(agent) || state.routes?.mode === 'expert') return
    if (state.phase !== 'planning' || state.planSubmitted || signal.aborted) return
    // A plain-text plan is also usable; ensure the execution model receives it.
    state.phase = 'executing'
    agent.steer(message('The planning model has finished. Execution model: implement and verify the plan in the preceding assistant message.'))
  })

  ctx.tools.guard(exec => {
    const agent = exec.agent
    if (agent === undefined) return undefined
    const state = states.get(agent)
    if (isExecutionChild(agent)) {
      if (['subagent', 'mids_plan', 'mids_submit_plan'].includes(exec.name)) return 'P&E: execution children cannot plan or delegate.'
      return undefined
    }
    const routes = state?.routes ?? routesForSession(settingsApi.get(), agent.session?.id)
    if (routes.mode === 'expert') {
      if (['mids_plan', 'mids_submit_plan'].includes(exec.name) || !EXPERT_TOOLS.has(exec.name)) {
        return 'P&E expert: inspect and decide here; delegate implementation and verification to execution subagents.'
      }
      return undefined
    }
    if (['subagent', 'send_message', 'interrupt_agent', 'list_agents'].includes(exec.name)) {
      return 'P&E: execution delegation is available only in expert mode.'
    }
    if (state?.phase === 'planning' && !PLANNER_TOOLS.has(exec.name)) {
      return 'P&E: the planning model may only use read-only inspection tools and mids_submit_plan.'
    }
    if (exec.name === 'mids_plan' && (state?.phase !== 'dispatch' || state.planned)) {
      return 'P&E: planning can be requested only once, during the execution model dispatch.'
    }
    if (exec.name === 'mids_submit_plan' && state?.phase !== 'planning') {
      return 'P&E: only the configured planning phase can submit a plan.'
    }
    return undefined
  })

  ctx.tools.register({
    name: 'mids_plan',
    description: 'Ask the configured planning model to plan this complex task in the current conversation. The configured execution model resumes after the plan.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { phase: { type: 'string' } }, required: ['phase'] },
      render: () => [{ type: 'text', text: 'Planning starts on the next model step. The conversation history is shared.' }],
    },
    async execute(_args, exec) {
      const state = states.get(exec.agent)
      if (state?.phase !== 'dispatch' || state.planned) throw new Error('planning is unavailable in this phase')
      state.planned = true
      state.phase = 'planning'
      return { phase: 'planning' }
    },
  })

  ctx.tools.register({
    name: 'mids_submit_plan',
    description: 'Planning model: submit the completed plan and hand control back to the execution model.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { plan: { type: 'string', description: 'Concrete implementation and verification steps' } },
      required: ['plan'],
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { plan: { type: 'string' } }, required: ['plan'] },
      render: (_args, value) => [{ type: 'text', text: `Plan accepted. The execution model must now implement and verify it:\n${value.plan}` }],
    },
    async execute(args, exec) {
      const state = states.get(exec.agent)
      if (state?.phase !== 'planning') throw new Error('no planning phase is active')
      if (typeof args?.plan !== 'string' || args.plan.trim() === '') throw new Error('plan must be a non-empty string')
      state.planSubmitted = true
      return { plan: args.plan.trim() }
    },
  })
}
