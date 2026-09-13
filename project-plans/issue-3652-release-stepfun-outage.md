# Issue #3652 — Release Failed for v0.12.0-nightly.260913.2aac6841e

## Root cause

The Release workflow failed at `Run Integration Tests` (run 34732047926). The
live-model integration tests (`integration-tests/replace.test.ts`,
`run_shell_command.test.ts`, and every other test without a
`fakeResponsesPath`) call the real model endpoint configured by repository
variables:

| Variable | Value (before) |
| --- | --- |
| `OPENAI_BASE_URL` | `https://api.stepfun.ai/step_plan/v1` |
| `LLXPRT_DEFAULT_MODEL` | `step-3.7-flash` |
| `LLXPRT_DEFAULT_PROVIDER` | `openai` (unchanged) |
| `KEY_VAR_NAME` / `KEY_VAR_NAME_2` | `STEPFUN_KEY` |

The StepFun subscription was cancelled (2026-09-13), so every live-model call
returns `400 you have no active step plan subscription`. Release logs:

```
Error when talking to openai (endpoint: https://api.stepfun.ai/step_plan/v1)
Non-interactive run failed: [API Error: 400 you have no active step plan subscription (Status: 400)]
```

Same-variable jobs fail identically elsewhere: `e2e.yml` on main
(34782117610), `nightly.yml` E2E/eval/shard jobs since 2026-09-11. Release
failures on 2026-09-09..12 were a different step (`Publish
@vybestack/llxprt-code-zed-acp`) and are out of scope here.

Sept 9-12 release runs passed integration tests with StepFun, so the outage
began between 2026-09-12 02:00 UTC and 2026-09-13 02:00 UTC.

## Fix

Repository configuration only — no workflow-file, code, or test changes. Point
the shared live-model vars at the Zai GLM-5.3 coding endpoint, using the
existing `ZAI_API_KEY` secret:

```
gh variable set OPENAI_BASE_URL     --body https://api.z.ai/api/coding/paas/v4
gh variable set LLXPRT_DEFAULT_MODEL --body glm-5.3
gh variable set KEY_VAR_NAME        --body ZAI_API_KEY
gh variable set KEY_VAR_NAME_2      --body ZAI_API_KEY
```

`LLXPRT_DEFAULT_PROVIDER` stays `openai` (OpenAI-compatible provider reading
`OPENAI_API_KEY` + `OPENAI_BASE_URL`, `LLXPRT_AUTH_TYPE=none`) — the exact
mechanism that worked with StepFun. `scripts/ci-quota-check.ts` has no
provider-specific logic on this path (non-Synthetic key names select the
primary key unconditionally).

### Why this endpoint

Probed from this workstation (artifacts in `tmp/verify3652/`):

- `https://api.z.ai/api/paas/v4/chat/completions` → 429
  `Insufficient balance or no resource package` (no platform balance on the key)
- `https://api.z.ai/api/coding/paas/v4/chat/completions` → 200, `glm-5.3`,
  plain chat OK, OpenAI-format `tools` round trip OK
  (`finish_reason: tool_calls`, correct arguments)

Zai's anthropic endpoint (`api.z.ai/api/anthropic`) also works but the release
pipeline is wired for the OpenAI-compatible provider.

## Acceptance criteria

1. **Root cause removed.** `gh variable list` shows the four vars above
   pointing at Zai/`ZAI_API_KEY`; nothing in the release path references
   StepFun.
2. **Release heals.** A `workflow_dispatch` dry run of `release.yml` on main
   (dry_run=true — integration tests still run, nothing publishes) completes
   `Run Integration Tests` successfully. Boundary: if the existing
   `ZAI_API_KEY` secret is stale (auth failure), rotate the secret to a
   verified working key and re-run; report the rotation explicitly.
3. **Shared-config consumer heals.** `e2e.yml` dispatched on main passes
   `Run E2E tests` (it failed identically before the change).
4. **No scope creep.** No workflow files, tests, or code modified; suspended
   OCR vars (`OCR_LLM_URL`, `OCR_LLM_MODEL` still StepFun) left untouched —
   OCR is disabled by Andrew's standing instruction; flagged as follow-up for
   whenever OCR is re-enabled.

## Evidence

- Local endpoint probes: `tmp/verify3652/zai-*.json` (200s on coding/paas
  chat + tools; 429 on plain paas).
- Local behavioral verification: `bun scripts/run_bun_tests.ts --root
  integration-tests replace.test.ts run_shell_command.test.ts` with the Zai
  env — **Passed 2/2 files** (`tmp/verify3652/local-integration2.log`); the
  previously-failing live-model tests (`replace > should be able to replace
  content in a file`, `run_shell_command` live tests) all pass against
  glm-5.3.
- AC1: `gh variable list` verified 2026-09-13 ~21:11 UTC.
- AC2: release.yml dry-run on main, run
  [34783081316](https://github.com/vybestack/llxprt-code/actions/runs/34783081316)
  — **success**, including `Run Integration Tests` (the incident's failing
  step) and `Run Preflight Checks`.
- AC3: e2e.yml dispatched on main, run
  [34786119735](https://github.com/vybestack/llxprt-code/actions/runs/34786119735)
  — **success**; `(pass) replace > should be able to replace content in a
  file` in both sandbox:none and sandbox:docker lanes (previously failing
  with the same 400).
- AC4: no repo files modified (`git status` clean apart from this plan);
  OCR vars untouched.

## Follow-ups filed

- #3658 — `openai` provider stream iterator intermittently throws
  `undefined is not a function` against the z.ai coding endpoint (~1 in 12-15
  live calls; per-file retries absorb it in CI today).
- #3659 — pre-existing: nightly `Publish @vybestack/llxprt-code-zed-acp`
  fails PUT 404 because the npm credential cannot create new packages under
  the scope. This is why releases #3623/#3625/#3628/#3649 failed and will
  keep failing on the next real publish regardless of this fix; needs an
  npm-side action (first manual publish or token scope change).

## Notes

- No PR: the fix is repo configuration; there is no commit to review. This
  plan document records the change instead.
- `STEPFUN_KEY` secret and OCR vars remain in the repo (dormant). Cleanup is
  a separate decision.
- The 260913 nightly itself is not retro-published; the next scheduled run
  (00:00 UTC) publishes a fresh date-stamped nightly with the fixed config —
  and will still stop at zed-acp publish until #3659 is resolved.

## Notes

- No PR: the fix is repo configuration; there is no commit to review. This
  plan document records the change instead.
- `STEPFUN_KEY` secret and OCR vars remain in the repo (dormant). Cleanup is
  a separate decision.
