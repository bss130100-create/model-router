import { describe, expect, test } from 'claude-code/testing'

import { AUTO_TIER_CAP, CLASSIFIER, LONG_CONTEXT_TOKENS, ON_CLASSIFIER_ERROR, TIERS } from '../hooks/rules'
import {
  buildClassifierRequest,
  capAutoTier,
  decide,
  describeRouter,
  extractRequest,
  findTag,
  keepStrongerModelInLongContext,
  parseClassifierReply,
  prepareClassifierInput,
  routeNote,
  rowText,
  unwrap,
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
      [{ role: 'assistant', text: 'Plan: rewrite the scanner in 4 files.' }],
      TIERS,
    )
    expect(prompt).toContain('ASSISTANT: Plan: rewrite the scanner in 4 files.')
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
    validateConfig(TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR, LONG_CONTEXT_TOKENS, AUTO_TIER_CAP)
  })
  test('an unknown effort is refused', async () => {
    const bad = { ...TIERS, hard: { ...TIERS.hard, effort: 'ultra' as never } }
    expect(() => validateConfig(bad, CLASSIFIER, ON_CLASSIFIER_ERROR, LONG_CONTEXT_TOKENS, AUTO_TIER_CAP)).toThrow(/effort "ultra"/)
  })
  test('a missing tier is refused', async () => {
    const { max: _, ...rest } = TIERS
    expect(() => validateConfig(rest as typeof TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR, LONG_CONTEXT_TOKENS, AUTO_TIER_CAP)).toThrow(
      /missing "max"/,
    )
  })
  test('an empty guide is refused', async () => {
    const bad = { ...TIERS, simple: { ...TIERS.simple, guide: ' ' } }
    expect(() => validateConfig(bad, CLASSIFIER, ON_CLASSIFIER_ERROR, LONG_CONTEXT_TOKENS, AUTO_TIER_CAP)).toThrow(/empty guide/)
  })
  test('a bad timeout is refused', async () => {
    expect(() => validateConfig(TIERS, { ...CLASSIFIER, timeoutMs: 0 }, ON_CLASSIFIER_ERROR, LONG_CONTEXT_TOKENS, AUTO_TIER_CAP)).toThrow(
      /timeoutMs/,
    )
  })
  test('an error tier that does not exist is refused', async () => {
    expect(() => validateConfig(TIERS, CLASSIFIER, 'medium' as never, LONG_CONTEXT_TOKENS, AUTO_TIER_CAP)).toThrow(/not a tier/)
  })
})

test('describeRouter lists every tier and the classifier', async () => {
  const text = describeRouter(false, null, TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR, LONG_CONTEXT_TOKENS, AUTO_TIER_CAP)
  expect(text).toContain('Model router is ON')
  expect(text).toContain('trivial -> haiku · low')
  expect(text).toContain('max -> opus · max')
  expect(text).toContain('Classifier: haiku · low')
  expect(text).toContain('Above 50K tokens of context it never switches to a cheaper model')
})

// A Projects relay as it arrives, preamble included: the preamble names the
// <cited> tag in prose, which must not swallow the real elements after it.
const RELAY = [
  'A message from the coordinator. Inside, <cited author="user"> entries are messages from members,',
  'and <cited author="coordinator"> entries and the note are the coordinator\'s words.',
  '<coordinator-relay><relay from="coordinator" session="s1">',
  '  <cited id="c1" author="user" name="Mihai">build the HUD export</cited>',
  '  <cited id="c2" author="coordinator">Earlier: The router recommends max for this; reply #max to use it.</cited>',
  '  <note>He wants CSV and PDF. #max</note>',
  '</relay></coordinator-relay>',
].join('\n')

const WAKE = [
  '<wake reason="mention" current-time="2026-10-26T17:12:18Z">',
  '  <project id="chan_1" type="project"><thread ts="cmsg_A">',
  '    <message trigger="true" from="system" trust="principal" role="initiator">You are a Thread Session #max</message>',
  '    <message trigger="true" from="human" trust="principal" author="Mihai" id="cmsg_C">it&#39;s live</message>',
  '  </thread></project>',
  '  <system-note>If answering this message needs tool calls first...</system-note>',
  '</wake>',
].join('\n')

describe('unwrap', () => {
  test('a plain prompt is all words', async () => {
    expect(unwrap('fix <b>this</b> bug #hard')).toEqual({ words: 'fix <b>this</b> bug #hard', notes: [] })
  })

  test("a wake keeps only the human message, not the system's", async () => {
    expect(unwrap(WAKE)).toEqual({ words: "it's live", notes: [] })
  })

  test("a relay keeps the user's cited words apart from the notes, past the preamble", async () => {
    expect(unwrap(RELAY)).toEqual({ words: 'build the HUD export', notes: ['He wants CSV and PDF. #max'] })
  })

  test("a #max that Claude wrote is not the person's tag", async () => {
    expect(findTag(unwrap(RELAY).words)).toBe(null)
    expect(findTag(unwrap(WAKE).words)).toBe(null)
  })
})

describe('extractRequest', () => {
  test('a plain prompt is returned as it is', async () => {
    expect(extractRequest('fix <b>this</b> bug')).toBe('fix <b>this</b> bug')
  })

  test("a wake is the person's words", async () => {
    expect(extractRequest(WAKE)).toBe("it's live")
  })

  test('a relay is the words, then each note marked as a colleague\'s', async () => {
    expect(extractRequest(RELAY)).toBe('build the HUD export\n(note from a colleague: He wants CSV and PDF. #max)')
  })

  test('a relay with only a note is the note', async () => {
    expect(extractRequest('<relay from="thread"><note>Eval done: 96/99.</note></relay>')).toBe(
      '(note from a colleague: Eval done: 96/99.)',
    )
  })

  test('a system event or an attachment-only message is empty', async () => {
    expect(extractRequest('<wake reason="device"><system-note>Device connected.</system-note></wake>')).toBe('')
    expect(extractRequest('<wake reason="mention"><message from="human" has-files="true"></message></wake>')).toBe('')
  })
})

describe('keepStrongerModelInLongContext', () => {
  const hard = decide('hard', 'classifier', 'bug', TIERS)
  const max = decide('max', 'tag', '#max tag', TIERS)
  const simple = decide('simple', 'classifier', 'question', TIERS)
  const trivial = decide('trivial', 'classifier', 'thanks', TIERS)

  test('a short conversation follows the new pick', async () => {
    expect(keepStrongerModelInLongContext(simple, hard, 50_000, 100_000, TIERS)).toBe(simple)
  })

  test('a long conversation keeps the stronger model but takes the new effort', async () => {
    expect(keepStrongerModelInLongContext(simple, hard, 150_000, 100_000, TIERS)).toEqual({
      ...simple,
      model: 'opus',
      effort: 'medium',
      source: 'long-context',
      why: 'simple on opus, not sonnet: context 150K tokens',
    })
  })

  test('after #max the next pick does not stay on max', async () => {
    const kept = keepStrongerModelInLongContext(trivial, max, 150_000, 100_000, TIERS)
    expect(kept.model).toBe('opus')
    expect(kept.effort).toBe('low')
    expect(kept.tier).toBe('trivial')
  })

  test('a recommendation is never carried over from an earlier turn', async () => {
    const recommended = { ...hard, recommended: 'max' as const }
    expect(keepStrongerModelInLongContext(simple, recommended, 150_000, 100_000, TIERS).recommended).toBe(null)
  })

  test('the same model keeps the new pick as it is', async () => {
    const standard = decide('standard', 'classifier', 'feature', TIERS)
    expect(keepStrongerModelInLongContext(standard, hard, 150_000, 100_000, TIERS)).toBe(standard)
  })

  test('a long conversation still moves to a stronger model', async () => {
    expect(keepStrongerModelInLongContext(hard, simple, 150_000, 100_000, TIERS)).toBe(hard)
  })

  test('with no earlier route the new one stands', async () => {
    expect(keepStrongerModelInLongContext(simple, null, 150_000, 100_000, TIERS)).toBe(simple)
  })
})

test('a bad LONG_CONTEXT_TOKENS is refused', async () => {
  expect(() => validateConfig(TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR, 0, AUTO_TIER_CAP)).toThrow(/LONG_CONTEXT_TOKENS/)
})

describe('prepareClassifierInput', () => {
  const rows = [
    { role: 'user' as const, text: 'old question' },
    { role: 'user' as const, text: '<wake reason="mention"><message from="human">plan the HUD rewrite</message></wake>' },
    { role: 'assistant' as const, text: 'Plan: 4 files.' },
    ...Array.from({ length: 8 }, () => ({ role: 'assistant' as const, text: '' })),
    { role: 'user' as const, text: '<wake reason="device"><system-note>Device connected.</system-note></wake>' },
  ]

  test('drops tool rows and system events before taking the last n, and unwraps every row', async () => {
    expect(prepareClassifierInput('<wake><message from="human">yes</message></wake>', rows, 2)).toEqual({
      prompt: 'yes',
      context: [
        { role: 'user', text: 'plan the HUD rewrite' },
        { role: 'assistant', text: 'Plan: 4 files.' },
      ],
    })
  })

  test('n = 0 reads no context', async () => {
    expect(prepareClassifierInput('hi', rows, 0)).toEqual({ prompt: 'hi', context: [] })
  })

  test("reads Claude's replies sent through a reply tool, and no other tool's input", async () => {
    const thread = [
      {
        role: 'assistant' as const,
        text: '',
        toolUses: [
          { tool: 'Bash', input: { command: 'git push' } },
          { tool: 'mcp__hearthbot__post_message', input: { text: 'Create the repo, then tell me and I will push.' } },
        ],
      },
      { role: 'user' as const, text: '' },
    ]
    expect(prepareClassifierInput("it's live", thread, 6).context).toEqual([
      { role: 'assistant', text: 'Create the repo, then tell me and I will push.' },
    ])
  })
})

describe('rowText', () => {
  test('a plain row is its text', async () => {
    expect(rowText({ role: 'assistant', text: 'Done.' })).toBe('Done.')
  })

  test('a reply tool call without text adds nothing', async () => {
    expect(rowText({ role: 'assistant', text: '', toolUses: [{ tool: 'mcp__x__post_message', input: {} }] })).toBe('')
  })
})

describe('capAutoTier', () => {
  test('a pick at or below the cap stands', async () => {
    const hard = decide('hard', 'classifier', 'bug', TIERS)
    expect(capAutoTier(hard, 'hard', TIERS)).toBe(hard)
  })

  test('max drops to hard and is kept as a recommendation', async () => {
    expect(capAutoTier(decide('max', 'classifier', 'stuck', TIERS), 'hard', TIERS)).toEqual({
      tier: 'hard',
      source: 'classifier',
      why: 'stuck',
      model: 'opus',
      effort: 'xhigh',
      recommended: 'max',
    })
  })
})

describe('routeNote', () => {
  test('a recommendation tells Claude to say it in the reply', async () => {
    const d = capAutoTier(decide('max', 'classifier', 'stuck', TIERS), 'hard', TIERS)
    expect(routeNote(d, false)).toContain(
      'Start your reply with this one line: "The router recommends max for this; reply #max to use it."',
    )
  })

  test('no recommendation: mention the route only when asked', async () => {
    expect(routeNote(decide('simple', 'classifier', 'q', TIERS), false)).toContain('Mention it only if the user asks')
  })

  test('a message that arrives mid-turn is routed for the next turn', async () => {
    const note = routeNote(decide('simple', 'classifier', 'q', TIERS), true)
    expect(note).toContain('The router picked sonnet at medium effort (tier simple, picked by classifier: q) for this message.')
    expect(note).toContain('The turn already running keeps its route; the pick applies from the next turn.')
    expect(note).not.toContain('This turn runs on')
  })
})

test('an AUTO_TIER_CAP that is not a tier is refused', async () => {
  expect(() => validateConfig(TIERS, CLASSIFIER, ON_CLASSIFIER_ERROR, LONG_CONTEXT_TOKENS, 'huge' as never)).toThrow(
    /AUTO_TIER_CAP/,
  )
})
