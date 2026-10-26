import type {
  ModelRouterClassifier,
  ModelRouterTier,
  ModelRouterTierSpec,
} from '../types'

// EDIT THIS FILE to tune the router.
//
// How it works: before each prompt runs, a small fast model (the CLASSIFIER)
// reads your prompt plus the last few messages and picks one TIER. The tier
// decides which model and effort answer you. When it is unsure between two
// tiers it is told to pick the higher one: accuracy first, then cost.
//
// Override it: type #trivial, #simple, #standard, #hard or #max anywhere in
// a prompt. A tag skips the classifier.
//
// model:  'opus', 'sonnet', 'haiku', or a full model id
// effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
// guide:  what the classifier reads to recognise the tier. Plain English.
//
// A mistake here stops the mod from loading and Claude Code shows why.

export const TIERS: Record<ModelRouterTier, ModelRouterTierSpec> = {
  trivial: {
    model: 'haiku',
    effort: 'low',
    guide:
      'Chit-chat, thanks, a plain yes/no, or a status question, and the assistant has nothing left to do. Nothing to explain or teach, no code to write or read. NOT trivial when the message lets the assistant carry on with work it said it would do next (it promised to push, build or test once the user confirmed).',
  },
  simple: {
    model: 'sonnet',
    effort: 'medium',
    guide:
      'Explain a concept or how something works, summarize, translate, a small edit to one file (rename, typo, a few lines), or a short script with an obvious approach.',
  },
  standard: {
    model: 'opus',
    effort: 'high',
    guide:
      'Normal engineering work: build or change a feature, write code with tests, review code, research and compare options, follow up on a plan.',
  },
  hard: {
    model: 'opus',
    effort: 'xhigh',
    guide:
      'A hard bug (crash, traceback, intermittent failure, still broken after a fix), tricky design or architecture, a multi-file refactor, security-sensitive code.',
  },
  max: {
    model: 'opus',
    effort: 'max',
    guide:
      'Stuck after several failed attempts, a deep root-cause hunt, or a decision with large consequences that needs the most careful reasoning.',
  },
}

export const CLASSIFIER: ModelRouterClassifier = {
  model: 'haiku',
  effort: 'low',
  timeoutMs: 8000,
  contextMessages: 6,
}

// The highest tier the router picks on its own. When the classifier says a
// higher tier (max), the router runs this one instead and Claude tells you in
// its reply that it recommends max: type #max to run it. Max only on request.
export const AUTO_TIER_CAP: ModelRouterTier = 'hard'

// In a long conversation, switching to a cheaper model costs MORE than it
// saves: each model keeps its own prompt cache, so the first turn on the new
// model re-reads the whole conversation at full price. Above this many tokens
// the router only moves UP a tier, never down. A #tag still forces any tier.
export const LONG_CONTEXT_TOKENS = 100_000

// If the classifier fails (timeout, API error, unreadable answer) this tier is
// used and the status line says so. Your prompt is never blocked by the router.
export const ON_CLASSIFIER_ERROR: ModelRouterTier = 'standard'
