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
