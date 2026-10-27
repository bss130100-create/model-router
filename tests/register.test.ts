import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteRequest, On, TurnStepInput } from 'claude-code'

import type { SessionRow } from '../hooks/route'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// Nothing sits beneath the plugin in a test: these hooks stand for the
// engine. `reply` is what the classifier model answers; `asked` records
// what it was asked, `sent` the model requests the router let through.
// A test adds to `rows` what the transcript holds after the fixed opening.
function engine(on: On, reply: string | readonly string[] | 'api-error' = '{"tier":"standard","why":"x"}') {
  const sent: TurnStepInput[] = []
  const asked: ModelCompleteRequest[] = []
  const rows: SessionRow[] = []
  on('command.register', () => ({ value: { command: 'route' } }))
  const notes: string[] = []
  on('prompt.submit', (_, e) => {
    notes.push(...(e.context ?? []))
    return { text: e.text }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Can you plan a rewrite of the scanner?', toolUses: [] },
      { role: 'assistant', text: 'Plan: 4 files, new threading model.', toolUses: [] },
      // A busy session ends in rows with no text: tool calls and their results.
      ...Array.from({ length: 8 }, () => ({ role: 'assistant' as const, text: '', toolUses: [] })),
      ...rows.map(r => ({ ...r, toolUses: (r.toolUses ?? []).map((u, i) => ({ ...u, tool_use_id: `tu${i}` })) })),
    ],
  }))
  // A list of replies is answered in order, one per classifier call.
  const replies = typeof reply === 'string' ? [reply] : reply
  on('model.complete', (_, e) => {
    asked.push(e)
    const text = replies[Math.min(asked.length, replies.length) - 1] ?? ''
    return {
      value:
        text === 'api-error'
          ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
          : { isAnswered: true, text, usage: USAGE },
    }
  })
  on('turn.step', async function* (_, e) {
    sent.push(e)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { ...USAGE, model: e.model },
    }
  })
  return { sent, asked, notes, rows }
}

async function step($: Engine, turnId: string, index: number, agentId?: string) {
  const stream = $.turn.step({
    turnId,
    index,
    model: 'claude-opus-5-5',
    effort: 'high',
    messageCount: 1,
    ...(agentId === undefined ? {} : { agentId }),
  })
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

// The person typing a prompt, and a slash command, as the engine raises them.
function say($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

function notify($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'task-notification' } })
}

function route($: Engine, args: string) {
  return $.command.run({
    command: 'route',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

test('the classifier tier picks the model and effort', async ($, on) => {
  const { sent, asked } = engine(on, '{"tier":"hard","why":"intermittent crash"}')
  await say($, 'the scan sometimes freezes')
  await step($, 't1', 0)
  expect(asked[0]?.model).toBe('haiku')
  expect(sent[0]?.model).toBe('opus')
  expect(sent[0]?.effort).toBe('xhigh')
})

test('trivial prompts run on opus at low effort, from the first prompt of a conversation', async ($, on) => {
  const { sent } = engine(on, '{"tier":"trivial","why":"thanks"}')
  await say($, 'thanks!')
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('opus')
  expect(sent[0]?.effort).toBe('low')
})

test('the model never changes between tiers, so the prompt cache is kept; only the effort moves', async ($, on) => {
  const { sent } = engine(on, ['{"tier":"hard","why":"bug"}', '{"tier":"trivial","why":"thanks"}', '{"tier":"simple","why":"q"}'])
  await say($, 'the app crashes')
  await step($, 't1', 0)
  await say($, 'thanks!')
  await step($, 't2', 0)
  await say($, 'what does the cache do?')
  await step($, 't3', 0)
  expect(sent.map(s => s.model)).toEqual(['opus', 'opus', 'opus'])
  expect(sent.map(s => s.effort)).toEqual(['xhigh', 'low', 'medium'])
})

test('the classifier reads the recent conversation', async ($, on) => {
  const { asked } = engine(on)
  await say($, 'yes, do it')
  const prompt = String(asked[0]?.prompt)
  expect(prompt).toContain('ASSISTANT: Plan: 4 files, new threading model.')
  expect(prompt).toContain('yes, do it')
})

test('a #tag skips the classifier', async ($, on) => {
  const { sent, asked } = engine(on)
  await say($, 'what is a venv? #max')
  await step($, 't1', 0)
  expect(asked.length).toBe(0)
  expect(sent[0]?.effort).toBe('max')
})

test('a classifier API error uses the declared error tier', async ($, on) => {
  const { sent } = engine(on, 'api-error')
  await say($, 'build the export feature')
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('opus')
  expect(sent[0]?.effort).toBe('high')
  const shown = await route($, '')
  expect(shown.text).toContain('CLASSIFIER FAILED: api-error')
})

test('an unreadable classifier answer uses the declared error tier, and Claude is told to say so', async ($, on) => {
  const { sent, notes } = engine(on, 'I think it is hard')
  await say($, 'build the export feature')
  await step($, 't1', 0)
  expect(sent[0]?.effort).toBe('high')
  const shown = await route($, '')
  expect(shown.text).toContain('by error')
  expect(notes[0]).toContain("The router's classifier failed")
})

test('a prompt typed mid-turn waits for the next turn', async ($, on) => {
  const { sent } = engine(on, '{"tier":"simple","why":"x"}')
  await say($, 'what is this?')
  await step($, 't1', 0)
  await say($, 'it still crashes #hard')
  await step($, 't1', 1)
  await step($, 't2', 0)
  expect(sent.map(s => s.effort)).toEqual(['medium', 'medium', 'xhigh'])
})

test('subagents keep their own model', async ($, on) => {
  const { sent } = engine(on, '{"tier":"trivial","why":"x"}')
  await say($, 'thanks')
  await step($, 't1', 0, 'agent-1')
  expect(sent[0]?.model).toBe('claude-opus-5-5')
  expect(sent[0]?.effort).toBe('high')
})

test('before any prompt the request is left as it is', async ($, on) => {
  const { sent } = engine(on)
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('claude-opus-5-5')
})

test('/route off stops routing and /route on starts it again', async ($, on) => {
  const { sent, asked } = engine(on, '{"tier":"simple","why":"x"}')
  const off = await route($, 'off')
  expect(off.text).toBe('Model router is now OFF.')
  await say($, 'what is this?')
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('claude-opus-5-5')
  expect(asked.length).toBe(0)

  await route($, 'on')
  await say($, 'what is this?')
  await step($, 't2', 0)
  expect(sent[1]?.model).toBe('opus')
  expect(sent[1]?.effort).toBe('medium')
})

test('/route shows the last pick and why', async ($, on) => {
  engine(on, '{"tier":"hard","why":"multi-file refactor"}')
  await say($, 'refactor the scanner')
  const shown = await route($, '')
  expect(shown.text).toContain('Last pick: route: opus · xhigh (hard), by classifier: multi-file refactor')
})

test('/route with a wrong option says so', async ($, on) => {
  engine(on)
  const shown = await route($, 'banana')
  expect(shown.text).toContain('Unknown option "banana"')
})

test('the answering model is told its route', async ($, on) => {
  const { notes } = engine(on, '{"tier":"hard","why":"intermittent crash"}')
  await say($, 'the scan sometimes freezes')
  expect(notes[0]).toBe(
    '[model-router] This turn runs on opus at xhigh effort (tier hard, picked by classifier: intermittent crash). Mention it only if the user asks which model, effort or route is in use. The router sets the model and effort of every turn, so changing them in the session has no effect: to change the effort, the user types #trivial, #simple, #standard, #hard or #max in a message.',
  )
})

test('routing off adds no note', async ($, on) => {
  const { notes } = engine(on)
  await route($, 'off')
  await say($, 'what is this?')
  expect(notes.length).toBe(0)
})

test('the classifier gets context even when the session ends in tool rows', async ($, on) => {
  const { asked } = engine(on)
  await say($, 'yes, do it')
  expect(String(asked[0]?.prompt)).toContain('USER: Can you plan a rewrite of the scanner?')
})

test('a project-thread wake is classified on the words alone', async ($, on) => {
  const { asked } = engine(on)
  await say($, '<wake reason="mention"><message from="human" author="Mihai">it&#39;s live</message><system-note>ids</system-note></wake>')
  const prompt = String(asked[0]?.prompt)
  expect(prompt).toContain("<new_request>\nit's live\n</new_request>")
  expect(prompt).not.toContain('system-note')
})

test('a background-task notification carries the last pick', async ($, on) => {
  const { sent, asked } = engine(on, '{"tier":"hard","why":"bug"}')
  await say($, 'the app crashes')
  await notify($, 'Background command finished with exit code 0')
  await step($, 't1', 0)
  expect(asked.length).toBe(1)
  expect(sent[0]?.effort).toBe('xhigh')
})

const STUCK = '{"tier":"max","why":"stuck after 4 fixes"}'
const ASK = 'The router recommends max for this. Reply yes to run it at max, or no to run it at hard.'

// The transcript after a max pick: the request, then Claude's question.
function asked_max(rows: SessionRow[]) {
  rows.push({ role: 'user', text: 'we tried 4 fixes and it still fails' }, { role: 'assistant', text: ASK })
}

test('a max pick starts no work: the turn only asks, at the lowest effort', async ($, on) => {
  const { sent, notes } = engine(on, STUCK)
  await say($, 'we tried 4 fixes and it still fails')
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('opus')
  expect(sent[0]?.effort).toBe('low')
  expect(notes[0]).toContain('Do not start the work')
  expect(notes[0]).toContain(`"${ASK}"`)
  expect(notes[0]).toContain('Then end your turn.')
})

test('yes to the question runs max, without asking the classifier', async ($, on) => {
  const { sent, asked, notes, rows } = engine(on, STUCK)
  await say($, 'we tried 4 fixes and it still fails')
  await step($, 't1', 0)
  asked_max(rows)
  await say($, 'Yes')
  await step($, 't2', 0)
  expect(asked.length).toBe(1)
  expect(sent[1]?.effort).toBe('max')
  expect(notes[1]).toContain('picked by answer: user said yes to max')
  expect(notes[1]).toContain('do that request now')
})

test('no to the question runs hard', async ($, on) => {
  const { sent, rows } = engine(on, STUCK)
  asked_max(rows)
  await say($, 'no, hard is enough')
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('opus')
  expect(sent[0]?.effort).toBe('xhigh')
})

test('the question is read from the transcript, so a yes after a restart still runs max', async ($, on) => {
  // A fresh process: nothing in memory, only the transcript.
  const { sent, asked, rows } = engine(on)
  asked_max(rows)
  await say($, 'yes')
  await step($, 't1', 0)
  expect(asked.length).toBe(0)
  expect(sent[0]?.effort).toBe('max')
})

test('any other reply is classified as a new request, and a later yes is ordinary', async ($, on) => {
  const { sent, asked, rows } = engine(on, ['{"tier":"simple","why":"q"}', '{"tier":"trivial","why":"ack"}'])
  asked_max(rows)
  await say($, 'first, what does the log say?')
  await step($, 't1', 0)
  expect(asked.length).toBe(1)
  expect(sent[0]?.effort).toBe('medium')
  rows.push({ role: 'user', text: 'first, what does the log say?' }, { role: 'assistant', text: 'It says timeout.' })
  await say($, 'yes')
  await step($, 't2', 0)
  expect(asked.length).toBe(2)
  expect(sent[1]?.effort).toBe('low')
})

test('"do it at hard instead" is not a yes: it is classified as a new request', async ($, on) => {
  const { sent, asked, rows } = engine(on, '{"tier":"hard","why":"bug"}')
  asked_max(rows)
  await say($, 'do it at hard instead')
  await step($, 't1', 0)
  expect(asked.length).toBe(1)
  expect(sent[0]?.effort).toBe('xhigh')
})

test("a background task's notification after the question does not hide it", async ($, on) => {
  const { sent, asked, rows } = engine(on)
  asked_max(rows)
  rows.push(
    { role: 'user', text: '<task-notification><task-id>b1</task-id><status>completed</status></task-notification>' },
    { role: 'assistant', text: 'The background build finished.' },
  )
  await say($, 'yes')
  await step($, 't1', 0)
  expect(asked.length).toBe(0)
  expect(sent[0]?.effort).toBe('max')
})

test('a yes in a relayed note does not answer the question', async ($, on) => {
  const { sent, asked, rows } = engine(on, '{"tier":"standard","why":"review"}')
  asked_max(rows)
  await say($, '<relay from="thread"><note>yes</note></relay>')
  await step($, 't1', 0)
  expect(asked.length).toBe(1)
  expect(sent[0]?.effort).toBe('high')
})

test("in a thread, the person's yes answers the question Claude posted with its reply tool", async ($, on) => {
  const { sent, asked, rows } = engine(on)
  rows.push(
    { role: 'user', text: '<wake reason="mention"><message from="human">we tried 4 fixes</message></wake>' },
    { role: 'assistant', text: '', toolUses: [{ tool: 'mcp__hearthbot__post_message', input: { text: ASK } }] },
    // A system event in between is not the person writing.
    { role: 'user', text: '<wake reason="device"><system-note>Device connected.</system-note></wake>' },
  )
  await say($, '<wake reason="mention"><message from="human" author="Mihai">yes</message></wake>')
  await step($, 't1', 0)
  expect(asked.length).toBe(0)
  expect(sent[0]?.effort).toBe('max')
})

test('a max pick that arrives mid-turn asks without stopping the running work', async ($, on) => {
  const { notes } = engine(on, STUCK)
  await $.prompt.submit({ text: 'it still fails', wait: false, origin: { kind: 'composer' }, turnId: 't1' })
  expect(notes[0]).toContain('Reply yes to run it at max')
  expect(notes[0]).toContain('Carry on with the work already running.')
})

test('#max runs max', async ($, on) => {
  const { sent, notes } = engine(on)
  await say($, 'go deep on it #max')
  await step($, 't1', 0)
  expect(sent[0]?.effort).toBe('max')
  expect(notes[0]).not.toContain('recommends')
})

test('after #max the next prompt does not stay on max', async ($, on) => {
  const { sent, notes } = engine(on, '{"tier":"simple","why":"q"}')
  await say($, 'go deep #max')
  await step($, 't1', 0)
  await say($, 'and what about the logs?')
  await step($, 't2', 0)
  expect(sent[1]?.model).toBe('opus')
  expect(sent[1]?.effort).toBe('medium')
  expect(notes[1]).toContain('picked by classifier: q')
})

test("a #max that Claude wrote in a relayed note does not force max", async ($, on) => {
  const { sent, asked } = engine(on, '{"tier":"standard","why":"review"}')
  await say(
    $,
    '<relay from="thread"><note>Reply to the user: The router recommends max for this; reply #max to use it.</note></relay>',
  )
  await step($, 't1', 0)
  expect(asked.length).toBe(1)
  expect(sent[0]?.effort).toBe('high')
})

test("the person's own #max in a wake does force max", async ($, on) => {
  const { sent, asked } = engine(on)
  await say($, '<wake reason="mention"><message from="human" author="Mihai">go deep on it #max</message></wake>')
  await step($, 't1', 0)
  expect(asked.length).toBe(0)
  expect(sent[0]?.effort).toBe('max')
})

test('a system event carries the last pick and adds no note', async ($, on) => {
  const { sent, asked, notes } = engine(on, '{"tier":"hard","why":"bug"}')
  await say($, 'the app crashes')
  await say($, '<wake reason="device"><system-note>Device connected.</system-note></wake>')
  await step($, 't1', 0)
  expect(asked.length).toBe(1)
  expect(notes.length).toBe(1)
  expect(sent[0]?.effort).toBe('xhigh')
})

test('max never carries into a turn you did not start', async ($, on) => {
  const { sent } = engine(on)
  await say($, 'go deep on it #max')
  await step($, 't1', 0)
  await say($, '<wake reason="github"><system-note>CI failed on the PR.</system-note></wake>')
  await step($, 't2', 0)
  await notify($, 'Background command finished with exit code 0')
  await step($, 't3', 0)
  expect(sent.map(s => s.effort)).toEqual(['max', 'xhigh', 'xhigh'])
})

test('a message that arrives mid-turn is told it applies from the next turn', async ($, on) => {
  const { notes } = engine(on, '{"tier":"simple","why":"q"}')
  await $.prompt.submit({ text: 'and the logs?', wait: false, origin: { kind: 'composer' }, turnId: 't1' })
  expect(notes[0]).toContain('The turn already running keeps its route')
})
