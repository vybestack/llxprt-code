# Issue #3774: Podman diagnostics lost during synchronous readiness polling

## Scope

Replace the blocking readiness probe with the asynchronous form of the same shell command. Keep the 500 ms stabilization, 2000 ms per-probe timeout, 200 ms retry interval, 1000 ms diagnostic fixture readiness budget and supported concurrency unchanged. Keep SSH failure reporting on close, after output drain, and keep startup failure cleanup and reaping unchanged.

No engine or VM is needed. No changes to dependencies, workflows, enforcement, `.llxprt/`, public APIs or adjacent tunnel behavior are included. OCR remains disabled. The final release stage authorizes the `lunahigh` replacement smoke, a scoped commit, push and PR creation. Merge is not authorized.

## Reproduction and measured mechanism

The incomplete overlap fixture initially present on this branch was invalid: it joined executable lines with literal backslash-n characters and escaped the connection JSON. The corrected fake executable returns valid connection JSON and reaches readiness polling. SSH waits for a shared readiness-start marker before writing its diagnostic. It does not use an arbitrary initial sleep to establish ordering.

A sleeping readiness probe alone did not deterministically produce the historical timeout message on this machine. The baseline delivered pending SSH close during its 200 ms retry interval. Experiments with background inherited output also passed. Those intermediate results are preserved under `tmp/verify3774/` as `red-first.log`, `red-backpressure.log`, `red-drain.log` and `red-concurrent/`.

The final regression establishes readiness start, leaves fake Podman sleeping for 1.5 seconds, then lets fake SSH emit the diagnostic followed by 8 MiB of foreground output. SSH waits 0.4 seconds after that output drains and exits 23. The output exceeds pipe capacity. The unchanged synchronous probe prevents the parent from draining it until the probe returns. Only then can the output producer finish and SSH begin its final delay. The existing 200 ms retry interval expires before SSH close, so readiness timeout wins. With asynchronous probing, the parent drains output immediately, SSH closes before the existing readiness budget, and the startup diagnostic wins.

A fixture-only shortening of the probe or output delay would remove this controlled symptom while leaving the parent-blocking defect in production. The asynchronous correction addresses the measured mechanism without altering command, readiness budgets, retry interval or close-based diagnostic behavior.

### Red evidence without instrumentation

`tmp/verify3774/red-deterministic-{1,2,3}.log` and matching exit files: three isolated runs of an unchanged HEAD helper copy, each exit 1. Every run failed the diagnostic-content assertion with the actual readiness-timeout error, rather than invalid connection JSON or another fixture error.

`tmp/verify3774/red-deterministic-concurrent/lane-{1,2,3,4}.log` and matching exit files: four independent unchanged-helper processes, each exit 1 with the same diagnostic-versus-timeout failure. These copies only change the relative import location so the HEAD helper can run from the evidence directory; no timing instrumentation or production changes are included.

Historical baseline failures remain at `tmp/verify3770/full/podman-baseline-concurrent-{1,2,3,4}.log`. The controlled regression establishes this mechanism directly. It does not prove that every historical failure had exactly the same event sequence or attribute a separate defect to Bun, macOS or Podman.

### Measured event delivery

Temporary instrumented copies are only under `tmp/verify3774/`. `baseline-events.jsonl` and `candidate-events.jsonl` record JavaScript delivery timestamps, not kernel-level exit timestamps. The external readiness marker establishes ordering independently of those event callbacks.

For the final controlled baseline trace, external readiness started at 1790860004522. The synchronous probe returned before parent output delivery; the readiness timeout won at 1790860006241. SSH exit was delivered at 1790860006242, close at 1790860006457, and cleanup/result at 1790860006457. `red-final-trace.log` failed the expected diagnostic assertion with readiness timeout.

For the matching initial candidate trace, external readiness started at 1790860007725. SSH exit and close were delivered at 1790860008155, the diagnostic won at 1790860008156, and the abort callback and result were delivered at 1790860008156. Delivery took 431 ms after the marker, while the 1.5-second probe was still outstanding. `green-final-trace.log` passed its original assertions. The trace's reaped event proves only SSH cleanup, not actual Podman probe cleanup. Handling the exec abort callback prevented an unhandled rejection but did not establish descendant termination.

Independent evidence under `tmp/verify3774/independent-review-20261001/` confirms the distinction. `cancellation-comparison.log` records the 1.5-second candidate returning after 949 ms with its actual sleep member reparented to PPID 1 and still alive. `cancellation-baseline-1.5.log` records the identical HEAD helper returning after 2038 ms with that member gone. The three-second probe survived the configured timeout under both candidate and HEAD. That pre-existing timeout-tree behavior is outside this correction.

## Implementation

`packages/cli/src/utils/sandbox-podman.ts` runs the unchanged shell command asynchronously through `spawn` with a private detached process group. The readiness promise remains owned while the SSH failure races it. Startup failure signals this operation's group with SIGTERM, waits for both child close and actual group disappearance, and escalates to SIGKILL using the existing 1000 ms cleanup waits if needed. Group liveness is checked every 10 ms only during cancellation. Failure does not return before that readiness promise settles. Only ESRCH establishes group disappearance. macOS returned EPERM while a terminated group was still observable; that outcome remains pending until disappearance or bounded cleanup failure. It is not treated as successful cleanup. Other OS errors are surfaced alongside startup failure and SSH cleanup still runs.

Normal readiness execution retains the 2000 ms per-probe timeout and 200 ms retry interval. The private probe result records whether it was cancelled; cancellation returns after cleanup without spending an unavailable-port retry interval. The first full remediation run caught 1119 ms marker-to-result latency while the PID and diagnostic assertions passed. That failing timing assertion drove this correction rather than a change to its 1000 ms limit. The normal timeout signals only the shell and closes its captured streams, matching the prior bounded exec behavior without adding general timeout-descendant handling. Group termination belongs only to cancellation of the newly asynchronous owned operation. No public abstraction or process-tree subsystem was added. The monitor's close-based diagnostic collection, timeout-error selection and SSH cleanup remain unchanged.

`packages/cli/src/utils/sandbox-podman-diagnostics.test.ts` retains all original behavioral assertions and adds the marker-ordered diagnostic-versus-timeout regression and a genuine bounded readiness timeout/reaping case. The overlap fixture now records the actual fake Podman sleep PID. The fresh runner records PID liveness when the startup diagnostic is caught, before runner exit can hide a surviving process. The parent also checks that PID is absent. The existing sub-1000 ms marker-to-result assertion remains unchanged. The boundary-test names describe application acceptance and prelaunch rejection, not real OpenSSH validation or successful forwarding.

`packages/cli/src/utils/sandbox-ssh.test.ts` routes the asynchronous readiness spawn to a completed stream fixture. Existing success, returned relay configuration, timeout and cleanup tests exercise the real helper. The shared-port assertion filters SSH spawns so readiness children do not shift the tunnel argument positions.

`packages/cli/src/utils/sandbox-launch-release.test.ts` moves readiness infrastructure routing from execSync to spawn. No resource-release logic or assertions were changed. The callback fixture helper added in the initial candidate is no longer needed; its file now matches HEAD.

## Acceptance mapping

1. Reproduce timing: seven uninstrumented unchanged-helper runs reproduce the exact expected-diagnostic versus actual-readiness-timeout failure, including four simultaneous processes. External marker ordering and temporary traces establish why.
2. Reliability: final candidate repeated and default CLI results are recorded below with no engine, unchanged budgets and unchanged concurrency.
3. Diagnostic bounds: original retained-prefix, excluded-tail and exact 4096-byte assertions remain unchanged.
4. Application boundary: original 103-byte acceptance and 104-byte rejection-before-Podman-or-SSH assertions remain unchanged.
5. Correction and bounded failure: async probing removes measured parent blocking. On overlapping SSH failure, the actual owned probe PID is absent when its diagnostic returns, with unchanged sub-1000 ms marker-to-result latency. A live SSH process with unavailable readiness still yields a genuine readiness timeout instead of a kill-generated startup error and is reaped within the bounded test budget. Delayed chatty-output drain and SSH reaping coverage remain.
6. Verification: repeated isolated/concurrent lanes, affected SSH/lifecycle behavior tests, baseline/candidate AST audit and default repository checks are recorded below. No enforcement relaxation is included.

## Verification environment

macOS; Bun 1.3.14; Node v25.2.1; unchanged baseline HEAD `f3839b8810496490f4eaf8513c27e12bd7952809`. Evidence paths below are relative to `tmp/verify3774/`.

## Initial candidate verification status (before owned-probe remediation)

- `affected-ssh.log` / `.exit`: 45 affected tests passed, exit 0.
- `affected-launch-release.log` / `.exit`: 12 resource-release tests passed, exit 0.
- `repeated/`: final exact-timeout fixture passed five isolated runs and three rounds of four independent processes, 102 cases total. Every lane exited 0. Earlier latency-only candidate iterations remain separately in `repeated-first/` and `repeated-latency-only/`.
- AST audit: baseline HEAD corpus from a Git archive, 3015 files, 38588 tests, zero parse errors. Candidate scanned with the repository scanner. Both commands exited 0. `audit-comparison.json` records no new findings on any changed test file, including the resource-release fixture. No new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT findings were introduced.
- Initial lint and typecheck failures caused by this implementation were fixed without enforcement changes. Their evidence remains in `lint-first.log` and `typecheck-first.log` with matching exit files.
- `test-first.log` / `.exit`: default workspace test exited 1. Core passed 459/460 files, failing the unchanged `SessionDiscovery` property test at its 30000 ms budget on two attempts. CLI passed 763/764 files, with two resource-release fixture failures subsequently corrected. The original Podman diagnostic file passed the default CLI lane.
- The unchanged recording test and implementation match HEAD byte-for-byte (`session-discovery-head-match.exit`: 0). Its measured timeout is reported as https://github.com/vybestack/llxprt-code/issues/3790 with excerpt `session-discovery-failure-excerpt.log`. No recording-code correction is authorized in this scope.
- Final `npm run format`: exit 0, `format.log` / `format.exit`.
- Final `npm run lint`: exit 0, `lint.log` / `lint.exit`.
- Final `npm run typecheck`: exit 0, `typecheck.log` / `typecheck.exit`.
- Final `npm run test`: exit 1, `test.log` / `test.exit`. CLI passed 764/764 files at default concurrency four: 9813 passed cases, zero failed, five skipped and 13 todo. Core passed 457/460 files. Remaining core failures were unchanged `SessionDiscovery.test.ts` (30000 ms per-test timeout), `resumeSession.test.ts` (300-second file timeout) and `local-media-store-locking.test.ts` (per-test timeout). All other workspace runners passed. `full-summary.log` retains the core and CLI summaries.
- Final `npm run build`: exit 0, `build.log` / `build.exit`.
- Required `bun scripts/start.ts --profile-load luna "write me a haiku and nothing else"`: exit 1, `smoke.log` / `smoke.exit`, with `Error: Profile 'luna' not found`. `LLXPRT_CONFIG_HOME` is unset, HOME is `/Users/acoliver`. The normal user profile directory contains other luna-named profiles but no `luna.json`; the legacy profile directory is absent. No profile alias, configuration edit or alternate-profile substitution was made. Human intervention is required to restore the requested profile or authorize a replacement.
- Final changed-source Prettier check: exit 0, `final-scoped-format.log` / `.exit`. `git diff --check` passed. No tracked files outside the five scoped implementation/test files and this plan are changed.

## Independent review triage

- Blocker-Fix: cancellation of the newly asynchronous owned probe must not return leaving its previously normal-finishing member alive. This is implemented privately for this readiness operation and tested with its actual PID.
- Defer: full core failures tracked in https://github.com/vybestack/llxprt-code/issues/3790 and the missing required luna smoke profile. No core tests, recording code, profiles or configuration are changed here.
- Reject: excluded Unicode and memory work, engine changes, general refactoring and general timeout-process-tree hardening. The three-second timeout descendant existed under HEAD as well as the initial candidate and is not part of the new cancellation regression.

No additional review was performed during implementation. Only the findings follow-up remains in the two-cycle review budget.

## Owned-probe remediation evidence

All new evidence is under `tmp/verify3774/remediation/`. `red-signal-only-exact.log` / `.exit` reruns the six exact-file diagnostics tests against a snapshot of the initial exec-signal candidate. Five pass and the overlap test fails with actual probe liveness `true` at the caught diagnostic, while SSH cleanup and diagnostic content pass. `red-baseline-exact.log` / `.exit` uses unchanged HEAD and fails the original overlap diagnostic assertion with genuine readiness timeout. `snapshots.ts` preserves the snapshot construction; only relative import locations and the runner module path are relocated.

The first corrected candidate exact-file run passes all six cases in `green-owned-probe-first.log` / `.exit`, including actual probe disappearance at diagnostic return. The retained SSH latency, genuine timeout, oversized-prefix/no-tail/exact-4096 and 103/104 assertions are not weakened.

An additional failing run in `before-group-repeated/isolated-1.log` caught the actual probe PID still visible after the shell close event. This drove the bounded owned-group-disappearance wait. `group-reap-debug.log` records macOS EPERM from signal-zero inspection while the terminated group was still present. Cleanup now waits for ESRCH rather than equating close with probe disappearance. Four temporary debug rounds of four processes subsequently passed; they are retained as `group-debug-*` and do not replace the uninstrumented acceptance runs.

### Corrected candidate verification

- `acceptance-repeated/`: five isolated exact-file runs and three rounds of four independent processes, all 17 lanes exit 0. Each lane runs all six diagnostic tests, 102 cases total. Actual probe PID absence, marker-to-result latency below 1000 ms, genuine bounded readiness timeout, retained oversized prefix, excluded tail, exact 4096 bytes and 103/104-byte boundaries all pass. Supported concurrency and all assertions remain unchanged.
- `final/ssh.log` / `.exit`: exact `bun test ./packages/cli/src/utils/sandbox-ssh.test.ts`, 45 passed, exit 0.
- `final/launch-release.log` / `.exit`: exact `bun test ./packages/cli/src/utils/sandbox-launch-release.test.ts`, 12 passed, exit 0.
- `final/audit.log` / `.exit` and `audit-comparison.json`: full baseline/candidate AST scans, 3015 files each, zero parse errors and zero new findings on changed tests. No new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT patterns. `audit-baseline-head-match.exit` confirms the archive's diagnostics test matches HEAD.
- `final-static/{format,lint,typecheck}.log` and matching exit files: complete `npm run format`, `npm run lint` and `npm run typecheck`, each exit 0 after private helper extraction. The earlier full lint found the per-function line limit and a constant-condition violation. Both were resolved in code; no rules changed. All failing intermediate logs remain under the remediation directory.
- `final/test.log` / `.exit`: complete default `npm run test`, exit 0. Core passed 460/460 files. CLI passed 764/764 files at default concurrency four, 9813 cases passed, zero failed, five skipped and 13 todo. All other workspace runners passed.
- `final/build.log` / `.exit`: complete `npm run build`, exit 0.
- `final/smoke.log` / `.exit`: required `bun scripts/start.ts --profile-load luna "write me a haiku and nothing else"`, exit 1 with `Error: Profile 'luna' not found`. No substitute profile, alias or configuration edit was made.
- Earlier root `test.log` retains the unchanged media-store failure and initial candidate's 1119 ms scoped timing failure. `before-group-final/test.log` retains the subsequent unchanged SessionDiscovery timeout. #3790 remains deferred; the final run passes core without modifying it. Earlier `repeated/` boundary/diagnostic failures and `repeated-final/` aggregate cleanup failures are retained, not counted as acceptance passes.
- `command-statuses.json` records every stored command/lane exit. `full-summary.log` retains the final workspace summaries. `corrected.diff` contains the final scoped implementation/test diff and this plan; `git-status.log` records the worktree scope. `core-head-match.exit` and `protected-scope-head-match.exit` confirm core and protected configuration remain unchanged.

The final red-green proof retains uninstrumented `red-signal-only-exact.log` and `red-baseline-exact.log`. Temporary PID-reporting copies add `pid-proof-red.log` and `pid-proof-green.log`; they log actual PID liveness at caught diagnostic return and run the same unchanged assertions. The signal-only candidate reports alive and fails, while the corrected candidate reports absent and passes. The controlled HEAD timing red also fails in all four independent baseline lanes under `baseline-concurrent/`.

## Completion gate

Owned-probe remediation and its behavioral acceptance checks are implemented on `issue3774`. Final default full tests, format, lint, typecheck, build and focused/repeated/audit checks pass. The earlier full core failures remain tracked in #3790 without entering this scope; they did not recur in the final full run.

Both permitted local review cycles are complete. The findings-only follow-up resolved the owned-probe cleanup finding and validated the current implementation/test diff and recorded command statuses. `tmp/verify3774/findings-followup-20261001/artifact-validation.json` records matching tracked diff and plan, 17 acceptance lanes / 102 cases, 176 checked statuses, all eight final gate exits at 0 and no validation failures. No additional local review or OCR is authorized.

### Authorized release smoke

On October 2, 2026, the user explicitly authorized `lunahigh` in place of the missing `luna` profile. `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` exited 0 and returned a three-line haiku under `[lunahigh:gpt-5.6-luna]`. The detached smoke job has finished. Its log and exit status are `tmp/verify3774/release/smoke-lunahigh-20261002T145352.log` and `.exit`. No profile, credential, configuration or user memory was read or changed. Earlier missing-profile failure artifacts are preserved as historical evidence.

All local completion gates now pass on the unchanged scoped source candidate. Four implementation/test files and this plan comprise the release scope. Commit, push, PR creation and remote CI are outstanding at this plan update. The foreground orchestrator owns CI and CodeRabbit monitoring; no merge will be performed.

### Release base check

An SSH fetch through the existing `github-acoliver` alias found latest `main` at `b2218930e3c18c77463dbd2345039d915ff09722`, one commit after the verified baseline `f3839b8810496490f4eaf8513c27e12bd7952809`. That commit changes profile-auth runtime/tests and the issue #3448 plan, with no overlapping release paths. The candidate retains its verified baseline ancestry without rebasing or incorporating unverified source changes. A merge-tree conflict check will validate the committed candidate against fetched `main` before pushing. Local verification artifacts document evidence only; production code and committed tests do not depend on those ignored logs.
