# Architecture Review: Session Recording Implementation Plan

**Reviewer**: Architecture Review Agent  
**Date**: 2026-02-11  
**Scope**: Implementation plan for issues #1361–#1369 (28 phases)  
**Plan Location**: `project-plans/issue1361/`

---

## Verdict: **PASS**

---

## Review Methodology

This review read and cross-referenced:
- All 9 GitHub issues (#1361 parent + #1362–#1369 sub-issues)
- `specification.md` (canonical design document)
- `plan/00-overview.md` (phase list + dependency graph)
- `plan/00a-preflight-verification.md` (dependency + assumption checks)
- 3 pseudocode files (recording-integration, concurrency-lifecycle, replay-engine)
- 6 plan phase files (04, 07, 08, 13, 14, 25, 27, 28)
- 5 actual source files (HistoryService.ts, geminiChat.ts, client.ts, nonInteractiveCli.ts, useGeminiStream.ts)
- Supporting files (sessionCleanup.ts, sessionUtils.ts, config.ts, paths.ts, cleanup.ts)

---

## 1. Internal Consistency

### Compression Model: Consistent [OK]

The plan universally states that compression is **in-place** (clear + add on the same HistoryService instance). This claim is verified across:
- `specification.md` ("Compression Event Semantics")
- `analysis/pseudocode/recording-integration.md` lines 160–176
- `plan/14-recording-integration-impl.md` Sub-Task 14.3
- `plan/00a-preflight-verification.md` ("Compression Flow Hookpoint Verification")

**Actual code confirms**: `geminiChat.ts` line 408 declares `private readonly historyService: HistoryService`, and `performCompression()` (lines 2011–2034) calls `this.historyService.startCompression()` → `this.historyService.clear()` → `this.historyService.add()` (loop) → `this.historyService.endCompression()` — all on the **same instance**. The plan is correct.

### Deferred Materialization: Consistent [OK]

All references agree: the JSONL file is not created until the first `content` event. The `session_start` event is buffered, metadata events before first content are buffered, and all are written in FIFO order when the first content event triggers materialization. Phase 04 TDD includes an explicit test (test case 23) verifying the exact ordering of buffered metadata events.

### Lock Path Convention: Consistent [OK]

All references consistently use session-ID-based lock paths (`<chatsDir>/<sessionId>.lock`), not file-path-based. The pseudocode (`concurrency-lifecycle.md`) has an explicit lock path contract table covering new sessions, resumed sessions, cleanup checks, and orphaned locks — all using the same derivation. The anti-pattern warnings explicitly forbid file-path-based lock paths.

### session_event Handling: Consistent [OK]

The specification, replay pseudocode, phase 07/08, and phase 25 all agree: `session_event` records are collected into `ReplayResult.sessionEvents` for audit, **NOT** added to `IContent[]` history, and **NOT** re-displayed in UI on resume. Phase 07 tests (cases 21–22) and Phase 08's implementation algorithm both enforce this.

### `endCompression` Signature Change: Consistent [OK]

Phase 14 Sub-Task 14.3 proposes changing `endCompression()` to accept optional `summary?: IContent, itemsCompressed?: number` parameters. The current `endCompression()` (HistoryService.ts line ~1527) takes no arguments. The plan correctly:
- Makes the new parameters optional (backward compatible)
- Updates the caller in `performCompression()` to pass `result.newHistory[0]` and the pre-compression count
- Keeps existing callers working (parameters are optional)

### ReplayResult Type: Minor Inconsistency (non-blocking) WARNING:

Phase 08 uses a slightly different `ReplayResult` structure (`error?: string` field directly on the result) compared to the pseudocode which uses a discriminated union (`{ok: true, ...} | {ok: false, error, warnings}`). Both approaches work — the implementer needs to pick one and be consistent. The specification's `ReplayResult` type in the "Data Schemas" section does not include `error?` or `ok`, suggesting the discriminated union from the pseudocode is the intended approach. **This is a style choice, not a bug** — either approach works, and the test cases will enforce the correct shape.

---

## 2. Codebase Alignment

### HistoryService Events: Correctly Identified [OK]

The plan correctly identifies that HistoryService currently only emits `tokensUpdated` (verified at line 37–47 of HistoryService.ts). It correctly identifies that `contentAdded`, `compressionStarted`, and `compressionEnded` must be **added** as new events. Phase 00a's preflight verification pins the exact type signatures and the exact line numbers where `emit()` calls should be added.

### Flush Point in useGeminiStream: Correctly Identified [OK]

The plan specifies the flush point as `submitQuery`'s `finally` block (useGeminiStream.ts line 1286). The actual code confirms:
```typescript
} finally {
    setIsResponding(false);  // line 1287
}
```
The plan correctly identifies this as the authoritative "turn is done" signal, and specifies adding the recording flush **before** `setIsResponding(false)`.

### cancelOngoingRequest Race Condition: Correctly Identified [OK]

Phase 14 identifies that `cancelOngoingRequest()` (line ~507) also sets `setIsResponding(false)` independently, creating a potential gap. The plan adds a fire-and-forget flush there as well. This is a genuine edge case that less thorough reviews would miss.

### Non-Interactive CLI: Correctly Identified [OK]

The plan correctly identifies `nonInteractiveCli.ts` as a separate execution path needing its own recording integration. Phase 14 Sub-Tasks 14.6–14.8 specify:
- Adding `recordingService?` to `RunNonInteractiveParams` (currently line 38)
- Adding `await recordingService.flush()` in the `finally` block (currently line 540)
- Creating the recording service in `gemini.tsx` non-interactive path

The actual `finally` block (lines 540–548) currently has `cleanupStdinCancellation()` → `consolePatcher.cleanup()` → `coreEvents.off()` → `shutdownTelemetry()`. The plan correctly places the recording flush **before** `shutdownTelemetry()`.

### Config.isContinueSession: Correctly Identified [OK]

The plan correctly notes that `continueSession` is currently `boolean` (config.ts line 428, 603, 754, 1001–1002) and must be changed to `string | boolean` to support `--continue <session-id>`. The plan adds `getContinueSessionRef()` while keeping `isContinueSession()` returning boolean for backward compatibility.

### getProjectHash: Correctly Identified [OK]

The plan references `getProjectHash()` from `packages/core/src/utils/paths.ts` (line 323). This function exists and returns a SHA-256 hex string of the project root path. It's currently used by `SessionPersistenceService` but is a general utility that the new system can use.

### Existing Session Cleanup: Correctly Identified [OK]

The plan correctly identifies that `sessionCleanup.ts` currently:
- Scans for `SESSION_FILE_PREFIX` + `.json` files (via `sessionUtils.ts` line 49)
- Uses `ConversationRecord` JSON format
- Has age-based and count-based retention
- Uses session ID matching for active session protection (line 73)

The adaptation plan (#1369) correctly specifies: update scan pattern to `.jsonl`, switch to lock-based active protection, handle old `.json` files during migration, add stale lock cleanup.

### gemini.tsx Restoration: Correctly Identified [OK]

The plan correctly identifies the current restoration path in `gemini.tsx`:
- `SessionPersistenceService` import and instantiation (line 74, 254)
- `loadMostRecent()` call (line 258)
- `restoredSession` variable passed to AppContainer (line 322)

And in `AppContainer.tsx`:
- `restoredSession` prop (line 157)
- `sessionRestoredRef` / `coreHistoryRestoredRef` (lines 525–526)
- Restoration `useEffect` (lines 607–755)
- `convertToUIHistory` / `validateUIHistory` functions (lines 421, 585)

### GeminiClient.startChat HistoryService Creation: Correctly Identified [OK]

The plan correctly identifies the edge case where `startChat()` (client.ts line 873) creates a `new HistoryService()` when `_storedHistoryService` is not set (lines 864–870). The plan's `onHistoryServiceReplaced()` method handles re-subscription for this case. The plan also correctly notes that during normal provider switches, `storeHistoryServiceForReuse()` (line 665) prevents this from happening — the HistoryService is reused.

### GeminiClient.resetChat: Partially Identified WARNING:

`resetChat()` (client.ts line 729) calls `historyService.clear()` if a chat exists, or `this.chat = await this.startChat([])` if no chat exists. The `startChat([])` path creates a new HistoryService. The plan mentions `resetChat()` (pseudocode line 186) as a case where HistoryService is replaced, but doesn't have a detailed test for this scenario. However, the `onHistoryServiceReplaced()` mechanism covers it generically — the wiring in Phase 26 just needs to call it after any code path that replaces the chat. **Not a blocker.**

---

## 3. All Execution Modes Covered

### Interactive Mode [OK]
- Session creation: `gemini.tsx` creates `SessionRecordingService`, passes to `AppContainer`
- Content capture: `RecordingIntegration` subscribes to HistoryService events
- Flush: `submitQuery` finally block in `useGeminiStream.ts`
- Shutdown: `registerCleanup()` pattern

### Non-Interactive Mode (`--prompt`) [OK]
- Phase 14 Sub-Tasks 14.6–14.8 explicitly cover this
- Creates `SessionRecordingService` in `gemini.tsx` non-interactive path
- Flush in `runNonInteractive()` finally block
- Lock acquisition and cleanup

### Resume Mode (`--continue`) [OK]
- Session discovery, replay, HistoryService seeding, UI reconstruction
- File reopened for append with seq continuing from lastSeq
- Provider mismatch handling (warning + event)
- Both bare `--continue` and `--continue <id>` covered

### Subagent Mode [OK]
- Phase 27's Mode Parity Matrix explicitly addresses subagents (task.ts)
- Subagents inherit from parent session recording
- Content captured via parent HistoryService events

---

## 4. Testing Adequacy

### Strengths

1. **No mock theater**: The plan explicitly forbids `toHaveBeenCalled` assertions and mock HistoryService/SessionRecordingService. All tests use real instances writing to real temp directories.

2. **Property-based testing**: 30%+ of tests in each phase use fast-check for generative testing. This catches edge cases that hand-written tests miss.

3. **Golden replay tests**: Phase 07 includes golden tests for specific event ordering scenarios (new session, resumed session, compression, multiple resumes).

4. **Malformed payload tests**: Phase 07 tests (30–38) cover malformed payloads for every known event type individually.

5. **Crash recovery tests**: Phase 25 addendum includes explicit crash-recovery scenarios (truncated last line, mid-file corruption, crash with partial write + subsequent append).

6. **Cross-mode parity test**: Phase 25 test 29 verifies interactive and `--prompt` modes produce structurally identical JSONL.

7. **Concurrent access test**: Phase 25 test 28 verifies lock contention between two processes.

### Potential Blind Spots (non-blocking)

1. **No test for compression failure + recording**: If `performCompression()` throws (line 2029–2031), `endCompression()` is still called in the `finally` block (line 2033). The plan says `compressionEnded` will be emitted from `endCompression()`, but on a failed compression, what `summary` and `itemsCompressed` should be passed? The `finally` block in `performCompression` calls `this.historyService.endCompression()` with no arguments — since the parameters are optional, this works (no `compressionEnded` event emitted on failure). This is actually correct behavior — if compression fails, the history is unchanged and no `compressed` event should be recorded. The plan implicitly handles this through the optional parameters, but doesn't have an explicit test. The existing HistoryService tests and the "compression failure" path in geminiChat.ts would need to be verified during implementation. **Not a blocker** — the design handles it correctly through parameter optionality.

2. **Very long session files**: No performance test for replay of large files (thousands of events). The spec acknowledges this ("Replay Performance" section) and defers optimization. Acceptable for v1.

3. **Unicode / special character content**: No explicit test for IContent with multi-byte Unicode, emoji, or special characters in JSONL serialization. JSON.stringify handles this correctly by default, but a paranoid test would be nice. The property-based tests with `fc.record` for IContent shapes would catch encoding issues if fast-check generates such data. **Not a blocker.**

---

## 5. Issue Alignment

| Issue | What It Specifies | What the Plan Implements | Aligned? |
|-------|-------------------|--------------------------|----------|
| #1362 | Core types + JSONL async writer | Phases 03–05: types, deferred materialization, ENOSPC, flush | [OK] |
| #1363 | Replay engine | Phases 06–08: pure function, corruption handling, project hash validation | [OK] |
| #1364 | Recording integration | Phases 12–14: HistoryService events, compression-aware filtering, flush points | [OK] |
| #1365 | Resume flow | Phases 18–20: CLI flag changes, SessionDiscovery, replay+seed+reconstruct | [OK] |
| #1366 | Session listing/deletion | Phases 21–23: --list-sessions, --delete-session, lock-aware delete | [OK] |
| #1367 | Concurrency + lifecycle | Phases 09–11: PID-based locks, stale detection, shutdown flush handlers | [OK] |
| #1368 | Remove old system | Phase 27: complete removal inventory, mode parity matrix, rollout safety gate | [OK] |
| #1369 | Cleanup adaptation | Phases 15–17: .jsonl pattern, lock-aware protection, stale lock cleanup | [OK] |

The dependency graph in `00-overview.md` matches the issue dependency graph from #1361's specification exactly. Phase ordering respects all dependencies.

---

## 6. Lock/Lifecycle Correctness

### Lock Acquisition Timing [OK]

- **New session**: Lock acquired immediately, before file materialization. The lock path is session-ID-based, so it's deterministic before the JSONL file exists. The state machine in the pseudocode (lines 170–198) correctly models the PRE_MATERIALIZATION → MATERIALIZED transition.

- **Resumed session**: Lock acquired before replay begins. If another process holds it, acquisition fails. The lock handle is passed to the recording service.

### Stale Detection [OK]

- PID-based: `process.kill(pid, 0)` — standard POSIX technique
- Age-based (48-hour cap): Guards against PID reuse on long-running systems
- Unparseable lock file: Treated as stale (safe default)

### Deferred Materialization + Lock Interaction [OK]

The lock is created before the JSONL file, so there's a window where the lock exists but the data file doesn't. The plan explicitly handles this in the cleanup flow: "If no JSONL file: this was a never-materialized session — nothing else to clean." Orphaned locks (stale + no JSONL) are cleaned up by `cleanupOrphanedLocks()`.

### Cleanup Interactions [OK]

The cleanup flow (Phase 17) respects locks:
1. Check if `.lock` exists and is held → skip
2. Lock exists but stale → delete both lock and data file
3. No lock → safe to delete per age/count policy
4. Orphaned locks (no corresponding `.jsonl`) → delete lock

### registerCleanup Integration [OK]

The plan uses the existing `registerCleanup()` / `runExitCleanup()` pattern (cleanup.ts lines 14, 18). Two cleanup handlers are registered:
1. `recording.flush()` — ensures all queued events are written
2. `lockHandle.release()` — removes the lock file

The plan correctly notes that `registerCleanup` is async-aware (it accepts `() => Promise<void>`), verified from the actual signature: `export function registerCleanup(fn: (() => void) | (() => Promise<void>))`.

---

## 7. Will This Produce a Working System?

**Yes.** The plan is comprehensive, internally consistent, and grounded in the actual codebase. Here's why I'm confident:

1. **Every assumption is verified**: Phase 00a has explicit verification commands for every type, function, and call path the plan depends on. The plan knows exactly which events HistoryService emits (only `tokensUpdated`), where compression happens (lines 2011–2034 of geminiChat.ts), and where the flush point is (line 1286 of useGeminiStream.ts).

2. **The hardest problem is correctly analyzed**: Compression-aware content filtering is the trickiest part of this design. The plan correctly identifies that compression is in-place (not a replacement), that `contentAdded` events during compression are re-adds that must be suppressed, and that the `compressionStarted`/`compressionEnded` bracket provides the suppression window. This matches the actual compression flow exactly.

3. **Edge cases are explicitly handled**: HistoryService replacement in `startChat()`, cancellation race conditions in `cancelOngoingRequest()`, ENOSPC graceful degradation, corrupt last-line crash recovery, PID reuse in stale detection, deferred materialization ordering — all are addressed with specific mechanisms.

4. **The dependency order is correct**: The phase ordering respects the dependency graph. Foundation types first (#1362), then independent consumers (replay #1363, concurrency #1367, recording integration #1364), then dependent flows (resume #1365, management #1366, cleanup #1369), then removal (#1368) last.

5. **The testing approach prevents regression**: Real-filesystem tests, property-based testing, golden replay tests, and cross-mode parity tests provide strong coverage. The explicit prohibition of mock theater means tests actually verify behavior, not implementation details.

6. **The migration path is safe**: Old `.json` files are cleaned up by existing age/count policy during the migration period. The `--continue` flag change from boolean to optional-string is backward compatible. The new system is always-on (no feature flag), which simplifies the code.

---

## Summary of Findings

| Category | Finding | Severity |
|----------|---------|----------|
| Compression model | Correctly identified as in-place; verified against actual code | [OK] Correct |
| HistoryService events | Correctly identifies need to add 3 new events; pins exact lines | [OK] Correct |
| Flush points | Correctly identifies submitQuery finally block + cancelOngoingRequest race | [OK] Correct |
| Non-interactive mode | Explicitly covered with Sub-Tasks 14.6–14.8 | [OK] Correct |
| ReplayResult type | Minor style difference between pseudocode and phase 08 | WARNING: Non-blocking |
| resetChat edge case | Covered generically by onHistoryServiceReplaced but no explicit test | WARNING: Non-blocking |
| Compression failure path | Handled correctly through optional parameters but untested | WARNING: Non-blocking |
| Lock lifecycle | Correct state machine, handles all transitions including orphans | [OK] Correct |
| Session cleanup | Lock-aware protection, stale detection, orphan cleanup all specified | [OK] Correct |
| Old system removal | Complete inventory, mode parity matrix, rollout safety gate | [OK] Correct |
| Testing approach | Real filesystem, property-based, no mock theater, 30%+ generative | [OK] Strong |
| Phase ordering | Respects dependency graph, sequential with verification gates | [OK] Correct |

**No blocking issues found. This plan will produce a working implementation if followed phase-by-phase.**
