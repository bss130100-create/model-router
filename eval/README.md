# Router eval

Mihai's 33 real prompts from the SW Engineer project, each with the tier chosen **before** any run
(`ideal`) and the tiers that count as acceptable (`ok`). It measures the classifier, not the model.

```
python3 eval/run_eval.py            # 3 runs per prompt, about $0.02 of Haiku
python3 -m unittest discover eval   # offline tests of the scorer, free
```

Each prompt runs two ways:

- **context**: the typed words plus up to 6 earlier visible messages.
- **thread**: how a project thread delivers it: the wake or coordinator-relay XML, earlier user
  messages wrapped the same way, and tool-call rows with no text in between. Prompts answered
  in the project chat have no thread form, since the router never runs there.

The run copies `hooks/route.ts`, `hooks/rules.ts` and `types/` into a throwaway harness mod and calls
`prepareClassifierInput`, `buildClassifierRequest` and `$.model.complete` exactly as the router does.
It exits 1 when either mode falls below its floor (95% context, 90% thread). Every miss is printed
with the classifier's reason.

Baseline, v0.2.1 (26 Oct 2026): context 98/99, thread 62/72.
