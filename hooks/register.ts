import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModelRouterDecision, ModelRouterTurnLock } from '../types'
import { CLASSIFIER, ON_CLASSIFIER_ERROR, TIERS } from './rules'
import {
  buildClassifierRequest,
  decide,
  describeRouter,
  findTag,
  label,
  parseClassifierReply,
  validateConfig,
} from './route'

// Change a shape tag when that value's fields change: it declines what an
// earlier version stored, which outlives a reload.
const last = atom({ plugin: 'model-router', key: 'last' } as const, null as ModelRouterDecision | null, {
  shape: 'decision-2',
})
const lock = atom({ plugin: 'model-router', key: 'lock' } as const, null as ModelRouterTurnLock | null, {
  shape: 'lock-2',
})
const isOff = atom({ plugin: 'model-router', key: 'isOff' } as const, false)

/** Asks the classifier model which tier the prompt needs. */
async function classify($: EngineInterface, text: string): Promise<ModelRouterDecision> {
  const history = CLASSIFIER.contextMessages === 0 ? [] : (await $.session.messages()).slice(-CLASSIFIER.contextMessages)
  const ask = buildClassifierRequest(text, history, TIERS)
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

/** The declared error tier, said out loud: never a silent fallback. */
function failed($: EngineInterface, why: string): ModelRouterDecision {
  $.ui.toast(`model-router: classifier failed (${why}); using ${ON_CLASSIFIER_ERROR}`)
  return decide(ON_CLASSIFIER_ERROR, 'error', why, TIERS)
}

export const register: Register = on => {
  // Fail fast: a broken rules.ts stops the mod from loading, with the reason.
  validateConfig(TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Model router: show tiers and last pick; /route off or /route on',
    })
    return next(e)
  })

  // 1. Understand each prompt you send and pick a tier.
  // Slash commands keep the last pick.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || (await read($, isOff))) {
      return next(e)
    }
    const tag = findTag(e.text)
    const decision = tag === null ? await classify($, e.text) : decide(tag, 'tag', `#${tag} tag`, TIERS)
    await update($, last, () => decision)
    $.ui.status(label(decision))
    return next(e)
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
    if (e.agentId !== undefined || (await read($, isOff))) {
      return yield* next(e)
    }
    let locked = await read($, lock)
    if (locked === null || locked.turnId !== e.turnId) {
      const decision = await read($, last)
      if (decision === null) {
        return yield* next(e)
      }
      locked = { turnId: e.turnId, decision }
      await update($, lock, () => locked)
    }
    const { model, effort } = locked.decision
    return yield* next({ ...e, model, effort })
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
      text: describeRouter(await read($, isOff), await read($, last), TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR),
    }
  })
}
