import { isExecutionChild } from './router.js'

// Each invocation gets a detached view; shared Cordis services and the engine's
// immutable configuration are never rewritten while another session runs.
function view(object, fields) {
  return Object.create(object, Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }])))
}

function capacity(info, route) {
  const size = info.context?.contextWindow
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`P&E: 规划模型 ${route.provider}/${route.model} 缺少有效的 contextWindow，请在模型设置中配置上下文容量，或将上下文压缩改为“跟随当前模型”。`)
  }
  return size
}

function planningRoute(engine, agent) {
  if (isExecutionChild(agent)) return undefined
  const routes = engine.ctx.adaptivePlanSettings.forCompaction(agent)
  return routes.compaction === 'planning' ? routes.planning : undefined
}

function summaryConfig(config, route) {
  const target = { summarizationProvider: route.provider, summarizationModel: route.model }
  return {
    ...config, ...target,
    modelPolicies: config.modelPolicies.map(policy => ({ ...policy, ...target })),
  }
}

function summaryTokens(ctx, agent, options) {
  const header = { ...agent.session.requestHeader(), config: {
    provider: options.provider, model: options.model, maxTokens: options.maxTokens,
  }, ...options.tools === undefined ? {} : { tools: options.tools } }
  const priced = ctx.tokenMeter.measure(agent.session, header)
  const ids = new Set(options.messages.map(message => message.id).filter(Boolean))
  let tokens = Math.max(0, priced.totalTokens - priced.surfaceTokens)
  const found = new Set()
  for (const node of priced.nodes) {
    const message = agent.session.deriveEventMessage(agent.session.eventAt(node.seq))
    if (!message || !ids.has(message.id)) continue
    tokens += node.tokens
    found.add(message.id)
  }
  // Includes the official final compaction instruction, which has no log id.
  for (const message of options.messages) {
    if (!message.id || !found.has(message.id)) tokens += ctx.tokenMeter.estimateMessage(message)
  }
  return tokens
}

/** Extend only the official backend's pressure entry and summarization hook. */
export function createPlanningCompaction(BasicCompactionEngine) {
  return class PlanningCompactionEngine extends BasicCompactionEngine {
    static inject = [...BasicCompactionEngine.inject, 'adaptivePlanSettings']

    async compactIfNeeded(agent, trigger, signal) {
      const route = planningRoute(this, agent)
      if (!route) return super.compactIfNeeded(agent, trigger, signal)
      const llm = this.ctx.llm
      const info = await llm.resolveModelInfo(route.provider, route.model, signal)
      const window = capacity(info, route)
      const latest = agent.session.requestHeader()?.config
      const scopedLlm = view(llm, {
        async resolveModelInfo(provider, model, abort) {
          const current = await llm.resolveModelInfo(provider, model, abort)
          if (provider !== latest?.provider || model !== latest?.model || !current.context) return current
          return { ...current, context: { ...current.context, contextWindow: Math.min(current.context.contextWindow, window) } }
        },
      })
      const routes = this.ctx.adaptivePlanSettings.forCompaction(agent)
      const scoped = view(this, { ctx: view(this.ctx, {
        llm: scopedLlm, adaptivePlanSettings: { forCompaction: () => routes },
      }) })
      // The official backend still selects balanced history, prunes tools,
      // retains the recent tail, and owns all transaction/retry bookkeeping.
      return super.compactIfNeeded.call(scoped, agent, trigger, signal)
    }

    async summarize(input, agent, signal) {
      const route = planningRoute(this, agent)
      if (!route) return super.summarize(input, agent, signal)
      const ctx = this.ctx
      const info = await ctx.llm.resolveModelInfo(route.provider, route.model, signal)
      const window = capacity(info, route)
      const llm = view(ctx.llm, {
        async *stream(options) {
          const request = { ...options, ...route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {} }
          const tokens = summaryTokens(ctx, agent, request)
          if (tokens + request.maxTokens > window) {
            throw new Error(`P&E: 待压缩内容约 ${tokens} tokens，加上摘要输出预算 ${request.maxTokens}，超过规划模型 ${route.provider}/${route.model} 的 ${window} 上下文窗口。请选择更大窗口的规划模型，或将上下文压缩改为“跟随当前模型”。`)
          }
          yield* ctx.llm.stream(request)
        },
      })
      const scoped = view(this, { config: summaryConfig(this.config, route), ctx: view(ctx, { llm }) })
      // The official instruction, assembler, text-only projection and exact
      // provider/model result envelope remain the backend's own implementation.
      return super.summarize.call(scoped, input, agent, signal)
    }
  }
}
