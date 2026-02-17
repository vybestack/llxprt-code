# Phase 32: End-to-End Integration — Implementation

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P32`

## Prerequisites

- Required: Phase 31a completed
- Verification: `test -f project-plans/issue1385/.completed/P31a.md`
- Expected files from previous phase:
  - `packages/cli/src/__tests__/sessionBrowserE2E.spec.ts` — 19+ E2E tests
  - All component implementations from P03-P29
- Preflight verification: Phase 0.5 completed

## Requirements Implemented (Expanded)

This phase wires together all components and fixes any integration gaps to make E2E tests pass. The primary focus is ensuring:

### REQ-SW-001: Two-Phase Swap
**Full Text**: Acquire new session before disposing old.
**Behavior**: See P31 for detailed GIVEN/WHEN/THEN.

### REQ-SW-003: Dispose Ordering
**Full Text**: During Phase 2, call `recordingIntegration.dispose()` before `recordingService.dispose()`.
**Behavior**:
- GIVEN: Successful resume (new session acquired)
- WHEN: Disposing the old session (Phase 2)
- THEN: Integration bridge disposed first (unsubscribes from HistoryService), then recording service disposed (flushes and closes file)

### REQ-SW-004: Lock Release
**Full Text**: During Phase 2, release old lock. If old lock is null, skip.
**Behavior**:
- GIVEN: Old session with a lock handle
- WHEN: Phase 2 of swap
- THEN: `lockHandle.release()` called on old lock

### REQ-SW-005: Lock Release Failure
**Full Text**: If old lock release fails, log warning but continue.
**Behavior**:
- GIVEN: Old lock release throws (e.g. EPERM)
- WHEN: Phase 2 of swap
- THEN: Warning logged, new session continues

### REQ-SW-008: Cross-Cutting Verification
**Full Text**: The entire resume flow must be tested end-to-end.
**Behavior**:
- GIVEN: Full system with all components wired
- WHEN: Resume is triggered from command or browser
- THEN: The complete flow works: discovery → lock → replay → history conversion → swap → UI update

### REQ-PR-002: performResume Resolution
**Full Text**: `performResume()` resolves session references independently of `--continue` CLI flow.
**Behavior**:
- GIVEN: A session reference (ID, index, or "latest")
- WHEN: performResume is called
- THEN: It uses `SessionDiscovery.listSessions()` + `resolveSessionRef()` (not CONTINUE_LATEST or SessionSelector)

### REQ-PR-004: "Latest" Picks First Resumable
**Full Text**: For "latest", performResume picks the first resumable session from newest-first list.
**Behavior**:
- GIVEN: Sessions sorted newest-first, some locked or empty
- WHEN: performResume("latest") is called
- THEN: Returns the first session that is unlocked, not current, and not empty

### REQ-PR-005: No Resumable Sessions Error
**Full Text**: If no resumable session exists for "latest", return error.
**Behavior**:
- GIVEN: All sessions are locked, current, or empty
- WHEN: performResume("latest") is called
- THEN: Returns `{ ok: false, error: "No resumable sessions found" }`

## Implementation Tasks

### Pseudocode Reference

Integration wiring from `integration-wiring.md`:
- Lines 1-25: DialogManager rendering of SessionBrowserDialog with onSelect wired to performResume
- Lines 30-60: onSelect handler flow — confirmation check → performResume → state update → close dialog
- Lines 65-90: Recording swap sequence — dispose integration → dispose service → release lock → update state
- Lines 100-125: Stats command integration — call formatSessionSection from stats action

performResume from `perform-resume.md`:
- Lines 1-15: Function signature and parameter validation
- Lines 16-30: Session discovery and reference resolution
- Lines 31-50: Lock check, empty session check, "latest" filtering
- Lines 51-75: Call core resumeSession, handle errors
- Lines 76-90: Return success result with history, metadata, new recording, new lock

### Files to Modify

1. **`packages/cli/src/services/performResume.ts`** — Ensure the complete implementation handles:
   - "latest" filtering (skip locked, current, empty sessions)
   - Session resolution via `SessionDiscovery.resolveSessionRef()`
   - Error wrapping as `{ ok: false, error: string }`
   - ADD marker: `@plan PLAN-20260214-SESSIONBROWSER.P32`
   - ADD marker: `@pseudocode perform-resume.md lines 1-90`

2. **`packages/cli/src/ui/components/DialogManager.tsx`** — Ensure the `SessionBrowserDialog` rendering:
   - Passes correct props (chatsDir, projectHash, currentSessionId)
   - Wires `onSelect` to call `performResume()` and return result
   - Wires `onClose` to close dialog
   - ADD marker: `@plan PLAN-20260214-SESSIONBROWSER.P32`

3. **`packages/cli/src/ui/AppContainer.tsx`** — Ensure recording swap is handled:
   - On successful resume, update recording state (new service, new lock, new metadata)
   - Dispose old recording infrastructure in correct order
   - Update client and UI history
   - ADD marker: `@plan PLAN-20260214-SESSIONBROWSER.P32`

4. **`packages/cli/src/ui/commands/statsCommand.ts`** — Ensure session section is displayed:
   - Call `formatSessionSection()` and include output in stats display
   - Handle case where `recordingMetadata` is unavailable (null)
   - ADD marker: `@plan PLAN-20260214-SESSIONBROWSER.P32`

### DO NOT MODIFY

- `packages/cli/src/__tests__/sessionBrowserE2E.spec.ts` — Tests from P31

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P32
 * @requirement REQ-SW-001, REQ-SW-003, REQ-SW-004, REQ-SW-005, REQ-PR-002, REQ-PR-004, REQ-PR-005
 * @pseudocode perform-resume.md lines 1-90, integration-wiring.md lines 1-125
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# 1. Plan markers
grep -r "@plan PLAN-20260214-SESSIONBROWSER.P32" packages/cli/src/ | wc -l
# Expected: 4+ (performResume, DialogManager, AppContainer, statsCommand)

# 2. E2E tests pass
npm run test -- --run packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: ALL PASS (Green phase)

# 3. TypeScript compiles
npm run typecheck
# Expected: Pass

# 4. Full test suite
npm run test
# Expected: No regressions

# 5. Lint clean
npm run lint
# Expected: Pass
```

### Deferred Implementation Detection

```bash
# Check all modified files for deferred markers
for file in packages/cli/src/services/performResume.ts packages/cli/src/ui/components/DialogManager.tsx packages/cli/src/ui/AppContainer.tsx packages/cli/src/ui/commands/statsCommand.ts; do
  echo "=== $file ==="
  grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" "$file" | grep -v ".spec.ts"
done
# Expected: No matches (all implementation complete)

# Check for empty returns
grep -rn "return \[\]$\|return \{\}$\|return null$" packages/cli/src/services/performResume.ts
# Expected: 0 (all paths return real values)
```

### Semantic Verification Checklist

1. **Does performResume handle all cases?**
   - [ ] "latest" → filters to first resumable session
   - [ ] Numeric index → resolves via resolveSessionRef
   - [ ] Session ID/prefix → resolves via resolveSessionRef
   - [ ] Locked session → error return
   - [ ] Non-existent → error return
   - [ ] Current session → error return

2. **Is the recording swap correct?**
   - [ ] Phase 1: New session acquired (resumeSession called)
   - [ ] Phase 2: Old integration disposed BEFORE old service
   - [ ] Phase 2: Old lock released (or skipped if null)
   - [ ] Phase 2: Lock release failure → warning only
   - [ ] React state updated with new recording/lock/metadata

3. **Are all integration points connected?**
   - [ ] /continue command → performResume
   - [ ] SessionBrowserDialog → onSelect → performResume
   - [ ] performResume → core resumeSession
   - [ ] Stats command → formatSessionSection
   - [ ] DialogManager renders SessionBrowserDialog

4. **Is there NO isolated code?**
   - [ ] Every new function is called from at least one existing code path
   - [ ] Users can reach all features through /continue or /stats

#### Feature Actually Works

```bash
# Run all E2E tests
npm run test -- --run packages/cli/src/__tests__/sessionBrowserE2E.spec.ts 2>&1 | tail -20
# Expected: All pass

# Run full test suite
npm run test 2>&1 | tail -10
# Expected: No failures

# Build succeeds
npm run build
# Expected: Clean build

# Run tmux harness visual E2E test
node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.session-browser.json --assert
# Expected: Clean exit, artifacts in tmp dir show "Session Browser" visible
```

#### Integration Points Verified

- [ ] performResume uses SessionDiscovery.listSessions (NOT SessionSelector)
- [ ] performResume uses SessionDiscovery.resolveSessionRef (NOT RESUME_LATEST)
- [ ] DialogManager correctly renders and dismisses SessionBrowserDialog
- [ ] AppContainer handles recording swap state transitions
- [ ] statsCommand displays session section from formatSessionSection
- [ ] History conversion uses iContentToHistoryItems (existing utility)
- [ ] Client history restoration uses geminiClient.restoreHistory (existing utility)

## Success Criteria

- All 19+ E2E tests pass
- All component tests from earlier phases still pass
- TypeScript compiles
- Lint clean
- Build succeeds
- No deferred implementation markers

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/services/performResume.ts`
2. `git checkout -- packages/cli/src/ui/components/DialogManager.tsx`
3. `git checkout -- packages/cli/src/ui/AppContainer.tsx`
4. `git checkout -- packages/cli/src/ui/commands/statsCommand.ts`
5. Re-run Phase 32 with corrected implementation
6. MUST NOT modify test files from P31

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P32.md`
Contents:
```markdown
Phase: P32
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Tests Passing: [count]
Verification: [paste of verification command outputs]
```
