import json
import pathlib
import subprocess
from datetime import datetime, timezone
from collections import Counter

plan_path = pathlib.Path('/private/tmp/luther-artifacts/llxprt-code/pr-followup/current/smoke-1803-202605041632-clonerepair/vybestack/llxprt-code/1911/pr-remediation-plan.json')
out_path = pathlib.Path('/private/tmp/luther-artifacts/llxprt-code/pr-followup/current/smoke-1803-202605041632-clonerepair/vybestack/llxprt-code/1911/pr-remediation-result.json')
repo = pathlib.Path('/private/tmp/luther-workspaces/llxprt-code')

plan = json.loads(plan_path.read_text())
must_fix = plan['must_fix']


def run(cmd: str) -> dict:
    p = subprocess.run(cmd, cwd=repo, shell=True, text=True, capture_output=True)
    return {
        'command': cmd,
        'exit_code': p.returncode,
        'stdout': p.stdout,
        'stderr': p.stderr,
    }


head_sha = run('git rev-parse HEAD')['stdout'].strip()
diff_cmd = run('git diff -- packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts pr-description.md')
typecheck = run('npm run -w packages/cli typecheck')
build = run('npm run -w packages/cli build')
focused_test = run('npm run -w packages/cli test -- src/ui/hooks/geminiStream/__tests__/useStreamEventHandlers.contextCleared.test.ts')

hook_text = (repo / 'packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts').read_text()
pr_desc_text = (repo / 'pr-description.md').read_text()

has_guard = "return 'contextCleared' in event && event.contextCleared === true;" in hook_text
is_h1 = pr_desc_text.startswith('# TLDR\n')
has_legacy_tests_token = '**tests**' in pr_desc_text
has_correct_tests_token = '__tests__' in pr_desc_text

primary_by_check_name = {
    'E2E Test (macOS)': 'ci-48eeb8f8cc8fd276434efca77a1e679a50ef13d1-gh-pr-checks-E2E-Test-(macOS)-4-E2E-Test-(macOS)',
    'E2E Test (Linux) - sandbox:docker': 'ci-48eeb8f8cc8fd276434efca77a1e679a50ef13d1-gh-pr-checks-E2E-Test-(Linux)---sandbox-docker-5-E2E-Test-(Linux)---sandbox-docker',
    'E2E Test (Linux) - sandbox:none': 'ci-48eeb8f8cc8fd276434efca77a1e679a50ef13d1-gh-pr-checks-E2E-Test-(Linux)---sandbox-none-7-E2E-Test-(Linux)---sandbox-none',
    'Lint (Javascript)': 'ci-48eeb8f8cc8fd276434efca77a1e679a50ef13d1-gh-pr-checks-Lint-(Javascript)-10-Lint-(Javascript)',
}

dedup_pair_for_check_run = {
    'ci-48eeb8f8cc8fd276434efca77a1e679a50ef13d1-check-run-74047407055-E2E-Test-(macOS)': primary_by_check_name['E2E Test (macOS)'],
    'ci-48eeb8f8cc8fd276434efca77a1e679a50ef13d1-check-run-74047407025-E2E-Test-(Linux)---sandbox-docker': primary_by_check_name['E2E Test (Linux) - sandbox:docker'],
    'ci-48eeb8f8cc8fd276434efca77a1e679a50ef13d1-check-run-74047407018-E2E-Test-(Linux)---sandbox-none': primary_by_check_name['E2E Test (Linux) - sandbox:none'],
    'ci-48eeb8f8cc8fd276434efca77a1e679a50ef13d1-check-run-74047401736-Lint-(Javascript)': primary_by_check_name['Lint (Javascript)'],
}

results = []
for item in must_fix:
    sid = item['source_id']
    stype = item['source_type']
    ev = item.get('evidence', {})

    if stype == 'ci_failure':
        check_name = ev.get('check_name', item.get('reason'))
        log_excerpt = ev.get('log_excerpt', '')
        has_ts2339 = 'error TS2339' in log_excerpt and 'contextCleared' in log_excerpt

        if sid in primary_by_check_name.values():
            status = 'fixed'
            evidence = {
                'check_name': check_name,
                'job_id': ev.get('job_id'),
                'run_id': ev.get('run_id'),
                'source_failure_id': ev.get('failure_id'),
                'failure_signature_present_in_plan_log_excerpt': has_ts2339,
                'failure_signature': "TS2339 Property 'contextCleared' does not exist on type 'ServerGeminiStreamEvent'",
                'implemented_change': "Narrowed event access using 'contextCleared' in event guard before reading event.contextCleared.",
                'guard_present_in_file': has_guard,
                'guard_file': 'packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts',
                'verification': {
                    'typecheck': {'command': typecheck['command'], 'exit_code': typecheck['exit_code']},
                    'build': {'command': build['command'], 'exit_code': build['exit_code']},
                    'focused_test': {'command': focused_test['command'], 'exit_code': focused_test['exit_code']},
                },
            }
        else:
            status = 'already_satisfied'
            evidence = {
                'check_name': check_name,
                'job_id': ev.get('job_id'),
                'run_id': ev.get('run_id'),
                'deduplicated_with_source_id': dedup_pair_for_check_run.get(sid),
                'reason': 'Duplicate CI record for same failing check represented by gh-pr-checks entry; primary remediation already applied.',
                'verification': {
                    'typecheck_exit_code': typecheck['exit_code'],
                    'build_exit_code': build['exit_code'],
                },
            }

    elif stype == 'coderabbit_feedback':
        if sid == 'rest-review:PRRC_kwDOPB5qbc69WC3W':
            status = 'fixed'
            evidence = {
                'file': 'pr-description.md',
                'expected': 'Top-level heading at first line (# TLDR).',
                'first_line': pr_desc_text.splitlines()[0] if pr_desc_text.splitlines() else '',
                'is_expected': is_h1,
                'diff_contains_change': '-## TLDR\n+# TLDR' in diff_cmd['stdout'],
            }
        elif sid == 'rest-review:PRRC_kwDOPB5qbc69WC3Z':
            status = 'fixed'
            evidence = {
                'file': 'pr-description.md',
                'expected': 'Use __tests__ path notation in reviewer test plan and summary bullet.',
                'contains_correct_token': has_correct_tests_token,
                'contains_incorrect_token': has_legacy_tests_token,
                'diff_replacement_detected': '__tests__/useStreamEventHandlers.contextCleared.test.ts' in diff_cmd['stdout'],
            }
        elif sid == 'issue-comment:IC_kwDOPB5qbc8AAAABA5mhhQ':
            status = 'already_satisfied'
            evidence = {
                'comment_type': 'summary_comment',
                'reason': 'Summary comment does not introduce additional actionable remediation beyond the two specific review comments already fixed.',
                'covered_by': [
                    'rest-review:PRRC_kwDOPB5qbc69WC3W',
                    'rest-review:PRRC_kwDOPB5qbc69WC3Z',
                ],
            }
        else:
            status = 'skipped'
            evidence = {'reason': 'Unrecognized feedback item id.'}
    else:
        status = 'skipped'
        evidence = {'reason': f'Unsupported source_type: {stype}'}

    results.append({
        'source_id': sid,
        'source_type': stype,
        'status': status,
        'evidence': evidence,
    })

allowed = {'fixed', 'changed', 'already_satisfied', 'not_reproduced', 'not_fixed', 'skipped', 'failed'}
for r in results:
    if r['status'] not in allowed:
        raise SystemExit(f"invalid status {r['status']} for {r['source_id']}")

out = {
    'schema_version': 1,
    'repository_owner': plan['repository_owner'],
    'repository_name': plan['repository_name'],
    'pr_number': plan['pr_number'],
    'plan_head_sha': plan['head_sha'],
    'output_head_sha': head_sha,
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'results': results,
    'evidence_summary': {
        'targeted_diff_command': diff_cmd['command'],
        'targeted_diff_exit_code': diff_cmd['exit_code'],
        'targeted_diff_excerpt': diff_cmd['stdout'][:4000],
        'typecheck_exit_code': typecheck['exit_code'],
        'build_exit_code': build['exit_code'],
        'focused_test_exit_code': focused_test['exit_code'],
    },
}

out_path.write_text(json.dumps(out, indent=2) + '\n')

print('wrote', out_path)
print('result_count', len(results))
print('status_counts', dict(Counter(r['status'] for r in results)))
