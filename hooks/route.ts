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
  longContextTokens: number,
  autoTierCap: ModelRouterTier,
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
  if (!TIER_ORDER.includes(autoTierCap)) {
    throw new Error(`model-router: AUTO_TIER_CAP "${autoTierCap}" is not a tier`)
  }
  if (!Number.isInteger(longContextTokens) || longContextTokens <= 0) {
    throw new Error('model-router: LONG_CONTEXT_TOKENS must be a whole number above 0')
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

const ENTITIES: Record<string, string> = {
  '&#39;': "'",
  '&#34;': '"',
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
}

function unescape(text: string): string {
  return text.replace(/&#39;|&#34;|&quot;|&lt;|&gt;|&amp;/g, e => ENTITIES[e] ?? e)
}

function inner(text: string, tag: string): string[] {
  const found = text.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))
  return [...found].map(m => unescape((m[1] ?? '').trim())).filter(t => t !== '')
}

/**
 * The person's own words. In a Projects thread a prompt arrives wrapped in
 * XML (a <wake> with <message>s, or a <relay> with <cited> messages and a
 * <note>); the wrapper's ids and system notes would mislead the classifier.
 * A prompt with no such wrapper is returned as it is.
 */
export function extractRequest(text: string): string {
  if (!/<(wake|relay|coordinator-relay)\b/.test(text)) {
    return text
  }
  const words = [...inner(text, 'message'), ...inner(text, 'cited')]
  const notes = inner(text, 'note')
  const parts = [...words, ...notes.map(n => `(note from a colleague: ${n})`)]
  return parts.length === 0 ? '(a message with attachments only, no text)' : parts.join('\n')
}

/**
 * In a long conversation keep the higher of the previous and the new tier:
 * moving down there costs more (a cold cache on the cheaper model) than it saves.
 */
export function keepHigherInLongContext(
  next: ModelRouterDecision,
  previous: ModelRouterDecision | null,
  contextTokens: number,
  limit: number,
): ModelRouterDecision {
  if (previous === null || contextTokens <= limit) {
    return next
  }
  if (TIER_ORDER.indexOf(next.tier) >= TIER_ORDER.indexOf(previous.tier)) {
    return next
  }
  const k = Math.round(contextTokens / 1000)
  return { ...previous, source: 'long-context', why: `kept ${previous.tier} over ${next.tier}, context ${k}K tokens` }
}

/**
 * Tiers above the cap run only on request: the pick drops to the cap and
 * keeps the higher tier as a recommendation the person can act on.
 */
export function capAutoTier(d: ModelRouterDecision, cap: ModelRouterTier, tiers: Tiers): ModelRouterDecision {
  if (TIER_ORDER.indexOf(d.tier) <= TIER_ORDER.indexOf(cap)) {
    return d
  }
  return { ...decide(cap, d.source, d.why, tiers), recommended: d.tier }
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)} [...cut]`
}

/**
 * What the classifier reads, from the raw prompt and the raw session rows:
 * rows with no text (tool calls, tool results) are dropped BEFORE the last
 * `n` are taken, and the prompt and every row are unwrapped (extractRequest).
 */
export function prepareClassifierInput(
  prompt: string,
  rows: readonly ContextMessage[],
  n: number,
): { prompt: string; context: ContextMessage[] } {
  const withText = n === 0 ? [] : rows.filter(r => r.text.trim() !== '').slice(-n)
  return {
    prompt: extractRequest(prompt),
    context: withText.map(r => ({ role: r.role, text: extractRequest(r.text) })),
  }
}

/** The system prompt and user message the classifier gets, from prepared input. */
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
    '- Pick for the work the ASSISTANT must do next, not for how much the user wrote.',
    '- When the user confirms a step the assistant said it would act on next (for example',
    '  "it is live" after "tell me when the repo exists and I will push"), pick the tier of',
    '  that work. An acknowledgement that leaves the assistant nothing to do stays trivial.',
    '',
    'Reply with one line of JSON and nothing else:',
    '{"tier": "<tier>", "why": "<at most 8 words>"}',
  ].join('\n')
  const history = context.map(m => `${m.role.toUpperCase()}: ${cut(m.text, CONTEXT_CHARS)}`)
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
  return { tier, source, why, model: tiers[tier].model, effort: tiers[tier].effort, recommended: null }
}

export function label(d: ModelRouterDecision): string {
  const rec = d.recommended === null ? '' : `, ${d.recommended} recommended`
  const head = `route: ${d.model} · ${d.effort} (${d.tier}${rec})`
  return d.source === 'error' ? `${head} CLASSIFIER FAILED: ${d.why}` : head
}

/** The hidden note the answering model reads beside the prompt. */
export function routeNote(d: ModelRouterDecision): string {
  const why = d.why === '' ? '' : `: ${d.why}`
  const base = `[model-router] This turn runs on ${d.model} at ${d.effort} effort (tier ${d.tier}, picked by ${d.source}${why}).`
  if (d.recommended !== null) {
    return `${base} The router recommends tier ${d.recommended} for this request, but runs it only when the user asks. Start your reply with this one line: "The router recommends ${d.recommended} for this; reply #${d.recommended} to use it."`
  }
  return `${base} Mention it only if the user asks which model, effort or route is in use.`
}

/** The text /route prints: on or off, the last pick, tiers and classifier. */
export function describeRouter(
  isOff: boolean,
  last: ModelRouterDecision | null,
  tiers: Tiers,
  classifier: ModelRouterClassifier,
  onError: ModelRouterTier,
  longContextTokens: number,
  autoTierCap: ModelRouterTier,
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
    `It picks up to ${autoTierCap} on its own; higher tiers only on request, with a recommendation.`,
    `Above ${Math.round(longContextTokens / 1000)}K tokens of context it only moves up a tier, never down.`,
    '',
    'Edit hooks/rules.ts to change them. /route off or /route on to switch.',
  ].join('\n')
}
