import type {
  ModelRouterClassifier,
  ModelRouterTier,
  ModelRouterTierSpec,
} from '../types'

// EDIT THIS FILE to tune the router.
//
// How it works: before each prompt runs, a small fast model (the CLASSIFIER)
// reads your prompt plus the last few messages and picks one TIER. The tier
// decides the effort that answers you. When it is unsure between two tiers it
// is told to pick the higher one: accuracy first, then cost.
//
// Override it: type #trivial, #simple, #standard, #hard or #max anywhere in
// a prompt. A tag skips the classifier.
//
// effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
// guide:  what the classifier reads to recognise the tier. Plain English.
//
// A mistake here stops the mod from loading and Claude Code shows why.

// Every tier runs on this model; only the effort changes. Each model keeps
// its own prompt cache, so a switch to another model re-reads the whole
// conversation at full price (and again on the way back), while an effort
// change keeps the cache. 'opus', 'sonnet', 'haiku', or a full model id.
export const MODEL = 'opus'

export const TIERS: Record<ModelRouterTier, ModelRouterTierSpec> = {
  trivial: {
    effort: 'low',
    guide:
      'Chit-chat, thanks, a plain yes/no, or a status question, and the assistant has nothing left to do. Nothing to explain or teach, no code to write or read. NOT trivial when the message lets the assistant carry on with work it said it would do next (it promised to push, build or test once the user confirmed).',
  },
  simple: {
    effort: 'medium',
    guide:
      'Explain a concept or how something works, summarize, translate, a small edit to one file (rename, typo, a few lines), or a short script with an obvious approach.',
  },
  standard: {
    effort: 'high',
    guide:
      'Normal engineering work: build or change a feature, write code with tests, review code, research and compare options, follow up on a plan.',
  },
  hard: {
    effort: 'xhigh',
    guide:
      'A hard bug (crash, traceback, intermittent failure, still broken after a fix), tricky design or architecture, a multi-file refactor, security-sensitive code, or a large build of many features at once.',
  },
  max: {
    effort: 'max',
    guide:
      'The user is stuck on the same problem after several failed fixes and asks to dig deeper, or a decision with large consequences that needs the most careful reasoning. Size alone (many features, many files, many batches) is hard, never max.',
  },
}

export const CLASSIFIER: ModelRouterClassifier = {
  model: 'haiku',
  effort: 'low',
  timeoutMs: 8000,
  contextMessages: 6,
}

// The highest tier the router picks on its own. When the classifier says a
// higher tier (max), no work starts: Claude only asks "Reply yes to run it at
// max, or no to run it at hard", and your answer picks the route. Max only
// with your yes (or a #max you type).
export const AUTO_TIER_CAP: ModelRouterTier = 'hard'

// If the classifier fails (timeout, API error, unreadable answer) this tier is
// used, and the status line and Claude's reply say so. Your prompt is never
// blocked by the router.
export const ON_CLASSIFIER_ERROR: ModelRouterTier = 'standard'
