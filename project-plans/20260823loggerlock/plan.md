# Plan: Logger inter-process file locking (Issue #2855)

Plan ID: PLAN-20260823-LOGGERLOCK
Generated: 2026-08-23
Total Phases: 3 (RED tests → GREEN implementation → verification)
Requirements: REQ-LOCK-001 .. REQ-LOCK-006

## Issue mapping note

The issue text names `_updateLogFileSync` and `_migrateLegacyToJsonl` from PR
#2839. The code has since been refactored to async equivalents; the mapping to
current code (`packages/core/src/core/logger.ts`) is:

| Issue concept | Current code |
|---|---|
| `_updateLogFileSync` read-compute-append | `initialize()` (`_loadFromDisk` + messageId computation) and `_appendEntry()` (id assignment + duplicate check + `_appendJsonl`) |
| `_migrateLegacyToJsonl` | `_ensureJsonlFormat()` (legacy check + backup + `_writeJsonlAtomic` rewrite), called from `initialize()` and the first write |

## Accepted behavior (shaped from the issue)

The Logger MUST use an advisory inter-process lock (native `O_EXCL` lockfile
pattern via `fs.open(lockPath, 'wx')` — one of the three mechanisms the issue
explicitly proposes; chosen to avoid a new dependency) so that separate
processes logging to the same project log file cannot interleave the
file-mutating sequences.

### REQ-LOCK-001: initialize is serialized across processes

- GIVEN: a log file other processes may be reading/appending/migrating
- WHEN: `initialize()` runs its load + eager legacy migration + messageId
  computation
- THEN: that entire sequence executes while this process owns the lock file
  `${logFilePath}.lock`, so the read never observes another process's
  mid-migration state and the computed messageId reflects all writes that
  completed before this initialize acquired the lock.

### REQ-LOCK-002: the append sequence is serialized across processes

- GIVEN: another process holds the lock
- WHEN: this process calls `logMessage()`
- THEN: the append (format-ensure + id assignment + duplicate check +
  trailing-newline fix + `appendFile`) waits for the lock and only then runs;
  a concurrent legacy migration rewrite can no longer wipe an appended entry,
  and the newline-fix + append two-step cannot interleave with another
  process's write.

### REQ-LOCK-003: bounded acquisition with graceful failure

- GIVEN: the lock stays held by another live process past the acquisition
  deadline (default 5000 ms, overridable via internal env seam
  `LLXPRT_LOG_LOCK_TIMEOUT_MS` for tests)
- WHEN: `logMessage()` is called
- THEN: it does not throw; messageId does not advance; the entry is not on
  disk; the failure is debug-logged (same contract as the existing append
  failure path).
- WHEN: `initialize()` is called
- THEN: it completes without throwing, sets `initialized = false` (logging
  disabled for the session), matching existing init failure handling.

Acquisition retries with a small fixed backoff (~25 ms). Lock waiters must
never spin hot and never block the event loop.

### REQ-LOCK-004: stale lock recovery

- GIVEN: a lock file left behind by a crashed holder whose mtime is older than
  the staleness threshold (default 10000 ms)
- WHEN: any Logger operation tries to acquire
- THEN: the stale lock is removed (unlink races are safe: only one waiter's
  subsequent `open('wx')` succeeds) and the operation proceeds.

### REQ-LOCK-005: lock hygiene and liveness

- The lock is released in a `finally` on every path (success, throw, timeout).
- No `.lock` file remains in the log dir after normal operation.
- No nested acquisition anywhere (verified by call-path audit: `_withLock`
  wraps only `initialize`'s load block and `_appendEntry`; nothing inside
  either callback acquires again), so no self-deadlock.
- Existing single-process behaviors are unchanged: per-instance `_writeQueue`
  serialization, per-instance messageId counters (two same-process instances
  still produce 0,0,1,1), close() draining, corruption recovery, migration
  semantics, and the O(1) steady-state path (no per-write file re-read).
- `_pruneOldBackups` runs outside the lock (best-effort, unrelated to append
  safety) and must not treat `.lock` files as prunable.

### REQ-LOCK-006: cross-process end-to-end integrity

- GIVEN: a legacy JSON-array log file and two real child bun processes plus
  the parent, all constructing `Logger` on the same project log dir, each
  initializing and logging messages
- THEN: every legacy entry survives, the final file is valid JSONL (does not
  start with `[`), and the total line count equals legacy + all writers'
  messages with every line parsing as a valid `LogEntry`.

## Inputs and boundary cases

- Uncontended acquire must be a single `open('wx')` with no timer waits (fake
  timers in existing logger tests must not hang).
- Fresh lock file held externally: `logMessage`/`initialize` block (observable:
  promise unresolved) until the lock disappears, then complete — deterministic
  tests manipulate the lock file directly with real fs ops.
- Lock holder crashes (lock file backdated via `fs.utimes`): broken after the
  staleness threshold.
- Two same-process instances contending on one lock file must not deadlock
  (JS single thread: holder's release spans awaits; waiter retries between).
- Child-process tests: driver script generated at runtime into gitignored
  `tmp/` at the repo root (inside the workspace so bare imports of
  `@vybestack/llxprt-code-settings` resolve), run with `bun`, same cwd and env
  as the parent so `Storage.getProjectTempDir()` matches; spawn awaited with a
  bounded timeout; cleanup removes the script.
- Existing tests `logger.test.ts` and `loggerJsonl.test.ts` must pass
  UNCHANGED (they encode current accepted behavior, including "external
  appends are not noticed" on the steady-state path).

## Non-goals (explicit, do not implement)

- Per-write file re-read or global cross-process messageId coordination for
  the same session id. Full same-session uniqueness across processes would
  require re-reading per write; PR #2839 deliberately removed that (O(1)
  steady-state path) and existing tests assert external appends are not
  noticed. The issue's "Why defer" section itself frames multi-process
  concurrent logging as an uncommon edge case; locking removes the
  file-corruption/lost-entry class of races, which is what was accepted.
- New dependencies (`proper-lockfile`) — the O_EXCL pattern from the issue's
  own list needs none.
- Locking `_pruneOldBackups`, `getPreviousUserMessages` (in-memory), or
  `close()` (drains the queue; queued appends release their own locks).
- Any refactor of SessionLockManager or reuse of it (session-recording
  specific: fail-fast acquire keyed by session id, 48h staleness — wrong
  semantics for a wait-with-timeout file lock).

## Test plan (test-first; bun:test, TS, no mock theater)

New file `packages/core/src/core/loggerLocking.test.ts`. Real fs everywhere;
the only "stub" usage mirrors the existing suite's infrastructure-mock
exception (fs error injection), which this plan avoids needing. Child
processes are real `bun` processes.

1. REQ-LOCK-002 determinism: create the lock file (fresh mtime), call
   `logMessage` without awaiting; poll that its promise stays pending for
   ~150ms; delete the lock; the promise resolves; entry on disk.
2. REQ-LOCK-001 determinism: seed a session entry with messageId 4 on disk;
   create fresh lock; start `initialize()`; poll pending; append another entry
   directly to the file (simulating the lock holder's write) while blocked;
   delete the lock; initialize completes with messageId computed from the
   post-append disk state (6, since both direct entries count), proving the
   read happens under the lock.
3. REQ-LOCK-004: backdate the lock mtime past the staleness threshold via
   `fs.utimes`; `logMessage` completes without manual release; entry on disk.
4. REQ-LOCK-003: fresh lock + `LLXPRT_LOG_LOCK_TIMEOUT_MS=250`;
   `logMessage` resolves without throwing, messageId unchanged, nothing
   appended, debug-logged; `initialize` completes with `initialized === false`.
   Restore env.
5. REQ-LOCK-005: after initialize + several logMessage + close, readdir shows
   no `.lock` file; two same-process instances interleaving logMessage calls
   both complete (existing loggerJsonl test already covers the 0,0,1,1
   semantics — this adds lock-file cleanup assertions).
6. REQ-LOCK-006 e2e: seed legacy pretty-printed array with 2 entries; spawn
   two child bun processes (driver) each logging 3 messages with the same
   session id while the parent logs 2; assert file: starts with `{` (JSONL),
   2 legacy + 5 new entries = 7 lines, all parse, legacy messages present in
   order, all 5 new messages present.
7. Regression: existing logger/loggerJsonl suites unchanged and green.

The test suite uses REAL timers (no `vi.useFakeTimers`) since it exercises
real backoff/polling.

## Implementation sketch (for the implementer)

All changes in `packages/core/src/core/logger.ts` (module-private; no new
exports, no new files in production code):

- Constants: `LOCK_FILE_SUFFIX = '.lock'`, `LOCK_STALE_MS = 10_000`,
  `LOCK_BACKOFF_MS = 25`, default `LOCK_TIMEOUT_MS = 5_000` overridable via
  `process.env.LLXPRT_LOG_LOCK_TIMEOUT_MS` read at acquire time.
- Private `async _withLogLock<T>(fn: () => Promise<T>): Promise<T>`: acquire
  (open 'wx' → write `{pid, ts}` payload → close; on EEXIST: stat → ENOENT
  retry immediately, mtime stale → unlink + retry; deadline check → throw
  descriptive Error; else `await delay(LOCK_BACKOFF_MS)`), run `fn`, release
  (unlink, ignore ENOENT) in `finally`. Use a local sleep helper or
  `utils/delay.js` if its shape fits (verify before importing).
- Wrap `initialize()`'s `_loadFromDisk` → `_ensureJsonlFormat` → messageId
  computation block.
- Wrap `_appendEntry()`'s body (`_ensureJsonlFormat` → id assign → dup check →
  `_appendJsonl` → `logs.push`).
- Failure paths ride existing handlers: init catch sets `initialized = false`;
  logMessage catch debug-logs and leaves messageId untouched.
- Copyright year on any new file: 2026.

## Verification cycle (run all, fix, re-run)

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus focused runs: `cd packages/core && bun test src/core/loggerLocking.test.ts
src/core/logger.test.ts src/core/loggerJsonl.test.ts`.

## Execution tracker

| Phase | ID | Status |
|---|---|---|
| 1 RED tests | P1 | pending |
| 2 GREEN impl | P2 | pending |
| 3 verification + review | P3 | pending |
