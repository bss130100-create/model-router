# model-router

A Claude Code mod that picks the **model** and **effort level** for each prompt you send, from simple keyword rules you edit yourself.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install model-router --marketplace bss130100-create/model-router
```

From a shell (also works in a cloud environment's setup script):

```
claude plugin marketplace add bss130100-create/model-router
claude plugin install model-router@mihai-mods
```

## What it does

1. When you send a prompt, it checks the rules in `hooks/rules.ts` top to bottom.
   The first rule whose keyword appears in your prompt wins (case does not matter).
   No match: the default route (`opus` at `high`).
2. Every model request of that turn is sent with the picked model and effort.
   The pick is locked for the whole turn, so a turn never switches model halfway.
   A message you type mid-turn is routed on the next turn.
3. The status line shows the pick, for example `route: opus · xhigh (hard-bug)`.

Subagents are left alone: they keep the model they were started with.

## Shipped rules

| Rule | Example keywords | Model · effort |
| --- | --- | --- |
| tag-max | `#max` | opus · max |
| tag-quick | `#quick` | sonnet · low |
| hard-bug | traceback, crash, still broken, race condition, memory leak | opus · xhigh |
| design | architecture, design the, refactor, trade-off | opus · xhigh |
| quick | what is, explain, summarize, rename, typo | sonnet · medium |
| default | anything else | opus · high |

Type `#max` or `#quick` anywhere in a prompt to force a route.

## Tuning it

Edit `hooks/rules.ts`. Each rule is one line of data:

```ts
{ name: 'docs', model: 'sonnet', effort: 'medium', keywords: ['readme', 'docstring'] },
```

Order matters: put the more specific rules first. A mistake (an unknown effort,
an empty keyword list, two rules with the same name) stops the mod from loading,
and Claude Code shows the reason. It never runs with half-broken rules.

## Commands

- `/route` shows on/off, the last pick, and every rule.
- `/route off` stops routing; your normal `/model` setting applies again.
- `/route on` starts it again.

## Things to know

- While it is on, the router overrides the model you picked with `/model`.
- Switching model between turns re-reads the conversation without the prompt
  cache, so a switch costs a little more on that turn.
- A model that does not take an effort setting (for example `haiku`) is sent none.

## Tests

```
claude plugin test .
```
