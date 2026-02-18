# Phase 06: Replay Engine Stub

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P06`

## Prerequisites
- Required: Phase 05a completed
- Verification: `test -f project-plans/issue1361/.completed/P05a.md`
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P05" packages/core/src/recording/`

## Requirements Implemented (Expanded)

### REQ-RPL-001: Pure Replay Function
**Full Text**: A pure function that reads a JSONL session file and returns a ReplayResult containing history, metadata, lastSeq, eventCount, and warnings.
**Behavior**:
- GIVEN: A path to a .jsonl file and expected project hash
- WHEN: replaySession() is called
- THEN: Returns a ReplayResult or ReplayError (stub: throws NotYetImplemented)
**Why This Matters**: The replay function is the read-side counterpart to the writer — essential for --continue.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/ReplayEngine.ts` — Stub
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P06`
  - MUST include: `@requirement:REQ-RPL-001`
  - `replaySession(filePath, expectedProjectHash)`: throws NotYetImplemented
  - `readSessionHeader(filePath)`: throws NotYetImplemented

### Files to Modify
- `packages/core/src/recording/index.ts` — Add ReplayEngine exports

### Required Code Markers
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P06
 * @requirement REQ-RPL-001
 */
```

## Verification Commands

```bash
test -f packages/core/src/recording/ReplayEngine.ts || echo "FAIL"
grep -q "replaySession" packages/core/src/recording/ReplayEngine.ts || echo "FAIL"
grep -q "readSessionHeader" packages/core/src/recording/ReplayEngine.ts || echo "FAIL"
cd packages/core && npx tsc --noEmit
```

### Semantic Verification Checklist
- [ ] Function signatures match pseudocode (filePath: string, expectedProjectHash: string)
- [ ] Return type is ReplayResult | ReplayError (from types.ts)
- [ ] readSessionHeader returns SessionStartPayload | null

## Success Criteria
- Stub compiles, exports correct function signatures
- No TODO comments, no V2 files

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/ReplayEngine.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P06.md`
