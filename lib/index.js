import { createRequire } from 'node:module'
import { DEFAULT_EXECUTION, DEFAULT_PLANNING, SETTINGS_NAMESPACE } from './defaults.js'

export { DEFAULT_EXECUTION, DEFAULT_PLANNING, SETTINGS_NAMESPACE }

function createSettingsSchema(Schema) {
  const RouteSchema = Schema.object({
    provider: Schema.string().required(),
    model: Schema.string().required(),
    reasoningEffort: Schema.string(),
  })
  const RoutePairSchema = Schema.object({
    execution: RouteSchema,
    planning: RouteSchema,
  })
  return Schema.object({
    defaultExecution: RouteSchema.default(DEFAULT_EXECUTION),
    defaultPlanning: RouteSchema.default(DEFAULT_PLANNING),
    // Session overrides live beside the global defaults but are hidden from
    // the settings card. The route is frozen on the first request and follows
    // the session across browser and Host restarts.
    sessionOverrides: Schema.dict(RoutePairSchema).default({}),
  })
}

/** Register plugin preferences while keeping this package optional. */
export function apply(ctx) {
  // Resolve this from DSH's own runtime rather than adding a second copy of
  // its schema package to the user's profile.
  const Schema = createRequire(ctx.baseUrl)('@deepseek-ai/schemastery')
  const SettingsSchema = createSettingsSchema(Schema)
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(SETTINGS_NAMESPACE, SettingsSchema, {
      base: {
        defaultExecution: DEFAULT_EXECUTION,
        defaultPlanning: DEFAULT_PLANNING,
        sessionOverrides: {},
      },
    })

    ctx.on('api-session/removed', sessionId => {
      const current = settingsCtx.settings.get(SETTINGS_NAMESPACE)
      if (current?.sessionOverrides?.[sessionId] === undefined) return
      void settingsCtx.settings.mutate(SETTINGS_NAMESPACE, [{
        op: 'unset', path: ['sessionOverrides', sessionId],
      }]).catch(error => {
        ctx.logger.warn(`could not remove Adaptive Plan settings for deleted session ${sessionId}: ${error?.message ?? error}`)
      })
    })
  })
}
