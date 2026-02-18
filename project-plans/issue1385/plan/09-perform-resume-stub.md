# Phase 09: performResume — Stub

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P09`

## Prerequisites
- Required: Phase 08a completed
- Verification: `test -f project-plans/issue1385/.completed/P08a.md`
- Expected files from previous phases:
  - `packages/core/src/recording/SessionDiscovery.ts` (extended in P06-P08)
  - `project-plans/issue1385/analysis/pseudocode/perform-resume.md`

## Requirements Implemented (Expanded)

### REQ-PR-001: Single Shared Utility
**Full Text**: Both the browser path and the direct `/continue <ref>` path shall use a single `performResume()` function that owns all resume side-effects.
**Behavior**:
- GIVEN: A session reference (ID, prefix, index, or `latest`)
- WHEN: `performResume(sessionRef, context)` is called
- THEN: The function resolves the reference, acquires the target session, performs recording swap side-effects, and only then returns its result payload
**Why This Matters**: Prevents side-effect drift and behavioral mismatch between browser resume and direct command resume.

### REQ-PR-002: Discriminated Union Result
**Full Text**: `performResume()` shall return `{ ok: true, history, metadata, warnings }` on success or `{ ok: false, error: string }` on failure.
**Behavior**:
- GIVEN: A valid resumable session
- WHEN: `performResume` succeeds
- THEN: Returns `{ ok: true, history, metadata, warnings }`
- GIVEN: Invalid/locked/empty/missing session
- WHEN: `performResume` fails
- THEN: Returns `{ ok: false, error }`
**Why This Matters**: Keeps side-effects in the utility while returning a stable output contract used by both entry points.

### REQ-SW-001 through REQ-SW-005: Two-Phase Swap and Cleanup Ordering
**Full Text**: New session must be acquired before old session disposal; old integration disposal must precede old recording disposal; old lock release is best-effort.
**Behavior**:
- GIVEN: Active recording infrastructure
- WHEN: Resume succeeds
- THEN: `integration.dispose()` runs before `recording.dispose()`, old lock release happens after disposal, warning-only on lock-release failure
**Why This Matters**: Prevents writing to a closing file and avoids data-loss windows during swap.

### REQ-RC-009: Same-Session Rejection
**Full Text**: If referenced session is already active, return `That session is already active.`
**Behavior**:
- GIVEN: A ref that resolves to the current session ID
- WHEN: `performResume` validates the ref
- THEN: Returns `{ ok: false, error: 'That session is already active.' }`

### REQ-PR-005: Generation Guard
**Full Text**: Resume attempts shall be guarded against stale async completions.
**Behavior**:
- GIVEN: A newer resume attempt supersedes an older attempt
- WHEN: The older attempt continues asynchronously
- THEN: It is discarded as stale; if it already acquired resources, those resources are disposed best-effort before returning stale/superseded error
**Why This Matters**: Prevents split-brain recording ownership under rapid consecutive resume actions.

## Implementation Tasks

### Files to Create
- `packages/cli/src/services/performResume.ts`
  - Export `RecordingSwapCallbacks`
  - Export `ResumeContext`
  - Export `PerformResumeResult`
  - Export `performResume(sessionRef: string, context: ResumeContext): Promise<PerformResumeResult>`
  - Stub behavior for this phase: return `{ ok: false, error: 'NotYetImplemented' }`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P09`
  - MUST include: `@requirement:REQ-PR-001, REQ-PR-002, REQ-SW-001, REQ-PR-005`
  - MUST include: `@pseudocode perform-resume.md lines 10-170`

### Required Types (stub contract)
```typescript
interface RecordingSwapCallbacks {
  getCurrentRecording: () => SessionRecordingService | null;
  getCurrentIntegration: () => RecordingIntegration | null;
  getCurrentLockHandle: () => LockHandle | null;
  setRecording: (
    recording: SessionRecordingService,
    integration: RecordingIntegration,
    lock: LockHandle | null,
    metadata: SessionRecordingMetadata,
  ) => void;
}

interface ResumeContext {
  chatsDir: string;
  projectHash: string;
  currentSessionId: string;
  currentProvider: string;
  currentModel: string;
  workspaceDirs: string[];
  recordingCallbacks: RecordingSwapCallbacks;
  logger?: Logger;
}

type PerformResumeResult =
  | {
      ok: true;
      history: IContent[];
      metadata: SessionMetadata;
      warnings: string[];
    }
  | { ok: false; error: string };
```

## Verification Commands
```bash
# File exists
test -f packages/cli/src/services/performResume.ts || echo "FAIL: performResume.ts missing"

# Exported contracts exist
grep -q "export interface RecordingSwapCallbacks" packages/cli/src/services/performResume.ts || echo "FAIL: RecordingSwapCallbacks"
grep -q "export interface ResumeContext" packages/cli/src/services/performResume.ts || echo "FAIL: ResumeContext"
grep -q "export type PerformResumeResult" packages/cli/src/services/performResume.ts || echo "FAIL: PerformResumeResult"
grep -q "export async function performResume" packages/cli/src/services/performResume.ts || echo "FAIL: performResume export"

# Stub return expected in this phase
grep -q "NotYetImplemented" packages/cli/src/services/performResume.ts || echo "FAIL: stub marker missing"

# Marker checks
grep -q "@plan PLAN-20260214-SESSIONBROWSER.P09" packages/cli/src/services/performResume.ts || echo "FAIL: plan marker"
grep -q "@requirement:REQ-PR-001" packages/cli/src/services/performResume.ts || echo "FAIL: requirement marker"

# TypeScript compiles
cd packages/cli && npx tsc --noEmit
```

## Deferred Implementation Detection
```bash
# Stub phase allows explicit NotYetImplemented, but no hidden placeholders
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP" packages/cli/src/services/performResume.ts
# Expected: no matches except explicit NotYetImplemented stub return
```

## Feature Actually Works
This is a stub phase. “Works” means the API surface is complete and type-safe for the upcoming TDD phase.

Manual command:
```bash
cd packages/cli && npx tsc --noEmit
```
Expected: compilation succeeds with exported contracts present.

### Semantic Verification Questions (YES required)
1. YES/NO — Does success result shape exclude `newRecording/newLock/newIntegration` and include only `history/metadata/warnings`?
2. YES/NO — Does `ResumeContext` use callback/ref recording swap APIs instead of direct mutable fields?
3. YES/NO — Is there exactly one exported `performResume` function planned for both browser and direct `/continue <ref>` paths?
4. YES/NO — Is generation-guard stale-discard behavior explicitly documented for later implementation?
5. YES/NO — Does the stub compile while intentionally returning a failing runtime result?

## Integration Points Verified
- `performResume` output is consumable by both browser hook and slash-command path.
- Recording swap ownership is represented via `recordingCallbacks.setRecording(...)` contract.
- Core dependencies are identified for next phase (`SessionDiscovery`, `SessionLockManager`, `resumeSession`).

## Success Criteria
- `performResume.ts` created with the exact exported contracts above.
- Stub compiles and returns explicit `NotYetImplemented` error result.
- Markers and references are present for plan/requirements/pseudocode.

## Failure Recovery
```bash
git checkout -- packages/cli/src/services/performResume.ts
rm -f packages/cli/src/services/performResume.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P09.md`
