# Technical Correctness Review

## Summary
**CONDITIONAL PASS**

The plan is well-structured, comprehensive, and demonstrates strong understanding of the codebase architecture. The dependency graph is correct, issue coverage is complete, and pseudocode algorithms are sound. However, there are several file path inaccuracies, missing codebase details, and integration assumptions that must be corrected before implementation begins. None are fatal to the overall approach, but several would cause implementation-time confusion or failures if not addressed.

---

## Critical Issues (Must Fix)

### 1. HistoryService lacks `contentAdded` and `compressed` events — plan underestimates the work

**Where**: Phase 14 (recording-integration-impl.md), pseudocode/recording-integration.md lines 10-22

The plan correctly identifies that HistoryService currently only emits `tokensUpdated` (confirmed: `HistoryServiceEventEmitter` only defines `tokensUpdated`). However, Phase 14 treats adding these events as a footnote ("NOTE: The HistoryService may need `contentAdded` and `compressed` events added"). This is not optional — it is a hard prerequisite.

**Specific concern**: HistoryService extends `EventEmitter` with a typed interface `HistoryServiceEventEmitter`. The plan must:
- Add `contentAdded` and `compressed` to the `HistoryServiceEventEmitter` interface (line 37-43 of HistoryService.ts)
- Add `this.emit('contentAdded', ...)` after `this.history.push(content)` in `addInternal()` (line 279)
- The compression event is harder: compression creates a **new HistoryService instance** (line 1475: `service.addAll(history)`). There is no `emit('compressed')` point inside HistoryService itself. The compression callback is external (in geminiChat.ts). The plan's pseudocode line 14-15 assumes a `compressed` event on HistoryService, but the compression creates a **replacement** HistoryService, not a mutation of the existing one.

**Fix**: Phase 14 must explicitly design how compression events are captured. Options: (a) add an event to the compression callback in geminiChat/client that fires on the **old** HistoryService before replacement, or (b) detect history replacement in the integration layer. This needs its own design section, not a footnote.

### 2. `restoreHistory` is on `client.ts`, not on `HistoryService` — plan references wrong API

**Where**: Phase 20 (resume-flow-impl.md), specification REQ-RSM-004

The plan says "seed HistoryService with IContent[]" (spec REQ-RSM-004). In AppContainer.tsx line 725, the current code calls `client.restoreHistory(restoredSession.history)` — this is a method on the **Client** class (`packages/core/src/core/client.ts:762`), not on HistoryService directly. HistoryService has `addAll()` but the restore path goes through `client.restoreHistory()` which ensures chat/content generator readiness.

**Fix**: Resume flow must call `client.restoreHistory()`, not `historyService.addAll()` directly. The plan's pseudocode and phase files should reference the Client API, not HistoryService directly.

### 3. `projectHash` is not a Config method — must be obtained from `getProjectHash()` utility

**Where**: Specification, Phase 03 (types), Phase 20 (resume flow)

The plan repeatedly references `projectHash` as something passed to `SessionRecordingService` constructor. In the codebase, `getProjectHash()` is a utility function in `packages/core/src/utils/paths.ts:323` — it's not a Config method. The old `SessionPersistenceService` computes it internally via `this.getProjectHash()` (a private method). The Config class has `getProjectTempDir()` which internally uses the project hash but doesn't expose it.

**Fix**: The plan should specify where `projectHash` is obtained: either call `getProjectHash(projectRoot)` from `packages/core/src/utils/paths.ts`, or derive it from the temp dir path. This affects Phase 26 (integration) and the constructor config type.

### 4. No `chatsDir` in Config — must be constructed

**Where**: Specification, multiple phases

The plan references `chatsDir` as a config value. The Config class has no `getChatsDir()` method. The current `SessionPersistenceService` constructs it internally: `path.join(storage.getProjectTempDir(), 'chats')`. The plan must document that `chatsDir` must be derived from `config.getProjectTempDir() + '/chats'` at the integration point (gemini.tsx or AppContainer.tsx), not assumed to exist on Config.

**Fix**: Phase 26 must explicitly construct `chatsDir = path.join(config.getProjectTempDir(), 'chats')`.

---

## Major Issues (Should Fix)

### 5. Issue #1368 references files that don't exist: `chatRecordingService.ts`, `chatRecordingService.test.ts`

**Where**: Phase 27 (old-system-removal.md), Issue #1368

Issue #1368 lists for deletion:
- `packages/core/src/services/chatRecordingService.ts`
- `packages/core/src/services/chatRecordingService.test.ts`

These files **do not exist** in the codebase. The ChatRecordingService is only a comment/stub reference at `geminiChat.ts:2276` (a no-op stub comment). The plan's Phase 27 correctly handles this by saying "Check for and remove any ChatRecordingService imports" rather than deleting a file, but the plan still references `client.ts` having `getChatRecordingService()/initializeChatRecording()` methods — which also don't exist in the current `client.ts`.

**Fix**: Phase 27 should note that `client.ts` has no ChatRecordingService references (confirmed: zero matches). The only ChatRecordingService references are:
- `geminiChat.ts:2276` — comment/stub (remove)
- `useGeminiStream.test.tsx:59` — test mock for `getChatRecordingService` (update)
- `useGeminiStream.thinking.test.tsx:126` — test mock (update)

### 6. `SessionPersistenceService` exports exist in `index.ts` but plan claims "REMOVED from core index.ts" without verifying current export structure

**Where**: Phase 27, specification "Existing Code To Be REPLACED" item 3

The current exports at `packages/core/src/index.ts:417-421`:
```typescript
  SessionPersistenceService,
  type PersistedSession,
  type PersistedUIHistoryItem,
  type PersistedToolCall,
} from './storage/SessionPersistenceService.js';
```

The plan's Phase 27 correctly identifies these for removal. However, it also references removing exports from `sessionTypes.ts` at `packages/core/src/index.ts:414`:
```typescript
} from './storage/sessionTypes.js';
```
This file exports `SESSION_FILE_PREFIX` and `ConversationRecord` — which are used by `sessionUtils.ts` in the CLI package. The plan should clarify whether these are kept (for migration period) or removed.

**Fix**: Phase 27 needs to explicitly check if `SESSION_FILE_PREFIX` and `ConversationRecord` from `sessionTypes.ts` are still needed by the updated `sessionCleanup.ts` / `sessionUtils.ts`. If the new cleanup uses `SessionDiscovery.listSessions()` instead, these can be removed. If not, they must be kept.

### 7. Plan introduces `RecordingIntegration` class not mentioned in any GitHub issue

**Where**: Phase 12-14 (recording-integration-stub/tdd/impl)

The spec and issues describe recording integration (#1364) as wiring HistoryService events to SessionRecordingService. The plan introduces a `RecordingIntegration` class in `packages/core/src/recording/RecordingIntegration.ts`. This is reasonable architecture, but:
- Issue #1364 doesn't specify this as a separate class
- The class is in `packages/core/src/recording/` but its primary consumers are in `packages/cli/src/`
- The plan should confirm this is the right architectural location (core vs CLI)

**Fix**: Consider whether `RecordingIntegration` belongs in core or CLI. Since it wraps a core service and subscribes to core events, core is likely correct — but this should be explicitly justified.

### 8. `convertToUIHistory` is a `useCallback` inside AppContainer — cannot be imported elsewhere

**Where**: Specification ("PersistedUIHistoryItem removal"), Phase 20 (resume-flow-impl)

The plan says "UI history is reconstructed from IContent[] via existing convertToUIHistory() logic." The current `convertToUIHistory` is defined as a `useCallback` hook at `AppContainer.tsx:421` — it's a React hook callback, not an importable function. The new resume flow in Phase 20 would need to call this from within AppContainer or extract it to a utility function.

**Fix**: The plan should explicitly note that `convertToUIHistory` must either: (a) remain inside AppContainer and the resume flow must pass IContent[] to AppContainer for UI reconstruction there, or (b) be extracted to a standalone utility function. Option (a) is simpler and matches how the current restoration code works.

### 9. HistoryService re-subscription on compression is architecturally complex

**Where**: Phase 14, Phase 26, pseudocode/recording-integration.md

The plan says RecordingIntegration has an `onHistoryServiceReplaced(newHistoryService)` method (REQ-INT-003). But examining the codebase, compression creates a new GeminiChat with a new HistoryService. The plan doesn't specify the exact mechanism for detecting this replacement and calling `onHistoryServiceReplaced`. This needs to be wired in Phase 26 at the point where the new GeminiChat/HistoryService is created after compression.

**Fix**: Phase 26 should specify exactly where in the compression flow `onHistoryServiceReplaced` is called. This likely involves hooking into the compression callback in geminiChat.ts or client.ts.

### 10. Plan doesn't address `getChatRecordingService` mocking in existing test files

**Where**: Phase 27

Two existing test files mock `getChatRecordingService`:
- `packages/cli/src/ui/hooks/useGeminiStream.test.tsx:59`
- `packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx:126`

Phase 27 must update these test mocks after removing the ChatRecordingService stub. If the mock is removed without replacement, these tests may fail.

**Fix**: Phase 27 should list these test files as needing modification.

---

## Minor Issues (Nice to Fix)

### 11. Pseudocode line numbers in `recording-integration.md` reference HistoryService event as `'add'` vs `'contentAdded'`

**Where**: pseudocode/recording-integration.md line 20

The pseudocode integration point says `SUBSCRIBE to historyService.on('add', handler)` but the type definition on line 20 uses `contentAdded`. These should be consistent.

### 12. Phase numbering gap: overview lists P28/P28a but plan directory has `28-final-verification.md` as the last file

**Where**: `00-overview.md` phase table

The overview lists Phase 28 as "Old System Removal Verification (Deep)" and 28a as "Old System Removal Deep Verification" followed by Phase 29. But the actual file is `28-final-verification.md`. The numbering convention is inconsistent — there's no `29-*.md` file.

### 13. `ReplayResult` type differs between pseudocode and specification

**Where**: pseudocode/replay-engine.md vs specification.md

The pseudocode defines `ReplayOutcome = ReplayResult | ReplayError` (a discriminated union with `ok: true/false`), while the specification's `ReplayResult` is a simple interface without `ok` field. Phase 03 (types) should pick one approach. The discriminated union with `ok` is better for error handling.

### 14. `SessionRecordingServiceConfig` interface in pseudocode vs constructor signature in issue #1362

**Where**: Phase 03, pseudocode/session-recording-service.md vs Issue #1362

The pseudocode uses a `SessionRecordingServiceConfig` object with 6 fields (sessionId, projectHash, chatsDir, workspaceDirs, provider, model). Issue #1362 shows a simpler constructor: `constructor(sessionId, projectHash, chatsDir)`. Phase 03 correctly uses the config object — this should be the canonical form.

### 15. `SessionDiscovery` pseudocode location mismatch

**Where**: Phase 20 references `analysis/pseudocode/session-management.md` for SessionDiscovery

SessionDiscovery pseudocode is in `session-management.md` but conceptually it's part of the resume flow (#1365). This is fine architecturally (SessionDiscovery is shared between resume and session management), but Phase 20 should also reference `resume-flow.md` for the `resumeSession` function pseudocode.

---

## Issue Coverage Audit

### #1362 — Core types + JSONL async writer
**Phases**: P03 (stub), P04 (TDD), P05 (impl)
**Coverage**: [OK] Complete — all REQ-REC requirements covered

### #1363 — Replay engine
**Phases**: P06 (stub), P07 (TDD), P08 (impl)
**Coverage**: [OK] Complete — all REQ-RPL requirements covered

### #1364 — Recording integration (HistoryService + subsystems)
**Phases**: P12 (stub), P13 (TDD), P14 (impl)
**Coverage**: WARNING: Mostly complete — REQ-INT-001 through REQ-INT-007 covered, but compression event mechanism (REQ-INT-003) needs more design detail (see Critical Issue #1)

### #1365 — Resume flow (--continue)
**Phases**: P18 (stub), P19 (TDD), P20 (impl)
**Coverage**: WARNING: Mostly complete — REQ-RSM-001 through REQ-RSM-006 covered, but `restoreHistory` API reference is wrong (see Critical Issue #2) and `convertToUIHistory` extraction needs addressing (see Major Issue #8)

### #1366 — Session listing and deletion (--list-sessions, --delete-session)
**Phases**: P21 (stub), P22 (TDD), P23 (impl)
**Coverage**: [OK] Complete — REQ-MGT-001 through REQ-MGT-004 covered

### #1367 — Concurrency + process lifecycle
**Phases**: P09 (stub), P10 (TDD), P11 (impl)
**Coverage**: [OK] Complete — REQ-CON-001 through REQ-CON-006 covered

### #1368 — Remove old persistence system
**Phases**: P27 (removal), P27a (verification)
**Coverage**: WARNING: Mostly complete — REQ-DEL-001 through REQ-DEL-007 covered, but:
- ChatRecordingService files referenced for deletion don't exist (see Major Issue #5)
- Test file mocks for getChatRecordingService not addressed (see Major Issue #10)
- SESSION_FILE_PREFIX/ConversationRecord fate unclear (see Major Issue #6)

### #1369 — Session cleanup adaptation
**Phases**: P15 (stub), P16 (TDD), P17 (impl)
**Coverage**: [OK] Complete — REQ-CLN-001 through REQ-CLN-005 covered

---

## File Path Accuracy

### Correct Paths [OK]
| Plan Reference | Real Path | Status |
|---|---|---|
| `packages/core/src/storage/SessionPersistenceService.ts` | `packages/core/src/storage/SessionPersistenceService.ts` | [OK] Exists |
| `packages/core/src/storage/SessionPersistenceService.test.ts` | `packages/core/src/storage/SessionPersistenceService.test.ts` | [OK] Exists |
| `packages/cli/src/ui/AppContainer.tsx` | `packages/cli/src/ui/AppContainer.tsx` | [OK] Exists |
| `packages/cli/src/gemini.tsx` | `packages/cli/src/gemini.tsx` | [OK] Exists |
| `packages/cli/src/ui/hooks/useGeminiStream.ts` | `packages/cli/src/ui/hooks/useGeminiStream.ts` | [OK] Exists |
| `packages/cli/src/ui/hooks/useHistoryManager.ts` | `packages/cli/src/ui/hooks/useHistoryManager.ts` | [OK] Exists |
| `packages/cli/src/utils/sessionCleanup.ts` | `packages/cli/src/utils/sessionCleanup.ts` | [OK] Exists |
| `packages/cli/src/utils/cleanup.ts` | `packages/cli/src/utils/cleanup.ts` | [OK] Exists |
| `packages/core/src/config/config.ts` | `packages/core/src/config/config.ts` | [OK] Exists |
| `packages/core/src/core/geminiChat.ts` | `packages/core/src/core/geminiChat.ts` | [OK] Exists |
| `packages/core/src/core/client.ts` | `packages/core/src/core/client.ts` | [OK] Exists |
| `packages/core/src/services/history/HistoryService.ts` | `packages/core/src/services/history/HistoryService.ts` | [OK] Exists |
| `packages/core/src/services/history/IContent.ts` (via import paths) | `packages/core/src/services/history/IContent.ts` | [OK] Exists |
| `packages/core/src/index.ts` | `packages/core/src/index.ts` | [OK] Exists |
| `packages/core/src/utils/paths.ts` (for getProjectHash) | `packages/core/src/utils/paths.ts` | [OK] Exists |
| `packages/core/src/storage/sessionTypes.ts` | `packages/core/src/storage/sessionTypes.ts` | [OK] Exists |

### Incorrect/Non-existent Paths [ERROR]
| Plan Reference | Reality | Issue |
|---|---|---|
| `packages/core/src/services/chatRecordingService.ts` (Issue #1368) | Does not exist | Issue #1368 lists this for deletion, but the file was never created. Only a stub comment exists in geminiChat.ts:2276 |
| `packages/core/src/services/chatRecordingService.test.ts` (Issue #1368) | Does not exist | Same as above |
| `packages/core/src/types/` for IContent (implied by plan) | `packages/core/src/services/history/IContent.ts` | IContent is NOT in a `types/` directory — it's in `services/history/IContent.ts`. Plan's type references are correct (import from `../services/history/IContent.js`) but this should be explicit |

### New Paths (to be created) — Appear Correct [OK]
| Planned Path | Assessment |
|---|---|
| `packages/core/src/recording/types.ts` | [OK] Follows project conventions (new module directory in core) |
| `packages/core/src/recording/SessionRecordingService.ts` | [OK] |
| `packages/core/src/recording/ReplayEngine.ts` | [OK] |
| `packages/core/src/recording/SessionDiscovery.ts` | [OK] |
| `packages/core/src/recording/SessionLockManager.ts` | [OK] |
| `packages/core/src/recording/RecordingIntegration.ts` | [OK] (but see Major Issue #7 re: core vs CLI) |
| `packages/core/src/recording/resumeSession.ts` | [OK] |
| `packages/core/src/recording/sessionManagement.ts` | [OK] |
| `packages/core/src/recording/index.ts` | [OK] |

---

## Pseudocode Assessment

### session-recording-service.md (Issue #1362)
**Assessment**: [OK] Sound

Algorithm for deferred materialization (buffer session_start until first content) is correct. Queue-drain-append pattern is standard. ENOSPC disable-and-warn is well-designed. The config object approach is more complete than the issue's bare constructor.

### replay-engine.md (Issue #1363)
**Assessment**: [OK] Sound

Streaming line-by-line approach via readline is correct. The event processing switch is complete for all 7 event types. Corruption handling (corrupt last line silent discard, corrupt mid-file skip+warn, missing session_start fatal) matches spec exactly. The `ReplayOutcome` discriminated union is a better API than the spec's plain `ReplayResult`.

Minor: The `readSessionHeader` helper is well-designed for efficient session listing.

### recording-integration.md (Issue #1364)
**Assessment**: WARNING: Has Issues

Event subscription pattern is correct in principle. However:
- Event name inconsistency: line 20 says `'add'`, type definition says `'contentAdded'`
- Compression event mechanism is under-designed (see Critical Issue #1)
- The `onHistoryServiceReplaced` method is the right idea, but the plan doesn't specify the compression flow hookpoint

### resume-flow.md (Issue #1365)
**Assessment**: WARNING: Has Issues

Discovery → lock → replay → seed → resume pattern is correct. Provider mismatch handling is well-designed. However:
- Uses `historyService.addAll()` instead of `client.restoreHistory()` (see Critical Issue #2)
- Doesn't address `convertToUIHistory` extraction (see Major Issue #8)

### session-management.md (Issue #1366)
**Assessment**: [OK] Sound

List/delete flow is straightforward and correct. Lock-aware deletion with stale detection is properly designed. Format helpers are reasonable.

### concurrency-lifecycle.md (Issue #1367)
**Assessment**: [OK] Sound

PID-based lockfile with `process.kill(pid, 0)` for stale detection is the right approach for a CLI tool. Exclusive creation with `{ flag: 'wx' }` is correct for atomic lock acquisition. Idempotent release is good design. ENOENT handling for parent directory creation is a nice touch.

### session-cleanup.md (Issue #1369)
**Assessment**: [OK] Sound

Dual-format scanning (old JSON + new JSONL) during migration is correct. Lock-aware protection with stale cleanup is well-designed. Orphaned lock cleanup is a good addition.

Note: The pseudocode references `getAllSessionFiles` which already exists in `packages/cli/src/utils/sessionUtils.ts`. The plan should clarify whether it's modifying the existing function or creating a new one. Since the existing function works with old-format files, modifying it is the right approach for migration support.

### old-system-removal.md (Issue #1368)
**Assessment**: WARNING: Has Issues

Removal checklist is comprehensive but references some non-existent targets (see Major Issue #5). The "do NOT remove" list (keep `convertToUIHistory`) is correct. The dangling reference check commands are thorough.

---

## Event Type Completeness

All 7 event types from #1361 are represented in the plan:

| Event Type | Defined in Types (P03) | Writer Support (P05) | Replay Support (P08) | Integration Trigger (P14) |
|---|---|---|---|---|
| `session_start` | [OK] | [OK] (buffered) | [OK] (metadata init) | [OK] (constructor) |
| `content` | [OK] | [OK] (triggers materialization) | [OK] (append to history) | [OK] (contentAdded event) |
| `compressed` | [OK] | [OK] (convenience method) | [OK] (clear + summary) | WARNING: (event mechanism unclear) |
| `rewind` | [OK] | [OK] (convenience method) | [OK] (remove last N) | [OK] (direct call) |
| `provider_switch` | [OK] | [OK] (convenience method) | [OK] (update metadata) | [OK] (direct call) |
| `session_event` | [OK] | [OK] (convenience method) | [OK] (skip) | [OK] (direct call) |
| `directories_changed` | [OK] | [OK] (convenience method) | [OK] (update metadata) | [OK] (direct call) |

---

## Dependency Graph Correctness

The plan's dependency graph matches the specification:

```
#1362 (Core types + writer) ── FOUNDATION
   ├── #1363 (Replay engine) ← depends on #1362 [OK]
   ├── #1367 (Concurrency) ← depends on #1362 [OK]
   ├── #1364 (Recording integration) ← depends on #1362 [OK]
   ├── #1369 (Cleanup adaptation) ← depends on #1367 [OK]
   ├── #1365 (Resume flow) ← depends on #1362 + #1363 + #1367 [OK]
   │     └── #1366 (List/delete) ← depends on #1362 + #1365 + #1367 [OK]
   └── #1368 (Remove old system) ← depends on #1364 + #1365 + #1369 [OK] (LAST)
```

Phase ordering correctly respects this graph:
- P03-P05 (#1362) first
- P06-P08 (#1363), P09-P11 (#1367), P12-P14 (#1364) can be parallelized but are sequenced safely
- P15-P17 (#1369) after #1367
- P18-P20 (#1365) after #1363 + #1367
- P21-P23 (#1366) after #1365
- P24-P26 (system integration) after all components
- P27 (#1368) last before final verification

**Note**: The overview shows #1364 (recording integration) at the same level as #1363 and #1367, but Phase 12-14 comes after Phase 11 (concurrency). This is conservative but correct — #1364 doesn't strictly depend on #1367, but ordering them this way avoids any potential issues.
