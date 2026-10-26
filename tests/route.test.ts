import { describe, expect, test } from 'claude-code/testing'

import { CLASSIFIER, ON_CLASSIFIER_ERROR, TIERS } from '../hooks/rules'
import {
  buildClassifierRequest,
  describeRouter,
  findTag,
  parseClassifierReply,
  validateConfig,
} from '../hooks/route'

describe('findTag', () => {
  test('finds a tier tag anywhere, any case', async () => {
    expect(findTag('fix the scanner #HARD please')).toBe('hard')
  })
  test('the highest of several tags wins', async () => {
    expect(findTag('#simple ... actually #max')).toBe('max')
  })
  test('ignores hashtags that are not tiers', async () => {
    expect(findTag('see issue #12 and #todo')).toBe(null)
  })
})

describe('parseClassifierReply', () => {
  test('reads a clean JSON line', async () => {
    expect(parseClassifierReply('{"tier": "hard", "why": "intermittent crash"}')).toEqual({
      tier: 'hard',
      why: 'intermittent crash',
    })
  })
  test('reads JSON wrapped in other text', async () => {
    expect(parseClassifierReply('Sure: {"tier":"trivial","why":"thanks"} done').tier).toBe('trivial')
  })
  test('refuses an unknown tier', async () => {
    expect(() => parseClassifierReply('{"tier":"huge"}')).toThrow(/unknown tier: huge/)
  })
  test('refuses a reply with no JSON', async () => {
    expect(() => parseClassifierReply('hard')).toThrow(/no JSON/)
  })
  test('refuses broken JSON', async () => {
    expect(() => parseClassifierReply('{tier: hard}')).toThrow()
  })
})

describe('buildClassifierRequest', () => {
  test('lists every tier guide and asks for JSON', async () => {
    const { system } = buildClassifierRequest('hi', [], TIERS)
    for (const spec of Object.values(TIERS)) {
      expect(system).toContain(spec.guide)
    }
    expect(system).toContain('pick the higher one')
    expect(system).toContain('{"tier"')
  })
  test('carries the recent conversation and the new request', async () => {
    const { prompt } = buildClassifierRequest(
      'yes, do it',
      [
        { role: 'assistant', text: 'Plan: rewrite the scanner in 4 files.' },
        { role: 'user', text: '' },
      ],
      TIERS,
    )
    expect(prompt).toContain('ASSISTANT: Plan: rewrite the scanner in 4 files.')
    expect(prompt).not.toContain('USER: \n')
    expect(prompt).toContain('<new_request>\nyes, do it\n</new_request>')
  })
  test('cuts a huge prompt', async () => {
    const { prompt } = buildClassifierRequest('x'.repeat(10000), [], TIERS)
    expect(prompt.length).toBeLessThan(4200)
    expect(prompt).toContain('[...cut]')
  })
})

describe('validateConfig', () => {
  test('the shipped rules are valid', async () => {
    validateConfig(TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR)
  })
  test('an unknown effort is refused', async () => {
    const bad = { ...TIERS, hard: { ...TIERS.hard, effort: 'ultra' as never } }
    expect(() => validateConfig(bad, CLASSIFIER, ON_CLASSIFIER_ERROR)).toThrow(/effort "ultra"/)
  })
  test('a missing tier is refused', async () => {
    const { max: _, ...rest } = TIERS
    expect(() => validateConfig(rest as typeof TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR)).toThrow(
      /missing "max"/,
    )
  })
  test('an empty guide is refused', async () => {
    const bad = { ...TIERS, simple: { ...TIERS.simple, guide: ' ' } }
    expect(() => validateConfig(bad, CLASSIFIER, ON_CLASSIFIER_ERROR)).toThrow(/empty guide/)
  })
  test('a bad timeout is refused', async () => {
    expect(() => validateConfig(TIERS, { ...CLASSIFIER, timeoutMs: 0 }, ON_CLASSIFIER_ERROR)).toThrow(
      /timeoutMs/,
    )
  })
  test('an error tier that does not exist is refused', async () => {
    expect(() => validateConfig(TIERS, CLASSIFIER, 'medium' as never)).toThrow(/not a tier/)
  })
})

test('describeRouter lists every tier and the classifier', async () => {
  const text = describeRouter(false, null, TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR)
  expect(text).toContain('Model router is ON')
  expect(text).toContain('trivial -> haiku · low')
  expect(text).toContain('max -> opus · max')
  expect(text).toContain('Classifier: haiku · low')
})
