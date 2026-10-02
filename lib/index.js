import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_EXECUTION, DEFAULT_PLANNING, DEFAULT_MODE, SETTINGS_NAMESPACE } from './defaults.js'
import { createRouteSnapshots } from './router.js'

export { DEFAULT_EXECUTION, DEFAULT_PLANNING, SETTINGS_NAMESPACE }

const RouteSchema = Schema.object({
  provider: Schema.string().required(),
  model: Schema.string().required(),
  reasoningEffort: Schema.string(),
})

// Desktop 0.2 exposes editable values through volatile plugin Config fields.
// Keep the original entry id as the settings namespace for migrated routes.
export const Config = Schema.object({
  defaultMode: Schema.union(['fast', 'expert']).default(DEFAULT_MODE).volatile(),
  defaultCompaction: Schema.union(['current', 'planning']).default('current').volatile(),
  defaultExecution: RouteSchema.default(DEFAULT_EXECUTION).volatile(),
  defaultPlanning: RouteSchema.default(DEFAULT_PLANNING).volatile(),
  sessionOverrides: Schema.dict(Schema.object({
    mode: Schema.union(['fast', 'expert']),
    compaction: Schema.union(['current', 'planning']),
    execution: RouteSchema,
    planning: RouteSchema,
  })).default({}).volatile(),
})

export function apply(ctx, config) {
  let settings
  ctx.inject(['settings'], scope => {
    settings = scope.settings
    scope.effect(() => settings.configure({ auto: false }, ctx.fiber))
  })
  const settingsApi = {
    get: () => ({
      defaultMode: config.defaultMode.get(),
      defaultCompaction: config.defaultCompaction.get(),
      defaultExecution: config.defaultExecution.get(),
      defaultPlanning: config.defaultPlanning.get(),
      sessionOverrides: config.sessionOverrides.get(),
    }),
    async freeze(sessionId, routes) {
      if (!settings) return
      await settings.mutate(SETTINGS_NAMESPACE, [{
        op: 'set', path: ['sessionOverrides', sessionId], value: routes,
      }])
    },
  }
  Object.assign(settingsApi, createRouteSnapshots(settingsApi.get))
  ctx.provide('adaptivePlanSettings', settingsApi)

  ctx.on('api-session/removed', sessionId => {
    if (!settings || config.sessionOverrides.get()[sessionId] === undefined) return
    void settings.mutate(SETTINGS_NAMESPACE, [{
      op: 'unset', path: ['sessionOverrides', sessionId],
    }]).catch(error => ctx.logger.warn(`could not remove P&E routes: ${error?.message ?? error}`))
  })
}
