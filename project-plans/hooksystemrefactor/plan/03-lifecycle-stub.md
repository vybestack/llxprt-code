# Phase 03: Lifecycle/Composition Stub

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P03`

## Prerequisites

- Required: Phase 02a (pseudocode verification) completed
- Verification: `grep -r "@plan:PLAN-20250218-HOOKSYSTEM.P02" . || ls project-plans/hooksystemrefactor/.completed/P02a.md`
- Preflight verification (P00a) MUST be completed

## Requirements Implemented (Expanded)

### DELTA-HSYS-001: HookSystem MessageBus/DebugLogger injection

**Full Text**: HookSystem SHALL inject MessageBus and DebugLogger into HookEventHandler during composition
**Behavior**:
- GIVEN: HookSystem receives optional messageBus and debugLogger constructor arguments
- WHEN: HookSystem instantiates HookEventHandler
- THEN: Both dependencies are forwarded to HookEventHandler
**Why This Matters**: Required foundation for all subsequent phases

### DELTA-HSYS-002: Management APIs

**Full Text**: HookSystem SHALL expose setHookEnabled / getAllHooks management methods
**Behavior**:
- GIVEN: HookSystem is initialized
- WHEN: setHookEnabled(id, flag) is called
- THEN: Delegates to hookRegistry.setEnabled(id, flag)
- WHEN: getAllHooks() is called
- THEN: Returns hookRegistry.getAll()

### DELTA-HEVT-004: dispose() — HARDENED STRICTNESS

**Full Text**: HookEventHandler SHALL expose dispose(); HookSystem teardown SHALL call dispose()
**Behavior**:
- GIVEN: HookSystem.dispose() is called
- WHEN: eventHandler.dispose() is invoked
- THEN: HookEventHandler cleans up any subscriptions (no-op in Phase A; bus subscribed in Phase B)

**HARDENING — dispose() contract requirements**:

1. **Idempotent**: Calling `dispose()` multiple times MUST be safe — second and subsequent calls
   are no-ops. The implementation MUST guard against double-dispose.
   ```typescript
   private disposed = false;
   dispose(): void {
     if (this.disposed) return;  // idempotency guard
     this.disposed = true;
     // ... cleanup ...
   }
   ```

2. **Post-dispose behavior defined**: After `dispose()` is called, any attempt to process a new
   message MUST be silently ignored (no-op, no error thrown). The handler enters a terminal state.
   In Phase B (P08), the subscription MUST be unsubscribed before `disposed = true` is set so no
   new messages can arrive after dispose.

3. **Resource leak guarantees**: The stub MUST declare the `disposed` flag and `subscriptionHandle`
   field even if they are not yet wired (they will be wired in P05/P08). This ensures:
   - TypeScript catches any usage of these fields before they are initialized
   - Reviewers can verify at the stub stage that resource tracking is planned
   - No subscription handle is ever orphaned (missing `unsubscribe` call)

### DELTA-HFAIL-005: HookEventName enum in internal routing

**Full Text**: All internal routing/helper/private methods accepting event name SHALL use HookEventName enum
**Behavior**:
- GIVEN: Internal methods accept eventName parameter
- WHEN: TypeScript compiles
- THEN: Parameter typed as HookEventName (not string)

### DELTA-HPAY-006: Typed session event parameters

**Full Text**: fireSessionStartEvent SHALL accept { source: SessionStartSource }; fireSessionEndEvent SHALL accept { reason: SessionEndReason }
**Behavior**:
- GIVEN: fireSessionStartEvent called with { source: SessionStartSource.UserExplicit }
- WHEN: TypeScript compiles
- THEN: Compiles without error; string argument rejected by type system

## Implementation Tasks

### Files to Modify

#### `packages/core/src/hooks/hookSystem.ts`
Add stubs for new APIs. The constructor signature gains optional messageBus and debugLogger;
management APIs return empty/no-op; dispose() calls eventHandler.dispose() if it exists.

- ADD `@plan:PLAN-20250218-HOOKSYSTEM.P03` marker to modified class/methods
- ADD `@requirement:DELTA-HSYS-001` to constructor
- ADD `@requirement:DELTA-HSYS-002` to setHookEnabled and getAllHooks
- Stub `setHookEnabled(hookId: string, enabled: boolean): void` — call through to hookRegistry or no-op
- Stub `getAllHooks(): HookDefinition[]` — return [] or hookRegistry.getAll()
- Stub `dispose(): void` — call this.eventHandler?.dispose() if available

#### `packages/core/src/hooks/hookEventHandler.ts`
Add stubs for new constructor parameters, dispose, and enum typing. Methods may
throw `new Error('NotYetImplemented')` OR return empty values of correct type.
Tests will fail naturally when stubs return empty/throw.

- ADD `@plan:PLAN-20250218-HOOKSYSTEM.P03` marker
- ADD `@requirement:DELTA-HEVT-004` to dispose()
- ADD `@requirement:DELTA-HFAIL-005` to internal routing
- ADD `@requirement:DELTA-HPAY-006` to fireSessionStartEvent / fireSessionEndEvent
- Stub `dispose(): void` — MUST include idempotency guard and resource tracking declarations:
  ```typescript
  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HEVT-004
   * Idempotent: safe to call multiple times. Post-dispose: all incoming messages ignored.
   * Resource tracking: subscriptionHandle declared here; wired in P08.
   */
  private disposed = false;
  private subscriptionHandle: { unsubscribe(): void } | undefined = undefined;

  dispose(): void {
    if (this.disposed) return;  // idempotency guard — MUST be present from stub stage
    this.disposed = true;
    // subscriptionHandle.unsubscribe() wired in P08 after bus subscription exists
    this.subscriptionHandle?.unsubscribe();
  }
  ```
- Update constructor signature to accept optional `messageBus?: MessageBus` and `debugLogger?: DebugLogger` parameters
- Update `fireSessionStartEvent` to accept `{ source: SessionStartSource }` parameter type
- Update `fireSessionEndEvent` to accept `{ reason: SessionEndReason }` parameter type
- Update internal method signatures using `string` eventName to use `HookEventName` where feasible without breaking direct paths
- Add stub `makeEmptySuccessResult(): AggregatedHookResult` — return `{ ...EMPTY_SUCCESS_RESULT }`
- Add stub `buildFailureEnvelope(error: unknown, stage: string, meta?: FailureMeta): AggregatedHookResult` — return `{ success: false, hookResults: [], allOutputs: [], errors: [], totalDuration: 0 }`
  - `// Stub intentionally returns errors:[] — P04 tests WILL fail; P05 implements properly`

### Required Code Markers

Every function/class created or modified in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P03
 * @requirement DELTA-HSYS-001
 */
```

## Verification Commands

### Structural

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250218-HOOKSYSTEM.P03\|@plan PLAN-20250218-HOOKSYSTEM.P03" \
  packages/core/src/hooks/ | wc -l
# Expected: 4+ occurrences

# Check requirement markers
grep -r "@requirement:DELTA-HSYS\|@requirement:DELTA-HEVT-004\|@requirement:DELTA-HFAIL-005\|@requirement:DELTA-HPAY-006" \
  packages/core/src/hooks/ | wc -l
# Expected: 4+ occurrences

# TypeScript compiles
npm run typecheck
# Expected: 0 errors

# No TODO comments in stub code
grep -rn "TODO" packages/core/src/hooks/hookSystem.ts packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 matches

# No V2/New/Copy files created
find packages/core/src/hooks -name "*V2*" -o -name "*New*" -o -name "*Copy*"
# Expected: 0 results

# dispose() method exists on HookEventHandler
grep -n "dispose" packages/core/src/hooks/hookEventHandler.ts
# Expected: method definition present

# dispose() method exists on HookSystem
grep -n "dispose" packages/core/src/hooks/hookSystem.ts
# Expected: method definition present

# setHookEnabled and getAllHooks exist on HookSystem
grep -n "setHookEnabled\|getAllHooks" packages/core/src/hooks/hookSystem.ts
# Expected: method definitions present

# Session event parameters use enums
grep -A 2 "fireSessionStartEvent\|fireSessionEndEvent" packages/core/src/hooks/hookEventHandler.ts
# Expected: SessionStartSource and SessionEndReason appear in signatures
```

### dispose() Strictness Checks

```bash
# Idempotency guard present in HookEventHandler.dispose()
grep -A 5 "dispose()" packages/core/src/hooks/hookEventHandler.ts | \
  grep "disposed\|this\.disposed"
# Expected: idempotency guard (if this.disposed) present

# disposed flag declared as private field
grep "private disposed" packages/core/src/hooks/hookEventHandler.ts
# Expected: private disposed = false;

# subscriptionHandle declared for resource tracking
grep "subscriptionHandle" packages/core/src/hooks/hookEventHandler.ts
# Expected: declaration present (even if unsubscribe not yet wired)

# Post-dispose behavior: messages ignored after dispose (structural declaration)
grep -A 3 "this\.disposed" packages/core/src/hooks/hookEventHandler.ts | head -20
# Expected: disposed flag checked before processing any incoming message (wired fully in P08)
```

### Anti-Fraud Checks

```bash
# No reverse testing (tests expecting NotYetImplemented)
grep -r "NotYetImplemented" packages/core/src/hooks/*.test.ts 2>/dev/null
# Expected: 0 matches

# Existing tests still pass (backward compatibility)
npm test -- --testPathPattern="hooks-caller" 2>&1 | tail -10
# Expected: pass (or same failures as before this phase)
```

### Deferred Implementation Detection

```bash
# In stub phase: NotYetImplemented is acceptable; TODO/FIXME are not
grep -rn "TODO\|FIXME\|HACK\|STUB" \
  packages/core/src/hooks/hookSystem.ts \
  packages/core/src/hooks/hookEventHandler.ts | grep -v ".test.ts"
# Expected: 0 matches
```

## Success Criteria

- TypeScript compiles without errors
- dispose(), setHookEnabled(), getAllHooks() stubs present on HookSystem
- dispose() stub present on HookEventHandler
- Constructor accepts optional messageBus and debugLogger params
- fireSessionStartEvent/fireSessionEndEvent use enum parameter types
- Existing tests remain passing (no regression)
- Plan markers on all changes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/hooks/hookSystem.ts`
2. `git checkout -- packages/core/src/hooks/hookEventHandler.ts`
3. Re-read pseudocode lines 10–35 (constructor + dispose) and retry

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P03.md`

```markdown
Phase: P03
Completed: YYYY-MM-DD HH:MM
Files Modified: hookSystem.ts, hookEventHandler.ts
Methods Stubbed: dispose (×2), setHookEnabled, getAllHooks, makeEmptySuccessResult, buildFailureEnvelope
TypeScript: PASS
Existing Tests: PASS
```
