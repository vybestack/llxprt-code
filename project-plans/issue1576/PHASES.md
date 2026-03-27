# Implementation Phases - Issue #1576

## Phase 0: Test Foundation (Do This First!)

**Before any hook extraction, implement/modify tests.**

### Tasks
1. Create test files in `packages/cli/src/ui/__tests__/`:
   - AppContainer.mount.test.tsx
   - AppContainer.strictmode.test.tsx
   - AppContainer.unmount-cleanup.test.tsx
   - AppContainer.keybinding-cardinality.test.tsx
   - AppContainer.builder-contract.test.tsx

2. Ensure existing tests still pass:
   - AppContainer.cancel-race.test.tsx
   - AppContainer.oauth-dismiss.test.ts

3. Run verification:
   ```bash
   npm test -- AppContainer
   ```

### Success Criteria
- [ ] All tests pass (new and existing)
- [ ] No console errors/warnings
- [ ] Coverage baseline established

### Subagent Assignment
**typescriptexpert** - Implement Phase 0 tests

---

## Phase 1: Low Risk Hooks (Isolated)

Extract hooks with no external dependencies first.

### Hooks to Extract

#### 1. useFlickerDetector.ts
**Lines:** 1898-1920
**Risk:** Very Low (telemetry only)
**Dependencies:** None

**Implementation:**
```typescript
export function useFlickerDetector(
  rootUiRef: React.RefObject<DOMElement | null>,
  terminalHeight: number,
  constrainHeight: boolean,
): void {
  // Implementation from lines 1898-1920
}
```

#### 2. useRecordingInfrastructure.ts
**Lines:** 287-349
**Risk:** Low (refs only)
**Dependencies:** None

**Implementation:**
```typescript
export function useRecordingInfrastructure(
  initialRecordingService?: SessionRecordingService,
  recordingIntegration?: RecordingIntegration,
  initialLockHandle?: LockHandle | null,
) {
  // Implementation from lines 287-349
}
```

#### 3. useLayoutMeasurement.ts
**Lines:** 1770-1896
**Risk:** Low (measurement only)
**Dependencies:** None

### Verification
- [ ] Extracted hooks compile
- [ ] Tests from Phase 0 still pass
- [ ] AppContainer.tsx reduced by ~220 lines

### Subagent Assignment
**typescriptexpert** - Extract Phase 1 hooks

---

## Phase 2: Self-Contained State Hooks

Extract hooks with local state only.

### Hooks to Extract

#### 4. useDialogOrchestration.ts
**Lines:** 672-805
**Risk:** Medium (many states)
**Dependencies:** None

**Note:** This is the largest state extraction. Verify all callbacks are stable.

#### 5. useDisplayPreferences.ts
**Lines:** 851-917
**Risk:** Medium (event subscription)
**Dependencies:** None

**Note:** Includes CoreEvent.SettingsChanged subscription.

#### 6. useModelTracking.ts
**Lines:** 807-850
**Risk:** Low (polling only)
**Dependencies:** None

### Verification
- [ ] Dialog states work correctly
- [ ] Settings changes update display
- [ ] Model tracking updates footer
- [ ] AppContainer.tsx reduced by ~230 lines

### Subagent Assignment
**typescriptexpert** - Extract Phase 2 hooks

---

## Phase 3: Side Effect Hooks

Extract hooks with external side effects.

### Hooks to Extract

#### 7. useOAuthOrchestration.ts
**Lines:** 350-398
**Risk:** Medium (polling, global flags)
**Dependencies:** appDispatch

**Note:** Marked as technical debt. Polling is interim solution.

#### 8. useExtensionAutoUpdate.ts
**Lines:** 451-500
**Risk:** Medium (interval)
**Dependencies:** settings, onConsoleMessage

#### 9. useCoreEventHandlers.ts
**Lines:** 400-450
**Risk:** Medium (multiple subscriptions)
**Dependencies:** Many callbacks

**Note:** Use stable subscription pattern with refs.

### Verification
- [ ] OAuth dialog opens on flag
- [ ] Extension updates checked
- [ ] Core events bridged to UI
- [ ] All subscriptions cleaned on unmount

### Subagent Assignment
**typescriptexpert** - Extract Phase 3 hooks

---

## Phase 4: Orchestration Hooks

Extract complex orchestration hooks.

### Hooks to Extract

#### 10. useTokenMetricsTracking.ts
**Lines:** 501-573
**Risk:** High (polling + events)
**Dependencies:** runtime, config

**Note:** Mixed strategy - stable subscription + interval.

#### 11. useStaticRefreshManager.ts
**Lines:** 575-670, 1921-1970
**Risk:** High (debouncing)
**Dependencies:** streamingState

**Note:** Consolidates two related ranges.

#### 12. useTodoContinuationFlow.ts
**Lines:** 1971-2024
**Risk:** Medium (streaming watcher)
**Dependencies:** geminiClient, config

### Verification
- [ ] Token metrics update
- [ ] Static refresh debounced
- [ ] Todo continuation detected
- [ ] Service swap handled correctly

### Subagent Assignment
**typescriptexpert** - Extract Phase 4 hooks

---

## Phase 5: Complex State Hooks

Extract hooks with complex state machines.

### Hooks to Extract

#### 13. useExitHandling.ts
**Lines:** 1599-1670
**Risk:** High (timers, process exit)
**Dependencies:** handleSlashCommand, config

**Note:** Use semantic API (requestCtrlCExit, not raw timer refs).

#### 14. useInputHandling.ts
**Lines:** 1503-1596
**Risk:** Medium (callbacks)
**Dependencies:** buffer, inputHistoryStore

#### 15. useKeybindings.ts
**Lines:** 1671-1768
**Risk:** High (priority, short-circuit)
**Dependencies:** Many callbacks

**Note:** Implement priority order with short-circuit.

### Verification
- [ ] Double-press exit works
- [ ] Keybindings respect priority
- [ ] Input handling correct
- [ ] Ctrl+C/D behavior preserved

### Subagent Assignment
**typescriptexpert** - Extract Phase 5 hooks

---

## Phase 6: Session Initialization

Extract the most complex hook last.

### Hooks to Extract

#### 16. useSessionInitialization.ts
**Lines:** 203-286 (session portion)
**Risk:** Highest (state machine, async)
**Dependencies:** config, addItem, loadHistory

**Note:** Implement formal state machine with AbortController.

### Verification
- [ ] State machine transitions correctly
- [ ] Session start hook called once
- [ ] History seeded if resumed
- [ ] Abort works correctly
- [ ] StrictMode idempotent

### Subagent Assignment
**typescriptexpert** - Extract useSessionInitialization

---

## Phase 7: Builders

Extract builder functions last.

### Files to Create

#### builders/buildUIState.ts
**Lines:** 2096-2285

#### builders/buildUIActions.ts
**Lines:** 2287-2499

#### builders/useUIStateBuilder.ts
Wrapper hook with useMemo

#### builders/useUIActionsBuilder.ts
Wrapper hook with useMemo

### Verification
- [ ] Builders compile
- [ ] All primitives passed correctly
- [ ] useMemo deps correct
- [ ] UIState/UIActions contracts preserved

### Subagent Assignment
**typescriptexpert** - Extract builders

---

## Final Verification

After all phases complete:

### Run Full Test Suite
```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
```

### Smoke Test
```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

### Acceptance Criteria Check
- [ ] No file > 800 lines
- [ ] No function > 80 lines
- [ ] All 20 integration tests pass
- [ ] No circular dependencies (madge)
- [ ] Smoke test passes
- [ ] Existing tests pass

### Subagent Assignment
**deepthinker** - Final review
**Me (acoliver)** - Merge coordination

---

## Rollback Plan

If issues discovered:
1. Identify problematic phase
2. Revert commits for that phase
3. Fix and re-implement
4. Re-run verification

## Time Estimates (Optional Guidance)

- Phase 0: 1-2 sessions (tests)
- Phase 1: 1 session (3 hooks)
- Phase 2: 1-2 sessions (3 hooks)
- Phase 3: 1-2 sessions (3 hooks)
- Phase 4: 2 sessions (3 hooks)
- Phase 5: 2 sessions (3 hooks)
- Phase 6: 1-2 sessions (1 complex hook)
- Phase 7: 1 session (builders)
- Final verification: 1 session

Total: ~10-15 sessions

## Subagent Coordination Notes

### typescriptexpert
- Primary implementer for all phases
- Run full verification after each phase
- Report issues immediately
- Commit after each phase

### deepthinker
- Review after Phases 0, 3, 6, 7
- Verify architectural soundness
- Check acceptance criteria

### acoliver (me)
- Coordinate phases
- Run final verification
- Merge when complete
