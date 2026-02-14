# Phase 00a: Preflight Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P00a`

## Purpose
Verify ALL assumptions before writing any code. This phase prevents the most common planning failures.

## Dependency Verification

| Dependency | Verification Command | Status |
|------------|---------------------|--------|
| vitest | `npm ls vitest` | Verify installed |
| node:fs/promises | Built-in, no check needed | OK |
| node:readline | Built-in, no check needed | OK |
| node:crypto | Built-in, no check needed | OK |
| fast-check (property testing) | `npm ls fast-check` | Verify installed for property-based tests |

```bash
# Run these checks:
cd packages/core && npm ls vitest
cd packages/core && npm ls fast-check || echo "MISSING: fast-check needed for property tests"
cd packages/cli && npm ls vitest
```

## Type/Interface Verification

| Type Name | Expected Location | Verification Command |
|-----------|-------------------|---------------------|
| IContent | `packages/core/src/services/history/IContent.ts` | `grep -A 5 "export interface IContent" packages/core/src/services/history/IContent.ts` |
| ContentBlock | `packages/core/src/services/history/IContent.ts` | `grep "export type ContentBlock" packages/core/src/services/history/IContent.ts` |
| HistoryService | `packages/core/src/services/history/HistoryService.ts` | `grep "export class HistoryService" packages/core/src/services/history/HistoryService.ts` |
| HistoryServiceEventEmitter | `packages/core/src/services/history/HistoryService.ts` | `grep "interface HistoryServiceEventEmitter" packages/core/src/services/history/HistoryService.ts` |
| Storage | `packages/core/src/config/storage.ts` | `grep "export class Storage" packages/core/src/config/storage.ts` |
| Config | `packages/core/src/config/config.ts` | `grep "export class Config" packages/core/src/config/config.ts` |
| registerCleanup | `packages/cli/src/utils/cleanup.ts` | `grep "export function registerCleanup" packages/cli/src/utils/cleanup.ts` |
| runExitCleanup | `packages/cli/src/utils/cleanup.ts` | `grep "export async function runExitCleanup" packages/cli/src/utils/cleanup.ts` |

## Call Path Verification

| Function | Expected Behavior | Verification Command |
|----------|-------------------|---------------------|
| `HistoryService.add()` | Adds IContent to history, emits tokensUpdated | `grep -n "add(content: IContent" packages/core/src/services/history/HistoryService.ts` |
| `HistoryService.on()` | EventEmitter subscription | `grep "extends EventEmitter" packages/core/src/services/history/HistoryService.ts` |
| `config.isContinueSession()` | Returns boolean for --continue flag | `grep -A 3 "isContinueSession" packages/core/src/config/config.ts` |
| `config.getSessionId()` | Returns session UUID | `grep -A 3 "getSessionId" packages/core/src/config/config.ts` |
| `storage.getProjectTempDir()` | Returns project-scoped temp dir | `grep -rn "getProjectTempDir" packages/core/src/config/storage.ts` |
| `registerCleanup()` | Registers cleanup handler | `grep -A 3 "export function registerCleanup" packages/cli/src/utils/cleanup.ts` |

## Test Infrastructure Verification

| Component | Test Location | Verification |
|-----------|---------------|-------------|
| HistoryService | `packages/core/src/services/history/HistoryService.test.ts` | `ls -la packages/core/src/services/history/HistoryService.test.ts` |
| SessionPersistenceService | `packages/core/src/storage/SessionPersistenceService.test.ts` | `ls -la packages/core/src/storage/SessionPersistenceService.test.ts` |
| sessionCleanup | `packages/cli/src/utils/sessionCleanup.test.ts` | `ls -la packages/cli/src/utils/sessionCleanup.test.ts` |
| cleanup | `packages/cli/src/utils/cleanup.test.ts` | `ls -la packages/cli/src/utils/cleanup.test.ts` |
| Test runner | vitest via npm run test | `npm run test -- --list-tests 2>&1 | head -10` |

```bash
# Verify test infrastructure exists:
ls -la packages/core/src/services/history/HistoryService.test.ts
ls -la packages/core/src/storage/SessionPersistenceService.test.ts
ls -la packages/cli/src/utils/sessionCleanup.test.ts

# Verify test patterns:
grep -c "describe\|it\|test" packages/core/src/services/history/HistoryService.test.ts
```

## Existing HistoryService Event System Verification

**CRITICAL**: The plan assumes HistoryService emits events we can subscribe to. Verify:

```bash
# Check what events HistoryService currently emits:
grep -n "this.emit(" packages/core/src/services/history/HistoryService.ts

# Check current event types:
grep -A 15 "interface HistoryServiceEventEmitter" packages/core/src/services/history/HistoryService.ts

# Check if HistoryService extends EventEmitter:
grep "extends EventEmitter" packages/core/src/services/history/HistoryService.ts
```

**Expected finding**: HistoryService currently only emits `tokensUpdated`. The plan requires adding `contentAdded` and `compressed` events. This is a modification to existing HistoryService, not a new dependency.

## AppContainer Session Restoration Verification

```bash
# Verify the restoration logic exists where plan says it does:
grep -n "restoredSession" packages/cli/src/ui/AppContainer.tsx | head -10
grep -n "sessionRestoredRef" packages/cli/src/ui/AppContainer.tsx
grep -n "coreHistoryRestoredRef" packages/cli/src/ui/AppContainer.tsx
grep -n "convertToUIHistory" packages/cli/src/ui/AppContainer.tsx
```

## File Naming Convention Verification

```bash
# Verify existing session file patterns:
grep -rn "persisted-session-\|session-" packages/core/src/storage/sessionTypes.ts
grep -rn "SESSION_FILE_PREFIX" packages/ --include="*.ts" | head -10

# Verify chats directory convention:
grep -rn "chats" packages/core/src/storage/SessionPersistenceService.ts | head -5
grep -rn "chats" packages/cli/src/utils/sessionCleanup.ts | head -5
```

## Blocking Issues Found

After running all verification commands, list any issues here:

1. [ ] HistoryService does NOT emit `contentAdded` or `compressed` events — these must be added in Phase 14
2. [ ] `continueSession` in Config is currently `boolean` — must be changed to `string | boolean` in Phase 18
3. [ ] fast-check may not be installed — verify and add if needed
4. [ ] The `convertToUIHistory` function location needs confirmation (AppContainer or separate utility)

## Verification Gate

- [ ] All dependencies verified
- [ ] All types match expectations
- [ ] All call paths are possible
- [ ] Test infrastructure ready
- [ ] HistoryService event enhancement planned
- [ ] Config change for --continue planned

**IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.**


## HistoryService Write Path Audit

Every method in HistoryService that modifies the `this.history` array, and whether it should emit `contentAdded`:

| Method | Line | What It Does | Emits `contentAdded`? | Rationale |
|--------|------|-------------|----------------------|-----------|
| `add(content, modelName)` | 241 | Queues during compression; otherwise calls `addInternal()` | Via `addInternal()` [OK] | Primary entry point for new content |
| `addInternal(content, modelName)` | 259 | `this.history.push(content)` at line 279 | [OK] YES — emit here | This is where content actually enters the array |
| `addAll(contents, modelName)` | 435 | Calls `add()` in a loop | [OK] Via `add()` → `addInternal()`, emits per item | Each item fires `contentAdded` individually |
| `clear()` | 549 | Queues during compression; otherwise calls `clearInternal()` |  NO | Clearing is NOT adding — no `contentAdded` |
| `clearInternal()` | 563 | `this.history = []` at line 569 |  NO | Clearing is NOT adding |
| `dispose()` | 530 | `this.history = []` at line 537 |  NO | Teardown — no listeners should remain |
| `removeLastIfMatches(content)` | 700 | `this.history.pop()` at line 703 |  NO | Removal, not addition |
| `pop()` | 712 | `this.history.pop()` at line 713 |  NO | Removal, not addition |
| `summarizeOldHistory(keepRecentCount, fn)` | 1447 | `this.history = [summary, ...toKeep]` at line 1459 |  NO | Legacy method, not used in compression flow. If used, it replaces history in bulk — would need separate event. |
| `ensureToolResponsesExist()` (splice) | 910 | `this.history.splice(i+1, 0, syntheticToolMessage)` |  NO — synthetic repair | This inserts synthetic tool responses for orphaned tool calls. These are repair artifacts, not new user/AI content. Recording should NOT capture these — they would be confusing on replay. |
| `startCompression()` | 1483 | Sets `isCompressing = true` | N/A (not a content add) | Emits `compressionStarted` instead |
| `endCompression()` | 1492 | Drains pending ops, sets `isCompressing = false` | N/A (not a content add) | Emits `compressionEnded` instead |

### Key Decisions

1. **`addInternal()` is the SOLE emission point for `contentAdded`.** All paths that add legitimate content flow through `addInternal()`.
2. **`addAll()` emits per item** — it calls `add()` in a loop, which calls `addInternal()`, which emits. This means N items produce N `contentAdded` events. This is correct: each item should be its own JSONL `content` event.
3. **`clear()`, `pop()`, `removeLastIfMatches()`, `dispose()`** do NOT emit `contentAdded` — they are removal/teardown operations.
4. **`summarizeOldHistory()`** does NOT emit `contentAdded` — it's a bulk history replacement used outside the compression flow. If it becomes relevant, it would need its own event type.
5. **`ensureToolResponsesExist()` splice** does NOT emit `contentAdded` — synthetic tool responses are repair artifacts, not new content. They exist to satisfy provider API requirements, not to represent user interactions.
6. **Compression re-adds during `endCompression()` pending queue drain**: When `endCompression()` drains the pending queue, those operations call `addInternal()`, which emits `contentAdded`. The `RecordingIntegration` suppresses these via the `compressionStarted`/`compressionEnded` bracket (see FIX 3).

## Compression Flow Hookpoint Verification

**CRITICAL**: Verify that the compression flow provides a stable hookpoint for RecordingIntegration.

### Evidence Required

```bash
# 1. Verify GeminiChat.historyService is readonly (stable reference):
grep -n "private readonly historyService" packages/core/src/core/geminiChat.ts
# Expected: line ~408 — confirms compression does NOT replace the instance

# 2. Verify performCompression uses clear+add on SAME instance (not replacement):
grep -B 2 -A 8 "Apply result: clear history" packages/core/src/core/geminiChat.ts
# Expected: this.historyService.clear() followed by this.historyService.add()

# 3. Verify startCompression/endCompression methods exist for event emission:
grep -n "startCompression\|endCompression" packages/core/src/services/history/HistoryService.ts
# Expected: Both methods exist, set isCompressing flag

# 4. Verify isCompressing state is exposed (for RecordingIntegration to check):
grep -n "isCompressing" packages/core/src/services/history/HistoryService.ts
# Expected: private field, used in add() to queue operations

# 5. Verify GeminiClient.startChat creates new HistoryService (the REAL replacement scenario):
grep -n "new HistoryService()" packages/core/src/core/client.ts
# Expected: line ~873 — this is where HistoryService instance IS replaced

# 6. Verify _storedHistoryService reuse prevents replacement on provider switch:
grep -B 2 -A 5 "_storedHistoryService" packages/core/src/core/client.ts
# Expected: reuse pattern at lines ~864-870
```

### Blocking Issues

5. [ ] Compression flow hookpoint: `startCompression()`/`endCompression()` exist but do NOT emit events yet — `compressionStarted`/`compressionEnded` events must be added in Phase 14
6. [ ] `isCompressing` is private — RecordingIntegration cannot query it directly, must rely on event-based notification
7. [ ] `GeminiClient.startChat()` creates new `HistoryService` when `_storedHistoryService` is not set — Phase 26 integration must handle rebinding for this edge case



---

## HistoryService Event Contract Verification (Architecture Review FIX 1)

**PURPOSE**: Pin the EXACT current event contract of HistoryService so that Phase 14 modifications are grounded in real code, not assumptions.

### Current `HistoryServiceEventEmitter` Type Definition (from source code)

Copied verbatim from `packages/core/src/services/history/HistoryService.ts` lines 37-47:

```typescript
interface HistoryServiceEventEmitter {
  on(
    event: 'tokensUpdated',
    listener: (eventData: TokensUpdatedEvent) => void,
  ): this;
  emit(event: 'tokensUpdated', eventData: TokensUpdatedEvent): boolean;
  off(
    event: 'tokensUpdated',
    listener: (eventData: TokensUpdatedEvent) => void,
  ): this;
}
```

And from `packages/core/src/services/history/HistoryService.ts` (the `HistoryServiceEventEmitter` interface) and `packages/core/src/services/history/HistoryEvents.ts` (for `TokensUpdatedEvent`):

```typescript
export interface TokensUpdatedEvent {
  totalTokens: number;
  addedTokens: number;
  contentId?: string | null;
}

export interface HistoryServiceEvents {
  tokensUpdated: (event: TokensUpdatedEvent) => void;
}
```

### Events That Exist TODAY vs What the Plan Needs

| Event | Exists Today? | Plan Needs? | Notes |
|-------|--------------|-------------|-------|
| `tokensUpdated` | ✅ YES (emitted in `updateTokenCount()` at line 322) | Not directly | Already used by AppContainer for token tracking |
| `contentAdded` | ❌ NO | ✅ YES | Must be added in Phase 14 — emitted after `this.history.push(content)` in `addInternal()` at line 279 |
| `compressionStarted` | ❌ NO | ✅ YES | Must be added in Phase 14 — emitted in `startCompression()` at line 1483 |
| `compressionEnded` | ❌ NO | ✅ YES | Must be added in Phase 14 — emitted in `endCompression()` at line 1492 |

### Concrete Tasks for Phase 14

Phase 14 MUST add the following events to the `HistoryServiceEventEmitter` interface:

1. **`contentAdded(content: IContent)`** — Emitted synchronously in `addInternal()` after `this.history.push(content)` (line 279). This event enables RecordingIntegration to capture every content addition without polling.

2. **`compressionStarted()`** — Emitted in `startCompression()` (line 1483) after setting `this.isCompressing = true`. This event lets RecordingIntegration know to stop recording individual content events (since compression will clear+re-add).

3. **`compressionEnded(summary: IContent, itemsCompressed: number)`** — Emitted in `endCompression()` (line 1492) after draining pending operations. This event provides the compression summary for the JSONL `compressed` event type.

The exact type signatures that MUST be added to `HistoryServiceEventEmitter`:

```typescript
// New events for Session Recording (Phase 14)
on(event: 'contentAdded', listener: (content: IContent) => void): this;
emit(event: 'contentAdded', content: IContent): boolean;
off(event: 'contentAdded', listener: (content: IContent) => void): this;

on(event: 'compressionStarted', listener: () => void): this;
emit(event: 'compressionStarted'): boolean;
off(event: 'compressionStarted', listener: () => void): this;

on(event: 'compressionEnded', listener: (summary: IContent, itemsCompressed: number) => void): this;
emit(event: 'compressionEnded', summary: IContent, itemsCompressed: number): boolean;
off(event: 'compressionEnded', listener: (summary: IContent, itemsCompressed: number) => void): this;
```

### Verification Command

```bash
grep -A 10 "HistoryServiceEventEmitter" packages/core/src/services/history/HistoryService.ts
```

**Expected output BEFORE Phase 14**: Only `tokensUpdated` event in the interface.
**Expected output AFTER Phase 14**: `tokensUpdated`, `contentAdded`, `compressionStarted`, `compressionEnded` all present.
