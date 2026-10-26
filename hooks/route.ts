import type {
  ModelRouterClassifier,
  ModelRouterDecision,
  ModelRouterEffort,
  ModelRouterTier,
  ModelRouterTierSpec,
} from '../types'

export const TIER_ORDER: readonly ModelRouterTier[] = ['trivial', 'simple', 'standard', 'hard', 'max']
const EFFORTS: readonly ModelRouterEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const PROMPT_CHARS = 4000
const CONTEXT_CHARS = 500

type Tiers = Record<ModelRouterTier, ModelRouterTierSpec>

/** One earlier message, as the classifier reads it. */
export type ContextMessage = { role: 'user' | 'assistant'; text: string }

/** Throws on the first mistake in rules.ts, so a bad edit never loads silently. */
export function validateConfig(
  tiers: Tiers,
  classifier: ModelRouterClassifier,
  onError: ModelRouterTier,
): void {
  for (const tier of TIER_ORDER) {
    const spec = tiers[tier]
    if (spec === undefined) {
      throw new Error(`model-router: TIERS is missing "${tier}"`)
    }
    checkModelAndEffort(`tier "${tier}"`, spec.model, spec.effort)
    if (spec.guide.trim() === '') {
      throw new Error(`model-router: tier "${tier}" has an empty guide`)
    }
  }
  checkModelAndEffort('CLASSIFIER', classifier.model, classifier.effort)
  if (!Number.isInteger(classifier.timeoutMs) || classifier.timeoutMs <= 0) {
    throw new Error('model-router: CLASSIFIER.timeoutMs must be a whole number above 0')
  }
  if (!Number.isInteger(classifier.contextMessages) || classifier.contextMessages < 0) {
    throw new Error('model-router: CLASSIFIER.contextMessages must be a whole number, 0 or more')
  }
  if (!TIER_ORDER.includes(onError)) {
    throw new Error(`model-router: ON_CLASSIFIER_ERROR "${onError}" is not a tier`)
  }
}

function checkModelAndEffort(where: string, model: string, effort: ModelRouterEffort): void {
  if (model.trim() === '') {
    throw new Error(`model-router: ${where} has an empty model`)
  }
  if (!EFFORTS.includes(effort)) {
    throw new Error(`model-router: ${where} has effort "${effort}"; use one of ${EFFORTS.join(', ')}`)
  }
}

/** A #tier tag typed in the prompt; with several, the highest wins. */
export function findTag(text: string): ModelRouterTier | null {
  const found = [...text.toLowerCase().matchAll(/#([a-z]+)\b/g)]
    .map(m => m[1] as ModelRouterTier)
    .filter(t => TIER_ORDER.includes(t))
  if (found.length === 0) {
    return null
  }
  return found.reduce((a, b) => (TIER_ORDER.indexOf(b) > TIER_ORDER.indexOf(a) ? b : a))
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)} [...cut]`
}

/** The system prompt and user message the classifier gets. */
export function buildClassifierRequest(
  prompt: string,
  context: readonly ContextMessage[],
  tiers: Tiers,
): { system: string; prompt: string } {
  const system = [
    'You route requests for a coding assistant to the right model and effort.',
    'Pick the tier the NEW REQUEST needs to be answered correctly.',
    'Read the recent conversation only to understand the request: a short reply',
    'such as "yes, do it" continues the work discussed before it.',
    '',
    'Tiers, cheapest first:',
    ...TIER_ORDER.map(t => `- ${t}: ${tiers[t].guide}`),
    '',
    'Rules:',
    '- Accuracy matters more than cost. When unsure between two tiers, pick the higher one.',
    '- Judge the work the request asks for, not how long the request is.',
    '',
    'Reply with one line of JSON and nothing else:',
    '{"tier": "<tier>", "why": "<at most 8 words>"}',
  ].join('\n')
  const history = context
    .filter(m => m.text.trim() !== '')
    .map(m => `${m.role.toUpperCase()}: ${cut(m.text, CONTEXT_CHARS)}`)
  const user = [
    '<recent_conversation>',
    history.length === 0 ? '(none)' : history.join('\n\n'),
    '</recent_conversation>',
    '',
    '<new_request>',
    cut(prompt, PROMPT_CHARS),
    '</new_request>',
  ].join('\n')
  return { system, prompt: user }
}

/** Reads the classifier's JSON answer; throws when it is not a known tier. */
export function parseClassifierReply(text: string): { tier: ModelRouterTier; why: string } {
  const json = text.match(/\{[^{}]*\}/)
  if (json === null) {
    throw new Error(`no JSON in classifier reply: ${cut(text, 80)}`)
  }
  const parsed: unknown = JSON.parse(json[0])
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('classifier reply is not an object')
  }
  const { tier, why } = parsed as { tier?: unknown; why?: unknown }
  if (typeof tier !== 'string' || !TIER_ORDER.includes(tier as ModelRouterTier)) {
    throw new Error(`classifier picked unknown tier: ${String(tier)}`)
  }
  return {
    tier: tier as ModelRouterTier,
    why: typeof why === 'string' ? cut(why.trim(), 60) : '',
  }
}

export function decide(
  tier: ModelRouterTier,
  source: ModelRouterDecision['source'],
  why: string,
  tiers: Tiers,
): ModelRouterDecision {
  return { tier, source, why, model: tiers[tier].model, effort: tiers[tier].effort }
}

export function label(d: ModelRouterDecision): string {
  const head = `route: ${d.model} · ${d.effort} (${d.tier})`
  return d.source === 'error' ? `${head} CLASSIFIER FAILED: ${d.why}` : head
}

/** The text /route prints: on or off, the last pick, tiers and classifier. */
export function describeRouter(
  isOff: boolean,
  last: ModelRouterDecision | null,
  tiers: Tiers,
  classifier: ModelRouterClassifier,
  onError: ModelRouterTier,
): string {
  const pick =
    last === null ? 'none yet' : `${label(last)}, by ${last.source}${last.why === '' ? '' : `: ${last.why}`}`
  return [
    `Model router is ${isOff ? 'OFF (your /model setting applies)' : 'ON'}.`,
    `Last pick: ${pick}`,
    '',
    'Tiers, cheapest first (type #<tier> in a prompt to force one):',
    ...TIER_ORDER.map(t => `  ${t} -> ${tiers[t].model} · ${tiers[t].effort}`),
    '',
    `Classifier: ${classifier.model} · ${classifier.effort}, reads the last ${classifier.contextMessages} messages.`,
    `If it fails: ${onError}.`,
    '',
    'Edit hooks/rules.ts to change them. /route off or /route on to switch.',
  ].join('\n')
}
