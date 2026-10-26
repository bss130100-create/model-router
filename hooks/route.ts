import type {
  ModelRouterDecision,
  ModelRouterEffort,
  ModelRouterRoute,
  ModelRouterRule,
} from '../types'

const EFFORTS: readonly ModelRouterEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Throws on the first mistake in the rules, so a bad edit never loads silently. */
export function validateRules(
  rules: readonly ModelRouterRule[],
  defaultRoute: ModelRouterRoute,
): void {
  checkRoute('DEFAULT_ROUTE', defaultRoute)
  const names = new Set<string>()
  for (const rule of rules) {
    if (rule.name.trim() === '') {
      throw new Error('model-router: a rule has an empty name')
    }
    if (names.has(rule.name)) {
      throw new Error(`model-router: two rules are named "${rule.name}"`)
    }
    names.add(rule.name)
    checkRoute(`rule "${rule.name}"`, rule)
    if (rule.keywords.length === 0) {
      throw new Error(`model-router: rule "${rule.name}" has no keywords`)
    }
    if (rule.keywords.some(k => k.trim() === '')) {
      throw new Error(`model-router: rule "${rule.name}" has an empty keyword`)
    }
  }
}

function checkRoute(where: string, route: ModelRouterRoute): void {
  if (route.model.trim() === '') {
    throw new Error(`model-router: ${where} has an empty model`)
  }
  if (!EFFORTS.includes(route.effort)) {
    throw new Error(
      `model-router: ${where} has effort "${route.effort}"; use one of ${EFFORTS.join(', ')}`,
    )
  }
}

/** First rule with a keyword in the text wins; none -> the default route. */
export function pickRoute(
  text: string,
  rules: readonly ModelRouterRule[],
  defaultRoute: ModelRouterRoute,
): ModelRouterDecision {
  const lower = text.toLowerCase()
  for (const rule of rules) {
    if (rule.keywords.some(k => lower.includes(k.toLowerCase()))) {
      return { rule: rule.name, model: rule.model, effort: rule.effort }
    }
  }
  return { rule: 'default', ...defaultRoute }
}

export function label(d: ModelRouterDecision): string {
  return `route: ${d.model} · ${d.effort} (${d.rule})`
}

/** The text /route prints: on or off, the last pick, and every rule. */
export function describeRouter(
  isOff: boolean,
  last: ModelRouterDecision | null,
  rules: readonly ModelRouterRule[],
  defaultRoute: ModelRouterRoute,
): string {
  const lines = [
    `Model router is ${isOff ? 'OFF (your /model setting applies)' : 'ON'}.`,
    `Last pick: ${last === null ? 'none yet' : label(last)}`,
    '',
    'Rules, first match wins:',
    ...rules.map(
      (r, i) => `  ${i + 1}. ${r.name} -> ${r.model} · ${r.effort}: ${r.keywords.join(', ')}`,
    ),
    `  default -> ${defaultRoute.model} · ${defaultRoute.effort}`,
    '',
    'Edit hooks/rules.ts to change them. /route off or /route on to switch.',
  ]
  return lines.join('\n')
}
