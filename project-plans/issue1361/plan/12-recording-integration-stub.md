# Phase 12: Recording Integration Stub

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P12`

## Prerequisites
- Required: Phase 11a completed (SessionLockManager works)
- Verification: `test -f project-plans/issue1361/.completed/P11a.md`
- Required: Phase 05a completed (SessionRecordingService works — RecordingIntegration wraps it)
- Verification: `test -f project-plans/issue1361/.completed/P05a.md`

## Requirements Implemented (Expanded)

### REQ-INT-001: Subscribe to HistoryService Content Additions
**Full Text**: Subscribe to HistoryService `add` event and enqueue a `content` recording event with the IContent that was added.
**Behavior**:
- GIVEN: RecordingIntegration subscribed to a HistoryService instance
- WHEN: Content is added to HistoryService
- THEN: A content event is enqueued to SessionRecordingService
**Why This Matters**: Automatically captures every conversation turn without caller needing to remember.

### REQ-INT-003: Re-subscribe on HistoryService Replacement
**Full Text**: When compression creates a new HistoryService instance, RecordingIntegration must re-subscribe to the new instance.
**Behavior**:
- GIVEN: RecordingIntegration subscribed to old HistoryService
- WHEN: onHistoryServiceReplaced(newService) is called
- THEN: Old subscription cleaned up, new subscription active
**Why This Matters**: Compression replaces HistoryService — recording must follow the active instance.

### REQ-INT-007: Flush at Turn Boundary
**Full Text**: Flush the recording service at the end of each complete turn.
**Behavior**:
- GIVEN: Events have been enqueued during a turn
- WHEN: flushAtTurnBoundary() is awaited
- THEN: All events written to disk
**Why This Matters**: Turn-boundary flush ensures durability.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/RecordingIntegration.ts` — Integration manager stub
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P12`
  - MUST include: `@requirement:REQ-INT-001, REQ-INT-003, REQ-INT-007`
  - Constructor accepting SessionRecordingService
  - `subscribeToHistory(historyService)`: no-op (stub)
  - `unsubscribeFromHistory()`: no-op (stub)
  - `onHistoryServiceReplaced(newService)`: no-op (stub)
  - `recordProviderSwitch(provider, model)`: no-op (stub)
  - `recordDirectoriesChanged(dirs)`: no-op (stub)
  - `recordSessionEvent(severity, message)`: no-op (stub)
  - `flushAtTurnBoundary()`: returns Promise.resolve() (stub)
  - `dispose()`: no-op (stub)

### Files to Modify
- `packages/core/src/recording/index.ts` — Add RecordingIntegration export

### Required Code Markers
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P12
 * @requirement REQ-INT-001, REQ-INT-003, REQ-INT-007
 */
```

## Verification Commands

```bash
# File exists
test -f packages/core/src/recording/RecordingIntegration.ts || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P12" packages/core/src/recording/ | wc -l
# Expected: 1+

# TypeScript compiles
cd packages/core && npx tsc --noEmit

# Method signatures
grep -q "subscribeToHistory" packages/core/src/recording/RecordingIntegration.ts || echo "FAIL"
grep -q "unsubscribeFromHistory" packages/core/src/recording/RecordingIntegration.ts || echo "FAIL"
grep -q "onHistoryServiceReplaced" packages/core/src/recording/RecordingIntegration.ts || echo "FAIL"
grep -q "recordProviderSwitch" packages/core/src/recording/RecordingIntegration.ts || echo "FAIL"
grep -q "recordDirectoriesChanged" packages/core/src/recording/RecordingIntegration.ts || echo "FAIL"
grep -q "recordSessionEvent" packages/core/src/recording/RecordingIntegration.ts || echo "FAIL"
grep -q "flushAtTurnBoundary" packages/core/src/recording/RecordingIntegration.ts || echo "FAIL"
grep -q "dispose" packages/core/src/recording/RecordingIntegration.ts || echo "FAIL"

# Barrel export
grep -q "RecordingIntegration" packages/core/src/recording/index.ts || echo "FAIL: Not exported"

# No TODO
grep -r "TODO" packages/core/src/recording/RecordingIntegration.ts && echo "FAIL"
```

### Semantic Verification Checklist
- [ ] Constructor accepts SessionRecordingService (dependency injection)
- [ ] subscribeToHistory accepts HistoryService parameter
- [ ] flushAtTurnBoundary returns Promise<void>
- [ ] dispose cleans up subscriptions

## Success Criteria
- Stub compiles with `npm run typecheck`
- All method signatures match pseudocode (recording-integration.md lines 30-87)
- Barrel export works

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/RecordingIntegration.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P12.md`
