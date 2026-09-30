import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_EXECUTION, DEFAULT_PLANNING, DEFAULT_MODE, SETTINGS_NAMESPACE } from './defaults.js'

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
  defaultExecution: RouteSchema.default(DEFAULT_EXECUTION).volatile(),
  defaultPlanning: RouteSchema.default(DEFAULT_PLANNING).volatile(),
  sessionOverrides: Schema.dict(Schema.object({
    mode: Schema.union(['fast', 'expert']),
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
  ctx.provide('adaptivePlanSettings', {
    get: () => ({
      defaultMode: config.defaultMode.get(),
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
  })

  ctx.on('api-session/removed', sessionId => {
    if (!settings || config.sessionOverrides.get()[sessionId] === undefined) return
    void settings.mutate(SETTINGS_NAMESPACE, [{
      op: 'unset', path: ['sessionOverrides', sessionId],
    }]).catch(error => ctx.logger.warn(`could not remove Adaptive Plan routes: ${error?.message ?? error}`))
  })
}
