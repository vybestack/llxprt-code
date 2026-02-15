# Phase 14: Recording Integration Implementation

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P14`

## Prerequisites
- Required: Phase 13a completed
- Verification: `test -f project-plans/issue1361/.completed/P13a.md`
- Expected: Tests in RecordingIntegration.test.ts exist and fail against stub

## Requirements Implemented (Expanded)

Implements all REQ-INT-001 through REQ-INT-007 to make Phase 13 tests pass.

## Implementation Tasks

### PRIORITY 1: HistoryService Event Contract Additions

RecordingIntegration cannot be implemented until the events it subscribes to actually exist. The current `HistoryServiceEventEmitter` interface (HistoryService.ts lines 37-47) only defines `tokensUpdated`. Phase 14 MUST add the following three events BEFORE implementing any RecordingIntegration logic.

#### Pinned Type Signatures (EXACT — do not deviate)

```typescript
// In HistoryServiceEventEmitter interface (HistoryService.ts ~line 37):

// Event: contentAdded
// Emitted: in addInternal() after this.history.push(content) at line 279
// Purpose: RecordingIntegration captures every new content addition
contentAdded: (content: IContent) => void;

// Event: compressionStarted
// Emitted: in startCompression() at line 1483, after setting isCompressing=true
// Purpose: RecordingIntegration stops recording re-adds during compression
compressionStarted: () => void;

// Event: compressionEnded
// Emitted: in endCompression() at line 1492, after draining pending queue
// Purpose: RecordingIntegration captures compression summary for JSONL
compressionEnded: (summary: IContent, itemsCompressed: number) => void;
```

#### Sub-Task 14.1: Extend HistoryServiceEventEmitter Interface

Add to the interface at HistoryService.ts lines 37-47:

```typescript
interface HistoryServiceEventEmitter {
  // Existing
  on(event: 'tokensUpdated', listener: (eventData: TokensUpdatedEvent) => void): this;
  emit(event: 'tokensUpdated', eventData: TokensUpdatedEvent): boolean;
  off(event: 'tokensUpdated', listener: (eventData: TokensUpdatedEvent) => void): this;

  // NEW: contentAdded — fired after every content push
  on(event: 'contentAdded', listener: (content: IContent) => void): this;
  emit(event: 'contentAdded', content: IContent): boolean;
  off(event: 'contentAdded', listener: (content: IContent) => void): this;

  // NEW: compressionStarted — fired when compression begins
  on(event: 'compressionStarted', listener: () => void): this;
  emit(event: 'compressionStarted'): boolean;
  off(event: 'compressionStarted', listener: () => void): this;

  // NEW: compressionEnded — fired when compression finishes
  on(event: 'compressionEnded', listener: (summary: IContent, itemsCompressed: number) => void): this;
  emit(event: 'compressionEnded', summary: IContent, itemsCompressed: number): boolean;
  off(event: 'compressionEnded', listener: (summary: IContent, itemsCompressed: number) => void): this;
}
```

- **Files**: `packages/core/src/services/history/HistoryService.ts` (interface only)
- **Complexity**: Low (type-level changes only, no runtime behavior)
- **Verification**: `npx tsc --noEmit` passes

#### Sub-Task 14.2: Emit `contentAdded` in addInternal()

In HistoryService.ts, in `addInternal()` after `this.history.push(content)` at line 279:

```typescript
this.history.push(content);
// @plan:PLAN-20260211-SESSIONRECORDING.P14
this.emit('contentAdded', content);
```

- **Files**: `packages/core/src/services/history/HistoryService.ts` (one line addition)
- **Complexity**: Low
- **Risk**: Verify existing tests still pass — the new event must not break callers that don't listen for it.

#### Sub-Task 14.3: Emit Compression Lifecycle Events

Compression is IN-PLACE on the same HistoryService instance. `GeminiChat.historyService` is `private readonly` (geminiChat.ts line 408). `performCompression()` (geminiChat.ts lines 2011-2037) calls `startCompression()` -> `clear()` -> `add()` for each item -> `endCompression()` on the SAME instance.

**File: `packages/core/src/services/history/HistoryService.ts`**

In `startCompression()` (~line 1483), after setting `isCompressing = true`:
```typescript
startCompression(): void {
  this.logger.debug('Starting compression - locking history');
  this.isCompressing = true;
  // @plan:PLAN-20260211-SESSIONRECORDING.P14
  this.emit('compressionStarted');
}
```

In `endCompression()` (~line 1492), after draining pending queue. The `summary` and `itemsCompressed` are passed from the compression caller. Change `endCompression()` signature to require these parameters:
```typescript
endCompression(summary: IContent, itemsCompressed: number): void {
  // ... existing logic (drain pending queue) ...
  // After draining:
  this.emit('compressionEnded', summary, itemsCompressed);
}
```

**File: `packages/core/src/core/geminiChat.ts`** — Update `performCompression()` to pass compression result to `endCompression()`:
```typescript
// In performCompression(), the finally block:
} finally {
  this.historyService.endCompression(result.newHistory[0], preCompressionCount);
}
```

- **Complexity**: Medium — must update `endCompression` signature and all callers
- **Risk**: All callers of `endCompression()` must be updated to pass the required parameters

### Sub-Task 14.4: RecordingIntegration Class Implementation

**File: `packages/core/src/recording/RecordingIntegration.ts`**

Implementation from pseudocode (MANDATORY line references from `analysis/pseudocode/recording-integration.md`):

- **Lines 30-37**: Class declaration, fields — recording: SessionRecordingService, historySubscription cleanup function, compressionInProgress boolean
- **Lines 39-71**: subscribeToHistory method:
  - **Line 41**: Call unsubscribeFromHistory() first
  - **Lines 44-50**: Create onContentAdded handler — check compressionInProgress, if true return; otherwise recording.recordContent(content)
  - **Line 51**: Subscribe to HistoryService 'contentAdded' event
  - **Lines 54-56**: Create onCompressionStarted handler — set compressionInProgress = true
  - **Line 57**: Subscribe to 'compressionStarted'
  - **Lines 59-62**: Create onCompressionEnded handler — set compressionInProgress = false, recording.recordCompressed(summary, itemsCompressed)
  - **Line 63**: Subscribe to 'compressionEnded'
  - **Lines 66-70**: Store cleanup function that calls off() for all three handlers
- **Lines 73-78**: unsubscribeFromHistory — call stored cleanup, set to null
- **Lines 80-82**: recordProviderSwitch — delegate to recording.recordProviderSwitch
- **Lines 84-86**: recordDirectoriesChanged — delegate to recording.recordDirectoriesChanged
- **Lines 88-90**: recordSessionEvent — delegate to recording.recordSessionEvent
- **Lines 92-94**: flushAtTurnBoundary — await recording.flush()
- **Lines 96-98**: dispose — call unsubscribeFromHistory()
- **Lines 102-104**: onHistoryServiceReplaced — call subscribeToHistory(newHistoryService) (for the rare startChat edge case)

- **Complexity**: Medium — straightforward event wiring
- **Risk**: Memory leaks if unsubscribe is missed; race condition if replacement happens during handler
- **Verification**: All Phase 13 tests pass

### Sub-Task 14.5: Handle startChat()-based HistoryService Creation (Phase 26 Wiring)

**File: `packages/cli/src/ui/hooks/useGeminiStream.ts` or `packages/cli/src/ui/AppContainer.tsx`**

The only case where the HistoryService instance is genuinely replaced is `GeminiClient.startChat()` (client.ts line 873), which creates a new `HistoryService()` unless `_storedHistoryService` is set (lines 864-870). This happens:
- On initial session creation (RecordingIntegration subscribes after creation — no rebind needed)
- On provider switch without `storeHistoryServiceForReuse()` (rare edge case)

For the provider-switch edge case, in the Phase 26 integration wiring:
- After `GeminiClient.startChat()` returns a new `GeminiChat`
- Get the new `HistoryService` via `GeminiClient.getHistoryService()` (client.ts line 568-576)
- Call `recordingIntegration.onHistoryServiceReplaced(newHistoryService)`

### Sub-Task 14.6: Non-Interactive Flush Integration

**File: `packages/cli/src/nonInteractiveCli.ts`**

Update the `RunNonInteractiveParams` interface (line 38) to accept an optional recording service:

```typescript
interface RunNonInteractiveParams {
  config: Config;
  settings: LoadedSettings;
  input: string;
  prompt_id: string;
  recordingService?: SessionRecordingService;  // NEW: from Phase 14
}
```

In the `finally` block (line 540), add recording flush BEFORE `shutdownTelemetry()`:

```typescript
} finally {
  cleanupStdinCancellation();

  // Flush recording before telemetry shutdown (Tier 1 guarantee)
  if (recordingService) {
    try {
      await recordingService.flush();
    } catch (flushError) {
      console.error(`Recording flush failed: ${flushError instanceof Error ? flushError.message : String(flushError)}`);
    }
  }

  consolePatcher.cleanup();
  coreEvents.off(CoreEvent.UserFeedback, handleUserFeedback);
  if (isTelemetrySdkInitialized()) {
    await shutdownTelemetry(config);
  }
}
```

### Sub-Task 14.7: Create Recording Service in gemini.tsx Non-Interactive Path

**File: `packages/cli/src/gemini.tsx`**

In the non-interactive execution path, before calling `runNonInteractive()`:

```typescript
let recordingService: SessionRecordingService | undefined;
let lockHandle: LockHandle | undefined;

if (/* recording enabled check */) {
  const chatsDir = path.join(config.getProjectTempDir(), 'chats');
  const sessionId = config.getSessionId();

  lockHandle = await SessionLockManager.acquireForSession(chatsDir, sessionId);
  registerCleanup(async () => {
    await lockHandle?.release();
  });

  recordingService = new SessionRecordingService(chatsDir, sessionId, {
    deferMaterialization: true,
  });
}

await runNonInteractive({
  config, settings, input,
  prompt_id: config.getSessionId(),
  recordingService,
});
```

### Sub-Task 14.8: Wire RecordingIntegration in Non-Interactive Mode

**File: `packages/cli/src/nonInteractiveCli.ts`**

**CRITICAL ORDERING CONSTRAINT**: Recording must subscribe to HistoryService events BEFORE any messages are sent. If subscription happens after `sendMessageStream()`, the first user message's `contentAdded` event is missed — the recording would start from the AI response, losing the user's prompt.

The correct ordering is:

```
1. Create SessionRecordingService (done in gemini.tsx, passed via params)
2. Get HistoryService from geminiClient (available after client creation)
3. Create RecordingIntegration
4. Subscribe to HistoryService events  ← BEFORE any messages sent
5. Call sendMessageStream (which triggers history events)
6. Flush in finally block
```

```typescript
// BEFORE the while(true) turn loop, BEFORE any sendMessageStream call:
let recordingIntegration: RecordingIntegration | undefined;
if (recordingService) {
  const historyService = geminiClient.getHistoryService();
  if (historyService) {
    recordingIntegration = new RecordingIntegration(recordingService);
    recordingIntegration.subscribeToHistory(historyService);
  }
}

// ... then the turn loop with sendMessageStream calls ...
```

**Why not after `sendMessageStream()`?** The `sendMessageStream()` call internally invokes `historyService.add()` for the user message. If RecordingIntegration is not yet subscribed, that `contentAdded` event fires into the void — the user's first message is silently dropped from the recording.

### Sub-Task 14.9: End-to-End Verification
- Run full test suite, verify plan markers, check for debug code, run TypeScript compilation.
- **Complexity**: Low
- **Estimated effort**: ~15 minutes

### Recommended Execution Order

14.1 -> 14.2 -> 14.3 -> 14.4 -> 14.5 -> 14.6 -> 14.7 -> 14.8 -> 14.9

Rationale: Types first (14.1), then simple event emission (14.2), then compression events (14.3), then the consumer class (14.4), then the wiring edge case (14.5), then non-interactive integration (14.6-14.8), then verification (14.9).

### Files to Modify (Summary)

- `packages/core/src/services/history/HistoryService.ts` — Add `contentAdded`, `compressionStarted`, `compressionEnded` event types and emission
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P14`
- `packages/core/src/recording/RecordingIntegration.ts` — Full implementation
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P14`
  - MUST reference pseudocode lines from `analysis/pseudocode/recording-integration.md`
- `packages/core/src/core/geminiChat.ts` — Pass compression result to `endCompression()` call
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P14`
- `packages/cli/src/nonInteractiveCli.ts` — Add recording parameter and flush in finally block
- `packages/cli/src/gemini.tsx` — Create recording service for non-interactive path

### Do NOT Modify
- `packages/core/src/recording/RecordingIntegration.test.ts` — Tests must not be changed

## Flush Boundary Analysis

### Content-Emitting Paths Coverage

| # | Path | Flush Point | Covered? |
|---|------|-------------|----------|
| 1 | Normal AI response | `submitQuery` finally block | YES |
| 2 | Tool call results (normal) | Continuation `submitQuery` finally | YES |
| 3 | Tool call results (cancelled turn) | Original `submitQuery` finally | YES |
| 4 | All tools cancelled | Original `submitQuery` finally | YES |
| 5 | Slash command side effects | Covered via continuations or N/A | YES |
| 6 | Cancellation mid-turn (Escape key) | Additional fire-and-forget flush in `cancelOngoingRequest` + `submitQuery` finally | YES (with additional flush) |
| 7 | Error during tool execution | Same `submitQuery` continuation path | YES |
| 8 | Error during API streaming | `submitQuery` catch -> finally | YES |
| 9 | Compression during turn | Within `sendMessageStream`, within `submitQuery` | YES |
| 10 | Non-interactive mode | `finally` block of `runNonInteractive()` (Sub-Task 14.6) | YES |

### Cancellation Race Condition Fix

`cancelOngoingRequest()` sets `isResponding(false)` at line 507. The `submitQuery` finally block also sets `isResponding(false)`. An additional fire-and-forget flush is needed in `cancelOngoingRequest`:

```typescript
// In cancelOngoingRequest (useGeminiStream.ts ~line 506-507):
if (recordingIntegration) {
  void recordingIntegration.flushAtTurnBoundary().catch(() => {});
}
setIsResponding(false);
```

## Turn Completion Signal Reference

The authoritative "turn is done, flush now" signal is defined in `specification.md` under "Durability Contract > Turn Completion Signal".

**Interactive mode**: `submitQuery` `finally` block in `useGeminiStream.ts` (line 1286). The recording flush MUST be called here, BEFORE `setIsResponding(false)`.

**Non-interactive mode**: `finally` block of `runNonInteractive()` in `nonInteractiveCli.ts`. The recording flush MUST be called here, BEFORE `shutdownTelemetry()`.

## Required Code Markers

Every function/method in the implementation MUST include:
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P14
 * @requirement REQ-INT-001 (or appropriate REQ-INT-*)
 * @pseudocode recording-integration.md lines X-Y
 */
```

## Verification Commands

```bash
# All tests pass
cd packages/core && npx vitest run src/recording/RecordingIntegration.test.ts
# Expected: All pass

# No test modifications
git diff packages/core/src/recording/RecordingIntegration.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# Plan markers present
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P14" packages/core/src/recording/RecordingIntegration.ts
# Expected: 1+

# Pseudocode references present
grep -c "@pseudocode" packages/core/src/recording/RecordingIntegration.ts
# Expected: 1+

# No debug code
grep -rn "console\.\|TODO\|FIXME\|XXX" packages/core/src/recording/RecordingIntegration.ts && echo "FAIL"

# TypeScript compiles
cd packages/core && npx tsc --noEmit

# Verify compression uses same HistoryService (not replacement):
grep -n "private readonly historyService" packages/core/src/core/geminiChat.ts
# Expected: line 408 — confirms readonly field

# Verify performCompression calls clear+add on same instance:
grep -A 5 "Apply result: clear history" packages/core/src/core/geminiChat.ts
# Expected: this.historyService.clear() and this.historyService.add()

# Verify compressionStarted/compressionEnded events emitted after implementation:
grep -n "compressionStarted\|compressionEnded" packages/core/src/services/history/HistoryService.ts
# Expected: emit calls in startCompression() and endCompression()

# Verify RunNonInteractiveParams has recordingService:
grep -n "recordingService" packages/cli/src/nonInteractiveCli.ts
# Expected: in interface and finally block

# Verify flush in finally block:
grep -B 2 -A 5 "recordingService.*flush" packages/cli/src/nonInteractiveCli.ts
# Expected: try/catch around flush call
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY)" packages/core/src/recording/RecordingIntegration.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/recording/RecordingIntegration.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/core/src/recording/RecordingIntegration.ts
# Expected: No matches in implementation
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does subscribeToHistory actually register event listeners on HistoryService?** -- [ ]
2. **Does unsubscribeFromHistory actually remove event listeners?** -- [ ]
3. **Does onHistoryServiceReplaced actually switch subscriptions?** -- [ ]
4. **Do delegate methods actually call the SessionRecordingService?** -- [ ]
5. **Does flushAtTurnBoundary actually await the flush?** -- [ ]
6. **Does compressionInProgress flag correctly suppress re-add events?** -- [ ]

#### Feature Actually Works
```bash
# Manual verification: Create integration and verify event flow
node -e "
const { SessionRecordingService, RecordingIntegration } = require('./packages/core/dist/recording/index.js');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-test-'));
const svc = new SessionRecordingService({
  sessionId: 'int-test',
  projectHash: 'hash-abc',
  chatsDir: tmpDir,
  workspaceDirs: ['/test'],
  provider: 'test',
  model: 'model'
});
const integration = new RecordingIntegration(svc);
integration.recordProviderSwitch('openai', 'gpt-5');
svc.recordContent({ speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] });
integration.flushAtTurnBoundary().then(() => {
  const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.jsonl'));
  console.log('Files:', files);
  if (files.length > 0) {
    const lines = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8').trim().split('\n');
    lines.forEach((l, i) => { const p = JSON.parse(l); console.log('Line', i, ':', p.type); });
  }
  fs.rmSync(tmpDir, { recursive: true });
});
"
```

#### Integration Points Verified
- [ ] RecordingIntegration correctly wraps SessionRecordingService
- [ ] HistoryService events correctly trigger recording
- [ ] Compression events correctly suppress re-add content and emit compressed event
- [ ] Event listener cleanup prevents memory leaks
- [ ] Non-interactive flush in finally block captures all content

#### Lifecycle Verified
- [ ] subscribe -> unsubscribe -> re-subscribe cycle works
- [ ] dispose cleans up all listeners
- [ ] No fire-and-forget async operations

#### Edge Cases Verified
- [ ] Subscribe with no prior subscription works
- [ ] Replace with same service instance works
- [ ] Empty flush works

## Success Criteria
- All Phase 13 tests pass without modification
- Implementation follows pseudocode
- No deferred implementation patterns
- TypeScript compiles cleanly
- Compression-aware content filtering works correctly

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/RecordingIntegration.ts
git checkout -- packages/core/src/services/history/HistoryService.ts
git checkout -- packages/core/src/core/geminiChat.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P14.md`
