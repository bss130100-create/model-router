# Router eval

Mihai's 33 real prompts from the SW Engineer project, each with the tier chosen **before** any run
(`ideal`) and the tiers that count as acceptable (`ok`). It measures the classifier, not the model.

```
python3 eval/run_eval.py --cases <cases.json>   # 3 runs per prompt, about $0.02 of Haiku
python3 -m unittest discover eval               # offline tests of the scorer, free
```

The cases are private conversation data and are not in this repo. `sample-cases.json`
shows the format: `context` holds plain `{role, text}` messages; `thread_rows` holds raw
session rows, where Claude's replies are reply-tool calls (`toolUses`) with empty text.

Each prompt runs two ways:

- **context**: the typed words plus up to 6 earlier visible messages.
- **thread**: how a project thread delivers it: the wake or coordinator-relay XML, earlier user
  messages wrapped the same way, Claude's replies as reply-tool calls, and tool-call rows
  with no text in between. Prompts answered
  in the project chat have no thread form, since the router never runs there.

The run copies `hooks/route.ts`, `hooks/rules.ts` and `types/` into a throwaway harness mod and calls
`prepareClassifierInput`, `buildClassifierRequest` and `$.model.complete` exactly as the router does.
A run is scored on the tier that does the work by default: when the classifier says a tier above
`AUTO_TIER_CAP`, the router asks first and runs the cap unless the person says yes, so the eval
scores the cap and counts the question separately. It exits 1 when either mode falls below its floor (95% context,
90% thread). Every miss is printed with the classifier's reason.

A label may change only for a reason that doesn't depend on what the classifier picked, and the case
then carries a `label_note` saying why.

Results on 26 Oct 2026:

| version | runs | context | thread | max recommended |
| --- | --- | --- | --- | --- |
| 0.2.1 | 3 | 98/99 | 62/72 (6 too high, 4 too low) | n/a (max ran) |
| 0.3.0 | 5 | 164/165 | 120/120 | 5 |

0.2.1's thread runs had no context, since that version saw none in a thread.
