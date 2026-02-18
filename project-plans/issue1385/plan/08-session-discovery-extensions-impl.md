# Phase 08: Session Discovery Extensions — Implementation

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P08`

## Prerequisites
- Required: Phase 07a completed
- Verification: `test -f project-plans/issue1385/.completed/P07a.md`
- Expected files:
  - `packages/core/src/recording/SessionDiscovery.ts` (stubs from P06)
  - `packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts` (tests from P07)

## Requirements Implemented (Expanded)

### REQ-SB-008: Detailed Listing with Skipped Count
**Full Text**: Session discovery shall expose skipped unreadable-file count together with valid sessions.
**Behavior**:
- GIVEN: mixed valid/corrupted files
- WHEN: `listSessionsDetailed(chatsDir, projectHash)` runs
- THEN: returns `{ sessions, skippedCount }` with newest-first sorting

### REQ-SB-005: Empty Session Detection
**Full Text**: Empty sessions (no events beyond header) shall be detectable and filtered.
**Behavior**:
- GIVEN: a file containing only `session_start`
- WHEN: `hasContentEvents(filePath)` runs
- THEN: returns `false`

### REQ-PV-002 / REQ-PV-009 / REQ-PV-010: Preview Extraction Resilience
**Full Text**: First user preview shall be extracted from text parts only, optionally truncated, and resilient to malformed/unexpected lines.
**Behavior**:
- GIVEN: content lines with mixed schema and parts
- WHEN: `readFirstUserMessage(filePath, maxLength?)` runs
- THEN: returns first user text preview or `null` without throwing

## Implementation Tasks

### Files to Modify
- `packages/core/src/recording/SessionDiscovery.ts`
  - Implement `listSessionsDetailed(chatsDir, projectHash)`
  - Implement `hasContentEvents(filePath)`
  - Implement `readFirstUserMessage(filePath, maxLength?)`
  - Preserve P06 markers and add P08 markers with pseudocode references
  - Keep method sequence explicit and stable:
    1. `listSessionsDetailed(chatsDir, projectHash)`
    2. `hasContentEvents(filePath)`
    3. `readFirstUserMessage(filePath, maxLength?)`

### Do NOT Modify
- `packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts` (must pass unchanged)
- Existing behavior of `listSessions()` and `resolveSessionRef()`.

## Verification Commands
```bash
# Extension tests pass
cd packages/core && npx vitest run src/recording/__tests__/SessionDiscovery.extensions.spec.ts

# Baseline recording tests pass
cd packages/core && npx vitest run src/recording

# Marker checks
rg -n "@plan PLAN-20260214-SESSIONBROWSER.P06|@plan PLAN-20260214-SESSIONBROWSER.P08" packages/core/src/recording/SessionDiscovery.ts
rg -n "@pseudocode" packages/core/src/recording/SessionDiscovery.ts

# Sequence and signature checks
rg -n "listSessionsDetailed\(chatsDir: string,\s*projectHash: string\)" packages/core/src/recording/SessionDiscovery.ts
rg -n "hasContentEvents\(filePath: string\)" packages/core/src/recording/SessionDiscovery.ts
rg -n "readFirstUserMessage\(filePath: string,\s*maxLength\?: number\)" packages/core/src/recording/SessionDiscovery.ts

# Compile
cd packages/core && npx tsc --noEmit
```

## Deferred Implementation Detection
```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" packages/core/src/recording/SessionDiscovery.ts
# Expected: no matches for implementation phase
```

## Feature Actually Works
Manual command:
```bash
cd packages/core && npx vitest run src/recording/__tests__/SessionDiscovery.extensions.spec.ts --reporter=verbose
```
Expected: all extension behavior tests pass, including unreadable counting, empty detection, and preview extraction.

### Semantic Verification Questions (YES required)
1. YES/NO — Does `listSessionsDetailed` return both `sessions` and `skippedCount` correctly?
2. YES/NO — Does `hasContentEvents` detect empty sessions by file content rather than hardcoded return?
3. YES/NO — Does `readFirstUserMessage` accept optional `maxLength` and truncate preview correctly?
4. YES/NO — Are malformed/unexpected lines handled without throws in preview extraction path?
5. YES/NO — Are existing `listSessions` and `resolveSessionRef` behaviors preserved?

## Integration Points Verified
- `useSessionBrowser` can consume `{ sessions, skippedCount }` from core in one call.
- Browser-side empty filtering can use `hasContentEvents(filePath)`.
- Preview enrichment can call `readFirstUserMessage(filePath, maxLength?)` consistently with pseudocode.

## Success Criteria
- All P07 tests pass unchanged.
- Core recording test suite remains green.
- No placeholder/deferred markers remain in implementation.

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionDiscovery.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P08.md`
