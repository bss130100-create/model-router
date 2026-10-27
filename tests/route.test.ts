import { describe, expect, test } from 'claude-code/testing'

import { AUTO_TIER_CAP, CLASSIFIER, MODEL, ON_CLASSIFIER_ERROR, TIERS } from '../hooks/rules'
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
  heldQuestion,
  holdForAnswer,
  parseClassifierReply,
  prepareClassifierInput,
  readAnswer,
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
  test('reads JSON in a code fence', async () => {
    expect(parseClassifierReply('```json\n{"tier":"trivial","why":"thanks"}\n```').tier).toBe('trivial')
  })
  test('refuses JSON wrapped in other text, rather than guess which part is the answer', async () => {
    expect(() => parseClassifierReply('Not {"tier":"max"} but {"tier":"trivial","why":"thanks"}')).toThrow(/not one JSON object/)
  })
  test('refuses an unknown tier', async () => {
    expect(() => parseClassifierReply('{"tier":"huge"}')).toThrow(/unknown tier: huge/)
  })
  test('refuses a reply with no JSON', async () => {
    expect(() => parseClassifierReply('hard')).toThrow(/not one JSON object/)
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
    validateConfig(TIERS, MODEL, CLASSIFIER, ON_CLASSIFIER_ERROR, AUTO_TIER_CAP)
  })
  test('an unknown effort is refused', async () => {
    const bad = { ...TIERS, hard: { ...TIERS.hard, effort: 'ultra' as never } }
    expect(() => validateConfig(bad, MODEL, CLASSIFIER, ON_CLASSIFIER_ERROR, AUTO_TIER_CAP)).toThrow(/effort "ultra"/)
  })
  test('a missing tier is refused', async () => {
    const { max: _, ...rest } = TIERS
    expect(() => validateConfig(rest as typeof TIERS, MODEL, CLASSIFIER, ON_CLASSIFIER_ERROR, AUTO_TIER_CAP)).toThrow(
      /missing "max"/,
    )
  })
  test('an empty guide is refused', async () => {
    const bad = { ...TIERS, simple: { ...TIERS.simple, guide: ' ' } }
    expect(() => validateConfig(bad, MODEL, CLASSIFIER, ON_CLASSIFIER_ERROR, AUTO_TIER_CAP)).toThrow(/empty guide/)
  })
  test('a bad timeout is refused', async () => {
    expect(() => validateConfig(TIERS, MODEL, { ...CLASSIFIER, timeoutMs: 0 }, ON_CLASSIFIER_ERROR, AUTO_TIER_CAP)).toThrow(
      /timeoutMs/,
    )
  })
  test('an error tier that does not exist is refused', async () => {
    expect(() => validateConfig(TIERS, MODEL, CLASSIFIER, 'medium' as never, AUTO_TIER_CAP)).toThrow(/not a tier/)
  })
})

test('describeRouter lists every tier and the classifier', async () => {
  const text = describeRouter(false, null, TIERS, MODEL, CLASSIFIER, ON_CLASSIFIER_ERROR, AUTO_TIER_CAP)
  expect(text).toContain('Model router is ON')
  expect(text).toContain('Every tier runs on opus')
  expect(text).toContain('trivial -> low')
  expect(text).toContain('max -> max')
  expect(text).toContain('Classifier: haiku · low')
  expect(text).toContain('For a higher tier it asks first: yes runs it, no runs hard.')
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

  test("a background task's notification and a reminder are not the person's words", async () => {
    expect(unwrap('<task-notification><status>completed</status> #max</task-notification>')).toEqual({ words: '', notes: [] })
    expect(extractRequest('<system-reminder>\n<task-notification>done</task-notification>\n</system-reminder>\n')).toBe('')
  })

  test('a reminder before a wake leaves the wake', async () => {
    expect(unwrap(`<system-reminder>note</system-reminder>\n${WAKE}`)).toEqual({ words: "it's live", notes: [] })
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

describe('decide', () => {
  test('every tier runs on the one model; only the effort changes', async () => {
    const routes = (['trivial', 'simple', 'standard', 'hard', 'max'] as const).map(t => decide(t, 'classifier', '', TIERS))
    expect(routes.map(r => r.model)).toEqual(['opus', 'opus', 'opus', 'opus', 'opus'])
    expect(routes.map(r => r.effort)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })
})

describe('carryPick', () => {
  test('a pick at or below the cap carries as it is', async () => {
    const hard = decide('hard', 'classifier', 'bug', TIERS)
    expect(carryPick(hard, 'hard', TIERS)).toBe(hard)
  })

  test('max never carries: it drops to the cap', async () => {
    const carried = carryPick(decide('max', 'tag', '#max tag', TIERS), 'hard', TIERS)
    expect(carried.tier).toBe('hard')
    expect(carried.effort).toBe('xhigh')
    expect(carried.recommended).toBe(null)
  })
})

test('an empty MODEL is refused', async () => {
  expect(() => validateConfig(TIERS, ' ', CLASSIFIER, ON_CLASSIFIER_ERROR, AUTO_TIER_CAP)).toThrow(/MODEL is empty/)
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

describe('holdForAnswer', () => {
  test('a pick with no recommendation stands', async () => {
    const hard = decide('hard', 'classifier', 'bug', TIERS)
    expect(holdForAnswer(hard, TIERS)).toBe(hard)
  })

  test('a recommendation runs the lowest effort, since the turn only asks', async () => {
    const held = holdForAnswer(capAutoTier(decide('max', 'classifier', 'stuck', TIERS), 'hard', TIERS), TIERS)
    expect(held).toEqual({
      tier: 'trivial',
      source: 'classifier',
      why: 'stuck',
      model: 'opus',
      effort: 'low',
      recommended: 'max',
    })
  })
})

describe('readAnswer', () => {
  test('a message that opens with a yes word is a yes', async () => {
    expect(readAnswer('Yes!')).toBe('yes')
    expect(readAnswer('  ok go ahead')).toBe('yes')
    expect(readAnswer('y')).toBe('yes')
    expect(readAnswer('yes, and check the logs too')).toBe('yes')
  })
  test('"go" and "do" are a yes only in a message made of nothing else', async () => {
    expect(readAnswer('do it')).toBe('yes')
    expect(readAnswer('Go!')).toBe('yes')
    expect(readAnswer('go for it')).toBe('yes')
    expect(readAnswer('do it at hard instead')).toBe(null)
    expect(readAnswer('do you think the cache is the cause?')).toBe(null)
    expect(readAnswer('go check the logs first')).toBe(null)
  })
  test('a message that opens with a no word is a no', async () => {
    expect(readAnswer('no, hard is fine')).toBe('no')
    expect(readAnswer('Nope')).toBe('no')
  })
  test('a message that holds both is not an answer', async () => {
    expect(readAnswer('ok wait, no')).toBe(null)
    expect(readAnswer('no wait, yes')).toBe(null)
  })
  test('anything else is not an answer', async () => {
    expect(readAnswer('nothing works still')).toBe(null)
    expect(readAnswer('what does max cost?')).toBe(null)
    expect(readAnswer('')).toBe(null)
  })
})

describe('findHeldQuestion', () => {
  const ask = heldQuestion('max', 'hard')

  test('finds the question in Claude\'s reply, with both tiers', async () => {
    const rows = [
      { role: 'user' as const, text: 'stuck on the freeze' },
      { role: 'assistant' as const, text: ask },
    ]
    expect(findHeldQuestion(rows)).toEqual({ recommended: 'max', cap: 'hard' })
  })

  test('finds it in a reply tool call, past tool rows and system events', async () => {
    const rows = [
      { role: 'user' as const, text: 'stuck on the freeze' },
      { role: 'assistant' as const, text: '', toolUses: [{ tool: 'mcp__x__post_message', input: { text: ask } }] },
      { role: 'assistant' as const, text: '' },
      { role: 'user' as const, text: '<wake reason="device"><system-note>Connected.</system-note></wake>' },
    ]
    expect(findHeldQuestion(rows)).toEqual({ recommended: 'max', cap: 'hard' })
  })

  test('null once the person has written after it', async () => {
    const rows = [
      { role: 'assistant' as const, text: ask },
      { role: 'user' as const, text: 'what does the log say?' },
      { role: 'assistant' as const, text: 'It says timeout.' },
    ]
    expect(findHeldQuestion(rows)).toBe(null)
  })

  test("a background task's notification after the question is not the person writing", async () => {
    const rows = [
      { role: 'user' as const, text: 'stuck on the freeze' },
      { role: 'assistant' as const, text: ask },
      { role: 'user' as const, text: '<task-notification><task-id>b1</task-id><status>completed</status></task-notification>' },
      { role: 'user' as const, text: '<system-reminder>\n<task-notification>done</task-notification>\n</system-reminder>' },
      { role: 'assistant' as const, text: 'The build finished.' },
    ]
    expect(findHeldQuestion(rows)).toEqual({ recommended: 'max', cap: 'hard' })
  })

  test('null when the line names no real tier', async () => {
    const rows = [{ role: 'assistant' as const, text: heldQuestion('huge' as never, 'hard') }]
    expect(findHeldQuestion(rows)).toBe(null)
  })
})

describe('answerHeld', () => {
  test('yes runs the recommended tier', async () => {
    expect(answerHeld('max', 'yes', 'hard', TIERS)).toEqual({
      tier: 'max',
      source: 'answer',
      why: 'user said yes to max',
      model: 'opus',
      effort: 'max',
      recommended: null,
    })
  })
  test('no runs the cap', async () => {
    expect(answerHeld('max', 'no', 'hard', TIERS).effort).toBe('xhigh')
  })
})

describe('routeNote', () => {
  const held = holdForAnswer(capAutoTier(decide('max', 'classifier', 'stuck', TIERS), 'hard', TIERS), TIERS)

  test('a recommendation tells Claude to ask, start no work and end the turn', async () => {
    const note = routeNote(held, false, 'hard')
    expect(note).toContain('Do not start the work')
    expect(note).toContain(
      'Reply with only this line, as a plain message (not a decision card): "The router recommends max for this. Reply yes to run it at max, or no to run it at hard."',
    )
    expect(note).toContain('Then end your turn.')
  })

  test('mid-turn, a recommendation asks but lets the running work carry on', async () => {
    const note = routeNote(held, true, 'hard')
    expect(note).toContain('Carry on with the work already running.')
    expect(note).not.toContain('Then end your turn.')
  })

  test('an answer tells Claude to do the held request now', async () => {
    expect(routeNote(answerHeld('max', 'yes', 'hard', TIERS), false, 'hard')).toContain(
      'do that request now, taking their reply into account',
    )
  })

  test('no recommendation: mention the route only when asked, and change effort with a #tag', async () => {
    const note = routeNote(decide('simple', 'classifier', 'q', TIERS), false, 'hard')
    expect(note).toContain('Mention it only if the user asks')
    expect(note).toContain('the user types #trivial, #simple, #standard, #hard or #max')
  })

  test('a classifier failure is told to the user, never silent', async () => {
    const note = routeNote(decide('standard', 'error', 'api-error', TIERS), false, 'hard')
    expect(note).toContain('picked by error: api-error')
    expect(note).toContain("The router's classifier failed")
    expect(note).toContain('tell the user so in one short line')
  })

  test('a message that arrives mid-turn is routed for the next turn', async () => {
    const note = routeNote(decide('simple', 'classifier', 'q', TIERS), true, 'hard')
    expect(note).toContain('The router picked opus at medium effort (tier simple, picked by classifier: q) for this message.')
    expect(note).toContain('The turn already running keeps its route; the pick applies from the next turn.')
    expect(note).not.toContain('This turn runs on')
  })
})

test('an AUTO_TIER_CAP that is not a tier is refused', async () => {
  expect(() => validateConfig(TIERS, MODEL, CLASSIFIER, ON_CLASSIFIER_ERROR, 'huge' as never)).toThrow(
    /AUTO_TIER_CAP/,
  )
})
