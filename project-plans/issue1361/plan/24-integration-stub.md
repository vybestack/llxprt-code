# Phase 24: System Integration Stub

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P24`

## Prerequisites
- Required: ALL component phases completed:
  - Phase 05a (SessionRecordingService)
  - Phase 08a (ReplayEngine)
  - Phase 11a (SessionLockManager)
  - Phase 14a (RecordingIntegration)
  - Phase 17a (Session Cleanup)
  - Phase 20a (Resume Flow — SessionDiscovery + resumeSession)
  - Phase 23a (Session Management — list/delete)
- Verification: All `.completed/P*a.md` files for P05a, P08a, P11a, P14a, P17a, P20a, P23a exist

## Requirements Implemented (Expanded)

This phase wires ALL recording components into the existing system. It modifies the actual application files that users interact with.

### REQ-INT-007 (extended): Turn Boundary Flush Integration
**Full Text**: Add flush() call at the end of each complete turn in useGeminiStream.
**Behavior**:
- GIVEN: Recording service is active and a turn has completed
- WHEN: The turn's finally block executes in useGeminiStream
- THEN: recording.flush() is awaited before the turn is considered done
**Why This Matters**: Ensures durability at turn boundaries.

### REQ-RSM-001 (integration): CLI Flag Wiring
**Full Text**: Wire --continue flag changes into gemini.tsx CLI argument parsing.
**Behavior**:
- GIVEN: User runs CLI with `--continue` or `--continue <id>`
- WHEN: CLI args are parsed
- THEN: Config receives the continue session reference
**Why This Matters**: Entry point for the entire resume feature.

### REQ-CON-006: Cleanup Registration
**Full Text**: Register recording flush and lock release as cleanup handlers via registerCleanup.
**Behavior**:
- GIVEN: Recording service is active
- WHEN: Process receives SIGINT/SIGTERM or exits
- THEN: flush() completes and lock is released before exit
**Why This Matters**: Data integrity on clean shutdown.

## Implementation Tasks

### Strategy
This phase creates STUB modifications to the integration points. The stubs add import statements and placeholder function calls that compile but don't yet affect behavior. This establishes the wiring structure before the TDD phase tests it.

### Files to Modify (STUBS)

- `packages/cli/src/gemini.tsx` — Add stub integration points
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P24`
  - ADD: Import SessionRecordingService, RecordingIntegration, resumeSession, handleListSessions, handleDeleteSession, CONTINUE_LATEST
  - ADD: Stub --list-sessions and --delete-session yargs options (type but no handler)
  - ADD: Stub --continue coerce function change (string type with skipValidation)
  - ADD: Stub recording service initialization point (commented/conditional)

- `packages/core/src/config/config.ts` — Add config method stubs
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P24`
  - ADD: `getContinueSessionRef()`: returns null (stub)
  - MODIFY: `isContinueSession()` to handle string values

- `packages/cli/src/ui/hooks/useGeminiStream.ts` — Add flush point stub
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P24`
  - ADD: Comment/placeholder for recording.flush() at turn boundary

- `packages/cli/src/utils/cleanup.ts` — Verify registerCleanup exists and is usable
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P24`
  - ADD: Type annotation for recording cleanup if needed

### Required Code Markers
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P24
 * @requirement REQ-INT-007, REQ-RSM-001, REQ-CON-006
 */
```

## Verification Commands

```bash
# Plan markers in integration files
grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P24" packages/cli/src/ packages/core/src/config/ | wc -l
# Expected: 3+

# TypeScript compiles
npm run typecheck

# Existing tests still pass
npm run test 2>&1 | tail -5

# Import paths valid
grep -q "recording" packages/cli/src/gemini.tsx || echo "WARNING: recording import missing"
grep -q "getContinueSessionRef" packages/core/src/config/config.ts || echo "FAIL: Config method missing"

# Build succeeds
npm run build
```

### Semantic Verification Checklist
- [ ] All imports reference actual exports from recording/index.ts
- [ ] Config changes are correct (isContinueSession handles new string type)
- [ ] No existing behavior is broken
- [ ] Stub wiring points are clearly marked for Phase 26 implementation

## Success Criteria
- All integration points have stub modifications
- TypeScript compiles
- All existing tests pass
- Build succeeds

## Failure Recovery
```bash
git checkout -- packages/cli/src/gemini.tsx
git checkout -- packages/core/src/config/config.ts
git checkout -- packages/cli/src/ui/hooks/useGeminiStream.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P24.md`
