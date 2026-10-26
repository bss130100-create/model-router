import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteRequest, On, TurnStepInput } from 'claude-code'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// Nothing sits beneath the plugin in a test: these hooks stand for the
// engine. `reply` is what the classifier model answers; `asked` records
// what it was asked, `sent` the model requests the router let through.
function engine(on: On, reply: string | 'api-error' = '{"tier":"standard","why":"x"}') {
  const sent: TurnStepInput[] = []
  const asked: ModelCompleteRequest[] = []
  on('command.register', () => ({ value: { command: 'route' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Can you plan a rewrite of the scanner?', toolUses: [] },
      { role: 'assistant', text: 'Plan: 4 files, new threading model.', toolUses: [] },
    ],
  }))
  on('model.complete', (_, e) => {
    asked.push(e)
    return {
      value:
        reply === 'api-error'
          ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
          : { isAnswered: true, text: reply, usage: USAGE },
    }
  })
  on('turn.step', async function* (_, e) {
    sent.push(e)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return { sent, asked }
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

test('trivial prompts go to haiku', async ($, on) => {
  const { sent } = engine(on, '{"tier":"trivial","why":"thanks"}')
  await say($, 'thanks!')
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('haiku')
  expect(sent[0]?.effort).toBe('low')
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

test('an unreadable classifier answer uses the declared error tier', async ($, on) => {
  const { sent } = engine(on, 'I think it is hard')
  await say($, 'build the export feature')
  await step($, 't1', 0)
  expect(sent[0]?.effort).toBe('high')
  const shown = await route($, '')
  expect(shown.text).toContain('by error')
})

test('a prompt typed mid-turn waits for the next turn', async ($, on) => {
  const { sent } = engine(on, '{"tier":"simple","why":"x"}')
  await say($, 'what is this?')
  await step($, 't1', 0)
  await say($, 'it still crashes #hard')
  await step($, 't1', 1)
  await step($, 't2', 0)
  expect(sent.map(s => s.model)).toEqual(['sonnet', 'sonnet', 'opus'])
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
  expect(sent[1]?.model).toBe('sonnet')
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
