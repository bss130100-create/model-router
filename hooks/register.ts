import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ModelRouterDecision, ModelRouterTurnLock } from '../types'
import { DEFAULT_ROUTE, RULES } from './rules'
import { describeRouter, label, pickRoute, validateRules } from './route'

// Change a shape tag when that value's fields change: it declines what an
// earlier version stored, which outlives a reload.
const last = atom({ plugin: 'model-router', key: 'last' } as const, null as ModelRouterDecision | null, {
  shape: 'decision-1',
})
const lock = atom({ plugin: 'model-router', key: 'lock' } as const, null as ModelRouterTurnLock | null, {
  shape: 'lock-1',
})
const isOff = atom({ plugin: 'model-router', key: 'isOff' } as const, false)

export const register: Register = on => {
  // Fail fast: a broken rules.ts stops the mod from loading, with the reason.
  validateRules(RULES, DEFAULT_ROUTE)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Model router: show rules and last pick; /route off or /route on',
    })
    return next(e)
  })

  // 1. Classify each prompt you send.
  on('prompt.submit', async ($, e, next) => {
    if (await read($, isOff)) {
      return next(e)
    }
    const decision = pickRoute(e.text, RULES, DEFAULT_ROUTE)
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
      text: describeRouter(await read($, isOff), await read($, last), RULES, DEFAULT_ROUTE),
    }
  })
}
