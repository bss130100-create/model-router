export type ModelRouterEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** A model alias (opus, sonnet, haiku) or a full model id, plus an effort level. */
export type ModelRouterRoute = { model: string; effort: ModelRouterEffort }

/** One rule: if the prompt contains any keyword, use this route. */
export type ModelRouterRule = ModelRouterRoute & {
  name: string
  keywords: readonly string[]
}

/** What the router picked for a prompt, and which rule picked it. */
export type ModelRouterDecision = ModelRouterRoute & { rule: string }

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
