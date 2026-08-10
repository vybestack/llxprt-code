# Issue #3164 — Functional, bounded, concurrency-safe session cleanup

Plan ID: PLAN-20260808-SESSION-CLEANUP

## 1. Accepted behavior

### AC-1 — Cleanup discovers the recorder's real format

Cleanup scans `session-*.jsonl` recordings produced by `SessionRecordingService` and
uses the same canonical JSONL header reader as session discovery/resume. It does not
parse recordings as legacy whole-file `ConversationRecord` JSON.

A behavioral contract test creates a session through the real recorder and proves that
cleanup discovers it. The test must fail if recorder and cleanup filename or header
handling drift again. BOM-prefixed and first-line headers larger than the old fixed
4096-byte read are covered.

The obsolete CLI-only legacy `.json` reader in `packages/cli/src/utils/sessionUtils.ts`
and legacy cleanup test helpers are removed once no production caller remains.

### AC-2 — Default-on, global size retention

With no `sessionRetention` setting, automatic cleanup is enabled with:

- `maxTotalSizeMB: 4096`, defined as 4096 MiB = 4 GiB;
- no default `maxAge`;
- no default `maxCount`;
- `minRetention: "1d"` as the safety floor.

`sessionRetention.enabled: false` disables all janitorial filesystem mutations.

The size budget is machine-wide across all recognized session recordings and cold
archives beneath every 64-hex project directory under `Storage.getGlobalTempDir()`.
It is not a per-project limit. Both raw JSONL and gzip archive physical bytes count.
Where allocated block information is available, cleanup uses it; otherwise, including
Windows filesystems that do not expose blocks, it uses file length.

User-provided `sessionRetention` objects are resolved over defaults at the consumer so
a partial object cannot accidentally remove default-on size bounding.

### AC-3 — Optional age and count retention

Users may explicitly configure `maxAge` and `maxCount`. Neither is supplied by default.
A defaults-only run below the size budget retains an otherwise eligible recording even
if it is years old.

Explicit age and count limits preserve their retention meaning: once the minimum
retention floor and live-data protections are satisfied, recordings outside an explicit
age/count limit may be removed. The limits apply globally, matching the global sweep.
Invalid retention values fail validation clearly; they are not silently normalized into
a different policy.

### AC-4 — Cold lossless archive before size-driven deletion

For size-driven reclamation, eligible inactive JSONL recordings are losslessly gzip
compressed before any session history is deleted. Archives use a standard gzip format
under a non-recursed `chats/archive/` directory and preserve the original JSONL bytes
for long-term telemetry and offline analysis.

Cold archives are intentionally not listed by `/continue` or the session browser and
are not appendable. Restoring one is a manual/offline operation in this PR. No live
recording, replay, checkpoint, or mutation path is changed to treat gzip as the active
recording format.

Compression uses built-in streaming zlib with bounded memory and no new dependency.
The lifecycle is crash safe:

1. Stream the source into a unique temporary gzip file in the destination directory.
2. Close and durably flush the temporary file where supported.
3. Stream-decompress and verify byte count and SHA-256 identity against the source.
4. Atomically rename the verified temporary file to its final archive name.
5. Only then unlink the source while holding exclusive session ownership.

At every interruption point at least one intact copy remains. Stale temporary artifacts
are recognizable, ignored by normal readers, and removed only by the elected janitor
after a conservative age threshold.

Archives count toward the same 4 GiB budget and are evicted oldest-first only after
eligible raw recordings have been compressed. This keeps total disk usage bounded while
retaining substantially more original history than direct JSONL deletion. If the
compressed corpus itself exceeds the configured budget, the oldest eligible cold
archives are deleted until the budget is met.

### AC-5 — Global reach without unsafe project inference

The elected janitor scans every direct child of `Storage.getGlobalTempDir()` whose name
is exactly a 64-character lowercase hexadecimal project hash. It does not infer project
ownership or orphan status from recording `workspaceDirs`; that metadata does not
reliably identify the project root that produced the directory.

Oldest eligible sessions are reclaimed globally with deterministic tie breaking. A run
started from one project may therefore reclaim old eligible recordings from another
project; this is required for one machine-wide bound and for reaching abandoned project
hash directories.

The janitor never recursively deletes a project directory. It removes `chats/` and a
project hash directory only through non-recursive empty-directory removal after a fresh
emptiness check.

### AC-6 — Single cross-process janitor without a service or socket

Concurrent LLxprt startups use a filesystem-only lease in the global temp directory.
Lease acquisition uses atomic exclusive creation. The lease carries a random owner
token, PID, hostname, and creation time.

- Exactly one normally concurrent starter wins and performs the full sweep.
- Non-winners detect the live lease, skip cleanup immediately, and continue startup.
- The winner heartbeats during a long sweep.
- Release removes the lease only when its on-disk owner token still matches.
- A crashed winner cannot disable cleanup forever: stale takeover uses filesystem
  identity checks, hostname-aware PID liveness as an accelerator, and a fixed age bound
  that PID reuse cannot extend indefinitely.
- Any ambiguous or platform-specific lease error fails toward skipping cleanup.
- Even if a pathological stale-takeover race allows overlapping sweep work, each
  destructive session operation remains independently ownership-safe and idempotent.

This is an internal implementation detail, not a new public abstraction or IPC service.

### AC-7 — Active-session and resume safety

Cleanup never archives or deletes:

- the process's current session ID;
- a recording with a live session lock;
- a recording newer than `minRetention`;
- an unreadable recording whose full session identity and lock ownership cannot be
  established safely.

Before moving or unlinking a raw recording, cleanup acquires exclusive ownership through
`SessionLockManager` and revalidates the candidate after acquisition. A prior PID check
alone is insufficient because lock acquisition/replacement can race cleanup.

If another process wins the session lock, the candidate is retained. A process that has
not yet acquired the lock for a pending resume target cannot reserve that target merely
through intent; the minimum-retention floor and ownership-at-deletion contract provide
the bounded startup protection without inventing broader coordination.

If protected or unreadable data prevents reaching the configured budget, cleanup retains
it and reports the remaining over-budget bytes rather than risking user data.

### AC-8 — Stale session locks are actually cleaned

Startup's elected global sweep invokes stale-lock cleanup in every recognized chats
directory. It reuses the existing PID-reuse-aware 48-hour lock predicate rather than
inventing a second session-lock age rule.

Stale-lock takeover, deletion, and release are hardened against ownership replacement.
A cleanup process never removes a lock that another process replaced or acquired after
the stale determination. Live-PID locks whose JSONL file has not materialized are kept.

### AC-9 — Cross-platform, bounded-resource behavior

The implementation works on Windows, macOS, and Linux using Node/Bun filesystem and zlib
APIs already available in the repository.

- Directory/header/stat work uses bounded concurrency; it never launches an unbounded
  `Promise.all` over the corpus.
- Header discovery does not read entire recordings.
- Compression and verification are streaming and bounded-memory.
- Files are compressed serially or with a deliberately small fixed concurrency.
- Same-directory temporary files make final rename same-filesystem.
- `ENOENT` from a concurrent unlink/rmdir is benign.
- Windows `EPERM`, `EACCES`, `EBUSY`, antivirus interference, and rename failures retain
  the candidate and do not abort CLI startup.
- `ENOTEMPTY` during empty-directory removal retains the directory.
- Cleanup remains best-effort for external filesystem failures and is awaited at the
  existing startup integration point.

The full global metadata sweep is retained as accepted behavior; there is no cursor,
per-project reachability heuristic, or arbitrary wall-clock cutoff that can permanently
leave old project directories unreachable.

### AC-10 — Strict deletion blast radius

Cleanup may remove only:

- selected `session-*.jsonl` recordings after session-lock ownership is acquired;
- cold `archive/session-*.jsonl.gz` files selected by the retention policy;
- its own stale temporary/archive artifacts;
- safely stale session `*.lock` files;
- its owner-checked global janitor lease;
- genuinely empty `chats/` and 64-hex project directories using non-recursive removal.

It never follows symlinks and never derives a deletion target from recording content.
It never touches checkpoints outside the recording, `logs.json`, backups,
`shell_history`, debug logs, token-usage data, OTEL data, performance logs, or unknown
entries. Existing cleanup behavior that deletes similarly named debug files is removed
rather than carried into the session-recording janitor.

### AC-11 — Result and diagnostics

Cleanup reports enough structured result information to prove and diagnose behavior:
scanned recordings, raw recordings archived, raw/archive files deleted, stale locks
removed, skipped/protected candidates, failures, bytes before/after, configured byte
limit, remaining over-budget bytes, and whether this process won or skipped the janitor
lease.

External filesystem failures are logged and counted without stopping startup. Internal
configuration errors are surfaced clearly rather than swallowed.

## 2. Behavioral evidence

All new or changed tests use Bun and `bun:test`. Cleanup tests use real temporary
filesystems rather than filesystem mocks or mock-call assertions.

### Writer/reader contract

- Create recordings with the real `SessionRecordingService` and prove cleanup scans them.
- Cover ordinary JSONL, UTF-8 BOM, and a valid first header line beyond 4096 bytes.
- Prove the legacy `.json` reader is no longer in the cleanup path.

### Retention behavior

- Defaults are enabled, use 4 GiB, and do not age-delete an old under-budget session.
- A partial configuration retains unspecified defaults.
- Explicit `maxAge`, `maxCount`, `minRetention`, and small injected size budgets exercise
  deterministic boundaries without allocating multi-gigabyte fixtures.
- The global budget includes raw JSONL and gzip archives across multiple hash dirs.
- Current, recently created, live-locked, and identity-unreadable recordings survive.
- Protected data exceeding the budget yields a reported shortfall.

### Compression and crash recovery

- Gzip round-trip bytes and SHA-256 are identical to the recorder-produced JSONL.
- Source unlink occurs only after archive verification and final rename.
- Interrupted states before rename and between rename/unlink retain an intact copy and
  converge safely on the next sweep.
- Truncated or unverifiable gzip leaves the source untouched.
- Large incompressible and compressible fixtures prove bounded-memory streaming.
- Archive files remain available to standard gzip/offline analysis while discovery and
  `/continue` intentionally ignore them.

### Concurrency and locks

- Real concurrent subprocesses compete for one janitor lease and exactly one normal
  winner mutates a marker corpus.
- A busy lease causes immediate skip with no cleanup mutation.
- Owner-token mismatch prevents release from removing another process's lease.
- A killed lease holder is eventually reclaimable, including a simulated reused PID.
- Concurrent session-lock acquisition versus archive/delete retains the session unless
  the janitor acquired exclusive ownership first.
- Competing stale-lock cleanup cannot unlink a replacement live lock.
- Concurrent `ENOENT` and `ENOTEMPTY` outcomes are benign.

### Traversal and platform boundaries

- Multiple 64-hex project dirs are swept globally.
- Non-hash top-level dirs, symlinks, nested unknown files, `token-usage/`, and `otel/`
  remain byte-identical.
- Empty directories are removed non-recursively; repopulated directories survive.
- Platform-specific allocated-size fallback and Windows busy/permission behavior are
  tested without weakening assertions on supported platforms.

## 3. Test-first implementation sequence

1. Replace legacy cleanup tests with real recorder/filesystem discovery tests and observe
   them fail against the `.json` reader.
2. Unify cleanup discovery with the canonical JSONL header reader; remove the dead legacy
   reader only after its callers are gone.
3. Add settings/default/validation tests, then implement default-on 4 GiB global policy
   resolution with optional explicit age/count.
4. Add real cross-process lease tests, then implement the internal filesystem janitor
   election and stale recovery.
5. Add lock-race tests, then harden session-lock stale takeover/release and require
   exclusive session ownership for every raw recording mutation.
6. Add global traversal and blast-radius tests, then implement bounded-concurrency scanning
   and production stale-lock invocation.
7. Add lossless archive/crash-state tests, then implement streaming gzip archival and
   verified source removal.
8. Add aggregate ordering tests, then implement raw compression followed by archive
   eviction until the configured global budget is met or only protected data remains.
9. Update generated settings schema/documentation through established project scripts and
   run the full verification gate.

Every production change is made in response to a naturally failing behavioral test.
Tests assert observable filesystem/results behavior and would fail if the production
implementation were removed.

## 4. Explicitly outside this PR

- Transparent/resumable gzip recordings or automatic archive restoration.
- Session segmentation, event compaction, or changing the append-only JSONL format.
- A new cleanup CLI command, daemon, IPC service, dependency, public maintenance API, or
  workflow.
- Cleanup of token-usage, OTEL, performance, debug, or conversation-log files.
- Wiring or deleting the unrelated `retentionDays`, `maxLogFiles`, and `maxLogSizeMB`
  conversation-logger settings. They predate this session janitor and control a distinct
  storage subsystem.
- Project-orphan inference from `workspaceDirs`.

These exclusions do not defer any accepted session-recording cleanup behavior: discovery,
default global bounding, lossless cold archival, eventual archive eviction, global reach,
stale locks, and concurrency safety are all delivered here.

## 5. Verification gate

Run on the candidate head:

    npm run test
    npm run lint
    npm run lint:eslint-guard
    npm run typecheck
    npm run format
    npm run build
    bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"

Before push, run Open Code Review detached with a 20-minute floor and verify Bun test files
are included. Review findings are classified as Blocker-Fix, In-scope-Fix, Reject, or
Defer; every Blocker-Fix and In-scope-Fix is resolved before the PR is declared ready.

## 6. Binding engineering constraints

- No ESLint or TypeScript suppression directives.
- No lint severity downgrade, ignore expansion, or complexity/size threshold increase.
- No new JavaScript or Vitest/Node test files; changed/new tests use Bun.
- No recursive deletion of project storage.
- No modification of `.llxprt/`.
- Fail fast for invalid internal configuration; fail toward retaining data at external
  filesystem and cross-process boundaries.
