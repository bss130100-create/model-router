import type { ModelRouterRoute, ModelRouterRule } from '../types'

// EDIT THIS FILE to tune the router.
//
// How it works: for each prompt, the rules are checked top to bottom.
// The first rule with a keyword found anywhere in the prompt wins
// (case does not matter). No rule matches -> DEFAULT_ROUTE.
//
// model:  'opus', 'sonnet', 'haiku', or a full model id
// effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
//
// A mistake here (unknown effort, empty keyword list, duplicate name)
// stops the mod from loading and Claude Code shows why.

export const DEFAULT_ROUTE: ModelRouterRoute = { model: 'opus', effort: 'high' }

export const RULES: readonly ModelRouterRule[] = [
  // Manual overrides: type the tag anywhere in your prompt.
  { name: 'tag-max', model: 'opus', effort: 'max', keywords: ['#max'] },
  { name: 'tag-quick', model: 'sonnet', effort: 'low', keywords: ['#quick'] },

  // Hard bugs: the cases where extra thinking pays off.
  {
    name: 'hard-bug',
    model: 'opus',
    effort: 'xhigh',
    keywords: [
      'traceback',
      'stack trace',
      'crash',
      'still broken',
      'still failing',
      'still not working',
      'race condition',
      'deadlock',
      'memory leak',
      'intermittent',
    ],
  },

  // Tricky design work.
  {
    name: 'design',
    model: 'opus',
    effort: 'xhigh',
    keywords: ['architecture', 'design the', 'refactor', 'trade-off', 'tradeoff'],
  },

  // Quick questions and small edits: a faster model is enough.
  {
    name: 'quick',
    model: 'sonnet',
    effort: 'medium',
    keywords: [
      'what is',
      'what does',
      'explain',
      'summarize',
      'translate',
      'rename',
      'typo',
    ],
  },
]
