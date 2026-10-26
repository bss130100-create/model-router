"""Router eval: Mihai's 33 real prompts, scored against tiers chosen before any run.

Usage (from the repo root):  python3 eval/run_eval.py --cases <cases.json> [--runs 3]
The cases are private conversation data and are not in this repo (format: sample-cases.json).
Costs about $0.02 of Haiku per 3-run pass. Exits 1 if the pass rate drops below the floors.
Each prompt runs two ways: 'context' (the words plus earlier messages) and 'thread' (as a project
thread delivers it: wake/relay XML, earlier messages wrapped, tool rows with no text in between)."""
import argparse, collections, json, os, re, shutil, subprocess, sys, tempfile

ORDER = ['trivial', 'simple', 'standard', 'hard', 'max']
FLOORS = {'context': 0.95, 'thread': 0.90}   # share of runs inside each prompt's accepted tiers
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def make_jobs(cases, runs):
    jobs = []
    for c in cases:
        for run in range(1, runs + 1):
            jobs.append({'id': c['id'], 'mode': 'context', 'run': run, 'prompt': c['text'], 'rows': c['context']})
            if 'thread_prompt' in c:
                jobs.append({'id': c['id'], 'mode': 'thread', 'run': run, 'prompt': c['thread_prompt'], 'rows': c['thread_rows']})
    return jobs


def build_harness(tmp):
    """The harness mod with the repo's own classifier code copied in."""
    dst = os.path.join(tmp, 'harness')
    shutil.copytree(os.path.join(HERE, 'harness'), dst)
    for name in ('route.ts', 'rules.ts'):
        shutil.copy(os.path.join(REPO, 'hooks', name), os.path.join(dst, 'hooks', name))
    types = open(os.path.join(REPO, 'types', 'index.d.ts')).read()
    # The PluginState block belongs to model-router; the harness is a different plugin.
    types = re.sub(r"\ndeclare module 'claude-code' \{.*?\n\}\n", '\n', types, flags=re.S)
    os.makedirs(os.path.join(dst, 'types'))
    open(os.path.join(dst, 'types', 'index.d.ts'), 'w').write(types)
    return dst


def run_classifier(harness, jobs_path, out_path):
    env = {k: v for k, v in os.environ.items() if k != 'CLAUDE_CODE_SESSION_ID'}
    cmd = ['claude', '-p', f'/router-eval {jobs_path} {out_path} 6', '--plugin-dir', harness,
           '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence']
    done = subprocess.run(cmd, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=600)
    if done.returncode != 0 or not os.path.exists(out_path):
        raise RuntimeError(f'classifier run failed:\n{done.stdout}\n{done.stderr}')


def verdict(tier, case):
    if tier in case['ok']:
        return 'ok'
    return 'over' if ORDER.index(tier) > ORDER.index(case['ideal']) else 'under'


def score(cases, results):
    failed = [r for r in results if not r['ok']]
    if failed:
        raise RuntimeError(f'{len(failed)} classifier calls failed, first: {failed[0]}')
    by_case = {c['id']: c for c in cases}
    tally = {m: collections.Counter() for m in FLOORS}
    misses = []
    for r in sorted(results, key=lambda r: (r['mode'], r['id'], r['run'])):
        v = verdict(r['tier'], by_case[r['id']])
        tally[r['mode']][v] += 1
        if v != 'ok':
            misses.append(f"{r['mode']:7} {r['id']:6} {r['tier']:8} ({v}; expected {'/'.join(by_case[r['id']]['ok'])}): {r['why']}")
    return tally, misses


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cases', required=True, help='cases file (private; see sample-cases.json for the format)')
    ap.add_argument('--runs', type=int, default=3)
    args = ap.parse_args()
    cases = json.load(open(args.cases))
    with tempfile.TemporaryDirectory() as tmp:
        harness = build_harness(tmp)
        jobs_path, out_path = os.path.join(tmp, 'jobs.json'), os.path.join(tmp, 'results.json')
        json.dump(make_jobs(cases, args.runs), open(jobs_path, 'w'))
        run_classifier(harness, jobs_path, out_path)
        results = json.load(open(out_path))
    tally, misses = score(cases, results)
    print('\n'.join(misses) or 'no misses')
    passed = True
    for mode, t in tally.items():
        total = sum(t.values())
        rate = t['ok'] / total
        passed &= rate >= FLOORS[mode]
        print(f"{mode:7} {t['ok']}/{total} in range ({rate:.0%}, floor {FLOORS[mode]:.0%}), too high {t['over']}, too low {t['under']}")
    sys.exit(0 if passed else 1)


if __name__ == '__main__':
    main()
