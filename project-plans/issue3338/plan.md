# Plan: Record streaming adds queued after a compression rebuild

Issue: #3338
Branch: `issue3338`
Base: `origin/issue3264` (PR #3336)
Labels: Context Management

## Problem and dependency

PR #3336 introduces a two-phase compression queue. It identifies the rebuild by
position: operations from the first queued `clear()` onward run before
`compressionLockReleased`, while operations before that `clear()` run after the
release events.

That fixes content queued before the rebuild clear, but it cannot identify a
streaming `add()` queued after the rebuild callback has queued its
`clear()` and retained entries. The late add is applied in the rebuild phase.
Its `contentAdded` event fires while `RecordingIntegration` still suppresses
content records, so replay cannot recover it.

Issue #3338 depends on #3336. This branch therefore starts from PR #3336's head,
and its pull request must remain stacked until #3336 lands.

## Accepted behavior

### AC-1: Rebuild work is identified explicitly

Compression rebuild callers must identify the synchronous `clear()` and re-add
block as rebuild work. Queue classification must not infer that boundary from
the first `clear()` or from operation position.

The known production callers are:

- `applyCompressionWithAnchor` in
  `packages/agents/src/compression/cacheAnchor.ts`.
- The fallback rebuild in
  `packages/agents/src/compression/pendingContextWindowEnforcement.ts`.
- The restore and retry rebuilds in
  `packages/agents/src/compression/providerContentEnforcement.ts`.

### AC-2: A late streaming add fires after the compression events

Given an active compression, an explicitly identified rebuild, and an ordinary
streaming `add()` queued after that rebuild but before `endCompression()`, event
order must be:

1. rebuilt entries' `contentAdded` events;
2. `compressionLockReleased`;
3. `compressionEnded` when summary and count are supplied;
4. the late streaming entry's `contentAdded` event.

For an argless or failed-shaped `endCompression()`, the existing conditional
`compressionEnded` behavior remains unchanged. The late streaming entry still
fires after `compressionLockReleased`.

### AC-3: History content and order are preserved

After the flush, final history must contain the rebuilt entries followed by all
streaming entries in their arrival order. This includes streaming entries
queued before the rebuild starts and entries queued after the rebuild callback
returns. A late `tool_response` or tool call must retain its payload and
identity.

### AC-4: Rebuilt entries remain unrecorded

`RecordingIntegration` must continue suppressing rebuilt entries. A retained
entry that was recorded before compression must have exactly one content record
after compression. The change must not reintroduce the duplicate recording
fixed by #3132.

### AC-5: Recording and replay recover the late entry

With the real `HistoryService`, `RecordingIntegration`,
`SessionRecordingService`, and `ReplayEngine`, the relevant persisted event
order must be:

`content` (original) -> `compressed` -> `content` (late streaming entry).

Replaying that session must yield the compression summary followed by the late
entry. No rebuilt retained entry may appear as a new content record.

### AC-6: Existing queue contracts remain intact

The #3336/#3264 behavior remains green:

- Streaming content queued before the rebuild clear survives and is emitted
  after the compression events.
- A compression window with no rebuild treats ordinary adds as streaming and
  preserves FIFO order.
- Queue operations are attempted under the existing failure aggregation rules.
- The #2852 never-drop and high-water-latch behavior is unchanged.
- Invalid or zero-block content keeps the existing rejection behavior.

## Inputs and boundary cases

- Empty rebuild: an identified rebuild may contain only `clear()`. A subsequent
  streaming add still runs after the release event.
- Multiple rebuilt entries: all remain before release and preserve rebuild
  order.
- Multiple streaming entries on both sides of the rebuild callback: all run
  after release in their original relative order.
- Multiple clear/retry sequences inside one identified rebuild scope: all are
  rebuild work and retain their existing execution and failure behavior.
- Rebuild helpers invoked when no compression lock is active: their history
  mutation remains synchronous and behaviorally unchanged.
- Summary-bearing, argless, and failed-shaped compression completion retain the
  existing event-presence rules.

## Test-first implementation plan

### RED

1. Extend
   `packages/core/src/services/history/compression-locking.test.ts` with a
   behavioral event-order test that identifies a rebuild, queues an ordinary
   add after it, calls `endCompression()`, and asserts AC-2 and AC-3.
2. Extend
   `packages/core/src/recording/RecordingIntegration.core.test.ts` with a real
   recording/replay round trip for AC-4 and AC-5.
3. Run both focused files and record the expected failures against the #3336
   head before changing production code.

### GREEN

1. Add one synchronous rebuild scope to `HistoryService`. While that scope is
   active, queued adds and clears are tagged as rebuild work. Ordinary adds
   outside the scope are tagged as streaming work, independent of their queue
   position.
2. Change `CompressionOperationQueue.flush()` to partition by the explicit
   rebuild/streaming tag while preserving FIFO order within each phase and the
   current failure aggregation.
3. Update the three production rebuild callers listed in AC-1 to use the scope.
4. Make only the test adjustments required by the explicit classification.

### REFACTOR

Refactor only if needed for naming, type clarity, or repository lint limits. Do
not alter recording payloads, replay format, token accounting, compression
strategy selection, or unrelated history APIs.

## Behavioral evidence

Required before completion:

- Focused history test proves exact event order and final history order for the
  late-add interleaving.
- Focused recording test proves persisted event order, no duplicate retained
  record, and replayed `[summary, late entry]` history.
- Existing #3264 tests prove pre-rebuild streaming adds still work.
- Existing agent compression suites covering the three rebuild callers pass.
- Test-audit comparison reports no new findings in touched tests.

## Verification gates

Run the full issue workflow cycle after implementation and after any review
remediation:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load zai "write me a haiku and nothing else"
```

Also run focused suites and the test-audit baseline comparison. Store logs under
`tmp/issue3338/` so concurrent worktrees cannot collide.

## Scope limits

In scope:

- One explicit, synchronous compression-rebuild scope on `HistoryService`.
- Queue classification based on that scope.
- Migration of the three known agent compression rebuild callers.
- The event-order and recording/replay tests described above.

Out of scope:

- Recording payload or JSONL schema changes.
- Replay format or replay policy changes.
- Compression strategy, cache-anchor policy, token accounting, or context-limit
  changes.
- General history transaction APIs or unrelated clear/add refactors.
- Re-entrant compression lifecycle changes.
- Optional cleanup or speculative queue hardening.

## Review finding triage

Every review finding will be recorded below as one of:

- **Blocker-Fix**: prevents an accepted behavior, safety property, required gate,
  or correct ancestry.
- **In-scope-Fix**: defect in changed code or accepted behavior that can be fixed
  without expanding scope.
- **Reject**: factually incorrect, already covered, or conflicts with the
  accepted behavior.
- **Defer**: valid concern outside the accepted behavior; no code change in this
  effort.

| Review source | Finding | Classification | Resolution |
| --- | --- | --- | --- |
| Review (A) | `HistoryService.rebuildWith` accepted `callback: () => void`, so TypeScript accepted `async` callbacks; an `await` exited the rebuild scope and mis-tagged the rest of the work as streaming (broken ordering/suppression). | In-scope-Fix | Typed the synchronous contract `callback: () => undefined` in `HistoryService.rebuildWith` and in the cross-package structural `historyService` type in `cacheAnchor.ts`; added a compile-time regression in `compression-rebuild-scope.test.ts` (`RejectsAsyncRebuild`). RED: typecheck failed against `() => void`; GREEN against `() => undefined`. All three agent call sites and both enforcer tests still compile. |
| Review (B1) | `applyCompressionWithAnchor` rebuild classification had no behavior test under an active compression lock. | In-scope-Fix | Added `applyCompressionWithAnchor under an active compression lock (#3338)` in `cacheAnchor.test.ts`: under a real `startCompression`, rebuild `contentAdded` fires before `compressionLockReleased`, both ordinary streaming adds (queued before the helper and after `rebuildWith`) finalize after the release in FIFO, and `getAll()` is rebuilt entries followed by streaming in arrival order. Mutation: removing the `rebuildWith` wrapper in `cacheAnchor.ts` fails the test (4 pass / 1 fail). |
| Review (B2) | `PendingContextWindowEnforcer` fallback rebuild classification had no behavior test under an active compression lock. | In-scope-Fix | Added a fallback-rebuild-under-lock test in `pendingContextWindowEnforcement.toolTruncation.test.ts` using the real enforcer + real `HistoryService` holding `startCompression`: the clear/resetCacheAnchorSeq/re-add work runs in the rebuild phase (rebuilt `contentAdded` before release), a late ordinary add runs in the streaming phase (after release), final history is rebuilt entries then the late add. Mutation: removing the `rebuildWith` wrapper fails the test (3 pass / 1 fail). |
| Review (B3) | `ProviderContentEnforcer` restore/retry path classification had no behavior test under an active compression lock. | In-scope-Fix | Added a restore-under-lock test in `compression-retry-provider-hardlimit.test.ts` (`buildEnforcerHarness` + real `HistoryService`): restore clear/add stay inside one rebuild scope (rebuilt `contentAdded` before release), a late streaming entry stays after the release, cache anchor resets, and the existing backup/retry/failure coverage is preserved. Mutation: removing the `rebuildWith` wrapper in `restoreHistory` fails the test (18 pass / 1 fail). |
| Review (B4) | Core queue classification lacked focused coverage for the rebuild/streaming boundary matrix. | In-scope-Fix | Added `compression-rebuild-scope.test.ts` with a table-driven boundary matrix: clear-only rebuild + late streaming add, multiple rebuilt entries in rebuild order, multiple streaming entries on both sides preserving FIFO after release, multiple clear/retry operations inside one rebuild scope, and no-lock synchronous rebuild. The callback-throws test in `compression-locking.test.ts` now queues real rebuild work before throwing so the rebuild phase still flushes. Mutation: always-classifying `'streaming'` in `HistoryService` fails 12 rows. |
| Compliance review | `design-notes.md` was marked as a working copy and described the superseded positional queue design. | In-scope-Fix | Removed the untracked working note so only the accepted plan and current implementation remain in the candidate. |
| Local OCR | Extract a private helper for the duplicated rebuild/streaming phase tag in `HistoryService.add()` and `clear()`. | Reject | Both sites use the same one-line expression and are covered by boundary tests. The suggestion is optional refactoring, adds no accepted behavior, and risks the existing source-size gate. |
| PR OCR | Claimed the nested recovery clears in `ProviderContentEnforcer.restoreHistory()` execute after the `rebuildWith` scope closes and are tagged as streaming. | Reject | The outer callback starts at line 647 and closes at line 680; every restore, backup, retry, and final cleanup clear/add remains inside that one scope. No code change required. |

## Verification evidence

- RED: `tmp/issue3338/red_history.log` and `red_recording.log` fail because
  `rebuildWith` does not exist before the production change.
- Focused post-remediation suites pass: core history and recording report 1,068
  tests across 68 files; the focused agent compression set reports 580 tests.
- Caller mutation checks fail when each of the three production `rebuildWith`
  wrappers is removed. The core phase mutation fails 12 boundary rows when all
  queued operations are forced to the streaming phase.
- The test-audit baseline and candidate each report 2,013 existing findings.
  The candidate introduces no new finding in a touched test.
- A clean, non-overlapping `npm run test` completed all workspaces. The agents
  workspace reported four load-sensitive timeouts after completing 372 of 376
  isolated files; those four files then passed together in isolation, 47 tests
  in 7.17 seconds. The changed core and agent compression suites remained green.
- Exact `npm run typecheck`, `npm run format`, and `npm run build` pass after all
  implementation and review changes. `git diff --check` also passes.
- The smoke command passes with `--profile-load zai`, returning a three-line
  haiku from `zai:glm-5.3`.
- The exact `npm run lint` traversal exhausted its fixed 12,288 MB heap. The
  same full-tree ESLint traversal passed with a 16,384 MB heap; changed-file lint
  and the ESLint policy guard also pass.
