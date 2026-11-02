# Issue #3992: verified media reads fail when another process holds the store lock

## Report

A user request failed with:

```text
Media store acquire store lock for read verified failed [contentId=sha256:…]: Lock contention exceeded 2000ms
```

## Root cause (reproduced)

- `LocalMediaStorePersistence.readObjectVerified`
  (`packages/core/src/storage/local-media-store-persistence.ts`) runs the
  verifying read inside `runExclusive`. That takes the per-root filesystem lock
  `<root>/locks/store.lock`, the same lock used by admission, reservation and
  reclamation.
- Since #3963/#3964, same-process work on a root is FIFO-queued, so a
  same-process turn starts with the file lock free. The 2000ms timeout
  therefore requires a holder outside this process's queue: another OS process
  on the same root, or an orphaned lock file.
- The project archive `<project>/media` is shared by every session, subagent
  and the session janitor.
- Stale-lock recovery is mtime-only with a 30s threshold. A SIGKILLed or
  crashed holder therefore blocks contenders for up to 30s, and each contender
  gives up after 2s.
- Reproduction with a real store, filesystem and child processes: a child took
  the lock inside `admitObjectsTransaction` and was SIGKILLed. A parent
  `readObjectVerified` then failed after 2002ms with exactly the reported text,
  although the object was intact.
- Callers that use the `read verified` label:
  - recorded-media copy and hydration (`recorded-media-transfer.ts`), reached
    from `SessionRecordingService.writeBatchToFile`;
  - the session media package writer;
  - the reference-lifecycle check.

  The failure surfaces from a recording-journal flush. The `[API Error]` label
  does not mean the HTTP request failed.

## Why the read does not need the store lock

- **Immutable objects:** objects are content-addressed and never rewritten in
  place. `publishBytes` writes a temp file (`wx`), fsyncs it, hard-links it to
  the object path, and syncs the directory.
- **Two possible outcomes:** a concurrent unlink (reclamation, or publish
  rollback) gives the reader either the complete bytes or ENOENT. ENOENT
  becomes the existing `MediaObjectMissingError`.
- **Integrity without the lock:** `readObjectVerifiedUnlocked` enforces a
  regular-file check, byte length and sha256 against the contentId. Integrity
  does not come from the lock. The same function already runs unlocked inside
  other exclusive operations.
- **Lease scope:** the instance lease protects reservations and GC ownership,
  not reads.

## Fix

1. Make the public `readObjectVerified` lock-free.
   - Reject when the store is closing or closed. Use the same
     `MediaStoreError` text as `runExclusive`: "Local media store is closed".
   - Register the read in `this.operations` so `close()` joins in-flight reads.
   - Call `readObjectVerifiedUnlocked(reference, 'read verified')` directly.
2. Keep `reserveAndReadVerified` and every other operation exclusive. The
   reservation must be atomic with respect to reclamation.
3. Do not change `DEFAULT_LOCK_TIMEOUT_MS` (2000) or `DEFAULT_STALE_LOCK_MS`
   (30000), and do not change media limits.
4. Out of scope and tracked as a follow-up: dead-owner (same host, dead pid)
   lock recovery, which would also help write-class orphans, and cancellable
   lock waits.

## Test plan (Bun, real `LocalMediaStore`, real filesystem and child processes)

New file `local-media-store-read-concurrency.test.ts`. Reuse the existing
child-process patterns. Synchronize with ready and release files or stdin
barriers, never sleeps. Use a short `lockTimeoutMs` so the old behavior fails
fast.

1. RED: a live foreign holder (child inside `admitObjectsTransaction`, parked
   on a barrier). `readObjectVerified` and `readVerified` return the correct
   bytes while the lock is still held, asserted before the barrier is released.
2. RED: an orphan. The holder is SIGKILLed after HELD, and `child.exited` is
   awaited. The read succeeds.
3. With a foreign holder present, integrity failures keep their typed errors:
   - a flipped byte raises `MediaObjectHashMismatchError`;
   - a truncated file raises `MediaObjectCorruptError`;
   - a missing object raises `MediaObjectMissingError`;
   - a directory or symlink in place of the object raises
     `MediaObjectCorruptError`.
4. `close()` joins an in-flight read, and a read after close rejects as closed.
5. `reserveAndReadVerified` with a foreign holder still contends and fails with
   the bounded lock error (unchanged).
6. Existing `local-media-store-queue.test.ts` cases that use reads as the
   contention victim move to a genuinely exclusive operation, so FIFO and
   root-alias coverage is kept.

## RED/GREEN evidence

Run from `packages/core`, one `bun test` process per file.

### RED (new test file against unchanged production code)

`bun test src/storage/local-media-store-read-concurrency.test.ts`:
3 pass, 8 fail (11 tests). The 8 failures are the live-holder `readObjectVerified`
and `readVerified` cases, the five integrity cases with a live holder, and the
SIGKILLed-orphan case. Each failed with `Lock contention exceeded 300ms` from
`acquire store lock for read verified`. The 3 passes are the regression guards
that already held: `reserveAndReadVerified` stays bounded, `close()` joins an
in-flight read, and reads after close reject as closed.

### GREEN (after the lock-free `readObjectVerified`)

| File | Pass | Fail |
| --- | --- | --- |
| local-media-store-read-concurrency.test.ts | 11 | 0 |
| local-media-store.test.ts | 27 | 0 |
| local-media-store-queue.test.ts | 19 | 0 |
| local-media-store-locking.test.ts | 15 | 0 |
| local-media-store-verification.test.ts | 19 | 0 |
| request-media-resolver.test.ts | 12 | 0 |
| request-media-byte-overflow.test.ts | 6 | 0 |
| session-media-owner-durability.test.ts | 9 | 0 |
| media-admission-service.test.ts | 14 | 0 |
| media-session-lifecycle.test.ts | 7 | 0 |
| media-lifecycle-metrics.test.ts | 3 | 0 |
| session-media-service-factories.test.ts | 1 | 0 |
| SessionRecordingService.{bounds,header,payloads}.test.ts, SessionRecordingService.test.ts | 9, 14, 15, 22 | 0 |
| session-media-package.test.ts, session-media-package.bounds.test.ts | 10, 10 | 0 |
| semantic-media-purge.recording.test.ts | 2 | 0 |
| RecordingIntegration.replay.test.ts | 25 | 0 |

`local-media-store-queue.test.ts`: the two cases that used `readVerified` as the
contention victim now use `reserveAndReadVerified`, which stays exclusive and
still returns the verified bytes, so the FIFO and root-alias coverage remains.

Scoped `prettier --check` and `eslint` pass on the touched files. `tsc --noEmit
-p tsconfig.test-bun.json` reports no errors in `local-media-store*` files.

## Independent review round 1 (actual Opus, claude-opus-5-5)

PASS, no HIGH or MEDIUM findings. It independently confirmed:
- no path rewrites, truncates or renames over an object;
- no caller relied on reading under the lock for atomicity: reads and later
  admits were already separate lock turns, and reservations protect
  lifecycle-checked objects;
- close() and `trackOperation` cannot leave a rejection unhandled;
- the adapted queue tests keep their queue-wait and alias coverage.

Addressed from its LOW findings:
- Same-process regression guard: a read on the same instance, and on a second
  instance on the same root, completes while a same-process exclusive turn is
  parked. Without this, putting reads back on the in-process queue would pass
  every cross-process test.
- Never-created root: the read gives `MediaObjectMissingError` and creates no
  directories.
- JSDoc: a read can observe an object from a transaction that later rolls
  back. Success proves the bytes, not commitment; use `reserveAndReadVerified`
  when the object must stay available.

RED against the original locked read (only that file temporarily stashed):
0 pass, 3 fail. The same-process reads deadlock behind the parked turn, and the
old read created the root. GREEN: the read-concurrency suite passes 14/14.
eslint (max-lines) and prettier are clean, and tsc reports nothing in
local-media-store files.

Deferred hardening, tracked as a follow-up issue rather than changed here:
- `readRegularFile` should open with O_NOFOLLOW, fstat the handle and cap the
  read at byteLength + 1. The existing lstat-then-readFile race allows a FIFO or
  oversized-file denial of service. This predates the change and the lock never
  protected against hostile processes.
- Policy for symlinked store and object directories on the read path; content
  is still hash-verified.
- Windows delete-pending behavior when a reclaim unlinks a file another
  process is reading.
- Unbounded `Promise.all` fan-out of `copyObjects` reads, which affects
  open-file limits.
- Dead-owner lock recovery and cancellable lock waits for write-class
  operations.

## Independent review round 2 (final, actual Opus)

PASS, no HIGH or MEDIUM findings. The reviewer re-ran the RED check with a
temporary preload restoring the original locked read: 0 pass / 3 fail. The new
tests passed 30/30 across 10 reruns each.

- Fixed LOW: the same-process test now releases the parked holder in `finally`,
  so a thrown read cannot strand the holder. A genuine deadlock, the regression
  this test exists to catch, still hangs the awaited read and makes the
  afterEach hook time out. Avoiding that would need a timer, which RULES
  forbids for synchronization, so the noisy-but-correct failure is accepted.
- Fixed nit: the never-created-root check matches the error `code` ('ENOENT')
  instead of message text.
- Left as-is, pre-existing nits: Buffer mutation in the flipped-byte setup,
  multi-assert older tests, and the `delay` in the queue tests' `withHeldStore`.

## Full verification (final code)

Serial cycle `project-plans/.tmp-issue3992/verify.sh`: typecheck, lint,
format, build, smoke (`gpt-luna-high` haiku) and audit all exit 0. Full test
exit 1, with every package passing except these two tests, both shown not to
be caused by this change:

- **agents `mcp-cancellation-failures.behavior.test.ts`:** timed out at 30s in
  a file run that took 145s (its neighbors took 5–11s). It passed 3/3 in
  isolation (0.7–1.6s) and in both earlier full runs tonight (0.27s and
  0.34s). The test does not touch media storage.
- **test-utils "transport headers deadline in the real CLI":** `TestRig.run()`
  exceeded its 12s budget. It fails 3/3 in isolation, and also 3/3 with main's
  original `local-media-store-persistence.ts` substituted (the only production
  file this change touches; TestRig runs CLI source). This is the budget
  problem tracked in #3994, where the evidence has been added.
