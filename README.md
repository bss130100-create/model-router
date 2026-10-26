# model-router

A Claude Code mod that picks the **model** and **effort level** for each prompt you send, from simple keyword rules you edit yourself.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install model-router --marketplace bss130100-create/model-router
```

From a shell:

```
claude plugin marketplace add bss130100-create/model-router
claude plugin install model-router@mihai-mods
```

### In a cloud environment's setup script (pin a release)

Cloud environments cache the setup script's result for about seven days and
rebuild it only when the script text changes. So pin a release branch: the
script then changes with every update, which rebuilds the cache, and the last
line fails setup loudly if the wrong version got installed.

```
set -e
claude plugin marketplace add bss130100-create/model-router#release-0.2.1
claude plugin install model-router@mihai-mods
claude plugin list | grep -A1 "model-router@mihai-mods" | grep -q "Version: 0.2.1" || { echo "model-router: installed version is not 0.2.1" >&2; exit 1; }
```

To update: push a `release-<version>` branch, then change both `0.2.1`s in the script.

## What it does

1. Before each prompt runs, a small fast model (Haiku, low effort) reads your
   prompt plus the last 6 messages and picks a **tier**. Reading the context is
   what lets it understand short replies like "yes, do it".
2. The tier decides the model and effort for every request of that turn.
   The pick is locked for the whole turn, so a turn never switches model halfway.
   A message you type mid-turn is routed on the next turn.
3. The status line shows the pick, for example `route: opus · xhigh (hard)`.

When the classifier is unsure between two tiers it is told to pick the higher
one: accuracy first, then cost. Subagents are left alone.

## Tiers

| Tier | Model · effort | For |
| --- | --- | --- |
| trivial | haiku · low | thanks, yes/no, status questions |
| simple | sonnet · medium | explain a concept, small one-file edit |
| standard | opus · high | normal feature work with tests |
| hard | opus · xhigh | hard bugs, tricky design, multi-file refactor |
| max | opus · max | stuck after several tries, deep root-cause hunt |

Type `#trivial`, `#simple`, `#standard`, `#hard` or `#max` anywhere in a prompt
to force a tier. A tag skips the classifier.

## Tuning it

Everything lives in `hooks/rules.ts`: each tier's model, effort, and the plain
English guide the classifier reads to recognise it. Change a guide to move a kind
of request up or down a tier.

If the classifier fails (timeout, API error, an answer it cannot read), the
`ON_CLASSIFIER_ERROR` tier (standard) is used, and a toast and the status line
say so. Your prompt is never blocked by the router.

A mistake in `rules.ts` (an unknown effort, a missing tier, an empty guide) stops
the mod from loading, and Claude Code shows the reason.

## Checking it

Ask Claude "which route are you on?". The router adds a one-line hidden note to
each prompt telling Claude the model, effort and tier it picked, so this works
everywhere, including Projects threads where slash commands cannot run.

## Commands (terminal and desktop Code sessions)

- `/route` shows on/off, the last pick, and every rule.
- `/route off` stops routing; your normal `/model` setting applies again.
- `/route on` starts it again.

## Things to know

- While it is on, the router overrides the model you picked with `/model`.
- Each prompt costs one small Haiku call (about a second). Slash commands skip it.
- Switching model between turns re-reads the conversation without the prompt
  cache, so a switch costs a little more on that turn.
- Haiku and Sonnet may have a smaller context window than your session model.
  In a very long conversation, force a tier with `#standard` or turn routing off.
- A model that does not take an effort setting (for example `haiku`) is sent none.

## Tests

```
claude plugin test .
```
