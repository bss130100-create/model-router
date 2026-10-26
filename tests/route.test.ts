import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_ROUTE, RULES } from '../hooks/rules'
import { describeRouter, pickRoute, validateRules } from '../hooks/route'

describe('pickRoute', () => {
  test('a hard bug gets opus at xhigh', async () => {
    const d = pickRoute('It still CRASHES on start, see the Traceback', RULES, DEFAULT_ROUTE)
    expect(d).toEqual({ rule: 'hard-bug', model: 'opus', effort: 'xhigh' })
  })

  test('a quick question gets sonnet at medium', async () => {
    expect(pickRoute('What is a venv?', RULES, DEFAULT_ROUTE).rule).toBe('quick')
  })

  test('the first matching rule wins', async () => {
    // "explain" is quick, but "traceback" comes first in the list.
    expect(pickRoute('explain this traceback', RULES, DEFAULT_ROUTE).rule).toBe('hard-bug')
  })

  test('the #max tag beats everything', async () => {
    expect(pickRoute('what is this? #max', RULES, DEFAULT_ROUTE)).toEqual({
      rule: 'tag-max',
      model: 'opus',
      effort: 'max',
    })
  })

  test('no match gets the default route', async () => {
    expect(pickRoute('add a dark mode toggle', RULES, DEFAULT_ROUTE)).toEqual({
      rule: 'default',
      model: 'opus',
      effort: 'high',
    })
  })
})

describe('validateRules', () => {
  const ok = { name: 'a', model: 'opus', effort: 'high', keywords: ['x'] } as const

  test('the shipped rules are valid', async () => {
    validateRules(RULES, DEFAULT_ROUTE)
  })

  test('an unknown effort is refused', async () => {
    const bad = [{ ...ok, effort: 'ultra' as never }]
    expect(() => validateRules(bad, DEFAULT_ROUTE)).toThrow(/effort "ultra"/)
  })

  test('a rule with no keywords is refused', async () => {
    expect(() => validateRules([{ ...ok, keywords: [] }], DEFAULT_ROUTE)).toThrow(/no keywords/)
  })

  test('an empty keyword is refused', async () => {
    expect(() => validateRules([{ ...ok, keywords: ['x', ' '] }], DEFAULT_ROUTE)).toThrow(
      /empty keyword/,
    )
  })

  test('duplicate rule names are refused', async () => {
    expect(() => validateRules([ok, ok], DEFAULT_ROUTE)).toThrow(/two rules are named "a"/)
  })

  test('an empty model is refused', async () => {
    expect(() => validateRules([{ ...ok, model: ' ' }], DEFAULT_ROUTE)).toThrow(/empty model/)
  })
})

test('describeRouter lists every rule and the default', async () => {
  const text = describeRouter(false, null, RULES, DEFAULT_ROUTE)
  expect(text).toContain('Model router is ON')
  expect(text).toContain('Last pick: none yet')
  for (const rule of RULES) {
    expect(text).toContain(rule.name)
  }
  expect(text).toContain('default -> opus · high')
})
