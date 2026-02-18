# Phase 05: Lifecycle/Composition Implementation

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P05`

## Prerequisites

- Required: Phase 04a (lifecycle TDD verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P04" packages/core/src/hooks/__tests__/`
- Tests from P04 MUST be failing naturally before this phase starts

## CRITICAL IMPLEMENTATION RULES

- Follow pseudocode EXACTLY — reference specific line numbers in comments
- Do NOT modify any test files from P04
- UPDATE existing files — never create V2/New/Copy versions
- No console.log, no TODO, no FIXME in production code
- All tests from P04 must pass when this phase is complete

## Requirements Implemented

### DELTA-HSYS-001, DELTA-HSYS-002, DELTA-HEVT-004, DELTA-HFAIL-005, DELTA-HPAY-006

See Phase 04 for full requirement text. This phase makes them pass.

## Implementation Tasks

### File: `packages/core/src/hooks/hookSystem.ts`

**Pseudocode Reference**: `analysis/pseudocode/message-bus-integration.md` lines 10–43

Implement the following (reference pseudocode line numbers in comments):

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P05
 * @requirement DELTA-HSYS-001
 * @pseudocode message-bus-integration.md lines 10-25
 */
constructor(config: Config, hooks: HookConfig[], messageBus?: MessageBus, debugLogger?: DebugLogger) {
  // Line 11: STORE config, hooks, messageBus, debugLogger
  // Line 12: INSTANTIATE hookRegistry = new HookRegistry(hooks)
  // Line 13: INSTANTIATE hookPlanner = new HookPlanner(hookRegistry)
  // Line 14: INSTANTIATE hookRunner = new HookRunner()
  // Line 15: INSTANTIATE hookAggregator = new HookAggregator()
  // Lines 16-24: INSTANTIATE hookEventHandler = new HookEventHandler(
  //   config, hookRegistry, hookPlanner, hookRunner, hookAggregator,
  //   messageBus,   // passed through; may be undefined
  //   debugLogger   // passed through; may be undefined
  // )
  // Line 25: STORE hookEventHandler as this.eventHandler
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P05
 * @requirement DELTA-HSYS-002
 * @pseudocode message-bus-integration.md lines 30-36
 */
setHookEnabled(hookId: string, enabled: boolean): void {
  // Line 31: CALL this.hookRegistry.setEnabled(hookId, enabled)
}

getAllHooks(): HookDefinition[] {
  // Line 36: RETURN this.hookRegistry.getAll()
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P05
 * @requirement DELTA-HEVT-004
 * @pseudocode message-bus-integration.md lines 40-43
 */
dispose(): void {
  // Lines 41-43: IF this.eventHandler EXISTS → CALL this.eventHandler.dispose()
}
```

### File: `packages/core/src/hooks/hookEventHandler.ts`

**Pseudocode Reference**: `analysis/pseudocode/hook-event-handler.md` lines 10–75

Implement:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P05
 * @requirement DELTA-HSYS-001, DELTA-HEVT-004
 * @pseudocode hook-event-handler.md lines 10-21
 */
constructor(
  config: Config,
  hookRegistry: HookRegistry,
  planner: HookPlanner,
  runner: HookRunner,
  aggregator: HookAggregator,
  messageBus?: MessageBus,   // Line 16: STORE (may be undefined)
  debugLogger?: DebugLogger  // Line 17: STORE (may be undefined)
) {
  // Lines 11-17: STORE all dependencies
  // Lines 18-21: IF messageBus IS NOT undefined → subscribe (Phase B handles this)
  //              Phase A: just store the reference; subscription added in P08
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P05
 * @requirement DELTA-HEVT-004
 * @pseudocode hook-event-handler.md lines 30-35
 * Idempotent: safe to call multiple times.
 * Post-dispose: all incoming messages are ignored (disposed flag checked at ingress in P08).
 * Resource tracking: subscriptionHandle unsubscribed here; undefined until P08 wires it.
 */
dispose(): void {
  if (this.disposed) return;   // idempotency guarantee — MUST be present
  this.disposed = true;
  // Lines 31-34: IF subscriptionHandle exists → unsubscribe (handles Phase B+ wiring)
  this.subscriptionHandle?.unsubscribe();
  // After dispose(), this.subscriptionHandle is still set but the unsubscribe prevents
  // further message delivery — no resource leak possible
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P05
 * @requirement DELTA-HFAIL-004
 * @pseudocode hook-event-handler.md lines 50-52
 */
private makeEmptySuccessResult(): AggregatedHookResult {
  // Line 51: RETURN spread copy of EMPTY_SUCCESS_RESULT constant
  return { ...EMPTY_SUCCESS_RESULT };
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P05
 * @requirement DELTA-HFAIL-001
 * @pseudocode hook-event-handler.md lines 60-75
 */
private buildFailureEnvelope(
  error: unknown,
  stage: string,
  meta?: FailureMeta
): AggregatedHookResult {
  // Line 61: EXTRACT message FROM error
  const message = error instanceof Error ? error.message
    : typeof error === 'string' ? error
    : JSON.stringify(error) ?? 'Unknown error';
  // Lines 62-68: BUILD normalizedError with stage, message, optional eventName/correlationId
  const normalizedError: Record<string, unknown> = { stage, message, details: error };
  if (meta?.eventName !== undefined) normalizedError['eventName'] = meta.eventName;
  if (meta?.correlationId !== undefined) normalizedError['correlationId'] = meta.correlationId;
  // Lines 69-75: RETURN failure envelope
  return { success: false, hookResults: [], allOutputs: [], errors: [normalizedError as any], totalDuration: 0 };
}
```

Update `fireSessionStartEvent` parameter type:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P05
 * @requirement DELTA-HPAY-006
 * @pseudocode hook-event-handler.md lines 140-151
 */
async fireSessionStartEvent(params: { source: SessionStartSource }): Promise<AggregatedHookResult> {
  // implementation follows same pattern as fireBeforeToolEvent
}

async fireSessionEndEvent(params: { reason: SessionEndReason }): Promise<AggregatedHookResult> {
  // implementation follows same pattern as fireBeforeToolEvent
}
```

Update any internal `eventName: string` parameters to use `HookEventName` enum:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P05
 * @requirement DELTA-HFAIL-005
 * @pseudocode hook-event-handler.md lines 80-95
 */
private async executeHooksCore(
  eventName: HookEventName,   // NOT string
  input: Record<string, unknown>
): Promise<AggregatedHookResult> {
  // Lines 81-95: try/catch execution core
}
```

Also update `buildBaseInput()`:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P05
 * @pseudocode hook-event-handler.md lines 40-46
 */
private buildBaseInput(): BaseHookInput {
  // Line 41: GET sessionId FROM config (appropriate method)
  // Line 42: GET cwd FROM config.getWorkingDir()   // NOT getTargetDir()
  // Line 43: GET timestamp = new Date().toISOString()
  // Line 44: SET transcript_path = ''
  // Line 45: RETURN { session_id, cwd, hook_event_name: '', timestamp, transcript_path }
}
```

## Verification Commands

### All P04 Tests Must Pass

```bash
# This is the PRIMARY verification — all P04 tests must now pass
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | tail -20
# Expected: ALL tests pass

# Count passing
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | grep -E "Tests:.*passed"
# Expected: 15+ passed
```

### No Test Modifications

```bash
# Confirm no test files were changed
git diff packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: no diff (test files MUST NOT be modified)
```

### Pseudocode Compliance

```bash
# Verify pseudocode references in implementation
grep -c "@pseudocode\|lines [0-9]" \
  packages/core/src/hooks/hookSystem.ts \
  packages/core/src/hooks/hookEventHandler.ts
# Expected: 8+ references to pseudocode line numbers

# buildBaseInput uses getWorkingDir (not getTargetDir)
grep "getWorkingDir\|getTargetDir" packages/core/src/hooks/hookEventHandler.ts
# Expected: getWorkingDir present, getTargetDir absent from buildBaseInput

# No EMPTY_SUCCESS_RESULT returned by direct reference in catch blocks
grep -n "return EMPTY_SUCCESS_RESULT" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 in catch blocks (make sure no-match paths use makeEmptySuccessResult)
```

### Failure Envelope Strictness (HARDENED — verified from P05 forward)

```bash
# ZERO bare EMPTY_SUCCESS_RESULT returns in catch or error branches (from P05 onward this must be 0)
grep -n "return EMPTY_SUCCESS_RESULT" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 — any match here is a BLOCKER

# All catch blocks call buildFailureEnvelope
CATCH_COUNT=$(grep -c "} catch" packages/core/src/hooks/hookEventHandler.ts)
ENVELOPE_COUNT=$(grep -c "buildFailureEnvelope" packages/core/src/hooks/hookEventHandler.ts)
echo "Catch blocks: $CATCH_COUNT | buildFailureEnvelope calls: $ENVELOPE_COUNT"
# Expected: ENVELOPE_COUNT >= CATCH_COUNT (every catch block must use envelope)

# No placeholder empty returns in impl files
grep -E "return \[\]|return \{\}|return null" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 in error/failure paths

# dispose() idempotency guard present
grep -A 3 "dispose()" packages/core/src/hooks/hookEventHandler.ts | grep "if.*disposed\|this\.disposed"
# Expected: idempotency guard line present

# subscriptionHandle declared
grep "subscriptionHandle" packages/core/src/hooks/hookEventHandler.ts
# Expected: field declaration and usage present
```

### dispose() Strictness Verification

```bash
# Idempotency: multiple dispose() calls must not throw
# (verified by P04 test "HookSystem.dispose() is idempotent")
grep -A 8 "dispose()" packages/core/src/hooks/hookEventHandler.ts | head -12
# Manual check: first line must be "if (this.disposed) return;"

# Post-dispose: message processing checks disposed flag (structural, fully wired in P08)
grep "this\.disposed" packages/core/src/hooks/hookEventHandler.ts
# Expected: at minimum 2 occurrences (set in dispose, checked at message ingress in P08)

# Resource guarantee: subscriptionHandle.unsubscribe() called in dispose()
grep -A 6 "dispose()" packages/core/src/hooks/hookEventHandler.ts | grep "unsubscribe\|subscriptionHandle"
# Expected: subscriptionHandle?.unsubscribe() present
```

### TypeScript and Build

```bash
npm run typecheck
# Expected: 0 errors

npm run build
# Expected: build succeeds
```

### Structural Integrity

```bash
# No V2/New/Copy files
find packages/core/src/hooks -name "*V2*" -o -name "*New*" -o -name "*Copy*"
# Expected: 0

# No debug code
grep -rn "console\.\|debugger" packages/core/src/hooks/hookSystem.ts packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 matches

# No TODO/FIXME in implementation
grep -rn "TODO\|FIXME\|HACK\|STUB" \
  packages/core/src/hooks/hookSystem.ts \
  packages/core/src/hooks/hookEventHandler.ts | grep -v ".test.ts"
# Expected: 0 matches
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" \
  packages/core/src/hooks/hookSystem.ts \
  packages/core/src/hooks/hookEventHandler.ts | grep -v ".test.ts"
# Expected: 0 matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be)" \
  packages/core/src/hooks/hookSystem.ts \
  packages/core/src/hooks/hookEventHandler.ts | grep -v ".test.ts"
# Expected: 0 matches
```

### Existing Tests Still Pass

```bash
npm test -- --testPathPattern="hooks-caller" 2>&1 | tail -10
# Expected: all pre-existing tests pass
```

## Success Criteria

- All P04 tests pass
- TypeScript compiles without errors
- Build succeeds
- No test modifications
- Pseudocode line references in implementation comments
- getWorkingDir() used (not getTargetDir())
- makeEmptySuccessResult() used for no-match paths (not EMPTY_SUCCESS_RESULT by reference)
- buildFailureEnvelope() exists and is used in catch blocks
- Existing tests remain passing

## Failure Recovery

If tests still fail after implementation:
1. Read the specific test failure message
2. Identify which pseudocode lines correspond to the failing behavior
3. Compare implementation to those pseudocode lines
4. Fix the discrepancy
5. Re-run tests

If TypeScript fails:
1. Read the error message
2. Fix the type error (likely enum type or optional parameter issue)
3. Re-run typecheck

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P05.md`

```markdown
Phase: P05
Completed: YYYY-MM-DD HH:MM
Files Modified: hookSystem.ts, hookEventHandler.ts
P04 Tests: ALL PASS
TypeScript: PASS
Build: PASS
Test Modifications: NONE
Pseudocode Lines Referenced: [count]
```
