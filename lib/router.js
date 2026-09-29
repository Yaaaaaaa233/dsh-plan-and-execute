import { randomUUID } from 'node:crypto'
import { DEFAULT_ROUTES, SETTINGS_NAMESPACE } from './defaults.js'

export const name = 'adaptive-plan-router'
export const inject = ['tools']

const PLANNER_TOOLS = new Set([
  'mids_submit_plan', 'read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch',
])

function message(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-adaptive-plan', form: 'notice', summary: text.slice(0, 120) },
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
  let settingsApi
  // Settings are optional at composition time; the shipped route pair remains
  // a safe fallback when the profile has no settings provider.
  ctx.inject(['settings'], settingsCtx => { settingsApi = settingsCtx.settings })

  const freezeRoutes = async agent => {
    const sessionId = agent?.session?.id
    const settings = settingsApi?.get(SETTINGS_NAMESPACE)
    const routes = routesForSession(settings, sessionId)
    if (sessionId === undefined || settingsApi === undefined
      || settings?.sessionOverrides?.[sessionId] !== undefined) return routes

    // Snapshot defaults on the first model request so editing plugin defaults
    // later cannot silently alter a conversation that has already begun.
    try {
      await settingsApi.update(SETTINGS_NAMESPACE, {
        sessionOverrides: { [sessionId]: routes },
      })
    } catch {
      // The in-memory Agent still keeps this snapshot for the current run. A
      // missing/read-only settings provider may prevent durable freezing.
    }
    return routes
  }

  // The Web Session controller installs its own selection before mounting a
  // preset. Wrapping that listener lets this preset own the effective route.
  ctx.on('agent/request', async ({ agent, turn }, next) => {
    const requested = await next()
    const state = stateFor(states, agent, turn)
    state.routes ??= await freezeRoutes(agent)
    const route = routeForPhase(state.phase, state.routes)
    const { provider: _provider, model: _model, reasoningEffort: _effort, ...base } = requested
    return { ...base, ...route }
  }, { prepend: true })

  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
    const state = stateFor(states, agent, turn)
    // The previous model step has fully settled now. A planning-model batch may
    // contain other calls after mids_submit_plan; keep all of them read-only.
    if (state.phase === 'planning' && state.planSubmitted) state.phase = 'executing'
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    let instruction
    if (state.phase === 'planning') {
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
    if (state.phase !== 'planning' || state.planSubmitted || signal.aborted) return
    // A plain-text plan is also usable; ensure the execution model receives it.
    state.phase = 'executing'
    agent.steer(message('The planning model has finished. Execution model: implement and verify the plan in the preceding assistant message.'))
  })

  ctx.tools.guard(exec => {
    const agent = exec.agent
    if (agent === undefined) return undefined
    const state = states.get(agent)
    if (state?.phase === 'planning' && !PLANNER_TOOLS.has(exec.name)) {
      return 'Adaptive Plan: the planning model may only use read-only inspection tools and mids_submit_plan.'
    }
    if (exec.name === 'mids_plan' && (state?.phase !== 'dispatch' || state.planned)) {
      return 'Adaptive Plan: planning can be requested only once, during the execution model dispatch.'
    }
    if (exec.name === 'mids_submit_plan' && state?.phase !== 'planning') {
      return 'Adaptive Plan: only the configured planning phase can submit a plan.'
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
