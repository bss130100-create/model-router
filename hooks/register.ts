import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepInput } from 'claude-code'

import type { ModelRouterDecision, ModelRouterTurnLock } from '../types'
import { AUTO_TIER_CAP, CLASSIFIER, LONG_CONTEXT_TOKENS, ON_CLASSIFIER_ERROR, TIERS } from './rules'
import {
  answerHeld,
  buildClassifierRequest,
  capAutoTier,
  carryPick,
  decide,
  describeRouter,
  extractRequest,
  findHeldQuestion,
  findTag,
  floorModelInLongContext,
  holdForAnswer,
  label,
  parseClassifierReply,
  prepareClassifierInput,
  readAnswer,
  routeNote,
  unwrap,
  validateConfig,
} from './route'
import type { SessionRow } from './route'

// Change a shape tag when that value's fields change: it declines what an
// earlier version stored, which outlives a reload.
const last = atom({ plugin: 'model-router', key: 'last' } as const, null as ModelRouterDecision | null, {
  shape: 'decision-5',
})
const lock = atom({ plugin: 'model-router', key: 'lock' } as const, null as ModelRouterTurnLock | null, {
  shape: 'lock-5',
})
const isOff = atom({ plugin: 'model-router', key: 'isOff' } as const, false)

/** Asks the classifier model which tier the prompt needs. */
async function classify(
  $: EngineInterface,
  text: string,
  rows: readonly SessionRow[],
): Promise<ModelRouterDecision> {
  const input = prepareClassifierInput(text, rows, CLASSIFIER.contextMessages)
  const ask = buildClassifierRequest(input.prompt, input.context, TIERS)
  const reply = await $.model.complete({
    model: CLASSIFIER.model,
    effort: CLASSIFIER.effort,
    timeoutMs: CLASSIFIER.timeoutMs,
    maxTokens: 100,
    system: ask.system,
    prompt: ask.prompt,
  })
  if (!reply.isAnswered) {
    return failed($, reply.reason)
  }
  try {
    const { tier, why } = parseClassifierReply(reply.text)
    return decide(tier, 'classifier', why, TIERS)
  } catch (err) {
    return failed($, err instanceof Error ? err.message : String(err))
  }
}

/** The classifier's tier; above AUTO_TIER_CAP the work waits for the person's yes or no. */
async function pick($: EngineInterface, text: string, rows: readonly SessionRow[]): Promise<ModelRouterDecision> {
  return holdForAnswer(capAutoTier(await classify($, text, rows), AUTO_TIER_CAP, TIERS), TIERS)
}

/**
 * How many tokens the conversation holds: what the last response was
 * answered over, which the session keeps across a restart or a resume.
 * Absent before the first response, when the conversation is new.
 */
async function contextSize($: EngineInterface): Promise<number> {
  return (await $.session.usage()).context.tokens ?? 0
}

/**
 * The tier for a prompt. Only the person's own words can force a tier or
 * answer the router's question: a #max or "yes" that Claude wrote, relayed or
 * quoted in a note, must not. A #tag wins, then a yes or no to the question
 * Claude last asked (read from the transcript), then the classifier.
 */
async function chooseTier($: EngineInterface, text: string): Promise<ModelRouterDecision> {
  const words = unwrap(text).words
  const tag = findTag(words)
  if (tag !== null) {
    return decide(tag, 'tag', `#${tag} tag`, TIERS)
  }
  const rows = await $.session.messages()
  const answer = readAnswer(words)
  const held = answer === null ? null : findHeldQuestion(rows)
  if (answer !== null && held !== null) {
    return answerHeld(held.recommended, answer, held.cap, TIERS)
  }
  return pick($, text, rows)
}

/** The route for a prompt: its tier, on at least the standard model in a long conversation. */
async function choose($: EngineInterface, text: string): Promise<ModelRouterDecision> {
  const tier = await chooseTier($, text)
  return floorModelInLongContext(tier, await contextSize($), LONG_CONTEXT_TOKENS, TIERS)
}

/**
 * The route a turn the person did not start carries: their last pick, never
 * above AUTO_TIER_CAP, and on at least the standard model in a long
 * conversation (it may have grown past the limit since).
 */
async function carry($: EngineInterface): Promise<void> {
  const tokens = await contextSize($)
  const carried = await update($, last, d =>
    d === null ? null : floorModelInLongContext(carryPick(d, AUTO_TIER_CAP, TIERS), tokens, LONG_CONTEXT_TOKENS, TIERS),
  )
  if (carried !== null) {
    $.ui.status(label(carried))
  }
}

/** The declared error tier, said out loud: never a silent fallback. */
function failed($: EngineInterface, why: string): ModelRouterDecision {
  $.ui.toast(`model-router: classifier failed (${why}); using ${ON_CLASSIFIER_ERROR}`)
  return decide(ON_CLASSIFIER_ERROR, 'error', why, TIERS)
}

/** The step with the turn's locked route applied, or as it came when there is none. */
async function routeStep($: EngineInterface, e: TurnStepInput): Promise<TurnStepInput> {
  if (await read($, isOff)) {
    return e
  }
  let locked = await read($, lock)
  if (locked === null || locked.turnId !== e.turnId) {
    const decision = await read($, last)
    if (decision === null) {
      return e
    }
    locked = { turnId: e.turnId, decision }
    await update($, lock, () => locked)
  }
  return { ...e, model: locked.decision.model, effort: locked.decision.effort }
}

export const register: Register = on => {
  // Fail fast: a broken rules.ts stops the mod from loading, with the reason.
  validateConfig(TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR, LONG_CONTEXT_TOKENS, AUTO_TIER_CAP)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Model router: show tiers and last pick; /route off or /route on',
    })
    return next(e)
  })

  // 1. Understand each prompt you send and pick a tier.
  // Slash commands, background-task notifications and system events (a
  // wrapped prompt with neither the person's words nor a note) carry the last pick.
  on('prompt.submit', async ($, e, next) => {
    if (await read($, isOff)) {
      return next(e)
    }
    const isYours =
      e.command === undefined && e.origin.kind !== 'task-notification' && extractRequest(e.text).trim() !== ''
    if (!isYours) {
      await carry($)
      return next(e)
    }
    const decision = await choose($, e.text)
    await update($, last, () => decision)
    $.ui.status(label(decision))
    // Tell the answering model its route, so in any session (Projects threads
    // included, where /route cannot run) you can ask "which route are you on?".
    const note = routeNote(decision, e.turnId !== undefined, AUTO_TIER_CAP)
    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(async ($, e, next) => {
    // Never reuse a stale pick: clear it, say so, and let the prompt through.
    await update($, last, () => null)
    $.ui.status('route: FAILED, using your /model setting')
    return next(e)
  })

  // 2. Apply it to every model request of the main conversation's turn.
  // The route is locked at the turn's first request, so a message typed
  // mid-turn changes the next turn, never the one running.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }
    return yield* next(await routeStep($, e))
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, isOff, () => arg === 'off')
      await update($, last, () => null)
      await update($, lock, () => null)
      $.ui.status(arg === 'off' ? 'route: off' : undefined)
      return { text: `Model router is now ${arg.toUpperCase()}.` }
    }
    if (arg !== '') {
      return { text: `Unknown option "${e.args.trim()}". Use /route, /route off or /route on.` }
    }
    return {
      text: describeRouter(
        await read($, isOff),
        await read($, last),
        TIERS,
        CLASSIFIER,
        ON_CLASSIFIER_ERROR,
        LONG_CONTEXT_TOKENS,
        AUTO_TIER_CAP,
      ),
    }
  })
}
