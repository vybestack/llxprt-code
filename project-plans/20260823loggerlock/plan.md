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
  the staleness threshold (default 30000 ms)
- WHEN: any Logger operation tries to acquire
- THEN: the stale lock is broken safely (atomic rename to a unique guard, the
  moved file re-verified as stale, then removed — never a bare unlink of the
  live name, which could delete a successor's fresh lock in a POSIX
  rename/unlink race) and the operation proceeds.

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
  initializing and logging messages, all contending on the still-legacy file
- THEN: every legacy entry survives, the final file is valid JSONL (does not
  start with `[`), and the total line count equals legacy + all writers'
  messages (2 legacy + 8 new entries = 10 lines) with every line parsing
  as a valid `LogEntry`.

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
   `fs.utimes`; `logMessage` completes without manual release; entry on
   disk; the broken lock is gone and no `.brk`/`.rel` guard junk
   remains in the log dir (stale-file-removal assertion).
4. REQ-LOCK-003: fresh lock + `LLXPRT_LOG_LOCK_TIMEOUT_MS=250`;
   `logMessage` resolves without throwing, messageId unchanged, nothing
   appended, debug-logged; `initialize` completes with `initialized === false`.
   Restore env.
5. REQ-LOCK-005: after initialize + several logMessage + close, readdir shows
   no `.lock` file; two same-process instances interleaving logMessage calls
   both complete (existing loggerJsonl test already covers the 0,0,1,1
   semantics — this adds lock-file cleanup assertions).
6. REQ-LOCK-005b (release-ownership): slow `fs.appendFile` with a 300ms
   pass-through delay; start a `logMessage` without awaiting; wait for its lock
   file; unlink the holder's lock and plant a fresh lock with a different
   token (successor); await the log; the successor's lock still exists with its
   exact original content (the release detected the inode mismatch and restored it via
   a hard link), the entry landed on disk, and no `.brk`/`.rel` guard
   junk remains.
7. REQ-LOCK-006 e2e: seed legacy pretty-printed array with 2 entries;
   spawn both child bun processes (driver) each doing initialize → migrate-or-load
   → 3 appends; then run the parent's `initialize` + 2 appends while the
   children run, so all three processes contend on the still-legacy file without
   any pre-migration; assert file: starts with `{` (JSONL), 2 legacy +
   8 new entries = 10 lines, all parse, legacy messages present in order, all
   8 new messages present exactly once.
8. REQ-LOCK-003b (bounded loop under persistent failure): plant a dangling
   symlink at the lock path (`open('wx')` fails EEXIST while `stat` reports
   ENOENT) with `LLXPRT_LOG_LOCK_TIMEOUT_MS=250`; `logMessage` settles within
   a bounded time (no hot loop), does not throw, writes nothing, and leaves
   messageId unchanged. Regression for the acquire loop that once bypassed its
   deadline via `continue` and wedged `close()`.
9. REQ-LOCK-002b (migration-retry reload): fail the pre-migration backup
   exactly once (`fs.copyFile` one-shot fault injection) so initialize's
   eager migration is swallowed while `_diskIsLegacy` stays true; another
   process migrates the file and appends a foreign entry; the victim's
   `logMessage` retries migration under a new lock hold and must re-read
   disk inside that hold and adopt the migrated file — the foreign entry
   survives (a stale-snapshot rewrite would destroy it).
10. Regression: existing logger/loggerJsonl suites unchanged and green.

The test suite uses REAL timers (no `vi.useFakeTimers`) since it exercises
real backoff/polling.

## Known limitations (accepted design boundaries)

- The lease is unfenced: a holder starved past `LOCK_STALE_MS` without a
  heartbeat landing (laptop sleep, event-loop starvation, SIGSTOP) can be
  broken while still mid-critical-section, and the mechanism cannot inform
  it. Inherent to timeout-based advisory lockfiles (proper-lockfile's
  `onCompromised` exists for the same reason). Release detects the takeover
  after the fact and restores the successor's lock.
- Between the guard rename and the restoring hard link (in both the stale
  break and the release), the live lock path is transiently absent. A third
  contender entering that two-syscall window — after a stale break has
  already occurred — can leave two processes believing they hold the lock.
  Guard junk files left by that race are inert (never at the `.lock` path)
  and are pruned by `_pruneOldBackups`.
- Under `vi.useFakeTimers` with a frozen system clock, a CONTENDED acquire
  would never reach its deadline (Date.now frozen) nor fire its backoff
  (setTimeout frozen). No existing test contends under fake timers (the
  locking suite uses real timers; the legacy suites are single-instance and
  `_writeQueue`-serialized), but future tests must not combine fake timers
  with lock contention.
- The restoring hard link assumes hardlink support. On filesystems where
  `link(2)` fails for reasons other than EEXIST (FAT/exFAT, some CIFS/NFS
  mounts) a restore can never succeed; a kidnapped lock stays at its guard
  path and the live path is left vacant until waiters re-acquire. The lock
  lives under the user's global log dir (APFS/ext4/zfs/btrfs in practice),
  all of which support hardlinks, so this is an accepted boundary, not a
  handled case. A link-retry loop cannot succeed on such mounts and
  rename-back could clobber a successor, so no blind fallback exists.
- If a broken holder releases in the window between a breaker's guard rename
  and the breaker's restoring link, the restore can resurrect an ownerless
  lock at the live path with a fresh mtime. Waiters then stall until it ages
  past `LOCK_STALE_MS` (30s) and is reclaimed. Bounded self-healing: no
  exclusion break, no data loss.

## Implementation sketch (for the implementer)

All changes in `packages/core/src/core/logger.ts` (module-private; no new
exports, no new files in production code):

- Constants: `LOCK_FILE_SUFFIX = '.lock'`, `LOCK_STALE_MS = 30_000`,
  `LOCK_HEARTBEAT_MS = 10_000`, `LOCK_BACKOFF_MS = 25`, default
  `LOCK_TIMEOUT_MS = 5_000` overridable via
  `process.env.LLXPRT_LOG_LOCK_TIMEOUT_MS` read at acquire time (test-only:
  gated on `NODE_ENV === 'test'` so it cannot silently degrade production
  appends).
- Private `async _withLogLock<T>(fn: () => Promise<T>): Promise<T>`: acquire
  (hardened protocol below), run `fn`, release in `finally`, and run a 10s
  heartbeat that re-stamps the held lock so a long critical section (large
  legacy migration, slow FS) cannot age past the staleness threshold.
- Hardened acquire. Each contender creates the lock with `open('wx')` (O_EXCL),
  writes a `{pid, timestamp}` diagnostic payload, and KEEPS THE DESCRIPTOR OPEN
  for the whole critical section: the pinned inode is the ownership proof, it
  cannot be recycled while the descriptor is open, and the steady-state append
  path stays read-free (no payload read-back — the O(1) contract the existing
  suites assert via `fs.readFile` spies). The heartbeat refreshes the lease with
  `handle.utimes()`, which touches only our pinned inode, never the lock path,
  so a broken holder can never extend a successor's lease. A stale lock (mtime
  older than `LOCK_STALE_MS`) is broken WITHOUT a bare unlink of the live path:
  the name is atomically renamed to a unique `.brk` guard (renames are atomic
  and only one waiter can win), the moved file is re-verified as stale after
  the rename, and only then removed; a file that proved fresh is restored with
  a hard link (`link` fails on EEXIST rather than overwriting) so a waiter can
  never clobber a successor's lock the POSIX rename/unlink way. If acquisition
  created the lock but finalizing failed, the just-created lock is removed so
  waiters never trip on an ownerless file.
- Hardened release. The lock is never bare-unlinked while releasing either: the
  name is renamed to a unique `.rel` guard and the guard's inode compared with
  the pinned descriptor's `fstat` inode — an exact identity check that needs no
  file read and no TOCTOU window. Only our own inode is unlinked; a mismatched
  guard (our lock was broken and a successor owns it) is restored at the live
  path via a hard link.
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

| Phase | ID | Status | Notes |
|---|---|---|---|
| 1 RED tests | P1 | done | 10 locking tests incl. 005b release-ownership |
| 2 GREEN impl | P2 | done | O_EXCL + rename-guard + pinned-inode ownership + heartbeat |
| 2b review round 1 | P2b | done | deepthinker: 2 HIGH (TOCTOU break, no lease) + leak + test gaps — all fixed |
| 2c review round 2 | P2c | done | architect: HIGH acquire-loop deadline bypass + MEDIUM stale-snapshot migration wipe — fixed with 003b/002b regressions; LOW items triaged (see Known limitations) |
| 3 verification + review | P3 | done | lint/typecheck/format/build/smoke all exit 0. Full `npm run test` exit 1 with 23 failures, all attributed: 5 grep/ripgrep stash-proven pre-existing; agents 180s/5s wall-clock timeouts — hookAdmin/mutationCoverage/core-tools recover in isolation (load 200-260), session.spec checkpoint + providerActivation fail IDENTICALLY on unmodified main (temp-worktree proof). Logger suites 34/34 on final commit. |
| 3b OCR round 1 (local) | P3b | done | 4 findings: 2 fixed (debug-string loosened, TEST_CONFIG_HOME cleanup), seam gated to NODE_ENV=test, 1 medium rejected with rationale (hardlink-less FS boundary — documented in Known limitations) |
| 3c OCR round 2 (PR) | P3c | done | 4 findings: 3 fixed (lazy re-init self-heal after init lock timeout with `_closed` guard + REQ-LOCK-007 regression; guard prune cutoff 24h + REQ-LOCK-008; child stdout 'ignore'), 1 rejected with rationale (driver-filename move to os.tmpdir() would break bare-import resolution from repo node_modules; pid-keyed names cannot collide across live processes; pre-cleaning stale drivers would race concurrently-running siblings) |
