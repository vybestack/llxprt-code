# Issue #3923: completion delivery and session-clear admission

## Goal and root causes

Terminal notifications lose their wakeup when checked while busy or when a subscription is retired before its queued check. Subscription installation and callback updates do not reconcile existing results. Cancelled task rows are never notification candidates but eviction treats them as unread; an unread oldest result also pins eligible history. Session admission checks shell terminal records rather than independently owned process groups.

## Test-first sequence

1. Add Bun behavior regressions using real managers, reminder generation, notification ownership and shell processes. Demonstrate busy-to-idle delivery without future events, initial pending subscription, immediate/debounce retirement, replacement during delivery, and explicit recovery after delivery failure.
2. Add bounded cancelled-history, protected unread-result and prune-on-ack regressions. Keep active ownership independent of record retention.
3. Extend existing agent/CLI background-clear suites: admission remains blocked by unread/in-flight results, task cleanup, shell group cleanup and client tools, then succeeds after acknowledgement and cleanup. Give category-specific advice without telling users to cancel terminal work.
4. Implement minimal reconciliation through the existing serialized scheduler, history pruning and shell resource admission predicates.
5. Compare baseline and branch test-audit results; run the full verification cycle and smoke profile lunahigh. Record commands, exit codes, test counts and any failures below.

## Constraints and decisions

- Branch issue3923 created from clean, fast-forwarded main. No commits, push or PR in this worker.
- No edits to .llxprt and no unrelated process cleanup.
- Delivery acknowledgement occurs only after successful completion. Failures remain observable through subscription drain and require lifecycle recovery; no retry loop.
- Shell resource ownership includes independently draining groups and live Windows survivors. Terminal/acknowledged history alone does not release resources.
- review skipped per Andrew 2026-10-09. Independent final review belongs to the orchestrator.

## Receipts

- Setup: git status --short; git checkout main; git pull --ff-only; git checkout -b issue3923. Exit 0, clean main, already up to date.
- Current year checked with date +%Y: 2026.
- Baseline audit before edits: bun scripts/test-audit/scan.ts tmp/verify3923/audit-main, exit 0. Logs under tmp/verify3923.

## Risks

Subscription replacement must not duplicate an in-flight batch. Failed deliveries must not accidentally trigger automatic handoff retries. Retention must protect unread completed/failed results while pruning eligible cancelled/acknowledged rows. OS group drain is independent of notice delivery.

## Implementation and regression evidence

- `AsyncTaskAutoTrigger` now reconciles through the existing immediate scheduler on subscription installation and callback updates. A failed delivery latches delivery until another explicit lifecycle update/subscription. The original subscription retains its drain error. Successful delivery still acknowledges only the captured batch and hands off retired subscriptions after the in-flight delivery settles.
- `AsyncTaskManager` prunes cancelled or acknowledged terminal rows in age order, skipping protected unread results rather than stopping at the first one. Acknowledgement immediately enforces retention. Cancellation does not set `notifiedAt`.
- Shell admission now consults independently retained POSIX groups and live Windows survivor handles through `hasPendingWork()`. Existing running-job checks remain. Admission reports blocker-specific advice for running work, task cleanup/delivery, shell cleanup, notices and client tools.
- Added a real-manager Bun suite plus agent and CLI integration cases. The CLI cases exercise actual hook replacement, queue consumption and Agent streaming for both task outcomes and all three shell outcomes. The agent resource test observes a live owned process group after terminal acknowledgement, verifies clear is blocked, then observes ESRCH after cleanup and successful clear.

### Red/green receipts

- `bun test packages/core/src/services/async-notice-recovery.test.ts`: RED exit 1, 1 pass / 14 fail, 32 assertions (`red-core.log`). GREEN exit 0, 15 pass / 0 fail, 60 assertions (`green-core.log`).
- `bun test packages/agents/src/api/__tests__/session-background-clear.behavior.test.ts`: RED exit 1, 6 pass / 2 fail (`red-admission.log`). The terminal-shell case incorrectly admitted clear. The other failing case initially set the history limit before the owner's settings refresh; moving the test's limit setup after launch made it exercise eviction correctly.
- An intermediate agent run failed because the reused OS group polling helper treats transient EPERM during group teardown as fatal. Production already treats EPERM as still-owned. The test now waits on the real shell ownership predicate, bounded by the existing deadline, and independently checks ESRCH afterward. No process cleanup code or unrelated helper was changed.
- Latest combined targeted run: `bun test packages/core/src/services/async-notice-recovery.test.ts packages/agents/src/api/__tests__/session-background-clear.behavior.test.ts`, exit 0, 23 pass / 0 fail, 89 assertions (`green-targeted2.log`).
- Latest CLI run: `bun test packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.background-clear.test.tsx`, exit 0, 7 pass / 0 fail, 70 assertions (`green-cli2.log`). React emits the suite's existing act-environment warnings.

### Initial full-cycle failures and bounded remediation

- `npm run lint` exit 1 (`full-lint-1.log`): new tests exceeded nesting/conditional rules, history pruning had two loop-control statements, and one new assertion used toEqual. Refactored fixture setup, flattened the scenario matrix, used toStrictEqual and one loop break. The remaining errors referenced stale declarations and the telemetry fixture below.
- `npm run typecheck` exit 2 (`full-typecheck-1.log`): the new test used a string instead of `SubagentTerminateMode.GOAL`, now fixed. It also exposed `import.meta.main` in the existing telemetry cleanup fixture, absent from its Node-typed ImportMeta. Main at b34e1a6ea79944e9aee774c3e58eac18a90cbba2 has the same expression. The fixture now narrows the runtime-specific property with `'main' in import.meta` and compares it to true. This one fixture adjustment is needed for required typecheck/lint, without changing checks or configuration.
- Initial `npm run test` encountered stale `packages/test-utils/dist/src/core/config.js`: missing `initializeTestMcpRuntime`/`installTestWorkspaceFilesystem` exports and old calls to removed Config methods such as getPolicyEngine/setModel. The declaration-only build does not refresh JavaScript. Cancelled this obsolete managed run after recording failures and rebuilding; no normal exit was captured. `npm run build` exit 0 (`full-build-1.log`) rebuilt JavaScript. The exact previously failing file then passed: `bun test --preload ./packages/core/bun-preload.ts packages/core/src/lsp/__tests__/e2e-lsp.test.ts`, exit 0, 19 pass / 0 fail, 67 assertions (`stale-helper-proof.log`).
- `npm run format` exit 0 (`full-format-1.log`). No unrelated formatting changes and no .llxprt edits.
- Scoped ESLint after remediation: exit 0 (`scoped-lint2.log`).
- Subsequent full cycles from the rebuilt workspace are recorded below. Each command writes its actual exit status alongside its log under tmp/verify3923.

### Test audit

Baseline was scanned before edits, with branch issue3923 still identical to main. Final branch scan: `bun scripts/test-audit/scan.ts tmp/verify3923/audit-branch`, exit 0. `audit-diff.log` shows only a line-number shift of the existing SELF_CONFIRMING session-identity assertion in the CLI suite (177 to 310). No new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT findings.

### Full test run 2 findings and remediation

- `npm run lint` exit 0 (`full-lint-2.log`).
- `npm run test` exit 1 (`full-test-2.log`): 3004/3007 files passed across the reported runner batches. The CLI batch was 819/822 files, with 10156 passed / 7 failed / 5 skipped / 13 todo test cases. All other batches passed.
- `clearCommand.test.ts` required the running-task message and unread-notice message to be identical. Reproduced directly: `bun test packages/cli/src/ui/commands/clearCommand.test.ts`, exit 1, 7 pass / 1 fail (`red-clear-command.log`). Replaced that obsolete assertion with category-specific assertions, including no cancel advice for a terminal notice. Extended the real command test to deliver the notice through the Agent subscription, then clear successfully. Same command GREEN: exit 0, 8 pass / 0 fail, 44 assertions (`green-clear-command.log`).
- The two layout files had failures from a stale installed Ink patch, not changed layout source. `node_modules/ink/build/ink.js` still replayed `fullStaticOutput` with `clearTerminal` when live height exceeded rows. The tracked `patches/ink+6.4.8.patch` already replaces that branch with `log.clear()`, writing only new static output and the live delta. This exactly explains the repeated old-history markers and tripled new-output marker in the failures. No layout source, assertions, tracked patch or manifest was changed.
- `bunx patch-package --error-on-fail` initially exited 1 because the installed package contained an older partially matching patch (`dependency-patches.log`). Restored only declared dependency @jrichman/ink@6.4.8 from its npm tarball (`npm pack @jrichman/ink@6.4.8 --ignore-scripts --pack-destination tmp/verify3923`, exit 0), then applied the repository's existing patches. `bunx patch-package --error-on-fail` exit 0 (`dependency-patches-clean.log`). The package tarball shasum is cfb54fe90975958daeaa709c9199a4e2bb421d55.
- In packages/cli, `bun test src/ui/layouts/default-app-layout.resize.test.tsx` now exits 0: 6 pass / 0 fail, 25 assertions (`green-layout-resize.log`). The cap suite is recorded in `green-layout-cap.log`. These are dependency-restoration checks, not weakened tests or blind retries.
- Started a fresh complete cycle after these corrections: full-test-3, full-lint-3, then full-typecheck-3, full-format-3, full-build-3 and the exact lunahigh smoke request. The unused waiting cycle-2 chain was cancelled before it ran any typecheck/format/build/smoke command.
- Repeated test-audit after the command-test correction: exit 0 and still only the existing CLI assertion's line shift, with no new findings.

### Cycle 3 receipts and remaining failure tracking

- `npm run test` exit 1: 3006/3007 reported file executions passed. CLI was 821/822 files, 10160 passed / 3 failed / 5 skipped / 13 todo test cases. All #3923 suites and both restored layout suites passed. Only `src/utils/sandbox-podman-diagnostics.test.ts` failed. `final-test-summary.json` records each batch.
- Podman failures: overlap readiness-to-result 1152 ms against the unchanged <1000 ms assertion; ENOENT reading fixture ssh.pid after the bridge returned; and an oversized SSH diagnostic case receiving the readiness timeout. This unchanged file passed in cycle 2. No Podman code, tests, deadlines or retries were changed. Existing #3853 documents the missing two-party overlap fixture barrier and unresolved original OS launch-delay cause. Added these receipts to https://github.com/vybestack/llxprt-code/issues/3853#issuecomment-6325489113 after verifying GitHub identity as acoliver. Load observed afterward was 21.60/21.48/16.56; that alone does not establish the OS cause. Do not treat a later passing run as erasing the failed aggregate.
- `npm run lint` exit 0, `npm run format` exit 0, `npm run build` exit 0.
- `npm run typecheck` exit 2: TypeScript does not retain property narrowing across repeated `import.meta` expressions. The fixture's guard now binds `const entrypoint = import.meta` before narrowing its runtime-specific `main` property. `bunx tsc --noEmit -p packages/cli/tsconfig.noemit.json` then exits 0 (`scoped-typecheck-fixture.log`). This is a test-fixture type correction, with no ambient-type change or check exclusion.
- `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` exit 0 (`full-smoke-3.log`), actual identity `[lunahigh:gpt-6-luna]`, returned a three-line haiku.
- Restored cap suite proof: in packages/cli, `bun test src/ui/layouts/default-app-layout.cap.test.tsx`, exit 0, 15 pass / 0 fail, 7268 assertions (`green-layout-cap.log`).
- Ran all six required commands again as cycle 4 after the fixture type correction. This run was required by the full-cycle-after-fixes rule, not a retry intended to qualify away #3853.

## Final verification: cycle 4

All commands ran from the repository root on the final code state. Logs and actual exit receipts are under `tmp/verify3923/`.

| Command | Exit | Receipt |
| --- | --- | --- |
| `npm run test` | 0 | `full-test-4.log`, `full-test-4.exit`: 3007/3007 reported file executions passed across 18 batches. CLI: 822/822 files, 10163 passed / 0 failed / 5 skipped / 13 todo test cases. |
| `npm run lint` | 0 | `full-lint-4.log`, all 18 partitions completed. |
| `npm run typecheck` | 0 | `full-typecheck-4.log`: declaration build, workspace checks and scripts/evals checks completed. |
| `npm run format` | 0 | `full-format-4.log`: no unrelated source changes. |
| `npm run build` | 0 | `full-build-4.log`: source/compiled lazy-MCP coherence verified. |
| `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` | 0 | `full-smoke-4.log`: `[lunahigh:gpt-6-luna]`, returned a three-line haiku. |

The final audit still has no new findings. The final `git diff --check` passed. The branch remains `issue3923` with no commits, push, PR or review. No `.llxprt`, manifest, lockfile, workflow or enforcement change is present. No intel processes or unrelated orphan PTYs were touched.

The cycle-3 Podman aggregate remains a recorded failure associated with existing #3853. Its later pass does not establish that the timing defect is fixed. Windows survivor admission uses existing original-child ownership checks; the new real-process regressions were executed on macOS, not Windows. Failed notification deliveries still retain their original drain error after successful lifecycle recovery, preserving failure visibility at disposal.

### Draft commit message

`fix(async): prevent stranded notices from blocking clear (Fixes #3923)`

### Handoff

Implementation is ready for the independent final review. Include the new core test and this plan when staging; both are currently untracked. Review was not run by this worker: review skipped per Andrew 2026-10-09.


## Final-review P1 remediation: discarded submissions were acknowledged

The independent finding reproduced data loss using the real Agent, TaskLaunchOwner and production queue. A failed-task notice was queued but never sent. Queue unmount called `onConsumed`, which resolved delivery and caused the trigger to mark the task notified. History stayed empty and clear was incorrectly admitted. Original receipt: `tmp/verify3923/review-undelivered-agent-probe.log`. The previous abort-before-send test also asserted that the unread result disappeared after an aborted runner settled; that expectation is corrected.

### Protocol and lifecycle decisions

- Replace `onConsumed` with typed `onSettled(SubmissionOutcome)`: completed, discarded, cancelled, or failed with the original error. Clear and queue unmount settle as discarded. Reserved-but-not-started notice drains settle as discarded too. An in-flight notice aborts on hook unmount and retains delivery ownership until execution settles.
- Only completed settlement resolves the notice delivery promise. Discard/cancellation rejects with its status, and failure rejects with the original error. This releases ownership without marking the result notified. The unread result continues blocking clear until actual recovery delivery.
- Return stream outcomes through the internal submission executor. Preparation that declines to send is discarded; handled stream rejection is failed; abort is cancelled even if the runner returns normally. The production Agent event consumer also returns failure for terminal error/idle-timeout events rather than treating ordinary iterator exhaustion as success. Existing public submitQuery callers still receive Promise<void>; their provider error rendering and preparation rejection behavior remain unchanged.
- Keep ordinary user-message retry behavior for unexpected executor rejection. Notice rejection settles immediately, without the queue retry loop. Submitter-not-ready retries retain their existing bounded behavior and settle failed at exhaustion.
- Keep the CLI subscription stable across busy/idle renders. Idle transitions call the subscription's serialized `schedule()` check, which does not reset its failure latch. Resubscribing on every busy/idle render reset that latch and retried a failed notice automatically; a new real-hook regression demonstrated two attempts instead of one.
- Track explicit lifecycle recovery generations in AsyncTaskAutoTrigger. A replacement installed while the old delivery is still settling gets one scheduled recovery opportunity afterward. An ordinary failure without explicit replacement stays latched and visible in its original drain. This avoids losing an explicit recovery request behind the in-flight serialization gate.
- Retain the existing task owner error policy: retired subscription drains remove their pending ownership on either fulfillment or rejection, while preserving rejected drains in the owner's cleanup errors. The integration tests assert hasPendingWork becomes false, unread results still block clear, successful replacement unblocks clear, and join still reports the original delivery failure. The new schedule method forwards to the same owned subscription; it does not create a second delivery owner.
- Preserve the original #3923 retention, shell-resource ownership and admission implementation. No enforcement, workflow, manifest, lockfile or .llxprt changes. No OCR, commit, push or PR.

### Remediation red/green receipts

All paths below are under `tmp/verify3923/`.

- `remediation-red-cli.log`, exit 1: initial real-queue regressions exposed the loss, but their cleanup expectation was incorrectly applied to buildAgent's cleanup helper, which intentionally swallows dispose errors. The test now asserts the real task owner join directly. The initial queue-ready wait also observed launch ownership before delivery enqueue; it now waits on the actual queued submission (or stream attempt). These were fixture corrections, not retries of an unexplained failure.
- `remediation-red-discard-mutation.log`, test exit 1: restoring only discard-as-completed settlement in the otherwise corrected production queue makes both real-Agent unmount/clear-before-send cases fail at the unread-result assertion, expected 1, received 0. The corrected source was restored in a finally block. This gives a direct loss-specific red receipt without the initial cleanup masking.
- `remediation-red-core.log`, exit 1: 15 pass / 1 fail, 62 assertions. Replacement-before-rejection left one unread result stranded instead of delivering it. The generation-aware handoff fixes this race.
- `remediation-red-event.log`, exit 1: 10 pass / 1 fail, 133 assertions. Exhausting the real FakeProvider fixture produced a terminal Agent error event and a normal iterator return; the notice was falsely acknowledged. The production event consumer now propagates a typed failure outcome without duplicate UI error handling.
- `remediation-red-idle.log`, exit 1: a failed notice was attempted twice across normal busy/idle rendering. Stable subscription plus non-resetting scheduled checks keeps it at one attempt.
- `remediation-green-final.log`, exit 0: 62 pass / 0 fail, 299 assertions across the real queue/CLI notice suite, queue business behavior, core notice recovery, task owner notice ownership and Agent background-clear admission. Includes queued unmount, queued clear, reserved-before-start unmount, stream rejection, terminal Agent error events, abort-before-send, once-only recovery, drain error visibility and successful clear only after actual delivery.
- `remediation-consumers-3.log`, exit 0: 15 isolated existing submission/event/queue files, 124 pass / 0 fail, 602 assertions, before the additional reserved-before-start case. Explicit `./` paths are necessary for Bun to execute the .bun.tsx files. The earlier root-relative glob invocation ran only five discovered .test.tsx files; the shared runner invocation with --workspace cli found no root because CLI uses its own runner. The full npm run test cycle uses that existing CLI runner and its complete discovery.
- `remediation-prebuild.log`, exit 1: TypeScript found an uninitialized stream outcome on the thrown-error path. The outcome now initializes explicitly before execution. `remediation-prebuild-2.log`, exit 0, rebuilt the workspace after the correction.
- Scoped lint initially rejected function length, nested ternary, conditional assertions and else-after-return. Settlement/finalization helpers and unconditional state assertions satisfy the existing limits. The void-return runner seam needed explicit type normalization rather than contradictory nullish-coalescing lint suggestions. `remediation-lint-scoped-4.log`, exit 0.
- AST scanner: `remediation-audit.log`, exit 0; comparison in `remediation-audit-diff.log` against the original pre-edit `audit-main/findings.tsv`. No new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT findings. The old session-identity SELF_CONFIRMING entry only moved. New DUP_ASSERT entries represent assertions of the same invariant at separate lifecycle stages (before send, after discard/abort, and after recovery/clear), including zero early acknowledgements across dequeue and requeue.

The first post-remediation verification job `shell_39771368a0f5` was cancelled during npm run test, before the later commands ran, because outcome tracing found another path in the same finding: Agent max-turns can return normally without sending the notice. `remediation-red-turn-limit.log`, exit 1, demonstrates the unread result disappearing (expected 1, received 0) using a real Agent configured with maxSessionTurns 1 after one ordinary turn. Non-success done reasons now settle cancelled; stop and refusal retain completed delivery, and a preceding structured error remains failed. `remediation-green-final-2.log`, exit 0: 63 pass / 0 fail, 307 assertions across the same five suites. `remediation-lint-scoped-5.log`, exit 0. No normal exit is claimed for the cancelled partial test run in `remediation-full-test-1.log`.

Post-remediation cycle 2 completed as managed job `shell_98e82d8837d0`. `npm run test`, lint, format, build and the exact lunahigh smoke request all exited 0. Full tests: 3007/3007 reported file executions across 18 batches; CLI 10170 passed / 0 failed / 5 skipped / 13 todo cases. Aggregation receipt: `remediation-full-test-2-summary.json`. `npm run typecheck` exited 2 because the existing loop-integration test harness explicitly declared the old Promise<void> runner return. Its result.current now derives ReturnType<typeof useAgentEventStream>, without changing any assertion or runtime test logic. The fixture passes 5 tests / 26 assertions (`remediation-loop-fixture.log`), scoped lint passes (`remediation-loop-fixture-lint.log`) and the complete CLI typecheck passes (`remediation-cli-typecheck.log`). The earlier full typecheck failure remains recorded in `remediation-full-typecheck-2.log`.

All six commands run again after that final type-only fixture correction, sequentially as managed job `shell_724171a55259`, with `remediation-full-*-3.log` and matching `.exit` receipts. Results follow below.

### Final post-remediation verification: cycle 3

Every required command exited 0 on the final source and fixture state. All receipt paths are under `tmp/verify3923/`; each log has a matching `.exit` file.

| Command | Exit | Receipt |
| --- | --- | --- |
| `npm run test` | 0 | `remediation-full-test-3.log`: 3007/3007 reported file executions across 18 batches. CLI: 822/822 files, 10170 passed / 0 failed / 5 skipped / 13 todo cases. Aggregate: `remediation-full-test-3-summary.json`. |
| `npm run lint` | 0 | `remediation-full-lint-3.log`: all 18 partitions completed. |
| `npm run typecheck` | 0 | `remediation-full-typecheck-3.log`: declaration build, workspace checks and scripts/evals checks completed. |
| `npm run format` | 0 | `remediation-full-format-3.log`. |
| `npm run build` | 0 | `remediation-full-build-3.log`: compiled/source lazy-MCP coherence verified. |
| `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` | 0 | `remediation-full-smoke-3.log`: actual identity `[lunahigh:gpt-6-luna]`, returned a three-line haiku. |

Final audit: `bun scripts/test-audit/scan.ts tmp/verify3923/audit-remediation-final`, exit 0, receipt `remediation-audit-final.log`; full comparison `remediation-audit-final-diff.log`. Counts before/after: MOCK_MIRROR 173/173, ALWAYS_TRUE 13/13, SELF_CONFIRMING 274/274, NO_ASSERT 98/98. The seven additional DUP_ASSERT entries check repeated lifecycle invariants at distinct stages. No new prohibited category findings.

Remediation production files are the queue protocol/store, submission execution and stream outcome handlers, stable notification scheduling, core recovery generation/handoff, and the owned subscription schedule forwarding through Agent tasks. Tests use the real production queue, Agent and TaskLaunchOwner; existing fake-Agent helpers and one integration harness type were aligned with the typed protocol. Original retention, shell resource and admission changes remain intact.

No remaining #3923 implementation or verification failure is known. Failure drains intentionally stay observable after recovery; the tests prove that they no longer keep hasPendingWork permanently true or falsely acknowledge unread results. React act warnings remain test-harness output. The original recorded #3853 timing issue and macOS-only coverage of the new real-process regressions remain limitations, without claiming Windows execution or a Podman timing fix. The independent follow-up review is still pending and must stay limited to the original acknowledgement scope and P1 finding. No separate broad review or OCR was run by this worker. No commits, pushes, PRs, .llxprt edits or check weakening.

## PR #3924 targeted CI and CodeRabbit remediation

Scope is limited to the failed runtime-boundary check and threads PRRT_kwDOPB5qbc6u-RnM and PRRT_kwDOPB5qbc6u-RnX. No further independent review or OCR is requested or run. No commit or push is authorized for this worker.

### Diagnoses and decisions

- Captured job 119513462786 from run 39683973341 in `tmp/verify3923/ci-lint.log`. The failing step is `npm run check:runtime-boundary`, not ESLint. CLI `runtime-service-bag-parameter` rises from 553 to 554 and `runtime-service-bundle` from 775 to 776, with no compiler diagnostics or unratcheted findings. The new `finaliseStreamOutcome` helper accepts the entire SubmitQueryCallbackDeps bundle although it uses only operationLifecycle. Narrow its argument to that lifecycle dependency. Leave the ratchet baseline and enforcement unchanged.
- Thread RnM is valid: discard and cancellation reject through the same path as provider failure, latching the trigger permanently in the production subscription. Replacement-only recovery tests do not demonstrate recovery in the mounted CLI. Introduce a typed `void | 'deferred'` delivery result across Agent tasks, owner and trigger. Completed delivery still acknowledges the captured batch. Deferred delivery exits the drain without acknowledgement or cleanup error. Actual rejection still latches failure and remains visible through the owned subscription drain.
- A deferred batch waits for an explicit idle opportunity, rather than retrying on unrelated background terminal events. The mounted hook records the busy generation at deferral. It schedules recovery only after a subsequent busy-to-idle opportunity, excluding the cancelled turn's own idle transition. Cancellation while already idle also waits for a new busy-to-idle opportunity. This avoids max-turns cancellation loops. A separate opportunity generation in the trigger preserves a valid schedule arriving while the old owned delivery is still unwinding, without resetting a genuine failure latch.
- Thread RnX is valid: a rejected group drain retains its POSIX group and sets ownershipLost permanently. Waiting cannot make that state healthy. Expose the existing state through ShellJobManager and ShellJobOwner and prioritize restart guidance in admission. Retain wait-for-drain guidance for healthy active cleanup. Do not change supervision or release uncertain ownership.

### Test-first evidence

- `ci-red-deferred.log`, exit 1: all three mounted production-hook cases (queue clear, cancellation while busy, cancellation while idle) leave one unread result after a subsequent busy-to-idle transition, instead of delivering it. These tests keep the same Agent task subscription throughout and do not replace subscribeNotifications.
- `ci-red-ownership.log`, exit 1: a real shell supervisor completes, but an injected EPERM at the OS process-group probe prevents drain confirmation. Admission incorrectly advises waiting after cancel reports the real drain error. The test uses the real Agent, shell owner, manager and group implementation, restoring process.kill in finally.
- `ci-red-deferred-handoff.log`, exit 1: an explicit idle opportunity scheduled while a deferred delivery is still settling is lost. Expected two attempts, received one. The separate opportunity generation preserves that request while retaining failure semantics.
- `ci-green-1.log`, exit 0: 44 tests across four focused suites pass before the additional handoff and real-provider busy/idle assertions. Scoped lint identified conditional assertions, nested test control flow and inconsistent helper returns; source/test structure was corrected without weakening rules.

### Targeted verification and audit

- `ci-green-2.log`, exit 0: 74 pass, 0 fail, 391 assertions across six focused suites: production hook/queue, Agent background admission, core recovery and lifetime, task-owner notices, and queue settlement. Includes real Agent provider error and max-turns outcomes across busy/idle rendering, with one attempt and no acknowledgement. The same mounted subscription recovers clear/cancel cases once, then admits a new session only after actual delivery.
- `ci-core-final.log`, exit 0: 18 pass, 0 fail, 75 assertions after making both return paths explicit in the two new delivery callback fixtures to satisfy the existing consistent-return lint rule. `ci-core-lint-final.log`, exit 0. `ci-scoped-lint-2.log` retains that pre-correction lint failure; it is not claimed as passing.
- `ci-prebuild.log`, exit 0: workspace build and source/compiled lazy-MCP registry coherence passed.
- `ci-boundary-before.log/.exit` reproduces the failed ratchet, exit 1. `ci-boundary-after.log/.exit` passes the exact CI audit with `--baseline scripts/runtime-service-shape-baseline.json`, exit 0, all scanners complete, no increases, no unratcheted findings and no compiler diagnostics. CLI counts are restored to 553 service-bag parameters and 775 service bundles. `ci-boundary-summary.json` records both. The detailed raw audit JSON includes existing baseline findings; use the command's ratchet verdict and exit receipt for pass/fail.
- `ci-lint-aggregate.log` confirms job 119515792158 fails because the JavaScript lint dependency failed, with no second root cause.
- `ci-audit-final.log`, exit 0, and `ci-audit-summary.json` compare the final AST scan against `audit-remediation-final/findings.tsv`, the pre-CI-remediation scan. Ignoring line shifts, there are no new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT findings. Counts remain 173, 13, 274 and 98 respectively, also matching the original audit-main baseline. Four new DUP_ASSERT entries check invariants at distinct lifecycle stages: no early retry, ownership released before and after recovery, no retry from the cancelled turn's idle render, and restart guidance before and after restoring the external OS probe.

### Final CI-remediation verification cycle

Managed job `shell_88089e175c44` completed the required six commands in order on the final source/test state. All paths in the table are relative to `tmp/verify3923/`; each log has a matching `.exit` receipt containing 0.

| Command | Exit | Receipt |
| --- | --- | --- |
| `npm run test` | 0 | `ci-full-test-1.log`, `ci-full-test-1-summary.json`: 3007/3007 reported file executions across 18 batches. CLI: 822/822 files; 10173 passed, 0 failed, 5 skipped, 13 todo cases. |
| `npm run lint` | 0 | `ci-full-lint-1.log`: all 18 partitions completed. |
| `npm run typecheck` | 0 | `ci-full-typecheck-1.log`: declaration build, workspace checks, scripts and evals checks completed. |
| `npm run format` | 0 | `ci-full-format-1.log`: no unrelated tracked files changed. |
| `npm run build` | 0 | `ci-full-build-1.log`: compiled/source lazy-MCP coherence verified. |
| `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` | 0 | `ci-full-smoke-1.log`: actual identity `[lunahigh:gpt-6-luna]`, returned a three-line haiku. |

The separate exact CI runtime-boundary ratchet also exits 0, as recorded above. Full tests contain deliberate failing subprocess fixtures used to test timeout/error classification; their enclosing tests and all reported workspace file batches passed. There was no manual retry of a failing full-cycle check.

The working branch remains `issue3923` at `d834bc703`, with these remediation changes uncommitted and unpushed. Both review findings are addressed locally; the orchestrator owns thread replies/resolution and the later commit/push. Remote PR checks still describe the pushed commit until then. No `.llxprt`, workflow, ratchet baseline, lint rule, test threshold, manifest or lockfile changed. No independent review was launched. OCR review skipped per Andrew 2026-10-09. The OS ownership regression ran on macOS and is POSIX-only; no Windows execution is claimed.

Draft commit message: `fix(async): recover deferred notices on later idle turns (Fixes #3923)`.

Suggested body: Keep discarded and cancelled batches pending until a later idle opportunity without retrying provider failures. Preserve owned delivery handoff, report lost shell ownership as a restart requirement, and narrow stream finalization to its actual lifecycle dependency so the CI boundary ratchet passes.

## PR #3924 render-phase finding: committed idle gates

Scope: thread `PRRT_kwDOPB5qbc6u_PDZ` only, starting from clean pushed `992271fea`. No further independent review, OCR, commit or push is authorized for this worker.

### Disposition and mechanism

The finding is valid for the production hook under React suspension. `useSubmitQueryEffects` wrote its live subscription's busy predicate and busy-opportunity counter during render. `useScheduleNext` independently wrote the queue scheduler's streaming-state ref during render. The stable submission executor also wrote `latestCbdRef` during render and read its streamingState when deciding whether to requeue. A busy render that suspends can therefore poison three live gates while the last committed hook state remains idle.

The regression uses the existing Ink-backed renderHook, actual `useSubmitQuery`, `useQueuedSubmissions`, Agent, task owner and notification subscription. It starts with committed idle, renders busy and throws an unresolved promise after invoking the hooks, then completes a task while that busy render remains suspended. A commit-effect witness remains idle. The expected behavior is one actual Agent delivery, history containing the task failure, acknowledgement after delivery and successful session clear. This is a behavioral reproduction with the installed React 19 / Ink renderer, not a simulated ref or static assertion. Installed Ink creates a LegacyRoot; the test does not assume ConcurrentRoot or substitute a DOM renderer. The test adds a Suspense boundary as the interruption harness. No existing shipped AppContainer suspension path or live-user occurrence is claimed.

### Fix and effect ordering

- Commit the subscription's streaming state and busy-opportunity transition in an effect registered before its idle scheduler and subscription effects. The deferred-opportunity comparison and original settlement protocol are unchanged.
- Commit the queue scheduler's streaming state in useScheduleNext. This effect registers before useSubmitQueryEffects, so the latter's idle scheduler sees committed idle rather than the preceding busy state.
- Commit the stable executor's latest dependency snapshot before the notification/idle effects. Fixing only the other two refs still leaves the executor requeuing against an uncommitted busy snapshot; the intermediate failing receipt below confirms this part of the same delivery path.
- Remove four redundant local-useRef entries from the scheduler callback dependency array to keep the function within the existing 80-line lint limit. Those ref identities never change. No rule, limit or baseline was altered.

### Test-first and local receipts

All paths in this section are under `tmp/verify3923/render-phase-20261021/`.

- Pre-change AST baseline: `bun scripts/test-audit/scan.ts tmp/verify3923/render-phase-20261021/audit-before`, exit 0.
- RED `red-suspended.log/.exit`: the new regression against unchanged production code exits 1, 0 pass / 1 fail. Expected zero unread results after delivery; received one while only idle had committed.
- Intermediate RED `red-executor.log/.exit`: the same regression still exits 1 after fixing the subscription and scheduler refs only. Moving latestCbdRef into its commit effect then makes the regression pass.
- GREEN `green-suspended.log/.exit`: exit 0, 1 pass / 0 fail, 9 assertions. One real Agent delivery occurs while busy remains suspended, then session clear succeeds.
- A separate exploratory cancellation/opportunity case passed even with render-time opportunity bookkeeping (`red-opportunity.log`, exit 0). It did not distinguish the defect because no new idle effect runs when the last committed streaming state stays idle. That non-distinguishing test was removed; it is not presented as red proof.
- `green-targeted.log` exits 0 but Bun discovers only three of its six named paths, 45 pass / 0 fail. The corrected explicit path list in `green-targeted-2.log/.exit` discovers all six suites: 75 pass / 0 fail, 399 assertions. They cover mounted deferred recovery, cancellation, real provider failure with no loop, max-turns cancellation, queue settlement, task-owner lifetime, no premature acknowledgement and clear admission.
- Scoped lint initially rejected useScheduleNext at 83 lines (`scoped-lint-1.log` and `scoped-lint-2.log`, exit 1). Removing redundant stable-ref dependencies satisfies the unchanged limit. `scoped-lint-3.log/.exit` exits 0 for both changed code/test files.

### Full verification

The required six-command cycle, exact CI runtime-boundary command and final AST scan completed sequentially as managed background job `shell_d18b286efa93`. Logs and matching per-command exit files use this section's unique directory. The full test gate is not green; its failure is retained below rather than replaced by a retry.

| Command | Exit | Receipt |
| --- | --- | --- |
| `npm run test` | 1 | `full-test-1.log/.exit`, `full-test-1-summary.json`: 2999/3000 reported file executions passed across 17 batches. Agents: 551/552, scanner ENOENT described below. CLI: 822/822 files; 10174 passed, 0 failed, 5 skipped, 13 todo cases. |
| `npm run lint` | 0 | `full-lint-1.log/.exit`: all 18 partitions completed. |
| `npm run typecheck` | 0 | `full-typecheck-1.log/.exit`: declaration build, workspaces, scripts and evals. |
| `npm run format` | 0 | `full-format-1.log/.exit`: only targeted code/test and issue-plan paths changed. |
| `npm run build` | 0 | `full-build-1.log/.exit`: compiled/source lazy-MCP coherence verified. |
| `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` | 0 | `full-smoke-1.log/.exit`: actual identity `[lunahigh:gpt-6-luna]`, three-line haiku. |
| `npm run check:runtime-boundary` | 0 | `runtime-boundary-1.log/.exit`: exact CI command, unchanged baseline, no increases, no unratcheted findings, zero compiler diagnostics, all scanners complete. |
| `bun scripts/test-audit/scan.ts tmp/verify3923/render-phase-20261021/audit-after` | 0 | `audit-after.log/.exit`, `audit-summary.json`: no new prohibited findings compared with the pre-change snapshot. |

AST counts before/after are unchanged for MOCK_MIRROR 173/173, ALWAYS_TRUE 13/13, SELF_CONFIRMING 274/274 and NO_ASSERT 98/98. One new DUP_ASSERT checks committed idle before and after notice delivery while busy remains suspended. All other findings are unchanged after ignoring line shifts. Combined receipts are in `verification-summary.json`; its summary process exits 1 because the recorded full-test exit is 1, not because the AST comparison failed.

### Full-suite failure: scratch-directory traversal race

The sole failing file is untouched `packages/agents/src/api/__tests__/boundary.no-internals-subpath.test.ts`. Its source-tree walk includes package-local tmp directories and does `readdirSync` followed by stat/recursive traversal without a consistent snapshot (lines 54-59 and 81-90). At `full-test-1.log:36672-36674`, the scan throws ENOENT reading `packages/agents/tmp/child-shell-owner-61NQgc`. The log interleaves that failure with the actual child-shell test completing. That fixture creates the directory at `async-child-background-isolation.behavior.test.ts:479` and removes it in finally at lines 532-535. `helpers/scratch-dir.ts:16-21` explains the package-local tmp placement. The varying input is the directory's existence during concurrent cleanup, not an import assertion or the notice hook.

Filed the source/log evidence as [issue #3927](https://github.com/vybestack/llxprt-code/issues/3927) after verifying GitHub identity as acoliver. No scanner code, enforcement rule, assertion, concurrency setting or fixture was changed. No full-suite retry was run. This failure remains a verification limitation for the remediation.

After identifying the changing input, ran that exact boundary test with its concurrent scratch-directory producer finished: from packages/agents, `bun test src/api/__tests__/boundary.no-internals-subpath.test.ts`, exit 0, 5 pass / 0 fail / 5 assertions (`boundary-stable-input.log/.exit`). This controlled stable-input result does not erase the failed aggregate. The agents package script's failing predecessor also skipped its seven-file native tail through `&&`; executing the previously unrun tail with `bun ../../scripts/run_bun_tests.ts --workspace agents` exits 0, 7/7 files (`agents-skipped-tail.log/.exit`).

Final tracked scope remains the production hook, its existing background-clear regression file and this issue plan. HEAD stays `992271fea`; no commit or push occurred. No .llxprt, workflow, baseline, manifest, lockfile or enforcement changes, no independent review and no OCR. The finding is fixed locally, but the required full-test aggregate must not be reported as passing.

Draft commit message: `fix(async): use committed state for notice delivery (Fixes #3923)`.

Suggested body: Keep suspended busy renders from changing the live notice subscription, queue scheduler or submission executor. Update their state snapshots in commit effects before idle scheduling so pending completions still reach the Agent and unblock clear after delivery.


## Issue #3927: relocate concurrent scratch inputs before final verification

The failed aggregate above remains the original failure receipt. Remediation is limited to the fixture producer and its ownership regression. The committed-state hook fix and regression are unchanged.

### Root cause and ownership decision

- Read #3927 and all six existing consumers of `helpers/scratch-dir.ts`. The default `resolve('tmp')` depends on each Bun child's working directory. The agents runner uses the package root, placing mutable fixture state under `packages/agents/tmp`, within the boundary scanner's unchanged `packages` root.
- The shell and child tests use the returned path as a working/config directory, log root or marker location, then remove it in their existing teardown/finally blocks. They resolve executable source fixtures separately through `resolveRepositoryFixture`; none requires scratch content to participate in source scanning. The profile test's explicit prompt parent resolves to repository-root `tmp/session-client-owner-consolidation`, already outside all four scan roots, and stays supported unchanged.
- Use `os.tmpdir()` as the helper's default. Both package and shared Bun runners already create unique sessions and pass `buildSessionEnv` to children, setting TMPDIR/TEMP/TMP to the session's temp root. This makes scratch lifecycle belong to the existing runner session while preserving unique mkdtemp suffixes, immediate caller cleanup, explicit parent creation and direct Bun execution's OS-temp fallback. No new session mechanism or shared global path is needed.
- The boundary scanner itself is untouched: the same four source roots, directory skips, forbidden reference check, import/export assertions and error propagation remain. No ENOENT catch, retries, test concurrency changes, threshold changes or baseline edits.

### Test-first receipts

All receipts in this section use `tmp/verify3923/scratch-root-20261021-2104/`.

- `red-scratch.log/.exit`, exit 1: 1 pass / 3 fail / 9 assertions against the unchanged helper, executed from packages/agents. Default ownership and session ownership both resolve to package-local tmp instead of the OS/session temp root. During an actual unchanged boundary scan, concurrent scratch create/write/remove cycles also remain inside the scanned packages root. The deterministic path assertions expose the invalid input even when the race does not throw on that run.
- `green-scratch.log/.exit`, exit 0: 4 pass / 0 fail / 18 assertions after changing the default root. Covers unique caller-owned paths outside all scan roots, independent Bun session environments and session cleanup, explicit missing-parent creation and caller cleanup, and an actual unchanged five-assertion boundary scan concurrent with repeated scratch creation/write/removal. No scanner implementation is mocked or copied.
- `scoped-lint-1.log/.exit`, exit 1: TypeScript lint treats a local boolean mutated only from a completion callback as always truthy. Store that lifecycle state in an object so the condition is typed as mutable, without adding a suppression or changing concurrency. `scoped-lint-2.log/.exit`, exit 0 after that test-only correction and scoped formatting.
- `audit-before.log/.exit`, exit 0: pre-change AST snapshot captured before adding the scratch regression. `committed-state-before.diff` preserves the incoming hook/test diff for a final byte comparison.

The full consumer run and required verification cycle follow below. #3927 stays open until final PR linkage; no issue closure, review/OCR, commit or push is authorized in this worker.


### Remaining direct producers: same changing-input mechanism

A source search before accepting the full-cycle result found three additional agents tests bypassing the helper. Their package-local scratch directories/files are also removed during teardown, so fixing only the named child-shell producer would leave the same scanner-input defect elsewhere.

- `workspace-checkpoint-lifetime.behavior.test.ts` now obtains its unique project/data root through `makeScratchDir`; its Git-backed checkpoint and borrowed-owner assertions and teardown remain intact.
- `recording-tool-hook-owner.behavior.test.ts` now owns a unique scratch root containing hook output, actual tool-written files and a substituted copy of its existing JSONL fixture. The original template stays unchanged. Set the fixture's working directory to that root and substitute JSON-escaped absolute scratch paths, because FakeProvider's existing `{{CWD}}` substitution uses process.cwd rather than the Agent working directory. Do not chdir, change provider code or alter the tool results/assertions. Dispose both recording owners before deleting the scratch root, as before.
- `model-tool-fixture.behavior.test.ts` now places its physical input in a unique scratch root and passes that root through the fixture's existing targetDir option. Its real ReadFileTool publication/execution assertions remain, with root cleanup after fixture-owner teardown.
- Added location assertions to those existing tests before relocation. RED receipts `red-direct-<filename>.log/.exit`: checkpoint 0 pass / 4 fail / 4 assertions, recording hook 0 pass / 1 fail / 1 assertion, model fixture 0 pass / 1 fail / 1 assertion. Each fails because its actual scratch path contains the agents package source root.
- GREEN receipts `green-direct-<filename>.log/.exit`: checkpoint 4 pass / 20 assertions, recording hook 1 pass / 10 assertions, model fixture 1 pass / 3 assertions, scratch ownership/concurrent scanner 4 pass / 18 assertions; all exit 0. Existing behavior assertions were retained, with only the location assertions added. The new regression's path-containment predicate also recognizes cross-drive absolute relative paths on Windows; no Windows execution is claimed.
- The earlier seven-suite consumer run completed as managed job `shell_15e895804504`, all exit 0: 32 pass / 0 fail / 436 assertions. Receipts are `target-<suite>.log/.exit`, with `target-all.exit` containing 0.
- Managed cycle `shell_cd3747fb9fe8` was cancelled during its first test command after locating the three direct producers, before accepting any final aggregate. Its `full-test-1.log` is a partial receipt; no completed test exit is claimed. No subsequent command in that cycle ran. A complete cycle on all relocated producers uses `full-*-2` receipts below.
- Scoped lint's third pass had no errors and one warning for a cleanup hook outside describe. Moved the hook into its existing describe block; no lint configuration was changed. Final scoped lint and all full-cycle results follow.


### Complete cycle 2 and test typing correction

Managed job `shell_9682852ad6aa` completed the eight-command cycle. `full-test-2.log/.exit` passes 3008/3008 reported file executions across 18 batches: agents 553/553 plus its seven-file native tail, CLI 822/822 files and 10174 passed / 0 failed / 5 skipped / 13 todo cases. `full-lint-2`, `full-format-2`, `full-build-2`, `full-smoke-2`, `runtime-boundary-2` and `audit-final` all exit 0 with matching log/exit receipts. This cycle's aggregate is not green because `full-typecheck-2.log/.exit` exits 2.

The typecheck failure is confined to two global `Bun.spawn` references in the new scratch regression. The agents package intentionally typechecks its source under Node types, with only bun:test declarations included. An explicit Bun namespace import was tested separately (`agents-typecheck-import.log/.exit`, exit 2), but loading Bun's ambient globals changes fetch/stream types throughout the imported Node-typed program. Do not change that program's types or unrelated provider code. Instead, use the adjacent suites' existing `node:child_process` API to launch the same Bun executable and capture its actual completion/output. The test remains a native bun:test suite, with identical ownership assertions, source roots, concurrent lifecycle loop, boundary subprocess and cleanup behavior. No test assertion is removed or weakened.

`agents-typecheck-final.log/.exit` now exits 0 for both existing agents TypeScript projects. `scoped-lint-final-2.log/.exit` exits 0 with --max-warnings 0. `green-scratch-final.log/.exit` exits 0, 4 pass / 0 fail / 18 assertions. A complete cycle after this test-only transport correction follows in `full-*-3`, `runtime-boundary-3` and `audit-final-3` receipts. The earlier failed typecheck and explicit-import probe are retained.


### Final verification after scratch relocation

Managed job `shell_70daab9a9b6a` completed sequentially with exit 0. Every command below has a matching `.log` and `.exit` under `tmp/verify3923/scratch-root-20261021-2104/`; all eight exit receipts and `cycle-3.exit` contain 0.

| Command | Exit | Receipt and result |
| --- | --- | --- |
| `npm run test` | 0 | `full-test-3`: 3008/3008 reported file executions, 18 batches, no runner failure lines. Agents 553/553 plus 7/7 native tail; CLI 822/822 files, 10174 passed / 0 failed / 5 skipped / 13 todo cases. |
| `npm run lint` | 0 | `full-lint-3`: all 18 partitions completed. |
| `npm run typecheck` | 0 | `full-typecheck-3`: declaration build, all workspaces including agents, scripts and evals completed. |
| `npm run format` | 0 | `full-format-3`: no unrelated tracked changes. |
| `npm run build` | 0 | `full-build-3`: source/compiled lazy-MCP registry coherence verified. |
| `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` | 0 | `full-smoke-3`: actual identity `[lunahigh:gpt-6-luna]`, three-line haiku. |
| `npm run check:runtime-boundary` | 0 | `runtime-boundary-3`: exact baseline command, no increases or unratcheted findings, zero compiler diagnostics; state, serviceShape and ambientDelegation scanners complete. |
| `bun scripts/test-audit/scan.ts tmp/verify3923/scratch-root-20261021-2104/audit-final-3` | 0 | `audit-final-3`: full-corpus AST audit and comparison below. |

`verification-summary.json` and `verification-summary.log/.exit` aggregate the actual exits, all 18 test batches and AST comparison; the summary exits 0. AST findings are identical to the pre-scratch snapshot after ignoring line shifts: no added or removed findings of any category, and no findings in the new scratch suite. Prohibited-category counts remain MOCK_MIRROR 173, ALWAYS_TRUE 13, SELF_CONFIRMING 274 and NO_ASSERT 98, also matching the original audit-main counts. `audit-diff.log` records the empty normalized difference. The exact boundary file passes its original five tests in the full suite, alongside the new concurrent lifecycle regression.

### Final scope, preserved constraints and dispositions

- Incoming committed-state hook/test changes are byte-for-byte identical to the starting worker diff: `committed-state-before.diff` versus `committed-state-after.diff`, with `committed-state-preserved.exit` containing 0.
- `enforcement-unchanged.log/.exit` records an empty HEAD diff and exit 0 for the boundary scanner, discovery roots, retry/concurrency policy, runtime baseline, agents runner/bunfig, .llxprt, workflows, ESLint configuration, package.json and bun.lock. No scanner root or assertion, test threshold, existing skip, concurrency or retry setting changed. No ENOENT catch was added.
- Added scope consists only of the scratch helper, new scratch ownership/concurrency suite, the three direct producer relocations, and this issue plan. The original template, recording helper, model-tool fixture helper and all runtime production code remain unchanged by the scratch remediation.
- Final changed paths: `packages/agents/src/api/__tests__/helpers/scratch-dir.ts`, `packages/agents/src/api/__tests__/scratch-dir.behavior.test.ts` (new, untracked), `packages/agents/src/api/__tests__/recording-tool-hook-owner.behavior.test.ts`, `packages/agents/src/api/__tests__/workspace-checkpoint-lifetime.behavior.test.ts`, `packages/agents/src/core/__tests__/model-tool-fixture.behavior.test.ts`, the two incoming `useSubmitQuery` code/test paths, and `project-plans/issue3923.md`.
- #3927's changing-input cause is fixed locally and verified. Keep #3927 open until the orchestrator adds final PR linkage. #3923's committed-state remedy remains intact and now has a green full-cycle aggregate. The original failing race aggregate and all intermediate red/typecheck receipts remain available; none was replaced by a passing receipt.
- Branch remains `issue3923`, HEAD `992271fea`. No commit, push, PR/thread edit, issue closure, review or OCR was performed. Review skipped per Andrew 2026-10-09. No Windows execution is claimed; new real-process behavior was verified on macOS. Remote PR #3924 still reflects the previously pushed commit until the orchestrator publishes this work.

Draft commit message: `fix(async): use committed state for notice delivery (Fixes #3923)`.

Suggested body: Keep suspended busy renders from changing live notice-delivery gates. Move mutable test fixtures into the existing Bun session temp root so concurrent cleanup cannot change source-boundary scan inputs. Preserve caller cleanup, session isolation and all boundary enforcement. Refs #3927.
