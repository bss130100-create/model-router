export type ModelRouterEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** How demanding a request is, from cheapest to most thorough. */
export type ModelRouterTier = 'trivial' | 'simple' | 'standard' | 'hard' | 'max'

/** A model alias (opus, sonnet, haiku) or a full model id, plus an effort level. */
export type ModelRouterRoute = { model: string; effort: ModelRouterEffort }

/** One tier: its effort (every tier runs on the router's one model), and the guide the classifier reads to pick it. */
export type ModelRouterTierSpec = { effort: ModelRouterEffort; guide: string }

/** The model that reads each prompt and picks a tier. */
export type ModelRouterClassifier = {
  model: string
  effort: ModelRouterEffort
  timeoutMs: number
  /** How many earlier messages it reads, so "yes, do it" is understood. */
  contextMessages: number
}

/**
 * What the router picked for a prompt and why. `source` says who picked the
 * tier: a #tag you typed, the classifier, the declared error tier, or your
 * yes or no to a recommendation.
 */
export type ModelRouterDecision = ModelRouterRoute & {
  tier: ModelRouterTier
  source: 'tag' | 'classifier' | 'error' | 'answer'
  why: string
  /**
   * A higher tier the router recommends. While set, the work waits: the turn
   * only asks you, and your yes or no on the next message decides the route.
   */
  recommended: ModelRouterTier | null
}

/** The route locked in for one turn, so a turn never changes model halfway. */
export type ModelRouterTurnLock = { turnId: string; decision: ModelRouterDecision }

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      last: Shaped<ModelRouterDecision | null>
      lock: Shaped<ModelRouterTurnLock | null>
      isOff: boolean
    }
  }
}
