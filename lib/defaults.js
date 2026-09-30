// Retain the original settings key so upgrades keep user defaults and session routes.
export const SETTINGS_NAMESPACE = 'dsh-mids-fast'
export const DEFAULT_MODE = 'fast'

export const DEFAULT_EXECUTION = Object.freeze({
  provider: 'deepseek-official',
  model: 'deepseek-flash',
})

export const DEFAULT_PLANNING = Object.freeze({
  provider: 'mimo',
  model: 'mimo-v2.6-pro',
})

export const DEFAULT_ROUTES = Object.freeze({
  execution: DEFAULT_EXECUTION,
  planning: DEFAULT_PLANNING,
})
