# Issue #3963: media-store lock contention

## Tracking and scope

Issue: https://github.com/vybestack/llxprt-code/issues/3963. Branch: `issue3963`, based on `112d562e109bb85eb0627bab33918058deb8351e`. Implemented and independently reviewed on 2026-10-27.

Issue type Bug, milestone 0.12.0, labels Loopbreaker/linux/packages/core. LLxprt roadmap assignment is blocked by the configured GitHub token's missing project scope. The modern-project GraphQL query returned INSUFFICIENT_SCOPES; the combined project edit also encountered deprecated classic-project access. The issue remains unassigned.

This fix addresses finite in-process contention. The original reporter's exact nightly version, holder and triggering sequence remain unknown. Linux/btrfs reproduction is confirmed. Provider exclusivity and OS exclusivity remain unproven. Long-held external locks and fresh abandoned locks retain their existing bounded contention failures.

## Confirmed cause

All content IDs under one root share `locks/store.lock`. Before this fix, `LocalMediaStorePersistence.runExclusive` immediately started every operation, each with its own 2,000 ms filesystem-acquisition deadline. Successful work did not extend competitors' deadlines or provide FIFO fairness. Verified reads also acquire, fsync and release this exclusive lock.

`recorded-media-transfer.ts:copyObjects` starts a verified read for every unique original/selected object through `Promise.all`. Finite local work can therefore exhaust its own acquisition budgets while earlier work continues succeeding. Actual `publishRecordedMedia` reproduced the reported `acquire store lock for read verified` error.

Recording, snapshots, provider reads, reservations and cleanup can overlap. Sessions normally have distinct UUID-scoped live roots but share a project recording archive, so coordination must cover multiple instances while retaining cross-process locking.

Relevant source boundaries:

- `packages/core/src/storage/local-media-store-files.ts`: managed directories, content paths and durable publication.
- `packages/core/src/storage/local-media-store-persistence.ts`: exclusive operations, acquisition deadline, heartbeats and identity-checked release.
- `packages/core/src/storage/local-media-store-lock-recovery.ts`: stale claims and takeover ownership checks.
- `packages/core/src/storage/recorded-media-transfer.ts`: verified copy fanout and transactional recording publication.
- `packages/core/src/storage/request-media-resolver.ts`: request-local materialization and cleanup.

## Provider and error propagation

Current Anthropic preparation invokes the shared request-media resolver before transport. OpenAI Chat, Responses and Vercel also use this boundary. Resolver errors are wrapped in `RequestMediaResolutionError`; its locked operation is labeled `reserve reference`. Recording copies emit the bare `read verified` wording. Journal drain retains publication failures and flush rethrows them. Generic turn/UI error handling can stop the loop and display `[API Error: ...]` for local errors. The label alone establishes neither an HTTP failure nor the precise caller.

## Reproduction evidence

Real filesystem/store implementations on Linux `7.0.0-1015-oem`, btrfs, workspace Bun 1.4.4. No provider request was needed. Results vary with filesystem latency and scheduling.

| Diagnostic workload | Observed result |
| --- | --- |
| 64 concurrent reads | 64 succeeded in 683 ms |
| 256 concurrent reads | 229 succeeded, 27 lock timeouts in 2,038 ms |
| 512 concurrent reads | 282 succeeded, 230 lock timeouts in 2,064 ms |
| 512 sequential reads | All returned correct bytes in 4,777 ms |
| Actual 512-object recording publication | Exact reported read-verified timeout |
| Same-instance or peer read behind held transaction | Exact reported timeout |
| Real resolver behind held transaction | Blob-verification wrapper with reserve-reference contention cause |
| Read after holder release | Correct bytes |
| Fresh lock left by exited child | Timeout; recovery succeeded after aging past stale threshold |

Disposable diagnostic scripts were removed. Permanent small behavioral tests replace the large diagnostic reproductions.

## Implementation contract

`runExclusive` synchronously accepts and tracks work before asynchronous scheduling. Closing rejects subsequent exclusive work and joins accepted queued operations.

`enqueueExclusive` serializes registration, validates/creates the managed root, canonicalizes it through `realpath`, and appends to a module-scoped root tail. Registration returns the pending operation inside an object, allowing subsequent registration without waiting for the operation itself. Canonical identity covers lexical aliases and symlinked ancestors while retaining rejection of a symlink managed root. Independent roots continue to execute while another root is held.

Each turn invokes the existing exclusive implementation. Its filesystem acquisition deadline starts after the local turn begins. The original `wx` lock, owner record, fsync, heartbeat, stale claims, identity/token checks, release, quotas and byte/hash verification remain unchanged. Rejection-neutral tails allow progress while preserving caller errors; identity-checked removal cleans up idle entries.

Independent review identified a FIFO self-deadlock when transaction publication or rollback-protection callbacks await another same-root exclusive operation. The implementation now uses an `AsyncLocalStorage` active-turn context to reject same-root reentrancy explicitly, including through peer instances and parent aliases. Turn lifetimes permit nested independent-root operations and later work from an inherited completed context.

There is no transaction replay, integrity-error suppression, stale-threshold change or acquisition-timeout increase. The existing public multi-stage `admitKnown`/close lifecycle boundary was identified during review and was not expanded into this fix.

## Behavioral coverage and TDD

New suite: `packages/core/src/storage/local-media-store-queue.test.ts`. Tests use real stores/filesystem, recording publication and request-media resolution. A public transaction barrier holds the lock for 200 ms against a configured 40 ms acquisition budget, then releases it. Assertions cover verified bytes, journal contents, materialized media, reservations and transaction order.

Coverage: same-instance and same-root peers; parent and lexical aliases; FIFO; independent-root progress; failure propagation and successor progress; close/drain and rejected new work; actual recording publication; actual resolver materialization/release; retained external-lock timeout; publication and rollback callback reentrancy; independent-root nesting and inherited-context completion.

- Initial RED before production edits: **2 pass / 8 fail**, intended acquisition-timeout failures including publication and resolver paths.
- Reentrancy RED before guard implementation: **0 pass / 6 fail**, callbacks remained pending beyond five acquisition budgets. Fixture cycle breakers ensure cleanup.
- Final five-suite GREEN: **90 pass / 0 fail / 221 assertions**.
- New 17-case suite: five consecutive passing repetitions.
- Independent reentrancy replay: **6 pass / 0 fail / 24 assertions** after remediation; original FIFO failed all six, baseline settled all six through its timeout.
- Full-corpus test audit exited 0 with **zero findings** on the new suite.

```sh
bun test ./packages/core/src/storage/local-media-store.test.ts ./packages/core/src/storage/local-media-store-queue.test.ts ./packages/core/src/storage/local-media-store-locking.test.ts ./packages/core/src/storage/local-media-store-verification.test.ts ./packages/core/src/storage/request-media-resolver.test.ts
```

## Independent review

Final code approval: no outstanding production-code finding. Initial P1 callback reentrancy was reproduced and remediated during review. Final reviewed source hashes match the submitted implementation and tests. No additional review round requested. Local OCR executable and configuration are absent; PR OCR is required for that additional signal.

## Verification disposition

Workspace Bun 1.4.4 was used because system Bun is 1.4.3. Temporary logs and exact evidence are scoped under `project-plans/.tmp-issue3963/` and excluded from the commit.

| Check | Result |
| --- | --- |
| Focused storage suites | 90 pass, 0 fail |
| Full `npm run lint` | Exit 0 on full retry and subsequent main cycle |
| Full `npm run typecheck` | Reviewer run exit 0 |
| Full `npm run build` | Reviewer run exit 0 |
| `npm run format` in isolated snapshot | Exit 0; 7,132 compared files, zero changes |
| Test audit | Exit 0; new suite zero findings |
| `git diff --check` | Exit 0 |
| Startup/provider smoke, `gpt-6-luna` | Exit 0; returned haiku |
| Literal `luna` smoke | Exit 1, profile absent locally |
| Protected `.llxprt` and existing issue3956 artifacts | Checksums unchanged |
| Full `npm run test` | Exit 1; agents 550/557 files passed; CLI 829/829 passed; other workspaces passed |

Seven main-run agents failures: `core-tools.spec.ts`, `fromConfig.behavior.test.ts`, `hook-session-shutdown.behavior.test.ts`, `mutationCoverage.auth.behavior.test.ts`, `mutationCoverage.tokens.behavior.test.ts`, `recording-tool-hook-owner.behavior.test.ts`, and `core/turn.liveness.test.ts`. Each has a successful serial replay recorded. Property tests hit per-test/file timeouts during concurrent full verification. The reviewer also observed a policy timing failure, followed by a passing complete policy workspace replay. Shell-owner-exit failed during loaded runs and passed serially under both Bun versions.

Serial passes do not convert the failed full invocation into a pass or establish baseline failure. No unrelated-code claim is made. CI must determine readiness. Duplicate reviewer testing was stopped to reduce load; after the main test and lint completed, redundant sequential typechecking was stopped because the independent full typecheck/build/format evidence already existed. No verification jobs are intentionally left running.

## Remaining boundaries

External holders exceeding the existing budget and abandoned locks younger than the stale threshold can still produce explicit contention errors. Their recovery policy requires separate safety work. macOS and Windows were not tested locally. Roadmap assignment remains blocked by GitHub authentication scope.

## Bounded CI remediation and final review, 2026-10-27

This section supersedes the pre-PR verification disposition above for the current uncommitted remediation. Final bounded review approves the code changes with no production-code blocker found. No further broad audit or review round was started. No commit, push, merge, or remote thread resolution was performed.

### Original PR CI and review availability

PR #3964 still points to `2650bae3d05fc23a8c02bbd04a4b13b845397265`. All original test shards (agents, three CLI shards, core, providers, rest), both Linux E2Es (Docker and unsandboxed), ACP conformance, and runtime-plugin checks passed. `Lint (Javascript)` and its aggregate `Lint` check failed. The recorded scanner finding is the new `storeQueueContext` ALS declaration in `local-media-store-persistence.ts` (`ci-lint-job.log`, lines 3460 onward).

OpenCodeReview and Run LLxprt review display successful workflow checks but did not provide completed code reviews. The OCR PR comment records phase `llm-preflight`, exit 1, zero tokens, and provider response `401 Unauthorized`, `token expired or incorrect`; the LLxprt comment reports the review unavailable. These green workflow statuses provide no review approval. Evidence: PR comments `6442823894` and `6442834636`.

CodeRabbit thread `PRRT_kwDOPB5qbc6ws0q1` requested a long-wait diagnostic without reintroducing a queue timeout. The implementation addresses that request locally. The thread remains unresolved on GitHub because this remediation has not been published.

### Reviewed contracts

- The ALS allowance matches only `packages/core/src/storage/local-media-store-persistence.ts` plus declaration `storeQueueContext`, with a documented reason. The existing scanner still requires exact file/declaration matching and a nonempty reason. No baseline, source roots, scanner implementation, or global enforcement rule changed. Queue ancestry carries canonical roots and active-turn flags, with turns deactivated in `finally`; it carries no runtime identity, settings, or services.
- The added negative guard test exercises the real production audit API with real fixture files. It accepts the intended declaration while reporting another ALS declaration in the same file and the same declaration name in another file, retaining exit 1 for those violations.
- A queued turn receives one warning after 30,000 ms through the existing `llxprt:storage:media` DebugLogger namespace, subject to normal debug configuration. Details contain canonical root, operation, and elapsed wait. The diagnostic neither rejects nor cancels the waiter and does not alter the filesystem acquisition deadline or close/drain contract.
- The one-shot timer is unreferenced and cleared when the turn starts, before exclusive work. Predecessor tails are rejection-neutral, so predecessor failure still reaches that cleanup. A stalled predecessor produces one warning per queued turn; it can still keep queued operations and close pending indefinitely. No hard timeout or periodic warning was added.
- The two diagnostic tests enter through public store operations, execute real filesystem/queue/close behavior, and control holders with public transaction callbacks. Fake time controls the diagnostic boundary; the logger spy captures emitted warning data without supplying queue results. Assertions cover threshold, single emission, pending waiter/close, eventual result, and cancellation when a turn starts even while its callback remains pending. These are behavioral tests without mock-return theater. Finally blocks release barriers, restore timers/logger, and settle operations; existing teardown closes stores and removes temporary directories.

### Exact remediation evidence

Existing logs are under `project-plans/.tmp-issue3963/`.

| Evidence | Recorded result |
| --- | --- |
| `ci-remediation-diagnostic-red` | Exit 1; missing warning reproduced (1 fail, 1 pass) before implementation |
| `ci-remediation-boundary-red` | Exit 1; missing exact allowance reproduced (1 fail) before implementation |
| `ci-remediation-queue-green` | Exit 0; 19 pass, 0 fail, 50 assertions |
| `ci-remediation-media-green` | Exit 0; 80 pass, 0 fail, 182 assertions across four files |
| `ci-remediation-guards-green` | Exit 0; 143 pass, 0 fail, 204 assertions across three files |
| `ci-remediation-scoped-lint` | Exit 0 |
| Current full boundary scan | Exit 0; zero unratcheted findings, zero ratchet changes, zero compiler diagnostics; all three scanners complete |
| Final five-file Prettier check | Exit 0; all remediation source/test files formatted |
| Final `git diff --check` | Exit 0 |
| Protected-file manifest | `sha256sum --status -c ci-remediation-protected.sha256` exit 0; all 11 entries preserved, including `.llxprt` files and existing issue3956 artifacts |

### Existing job commands, limits, and pending verification

Inspection found two distinct existing evidence streams. No duplicate verification was launched during finalization.

1. `ci-remediation-round1/` records boundary exit 0 and lint exit **124**, with lint interrupted after its 420-second budget at package 10/18 (`packages/providers`). This is an incomplete lint run, without an established lint error. Its typecheck child used `timeout --kill-after=20s 600 bash -c 'npm run typecheck'`. That orphaned process was running at first inspection and had disappeared by 13:49:40 UTC. The log ends with workspace typechecking and contains no recorded final exit file. Its overall outcome is **unknown**, not a passing full typecheck; no timeout result can be inferred.
2. Managed job `shell_929fc2204223`, launched 13:43:50 UTC, writes directly to `.tmp-issue3963/ci-remediation-*`. Its boundary step completed at 13:48:32 UTC with exit 0. Its lint step started at 13:48:32 UTC and remains running at the final snapshot. Its sequential commands and budgets are boundary `npm run check:runtime-boundary` (300 s), lint `npm run lint` (900 s), typecheck `npm run typecheck` (600 s), format `npm run format:check` (180 s), build `npm run build` (420 s), smoke `bun scripts/start.ts --profile-load luna "write me a haiku and nothing else"` (120 s), and test `npm run test` (1,200 s). Every step has a 20-second kill grace and records its own exit file. The loop continues after failures, so shell completion alone will not establish that all checks passed. It uses workspace Bun 1.4.4 and agents/CLI/core test concurrency 2.

Current full lint is pending; typecheck, full format check, build, literal-luna smoke, and full test remain queued in that managed job. The earlier pre-PR full typecheck/build passes do not certify this remediation. Literal `luna` was absent in earlier local smoke evidence, so the queued smoke may reproduce that environment failure. No extra full verification, endless retry, or new provider review was started. The pre-existing managed verification job is intentionally left running for its existing owner; no process or disposable fixture was created by this final review.

Disposition: code approved for the bounded remediation; complete local-cycle verification and publication remain pending. Original remote CI still reflects the pre-remediation commit and its scanner failure. This PR is not yet established ready to merge.
