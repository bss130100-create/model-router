"""Offline tests for run_eval.py's scoring and job building (no model calls)."""
import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_eval as ev

CASES = [{'id': 'X1', 'text': 'thanks', 'ideal': 'trivial', 'ok': ['trivial', 'simple'], 'context': []},
         {'id': 'X2', 'text': 'build it', 'ideal': 'standard', 'ok': ['standard', 'hard'], 'context': [],
          'thread_prompt': '<wake>build it</wake>', 'thread_rows': [{'role': 'assistant', 'text': ''}]}]


class EvalTest(unittest.TestCase):
    def test_jobs_cover_both_modes_only_where_thread_form_exists(self):
        jobs = ev.make_jobs(CASES, 2)
        self.assertEqual(len(jobs), 6)
        self.assertEqual(sum(j['mode'] == 'thread' for j in jobs), 2)

    def test_verdicts(self):
        self.assertEqual(ev.verdict('simple', CASES[0]), 'ok')
        self.assertEqual(ev.verdict('standard', CASES[0]), 'over')
        self.assertEqual(ev.verdict('simple', CASES[1]), 'under')

    def test_score_counts_and_lists_misses(self):
        results = [{'id': 'X1', 'mode': 'context', 'run': 1, 'ok': True, 'tier': 'trivial', 'why': 'a'},
                   {'id': 'X2', 'mode': 'thread', 'run': 1, 'ok': True, 'tier': 'max', 'why': 'b'}]
        tally, misses = ev.score(CASES, results)
        self.assertEqual(tally['context']['ok'], 1)
        self.assertEqual(tally['thread']['over'], 1)
        self.assertEqual(len(misses), 1)

    def test_failed_call_stops_the_eval(self):
        with self.assertRaises(RuntimeError):
            ev.score(CASES, [{'id': 'X1', 'mode': 'context', 'run': 1, 'ok': False, 'error': 'timeout'}])

    def test_sample_cases_file_is_consistent(self):
        cases = json.load(open(os.path.join(ev.HERE, 'sample-cases.json')))
        for c in cases:
            self.assertIn(c['ideal'], c['ok'], c['id'])
            self.assertTrue(set(c['ok']) <= set(ev.ORDER), c['id'])


if __name__ == '__main__':
    unittest.main()
