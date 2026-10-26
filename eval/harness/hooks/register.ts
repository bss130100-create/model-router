// Eval harness: runs model-router's real classifier path over a cases file.
// run_eval.py copies the repo's hooks/route.ts, hooks/rules.ts and types next to this file first.
import type { EngineInterface, Register } from 'claude-code'

import { AUTO_TIER_CAP, CLASSIFIER, TIERS } from './rules'
import { buildClassifierRequest, capAutoTier, decide, parseClassifierReply, prepareClassifierInput } from './route'
import type { SessionRow } from './route'

type Job = { id: string; mode: 'context' | 'thread'; run: number; prompt: string; rows: SessionRow[] }

async function classify($: EngineInterface, job: Job) {
  const input = prepareClassifierInput(job.prompt, job.rows, CLASSIFIER.contextMessages)
  const ask = buildClassifierRequest(input.prompt, input.context, TIERS)
  const started = Date.now()
  const reply = await $.model.complete({
    model: CLASSIFIER.model,
    effort: CLASSIFIER.effort,
    timeoutMs: CLASSIFIER.timeoutMs,
    maxTokens: 100,
    system: ask.system,
    prompt: ask.prompt,
  })
  const base = { id: job.id, mode: job.mode, run: job.run, ms: Date.now() - started, usage: reply.usage }
  if (!reply.isAnswered) {
    return { ...base, ok: false, error: reply.reason }
  }
  try {
    const { tier, why } = parseClassifierReply(reply.text)
    // The tier that runs: above AUTO_TIER_CAP the router runs the cap and recommends the higher tier.
    const ran = capAutoTier(decide(tier, 'classifier', why, TIERS), AUTO_TIER_CAP, TIERS)
    return { ...base, ok: true, classified: tier, tier: ran.tier, recommended: ran.recommended, why }
  } catch (err) {
    return { ...base, ok: false, error: err instanceof Error ? err.message : String(err), raw: reply.text }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'router-eval', description: 'run the router eval over a jobs file' })
    return next(e)
  })

  on('command.run', { command: 'router-eval' }, async ($, e) => {
    const [inPath, outPath, width] = e.args.trim().split(/\s+/)
    if (!inPath || !outPath) {
      throw new Error('usage: /router-eval <jobs.json> <results.json> [parallel]')
    }
    const jobs = JSON.parse(await $.fs.read(inPath)) as Job[]
    const results: unknown[] = []
    let next = 0
    const worker = async () => {
      while (next < jobs.length) {
        results.push(await classify($, jobs[next++]))
      }
    }
    await Promise.all(Array.from({ length: Number(width ?? 6) }, worker))
    await $.fs.write(outPath, JSON.stringify(results, null, 1))
    return { text: `classified ${results.length} of ${jobs.length}` }
  })
}
