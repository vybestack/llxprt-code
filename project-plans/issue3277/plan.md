# Issue #3277 — Session lock transition guard does not serialize stale takeover

## 1. Defect analysis

`packages/core/src/recording/SessionLockManager.internals.ts` implements a
per-session "transition guard" that is supposed to serialize every pathname
mutation on `<chatsDir>/<sessionId>.lock`. It does not.

`acquireTransitionGuard(lockPath)` claims the guard with
`link(lockPath, guardPath)`. Exactly one contender wins the link; every other
contender gets `EEXIST` and falls through to `tryReclaimGuard`.

`tryReclaimGuard` decides whether the incumbent claim is abandoned by calling
`checkStaleWithPidReuse(guardPath)`. Because the guard is a hard link of the
lock inode, that call inspects the **victim lock's** payload, not the
**claimant's**. During a stale takeover the victim is stale by construction, so
every loser concludes the incumbent claimant crashed, unlinks the incumbent's
guard, and relinks its own. The guard therefore provides no mutual exclusion in
the only situation it exists for.

`verifyTransitionClaim(lockPath)` compares `stat(lockPath)` against
`stat(guardPath)` by `dev`/`ino`. A stolen guard is a hard link to the same
inode, so the check passes for the thief and the victim alike.

Two further consequences follow from the same root cause:

- `releaseTransitionGuard` unlinks `guardPath` unconditionally, so a contender
  deletes whatever guard happens to be installed, including another process's.
- When the lock does not exist, `acquireTransitionGuard` returns `true` without
  installing anything, and the caller's `finally` still calls
  `releaseTransitionGuard`, deleting a guard it never owned.

### Why contention can resolve with zero winners

The zero-winner outcome reported in the issue follows directly. Every contender
believes it holds the guard. Each one runs
`read original -> checkStale -> re-read -> verifyTransitionClaim -> unlink -> create`.
`verifyTransitionClaim` calls `stat(guardPath)`. Contenders are continuously
unlinking and relinking `guardPath` (in `tryReclaimGuard`, and in the `finally`
of `tryStaleTakeover`), so `stat(guardPath)` can throw `ENOENT` for *every*
contender in turn. Each then returns `false` from `tryStaleTakeover` and throws
`SessionLockedError`. Nobody unlinks the stale lock, nobody creates a
replacement, and the whole race returns in well under the 500 ms a winner would
have spent holding the lock. That matches the reported failure exactly (three
`SKIP`s, 63 ms, lock left unclaimed).

## 2. Acceptance criteria

- **AC-1 — Guard carries its own identity.** The transition guard is a distinct
  file whose payload identifies the claimant: `pid`, `timestamp`, a random
  `claimToken`, and the `dev`/`ino` of the lock observed at claim time. It is no
  longer a hard link of the lock inode.
- **AC-2 — Guard installation is exclusive.** At most one live claimant holds
  the guard. A contender that loses the exclusive install and cannot prove the
  incumbent claimant is abandoned reports busy.
- **AC-3 — Reclaim depends on claimant liveness.** A guard is reclaimable only
  when its own payload indicates abandonment (dead PID, or an alive PID past the
  48-hour PID-reuse bound, or an unreadable/corrupt guard older than that bound).
  The staleness of the lock being taken over must never make the guard
  reclaimable.
- **AC-4 — Reclaim never displaces a live claimant.** Concurrent reclaimers of
  the same abandoned guard resolve to at most one new holder, and a claim that
  becomes live between the liveness check and the reclaim is restored rather
  than discarded.
- **AC-5 — Claim verification detects theft.** `verifyTransitionClaim` returns
  true only when the guard on disk still carries *this* claim's `claimToken`
  **and** the lock still has the `dev`/`ino` recorded at claim time. Relinking
  the same lock inode cannot forge a claim.
- **AC-6 — Release is ownership-checked.** A process unlinks the guard only
  while it still carries that process's `claimToken`. A process that never
  installed a guard never unlinks one.
- **AC-7 — Contention resolves to exactly one owner.** Contention over a
  genuinely stale lock always produces exactly one winner. `winners.length === 1`
  stays as-is; it is not relaxed to `<= 1`. No contender reports `LOST`, and no
  `.tguard` or `.locktmp` artifacts remain afterwards.
- **AC-8 — Existing janitor behaviour is preserved.** `cleanupOrphanedLocks`
  still removes safe-grammar guards whose claimant is dead, still refuses to
  remove live guards, still refuses to remove unsafe-named guards and unknown
  `.locktmp` files, and the existing lock-removal semantics are unchanged.

### Out of scope

`packages/core/src/recording/janitor/janitorLease.ts` implements the same
hard-link claim protocol (`acquireTransitionClaim` / `tryReclaimClaim` /
`verifyTransitionClaim`) for janitor leases. Its reclaim path reads the *lease*
content rather than the claimant's, so it is structurally similar. The issue is
scoped to `SessionLockManager`, and the lease claim is a separate mechanism with
its own tests, so it is **not** changed here. Recorded as a follow-up.

## 3. Design

### 3.1 Guard payload

```ts
interface TransitionClaim {
  /** Path of the guard file this claim installed. */
  guardPath: string;
  /** Random token unique to this claim. */
  claimToken: string;
  /** dev/ino of the lock observed when the claim was installed, or null. */
  lockIdentity: { dev: string; ino: string } | null;
}
```

On-disk guard payload (JSON):

```json
{
  "pid": 1234,
  "timestamp": "2026-08-23T00:00:00.000Z",
  "claimToken": "<uuid>",
  "lockDev": "16777232",
  "lockIno": "627806075"
}
```

`dev`/`ino` are stored as decimal strings so a JSON round-trip cannot lose
precision on filesystems with large inode numbers.

`pid` and `timestamp` use the same key names the existing
`checkStaleWithPidReuse` already reads, so that function can be reused verbatim
to answer "is this claimant abandoned?" — dead PID means abandoned, an alive PID
means abandoned only past the 48-hour bound, and an unreadable or corrupt guard
falls back to the mtime bound. That is precisely AC-3.

### 3.2 Install (exclusive)

```
tempPath = <lockPath>.<uuid>.locktmp
write payload to tempPath with O_EXCL, fsync, close
link(tempPath, guardPath)      // EEXIST => someone else holds it
unlink(tempPath)               // always
```

The temp name deliberately reuses the existing `<safeSessionId>.lock.<uuid>.locktmp`
grammar so the existing `cleanupStaleLockTemp` orphan sweep already covers guard
temps; no new cleanup path is introduced.

The lock's `dev`/`ino` are stat'ed immediately before the payload is written. If
the lock does not exist, `lockIdentity` is `null`; the guard is still installed
so mutators still serialize, and `verifyTransitionClaim` then returns `false`,
which matches today's behaviour (today `stat(guardPath)` throws and verification
fails).

### 3.3 Reclaim (liveness-based, non-displacing)

Abandonment is decided by `isGuardAbandoned(guardPath)`:

```
parse guardPath as JSON
if unparseable, or claimToken is not a non-empty string:
    return isOlderThanBound(guardPath)     // no discoverable claimant
return checkStaleWithPidReuse(guardPath)   // our format: claimant liveness
```

The `claimToken` gate matters. A guard written by the pre-fix revision is a hard
link of the lock inode, so its payload describes the **victim lock**, not the
claimant. Feeding that to `checkStaleWithPidReuse` is precisely the defect: over
a stale lock it reads as abandoned to every contender simultaneously. A guard
this implementation did not write has no discoverable claimant, so the
conservative answer is busy, reclaimable only once it passes the existing
48-hour age bound. This matches the file's existing posture that unreadable and
corrupt files are busy rather than instantly stale. Orphaned legacy guards still
converge, because the janitor's `cleanupStaleGuard` sweep (unchanged) removes
safe-grammar guards whose payload PID is dead.

```
if (!isGuardAbandoned(guardPath)) return null;   // live/unattributable -> busy

capturePath = <lockPath>.<uuid>.locktmp
rename(guardPath, capturePath)      // atomic; ENOENT => another reclaimer won
if (!isGuardAbandoned(capturePath)) {
  link(capturePath, guardPath)      // restore; EEXIST => already reinstalled
  unlink(capturePath)
  return null                        // never displace a live claim
}
unlink(capturePath)
return installGuard(lockPath)        // exclusive install; may still lose
```

`rename` moves the guard out of the well-known name atomically, so exactly one
concurrent reclaimer captures a given abandoned guard; the others get `ENOENT`
and back off. Re-running the abandonment check on the captured inode closes the
window where a different, live claim was installed between the first check and
the rename: the captured file is out of the shared namespace and nobody else can
modify it, so the second check is authoritative. A live capture is put back.

The worst outcome of a losing reclaimer is a brief interval in which `guardPath`
is absent; a live holder that calls `verifyTransitionClaim` during that interval
fails verification and aborts without mutating. Safety is preserved; only
liveness (a retryable busy result) is affected, and only when a claimant has
actually crashed.

### 3.4 Verification

```
verifyTransitionClaim(claim):
  if (claim.lockIdentity === null) return false
  read guardPath, parse, require claimToken === claim.claimToken
  stat(lockPath), require dev/ino === claim.lockIdentity
```

The token check is what a thief cannot forge by relinking the lock inode (AC-5).
The `dev`/`ino` check preserves the existing protection against the lock being
replaced between claim time and mutation; it is now recorded in the claim
payload instead of being inferred from the guard's own inode.

### 3.5 Release

```
releaseTransitionGuard(claim):
  read guardPath, parse
  if (claimToken !== claim.claimToken) return   // not ours -> leave it
  unlink(guardPath)
```

Mirrors the existing `releaseIfOwned` token-checked pattern for locks (AC-6).

### 3.6 Call-site changes

`acquireTransitionGuard` returns `TransitionClaim | null` instead of `boolean`.
The three mutators — `tryStaleTakeover`, `tryRemoveStaleLock`, `releaseIfOwned` —
thread the claim through to `verifyTransitionClaim(claim)` and
`releaseTransitionGuard(claim)`. Public API is unchanged; every touched symbol
is module-private.

Error handling stays conservative and matches today's surface: any failure to
install a guard yields `null` (treated as busy) rather than throwing, so
`handle.release()` and the janitor sweep cannot start throwing new I/O errors.

## 4. Test plan

All tests are behavioural and go in the existing
`packages/core/src/recording/SessionLockManager.safety.test.ts`, exercising the
public `SessionLockManager` API plus direct on-disk inspection of the guard
file. No mock theater; no new test files.

New describe block: `SessionLockManager — transition guard identity (Issue #3277)`.

| Test | Covers | Behaviour |
| --- | --- | --- |
| T1 | AC-2, AC-3, AC-6 | Stale lock (dead PID, 49 h mtime) plus a guard file whose payload has **this test process's live PID** and a distinct `claimToken`. `acquire` rejects with `SessionLockedError`; the guard file is byte-identical afterwards; the stale lock still exists. Under the current code the contender walks through the guard and acquires. |
| T2 | AC-3 | Same stale lock, guard payload with a **dead PID**. `acquire` resolves; the acquired lock carries a fresh `ownerToken`; after `release` neither the lock nor the guard remains. |
| T3 | AC-3 | Stale lock plus a guard whose payload has a live PID but a `timestamp` 49 hours old. `acquire` resolves (PID-reuse bound reclaim). |
| T4 | AC-3 | Stale lock plus a **corrupt, recent** guard. `acquire` rejects with `SessionLockedError` and the guard survives. |
| T5 | AC-3 | Stale lock plus a **corrupt guard with a 49-hour mtime**. `acquire` resolves. |
| T6 | AC-1 | While a lock is held, the guard is absent; a legacy-format guard (a hard link of a *live* lock) is not treated as reclaimable. Concretely: live lock plus a guard hard-linked to it, `acquire` rejects and the guard survives. |
| T7 | AC-6 | `removeStaleLock` on a stale lock guarded by a live claimant leaves both the lock and that claimant's guard in place. |
| T8 | AC-1, AC-7 | A normal `acquire`/`release` cycle leaves no `.tguard` and no `.locktmp` in `chatsDir`. |
| T9 | AC-2, AC-3 | **The issue's proof scenario.** Lock with a dead PID and a *recent* mtime (stale by the dead-PID rule, not by age), plus a guard hard-linked to it — exactly what a pre-fix claimant mid-takeover leaves on disk. `acquire` rejects with `SessionLockedError`, the guard survives pointing at the same inode, and the lock keeps its original `ownerToken`. |
| T10 | AC-6 | `removeStaleLock` with **no lock present** and a live claimant's guard on disk leaves that guard intact. Pre-fix, `acquireTransitionGuard` returned `true` on `ENOENT` without installing anything and the caller's `finally` unlinked the guard it never owned. |

#### Which tests fail before the fix, and why the others cannot

Only **T9** and **T10** fail against the unfixed implementation, and that is a
property of the defect rather than a weakness in the suite. The pre-fix guard
format cannot express "a live claimant is guarding this lock" — the guard is a
hard link of the victim — so no fixture written in the new format can drive the
old code down its broken path. T1–T8 are contract tests for the new guard
semantics: they pin reclaim to claimant liveness and stop a future change from
regressing to a victim-content predicate. T9 is the regression test for the
reported defect and reproduces the issue's own proof verbatim; T10 covers the
unowned-guard deletion that falls out of the same root cause.

Pre-fix output for T9:

```
(fail) a hard-link guard over a stale lock is not reclaimable and blocks takeover
  Expected promise that rejects
  Received promise that resolved: Promise { <resolved> }
```

Existing tests that must keep passing unchanged:

- `exactly one of several competing stale-takeover subprocesses wins` (AC-7).
- `winner lock cannot be removed by concurrent stale-takeover contender
  (hard-link claim)` — assertion `winners.length === 1` stays; `lost.length === 0`
  stays; no leftover `.tguard`/`.locktmp` stays (AC-7). Its doc comment is
  updated to describe the identity-bearing guard rather than the hard-link claim,
  and the title's parenthetical is updated accordingly.
- `SessionLockManager.test.ts` guard-cleanup tests: stale guard with dead PID is
  removed, live guard is kept, unsafe-named guard is kept (AC-8).

Determinism note: T1–T7 are single-process, fixture-driven and deterministic.
The subprocess race tests remain the only timing-sensitive tests, and the fix
removes the interleaving that made them flaky.

## 5. Verification

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus a repeated run of the two subprocess race tests under CPU load, since the
original symptom only reproduced on a loaded machine:

```
cd packages/core
for i in $(seq 1 10); do bun test src/recording/SessionLockManager.safety.test.ts || break; done
```

## 6. Review triage

Review round 1 (deepthinker) returned CHANGES-REQUIRED. Triage:

| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | HIGH | `tryReclaimGuard` renamed whatever occupied `guardPath`, not the guard it had judged abandoned. A reclaimer that paused after its decision could rename away a live claim installed in the meantime, and its best-effort restore could then lose to a third contender, leaving two processes past verification. | **In-scope-Fix.** Two changes, below. |
| 2 | HIGH | The janitor's `cleanupStaleGuard` is check-then-unlink and can unlink a live claim installed after its classification. | **In-scope-Fix.** Same defect class in the same guard mechanism; routed through the shared non-displacing protocol. |
| 3 | MEDIUM | `releaseTransitionGuard` reads the token and unlinks in two steps. | **Reject.** Reaching it needs our own claim to pass the 48-hour PID-reuse bound while this process is alive and mid-release; claims live for milliseconds. Every remedy (rename-then-check) reintroduces the displacement of finding 1. Documented in the code. |
| 4 | MEDIUM | `rename` preserves mtime, so a capture could be immediately eligible for the 5-minute `.locktmp` sweep and be deleted mid-protocol. | **In-scope-Fix**, resolved structurally: the post-rename check is now an inode comparison, which `rename` also preserves, so no step depends on the capture's mtime. Losing a capture to the sweep now degrades to "busy". |
| 5 | MEDIUM | `String(stat().dev/ino)` cannot represent 64-bit Windows file IDs or inodes above 2^53, so two distinct files can compare equal. | **In-scope-Fix.** `fs.stat(path, { bigint: true })` via a new `statIdentity` helper. |
| 6 | MEDIUM | No test starts from an abandoned guard, so the reclaim branch is never exercised under contention. | **In-scope-Fix.** New subprocess race test, below. |
| 7 | LOW | All guard-install I/O errors collapse to "busy", hiding ENOSPC/EACCES. | **Reject** for the general case: this is the pre-fix error surface and changing what `release()` throws is outside the issue. **Accepted in part** for the specific case the reviewer identified as user-visible: a non-ENOENT `stat` failure on the lock used to yield a null identity, which fails verification and makes `releaseIfOwned` silently leave a lock this process owns. That now reports busy instead. |
| — | — | "Redesign reclaim around a true cross-platform file lock or a fencing protocol." | **Reject.** A new locking primitive is a redesign well beyond this issue, and POSIX offers no compare-and-swap unlink that would make it unnecessary. |

### 6.1 Non-displacing guard retirement (`retireGuardIf`)

Retirement no longer decides against the well-known path. It hard-links the
incumbent guard to a probe, judges the probe, and unlinks the probe. A guard
belonging to a live claimant is therefore never renamed, unlinked, or even
momentarily absent, so deciding "busy" costs a live claimant nothing. Only a
guard proved retirable is retired, via an atomic `rename` whose captured inode
must equal the probed inode; a different guard installed in between is restored.
`rename` also means exactly one of several concurrent reclaimers retires a given
guard.

The predicate is a parameter. `tryReclaimGuard` passes `isGuardAbandoned` (the
strict, claimToken-gated rule). `cleanupStaleGuard` keeps
`checkStaleWithPidReuse`, because the janitor is the escape hatch that lets a
legacy guard with no `claimToken` converge instead of waiting out the age bound,
and AC-8 requires its existing behaviour to be preserved.

### 6.2 Atomic stale-lock retirement (`retireStaleLock`)

The deeper answer to finding 1 is to stop depending on the guard for the
exactly-one-owner property. `tryStaleTakeover` and `tryRemoveStaleLock` no
longer `unlink(lockPath)`; they `rename` it out of the well-known path.

`rename` is the only pathname primitive POSIX offers that removes a name and
tells exactly one caller that it did so. A bare `unlink` cannot distinguish "I
removed the stale lock" from "I removed the replacement somebody else just
published". With the rename, every other contender's attempt fails with ENOENT,
and a caller that captures a lock whose content is not the payload it judged
stale restores that lock instead of destroying it. Contention over a stale lock
therefore resolves to a single owner even if the guard were bypassed entirely,
and the "no process unlinks another's lock" invariant no longer rests on the
guard alone.

### 6.3 New test

`exactly one contender wins when the stale lock already carries an abandoned
guard` — three subprocesses contend over a stale lock that already carries a
dead-claimant guard, so every contender must go through reclaim rather than the
uncontended install path. Exactly one winner, no `LOST`.

### 6.4 Open Code Review triage

OCR returned two findings, both on the retirement protocol introduced in 6.1 and
6.2, and both are regressions that change introduced rather than pre-existing
issues. Before this change a `.locktmp` file was always a redundant publication
copy, because the real lock still existed at `lockPath`. After it, a retirement
capture can briefly be the only copy.

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | On the restore-failure path both `retireStaleLock` and `retireGuardIf` unlinked the capture, destroying what could be a live lock or claim. | **In-scope-Fix**, later refined (see 6.7). The capture is parked rather than deleted when restoration fails for a reason other than the path already being occupied. |
| 2 | `cleanupStaleLockTemp` reclaims `.locktmp` files on age alone, so it would destroy a parked live lock five minutes later, or one left behind by a crash between the rename and the restore. | **In-scope-Fix.** The sweep is now payload-aware: an aged temp whose payload names a live owner is kept. Content that does not parse, or that carries no usable pid, is still a partial publication artifact and is still reclaimed, so the existing sweep behaviour is unchanged for the artifacts it was written for. |

Two behavioural tests were added in `SessionLockManager.test.ts` next to the
existing temp-sweep tests: an aged temp naming a live owner survives, and an
aged temp whose owner is dead is reclaimed.

### 6.5 Second review pass

A second independent review of the finished state returned CHANGES-REQUIRED,
centred on the claim that the protocol is fully serializing. Triage:

| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | HIGH | `retireGuardIf` still judges a probe and renames later, so a reclaimer that stalls between the two can rename a replacement guard. A ten-step chain across four processes, requiring an abandoned guard and a concurrent janitor sweep, ends with two processes holding lock handles. | **Reject as specified, accept as documentation.** The proposed remedy is "a cross-platform native file-lock abstraction or a fencing protocol" — a new locking subsystem, which is a redesign beyond this issue and needs approval. The reviewer also states the underlying truth: with `link`, `rename` and `unlink` there is no compare-and-swap, so no pathname protocol can establish the invariant. What the change does deliver is removing the defect that fires on *every* stale takeover and replacing it with a window that needs a crashed claimant, a concurrent janitor, four processes and a specific stall. The overclaiming comments have been corrected instead: the module header now says what the protocol does and does not promise. Recorded as a follow-up. |
| 2 | HIGH | The same stall can produce zero winners plus an orphan guard carrying a live PID. | **Reject as specified**, same root and same remedy. Narrower than the reported defect, retryable, and self-healing when the claimant exits or the janitor sweeps a dead PID. Restoring the captured guard is deliberate: it favours safety (never leave two claimants past verification) over liveness (an occasional retry). |
| 3 | MEDIUM | Guard-install collapses every I/O error into "busy", so a real ENOSPC/EACCES looks like contention, and a failed release silently leaves the lock. | **Split.** Accepted in part: installation now returns a tagged `installed` / `contended` / `failed` result, so only genuine contention consults an incumbent claim. Deferred in part: making `release()` throw or become retryable changes a public contract, and the leak on a failed release is pre-existing (the old `link`-based guard swallowed the same errors). Out of scope for this issue. |
| 4 | MEDIUM | `namesLiveOwner` mapped every read failure to "no owner", so a transient EACCES/EMFILE would let the temp sweep delete an unreadable parked live lock. | **In-scope-Fix.** This is a regression from the parking behaviour added in 6.4. Unreadable now means unknown and the file is kept; only a confirmed ENOENT, readable non-payload content, or a readable payload with a dead owner is disposable. |
| 5 | MEDIUM | The replacement interleavings are not deterministically tested; the abandoned-guard race test relies on scheduling. | **Defer.** The remedy requires adding pause hooks to the production protocol so tests can stall it at named points. Wiring test seams into a concurrency protocol is a design change with its own risk, and the interleavings in question are the residual accepted above. |
| 6 | LOW | `releaseTransitionGuard` read-then-unlink window. | **Accept as documented**, already commented at the call site. Needs a >48-hour pause or a clock jump to reach. |

One analysis point is worth recording as verified-safe rather than as a finding:
fresh publication in `acquire` does not take the guard, so a new lock can be
published while a takeover is in progress. That is not a violation. The
publisher competes through exclusive creation only, so the takeover's own
create then fails with EEXIST and reports busy. One owner either way; the
unguarded path can lose but cannot destroy.

### 6.6 Residual, stated plainly

POSIX has no compare-and-swap unlink or rename, so between any check and any
pathname mutation there is a window. This change does not close that class of
window and cannot with the primitives available.

What it does buy: the guard now identifies its claimant, so the reclaim
decision is about the claimant rather than the victim; a live claimant is never
displaced, because abandonment is judged against a probe; the single-owner
property for stale takeover is carried by an atomic rename rather than by the
guard; and no path deletes a lock or claim it has not proved disposable. The
defect in the issue fired on every stale takeover. What remains needs a crashed
claimant, several concurrent processes and a specific stall.

Closing the remainder means a real locking primitive — an OS file lock or a
fencing/generation protocol — which is a separate piece of work.

### 6.7 CI review: parking is only correct when restoration was actually possible

The OpenCodeReview job on the PR pointed out that parking on every restore
failure leaks a temp file for the lifetime of the owning process, because
`namesLiveOwner` then refuses to sweep it. **In-scope-Fix**, and the reviewer is
right on the substance, though the leak is bounded by the owner's process
lifetime rather than permanent.

Resolving it needed the question the earlier round had not asked: is a parked
capture ever read back? It is not. Capture and probe names are single-use UUIDs
that nothing records, and no code path restores a `.locktmp` into service. So
parking buys recovery for nobody; the actual protection against destroying a
live lock is the restore attempt itself.

Restoration fails for two different reasons, and they deserve different
answers:

- **EEXIST.** Another lock or guard already occupies the well-known path. The
  captured object is superseded and unreachable — its owner's `ownsLock()`
  already reports false, and a superseded claimant can no longer pass
  verification. Discarding it loses nothing, and parking it would leak.
- **Anything else** (ENOSPC, EPERM, and friends). The path may well be empty and
  the capture may be the only copy, so it stays parked and the payload-aware
  sweep reclaims it once its owner is gone.

`namesLiveOwner` stays, because it still governs that second case and crash
leftovers, but the leak is now confined to genuine I/O failures rather than
occurring on every lost race.

## 7. Follow-ups (not in this change)


## 7. Implementation notes (Issue #3277, added during implementation)

- **Deviations found when the tests were run against the unfixed code:**
  - The plan stated T1 "MUST FAIL ON THE CURRENT CODE". In practice T1 PASSED
    on the unfixed code. Under the old implementation the current code calls
    `checkStaleWithPidReuse(guardPath)`, and T1's fixture writes the guard as
    a **separate file** whose payload has this process's live PID with a fresh
    timestamp. Even with the old guard code the reclaim predicate therefore reads the
    guard's own content, sees a live claimant, and correctly refuses — so T1
    rejects with `SessionLockedError` and the guard survives on both the old and the
    new code. The old code only misbehaves when the guard *is* the lock inode,
    which cannot be combined with an independent "live claimant" payload (writing a
    payload through a hard link would rewrite the lock itself). T1 is kept exactly as
    specified; it is a regression pin on the new guard format rather than a red/green
    differentiator.
  - An additional fixture-driven test that the old code genuinely fails was added to
    the same describe block to close the gap: "removeStaleLock does not unlink a
    live claimant guard when the lock is absent". With the lock absent, the old
    `acquireTransitionGuard` returned true without installing anything and the caller's
    `finally` still unlinked `guardPath` (the "release a guard we never created"
    bug). The new code installs the claim even when the lock is absent and releases it
    token-checked, so the guard survives. Verified RED against the unfixed code
    (guard deleted, test failed with the readFile ENOENT) and GREEN after the fix.
- `janitorLease.ts` uses the same hard-link claim protocol and the same
  victim-content reclaim test. It should get the same identity treatment.
- Replace the pathname-based transition guard with a real locking primitive (an
  OS file lock, or a fencing/generation protocol). That is what would close the
  residual in 6.6, and it is a redesign rather than a fix.
- `release()` cannot report or retry a failed release, so an I/O error during
  release leaks the lock until it goes stale. Pre-existing; changing it means
  changing the public contract of `LockHandle.release`.
- The protocol assumes a local filesystem. `link`, `rename` and `O_EXCL` are not
  dependable over NFS or SMB, and `process.kill(pid, 0)` is host-local while a
  lock carries no hostname. Worth stating in user-facing docs, or enforcing.
