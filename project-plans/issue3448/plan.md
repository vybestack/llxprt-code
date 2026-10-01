# Issue #3448: inline profile OAuth parity

## Intake and scope

- Start revision: `f3839b8810496490f4eaf8513c27e12bd7952809` (`main`). Work branch: `issue3448`.
- #3448 contributes CLI OAuth regressions to #3629 and #2644, with CLI preservation owned by #3634. Frozen S1-S12 definitions are unchanged.
- The resumed pass updates this plan, verifies the approved candidate, and commits the four issue files after all checks pass. No additional review, OCR, push, PR, workflow, dependency, quality-policy, profile, configuration, or memory changes are included.

## Behavioral evidence and defect

The adapter already exists in `profileBootstrap.ts` and `postConfigRuntime.ts`. The initial real CLI regression demonstrated a different failure on unchanged production: both named OAuth profiles succeeded, while the identical inline profiles failed authentication.

`profileRuntimeApplication.ts` passed the invented saved-profile name `inline-profile` to `applyProfileSnapshot`. OAuth's profile bucket/session resolution subsequently tried to load that nonexistent saved document. The inline path now passes the actual optional `profileToLoad` value, leaving inline documents unnamed rather than inventing a repository reference. Named profiles retain their name. The production diff changes two lines; no redundant adapter wiring was added.

Red evidence: `tmp/verify3448/oauth-red.log` records both enabled/stored OAuth cases failing before the production change. `tmp/verify3448/focused.log` records 14 passing cases and those two failures on unchanged production. `harness-red.log` is only the missing test-preload check and is not evidence of a production defect.

## Test paths and accepted-case mapping

Suite: `packages/cli/src/integration-tests/profile-oauth-parity.integration.test.ts`.
Infrastructure preload: `packages/cli/src/integration-tests/__tests__/profile-auth-transport.preload.ts`.

Every case starts real `packages/cli/index.ts` child processes with the same serialized version-1 document saved as `parity.json` and supplied inline. Both processes share one isolated settings/keyring authority. The environment is an allowlist, excluding inherited provider keys, credential proxies, fake-response flags, and host-session bootstrap state. Paths are set before CLI imports. The working directory, HOME, and all storage categories are isolated.

The preload substitutes only the OS keyring binding, browser boundary, global fetch, and Undici WebSocket. SecureStore, KeyringTokenStore, OAuthManager, profile loading, runtime assembly, real providers, SDK parsing, and noninteractive CLI execution remain real. Native Anthropic/OpenAI/Codex URLs are retained. Outgoing credentials are recorded only as scrypt-derived fingerprints (SHA-256 before the CI finding remediation below). No live user token is accessed or mutated.

| Cases | Assertions |
| --- | --- |
| `claudecode` and `codex`: enabled stored OAuth | Both routes exit 0, decode the response, use the expected native host/model and credential fingerprint, retain the input prompt, and produce identical request observations. Codex sends the stored account ID. Claudecode uses the native `https://api.anthropic.com` base URL from the issue reproduction. |
| Each OAuth provider: explicitly disabled with stored token | Both routes exit 1 with terminal noninteractive API-auth errors, send no inference requests, do not invoke the browser or write/delete credentials, and preserve settings content and modification time. |
| Each OAuth provider: enabled with missing token | Same terminal/no-side-effect assertions, without credential creation or login. |
| Each OAuth provider: absent settings or absent provider entry, with stored token | Preserve the existing disabled default and the same terminal/no-side-effect behavior. |
| `anthropic` and `openai`: `auth-key`, `auth-keyfile`, `auth-key-name` | Six cases verify successful real provider request generation, correct outgoing model/credential and decoded response for both routes. The keyfile includes surrounding whitespace; named keys traverse real ProviderKeyStorage. |

The accepted matrix has 16 cases and 32 CLI processes per complete suite run. Remediation adds only five fixture sensitivity probes, described below. The pre-fix red run also demonstrated that disabled/missing/default and API-key cases were already green. The suite catches deletion or corruption of the real inline OAuth path; it does not assert mocked assembly calls or mock token resolution.

## Pre-remediation verification and contribution handoff

Verification logs and stage exit codes are retained under `tmp/verify3448/`, with status in `status.txt`. Focused green runs are `focused-green.log` and `focused-final.log`. The AST audit writes `audit/findings.tsv` and `audit/file-stats.tsv`; `touched-audit.tsv` isolates findings on this contribution.

Results before accepted findings remediation:

| Check | Result | Log under `tmp/verify3448/` |
| --- | --- | --- |
| `npm run format` | Exit 0 | `format-final.log` |
| `npm run lint` | Exit 0 | `lint-final.log` |
| `npm run typecheck` | Exit 0 | `typecheck-final.log` |
| `npm run test` | Exit 0; all 765 CLI files passed | `test.log` |
| `npm run build` | Exit 0 | `build.log` |
| Focused 16-case suite | 16 pass, 0 fail, 376 assertions | `focused-final.log` |
| Scoped ESLint and CLI typecheck | Exit 0 for both | `scoped-lint.log`, `cli-typecheck-final.log` |
| AST test audit | Exit 0; no findings on either new file | `audit.log`, empty `touched-audit.tsv` |
| `git diff --check` | Exit 0 | Final working-tree check |
| Luna smoke | Exit 1: `Profile 'luna' not found` | `smoke.log` |

The earlier smoke command was `bun scripts/start.ts --profile-load luna "write me a haiku and nothing else"`. `HOME=/Users/acoliver`, no `LLXPRT_CONFIG_HOME` override was present, and neither workspace `profiles/luna.json` nor `/Users/acoliver/Library/Preferences/llxprt-code/profiles/luna.json` exists. The user subsequently clarified that Luna means the existing GPT Luna profile, `gpt-6-luna`. The resumed smoke below uses that profile and resolves the earlier smoke failure without changing user settings.

Initial typecheck attempts caught test-harness typing problems. They were corrected by using Node's subprocess API from the Bun test rather than importing Bun global type augmentations, and by defining a no-op transport preconnect. The full final typecheck passed; earlier nonzero entries remain in `status.txt` for provenance. All managed jobs have completed, with none active.

The passing candidate is baseline `f3839b8810496490f4eaf8513c27e12bd7952809` plus the uncommitted files listed above. Full suite output contains deliberately failing runner fixtures used by passing lifecycle/classification tests; the root `npm run test` stage exits 0.

The earlier transport-seam blocker is resolved by the authorized test-only Bun preload. There is no need for a production transport subsystem or local Anthropic base URL.

A committed test path, implementation PR, tested commit SHA, and green result must later be linked on #3629 and in #2644's evidence index. The resumed pass commits the verified candidate locally; publishing and GitHub evidence updates remain outside this pass. #2644 must rerun the committed suite at its final main SHA.

## Accepted findings remediation (F1-F3 only)

The accepted classifications are F1 **Blocker-Fix**, F2 **In-scope-Fix**, and F3 **In-scope-Fix**. This pass changes only the existing integration suite, its infrastructure preload, and this issue plan. The two-line production diff in `profileRuntimeApplication.ts` remains unchanged. No additional production RED, endpoint policy matrix, credential policy, dependency, or public API is introduced.

| Finding | Resolution and evidence |
| --- | --- |
| F1: the shared API-shaped fixture did not exercise Anthropic OAuth headers | Stored OAuth now has provider-specific synthetic credentials separate from API-key fixtures. Claudecode uses the provider-recognized OAuth prefix. Observations expose only authorization kind, API-key presence, OAuth-beta presence, credential fingerprint, and synthetic account ID. Existing success cases require Claudecode Bearer plus OAuth beta with no API-key header; Codex requires Bearer plus stored account ID; Anthropic API keys require `x-api-key`; OpenAI API keys require Bearer. `tmp/verify3448/remediation/f1-wire-red.log` shows the old fixture failing the strengthened Bearer oracle with `absent`. |
| F2: wrong Codex paths could receive successful responses | The fixture accepts only `wss://chatgpt.com/backend-api/codex/responses` and its exact HTTPS counterpart. Existing success cases now assert the complete outgoing URL. Two narrow fixture probes reject the previously accepted `/not-codex/responses` path through HTTP and WebSocket before any inference observation or response. These probes test fixture sensitivity, without adding provider endpoint-policy cases. |
| F3: unexpected network attempts were rejected without observation | Unknown HTTP and WebSocket attempts append an `unexpected-network` event before rejection or inference body parsing. Events contain transport, method, and endpoint with no headers, body, URL credentials, or query. The existing eight negative cases explicitly require no inference requests and no boundary events on both CLI routes. Narrow probes require an observed external GET and an OAuth POST without a model, while a local data URL is read locally with no network event. Unknown external requests still fail immediately. |

Original finding evidence remains in `tmp/verify3448/review/claudecode-wire-header-summary.log`, `codex-wrong-endpoint-probe.log`, and `auth-attempt-observation-probe.log`.

Tests were strengthened before fixture changes. `remediation/behavior-red.log` records 8 pass and 13 fail: all five sensitivity probes fail against the old preload, and eight successful inference cases lack the new header observations. Wrong Codex HTTP and WebSocket requests incorrectly exit 0; the external GET has no event; the OAuth POST fails inference-model validation before observation; the local data URL is incorrectly rejected. `remediation/focused-red.log` is an initial test-source syntax failure, not behavioral evidence. `remediation/focused-green.log` records 21 pass, 0 fail, and 546 assertions after the test-only fixes: the original 16 acceptance cases plus five fixture sensitivity cases. Real credential resolution, providers, SDKs, CLI execution, and the unchanged production fix remain in use.

### Final remediation verification

All logs below are under `tmp/verify3448/remediation/`; `status.txt` retains every attempt. The final full sequence ran after the test-only lint and typing corrections.

| Command or check | Exact outcome | Log or evidence |
| --- | --- | --- |
| `npm run format` | Exit 0 | `format.log` |
| `npm run lint` | Exit 0 | `lint.log` |
| `npm run typecheck` | Exit 0 | `typecheck.log` |
| `npm run test` | Exit 0; 765/765 CLI files passed; all workspace runners passed | `test.log` |
| `npm run build` | Exit 0 | `build.log` |
| `bun scripts/start.ts --profile-load luna "write me a haiku and nothing else"` | Exit 1: `Profile 'luna' not found` | `smoke.log` |
| Final focused suite | Exit 0; 21 pass, 0 fail, 546 assertions | `focused-final.log` |
| `bun scripts/test-audit/scan.ts tmp/verify3448/remediation/audit` | Exit 0; zero findings on either touched test file | `audit.log`, `audit/findings.tsv`, empty (0 bytes) `touched-audit.tsv` |
| Scoped ESLint and CLI typecheck | Exit 0 for both after their respective corrections | `scoped-lint.log`, `cli-typecheck.log` |
| `git diff --check` | Exit 0 | `diff-check.log` |
| Production file unchanged during remediation | SHA-256 comparison exit 0; existing two-line diff preserved | `production-before.sha256`, `production-after.sha256`, `production-before.diff` |

The final focused run proves the complete accepted matrix: two OAuth successes, eight terminal OAuth failures, and six API-key-source successes. Every accepted case runs named and inline CLI routes against the same authority and requires matching observations, unchanged persistence, no boundary events, and no synthetic credential leakage. The five additional tests prove wrong Codex HTTP and WebSocket endpoints are rejected and observed before inference; an external GET and a model-less OAuth POST are observed and rejected; and a local data URL succeeds without external-network observation. The final suite contains 32 real CLI invocations plus five fixture probe processes.

Intermediate outcomes are retained rather than hidden. `focused-red.log` is a source-syntax failure. `behavior-red.log` and `f1-wire-red.log` are the behavioral RED runs. `focused-green.log` passes all 21 tests. The first full verification job was cancelled during lint after three test-only errors (nested conditionals and a nullable boolean), retained in `lint-initial.log`. The second attempt passed format/lint but exited 2 on test-only TS2769 because the transport array widened to `string`; `typecheck-attempt2.log` records that error. That job was cancelled after entering the test stage and before starting another verifier. The transport list now uses its existing observation schema's union type. `*-attempt2.log` and `format-initial.log` preserve those attempts. Final full rerun results above supersede them. No checks, assertions, runner limits, or production code were weakened.

The final workspace test run retried `ReplayEngine.property.test.ts` after a per-file timeout and `SessionDiscovery.test.ts` after per-test timeouts; both recovered and the core runner passed 460/460 files. These observations are **Defer**, outside F1-F3, with no expansion or changes to unrelated tests. Deliberate runner fixture failures also appear inside passing runner lifecycle tests; the root test command exits 0.

The remediation's literal `luna` smoke failure is retained above as historical evidence. It is resolved by the user's clarification and the successful `gpt-6-luna` smoke below. No profile, configuration, memory, credential, dependency, or quality-policy changes were made.

The remediation verifier (`shell_f473e46f9bad`) completed. Earlier attempts are completed, failed RED runs, or cancelled as described above. The scoped candidate contains only the existing production diff, the two issue test files, and this issue plan.

## Final review and resumed candidate verification

The final scoped review passed F1-F3 with no scoped findings. Evidence is retained under `tmp/verify3448/final-review/`, including `status.txt`, `focused.log`, `production.diff`, and matching `candidate-before.sha256` and `candidate-after.sha256`. The focused suite passed all 21 cases. The review budget is exhausted; this resumed pass performs no further review or OCR and changes no production or test code.

The user clarified that Luna refers to the existing GPT Luna profile at `/Users/acoliver/Library/Preferences/llxprt-code/profiles/gpt-6-luna.json`. The actual command `bun scripts/start.ts --profile-load gpt-6-luna "write me a haiku and nothing else"` exited 0 and returned:

```text
[gpt-6-luna:gpt-6-luna]
Autumn leaves drift down
Cool light gathers on still ponds
Evening folds the hills
```

The response and exit status are recorded in `tmp/verify3448/candidate/smoke-initial.log` and `smoke-initial.status`. No fallback provider was used. The earlier missing-profile blocker is resolved.

The precommit verification cycle uses the exact candidate after this plan update: `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and the actual `gpt-6-luna` smoke command above. Logs are retained under `tmp/verify3448/candidate/` as `format.log`, `lint.log`, `typecheck.log`, `test.log`, `build.log`, and `smoke.log`; `status.txt` records stage exit codes. The touched-file audit uses `bun scripts/test-audit/scan.ts tmp/verify3448/candidate/audit`, with results in `audit.log`, `audit/findings.tsv`, and `touched-audit.tsv`. `diff-check.log` records `git diff --check`.

The commit gate requires every candidate stage to exit 0, no audit findings on the touched test files, and no source changes from the approved review. Candidate SHA-256 records and committed-file comparisons are retained under the same directory. Only the four issue files are staged for `fix(cli): preserve OAuth for inline profiles (Fixes #3448)`. This pass does not push or create a PR.

## PR #3801 CI/test-harness findings

Candidate: `2f2c5935112d6af1b4b6f99f225637e2a99b22a8`. This pass is authorized only for existing CodeQL and CodeRabbit findings, their narrow behavioral probes, and this plan. Only the existing suite, preload, and plan change. The original two-line production fix remains identical. No new review or OCR is run because the local review budget is exhausted. No dependency, workflow, scanner, assertion threshold, timeout, quality policy, user configuration, or memory changes are included.

| Existing finding | Classification and resolution |
| --- | --- |
| CodeQL check `110584017233`, alerts #781 (preload) and #782 (suite), `js/insufficient-password-hash` | **Reject** as an actual password-storage vulnerability: the values are hard-coded synthetic credentials and observations are test identity fingerprints, not stored password verifiers. Apply the explicitly authorized test-only representation fix rather than suppressing or dismissing the alerts. Both observed and expected fingerprints now use standard `node:crypto` `scryptSync`, a 32-byte derived key, fixed explicit salt `synthetic-profile-parity-3448`, and the safe default cost parameters (N=16384, r=8, p=1). Neither SHA-256 credential sink remains. Exact identity equality and no-raw-token observations remain required. A suite-private assertion helper lets the sensitivity case exercise the same identity oracle as the acceptance cases. |
| CodeRabbit thread `PRRT_kwDOPB5qbc6oIu87`, process close handler | **In-scope-Fix**: reject signal termination with the signal and captured stderr in the error at the close event, after pipe output has drained. Ordinary exit statuses and spawn-error rejection remain unchanged. Cleanup still runs through the existing `afterEach`; the subprocess timeout remains 60000 ms and CLI-case deadline remains 120000 ms. |
| CodeRabbit docstring coverage suggestion | **Reject** as outside this issue. No blanket documentation or coverage-policy change. |
| Optional downstream credential-selection/interrupted-cleanup matrix | **Reject** as outside the authorized findings. No new policy or cleanup matrix. |

### Narrow RED/GREEN and preserved acceptance mapping

- KDF RED: `tmp/verify3448/ci-fixes/red.log` records both enabled/stored OAuth cases failing exact identity equality when the expected derivation was strengthened to scrypt while observations still used SHA-256. This is representation sensitivity, not a new production defect.
- Signal RED: `signal-red.log` records 2 pass and 1 fail with the corrected real SIGTERM probe against the candidate close handler. Actual exits 0 and 23 pass; signal termination incorrectly resolves. The earlier signal result in `red.log` and first `green-narrow.log` came from a malformed eval diagnostic and is not signal-behavior evidence. The probe syntax was corrected before recording the authentic RED.
- Final narrow GREEN: `green-narrow-final.log` records 6 pass, 0 fail, 107 assertions. Both stored OAuth cases match the scrypt oracle; SIGTERM rejects with signal/stderr; exits 0 and 23 preserve captured output and status. A wrong synthetic API credential traverses real OpenAI credential resolution and both real CLI routes. Its observation matches that input's derived fingerprint, but the same acceptance identity oracle throws against the required credential, with no raw token in observations/output. Core auth/profile/provider code is not mocked.
- The complete #3448 mapping above is retained: 16 acceptance cases (two OAuth successes, eight disabled/missing/default failures, six API-key-source successes), each on named and inline routes against the same isolated authority, plus the existing five transport sensitivity cases. This pass adds only four tests: one signal probe, two ordinary-exit probes, and one credential-identity sensitivity case. The complete focused suite has 25 tests, including 34 real CLI invocations and eight infrastructure subprocess probes. Native hosts, full inference URLs, models, header kinds, OAuth beta, account ID, prompt preservation, matching observations, unchanged persistence, no browser/network/credential-mutation events, and no synthetic-token leakage remain enforced.

### CI-fix verification and publication gate

All final verification stages exited 0. Logs and stage exit codes are retained under `tmp/verify3448/ci-fixes/`; `status.txt` and `driver.log` record the completed managed job. No alternate smoke provider was used.

| Command or check | Final outcome | Log under `tmp/verify3448/ci-fixes/` |
| --- | --- | --- |
| `npm run format` | Exit 0 | `format.log` |
| `bun test packages/cli/src/integration-tests/profile-oauth-parity.integration.test.ts` | Exit 0; 25 pass, 0 fail, 575 assertions | `focused.log` |
| `bun scripts/test-audit/scan.ts tmp/verify3448/ci-fixes/audit` | Exit 0; zero findings on either touched test file; full findings identical to the verified candidate | `audit.log`, empty `touched-audit.tsv`, empty `audit-baseline.diff`, `audit-baseline.status` |
| `npm run lint` | Exit 0 | `lint.log` |
| `npm run typecheck` | Exit 0 | `typecheck.log` |
| `npm run test` | Exit 0; core 460/460 files and CLI 765/765 files pass; all workspace commands pass. CLI reports 9836 passed, 0 failed, 5 skipped, 13 todo | `test.log` |
| `npm run build` | Exit 0 | `build.log` |
| `bun scripts/start.ts --profile-load gpt-6-luna "write me a haiku and nothing else"` | Exit 0; actual GPT Luna response below | `smoke.log` |
| `git diff --check` | Exit 0 | `diff-check.log` |
| Production unchanged relative to candidate | Exit 0; no diff in `profileRuntimeApplication.ts` | Empty `production-unchanged.diff` |

```text
[gpt-6-luna:gpt-6-luna]
Autumn rain whispers
Red leaves drift across still paths
Dusk gathers the hills
```

Intermediate verification evidence is retained. `lint-initial.log` records `jest/require-to-throw-message` on the new credential sensitivity assertion; the assertion now requires the identity-equality diagnostic, without changing the lint rule. `status-initial.txt` preserves that attempt. The first complete root test attempt exited 1: `terminalContract.test.ts` received elapsed wall-clock time -87 ms where >=40 ms was required, while Bun reported a 53.22 ms test duration. `test-first-full.log` and `status-before-test-retry.txt` retain the failure. This timing observation is outside the authorized findings; no source, assertion, or runner limit was changed for it. The untouched test then passed 10/10 in `terminal-contract-unchanged-rerun.log`, followed by the successful entire root sequence above. Deliberately failing runner fixtures remain present inside passing runner-classification tests and are not root command failures. No further review or OCR was run.

Publication uses the existing `issue3448` branch and PR #3801. The commit gate requires all stages to exit 0, zero touched-file audit findings, `git diff --check` success, and zero production changes relative to the candidate. Only suite/preload/plan are staged for `test(cli): satisfy OAuth parity check oracles`, followed by a clean-status check and a non-force push over `git@github-acoliver:vybestack/llxprt-code.git`. GitHub identity must be `acoliver`. The driver owns thread comments/resolution, remote CI watching, and #3629/#2644 conformance links. No new PR, merge, review run, or CodeQL alert dismissal is performed.
