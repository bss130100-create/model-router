import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepInput } from 'claude-code'

// Nothing sits beneath the plugin in a test: these hooks stand for the
// engine and record the model request the router let through.
function engine(on: On): TurnStepInput[] {
  const sent: TurnStepInput[] = []
  on('command.register', () => ({ value: { command: 'route' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.step', async function* (_, e) {
    sent.push(e)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: null,
    }
  })
  return sent
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

test('a hard bug prompt sends opus at xhigh', async ($, on) => {
  const sent = engine(on)
  await say($, 'the app crashes with a traceback')
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('opus')
  expect(sent[0]?.effort).toBe('xhigh')
})

test('a quick prompt sends sonnet at medium', async ($, on) => {
  const sent = engine(on)
  await say($, 'what is a list comprehension?')
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('sonnet')
  expect(sent[0]?.effort).toBe('medium')
})

test('a prompt typed mid-turn waits for the next turn', async ($, on) => {
  const sent = engine(on)
  await say($, 'what is this?')
  await step($, 't1', 0)
  await say($, 'it still crashes')
  await step($, 't1', 1)
  await step($, 't2', 0)
  expect(sent.map(s => s.model)).toEqual(['sonnet', 'sonnet', 'opus'])
  expect(sent.map(s => s.effort)).toEqual(['medium', 'medium', 'xhigh'])
})

test('subagents keep their own model', async ($, on) => {
  const sent = engine(on)
  await say($, 'what is this?')
  await step($, 't1', 0, 'agent-1')
  expect(sent[0]?.model).toBe('claude-opus-5-5')
  expect(sent[0]?.effort).toBe('high')
})

test('before any prompt the request is left as it is', async ($, on) => {
  const sent = engine(on)
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('claude-opus-5-5')
})

test('/route off stops routing and /route on starts it again', async ($, on) => {
  const sent = engine(on)
  const off = await route($, 'off')
  expect(off.text).toBe('Model router is now OFF.')
  await say($, 'what is this?')
  await step($, 't1', 0)
  expect(sent[0]?.model).toBe('claude-opus-5-5')

  await route($, 'on')
  await say($, 'what is this?')
  await step($, 't2', 0)
  expect(sent[1]?.model).toBe('sonnet')
})

test('/route shows the last pick and the rules', async ($, on) => {
  engine(on)
  await say($, 'refactor the scanner')
  const shown = await route($, '')
  expect(shown.text).toContain('Last pick: route: opus · xhigh (design)')
  expect(shown.text).toContain('Rules, first match wins:')
})

test('/route with a wrong option says so', async ($, on) => {
  engine(on)
  const shown = await route($, 'banana')
  expect(shown.text).toContain('Unknown option "banana"')
})
