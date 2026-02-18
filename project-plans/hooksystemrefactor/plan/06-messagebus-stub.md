# Phase 06: MessageBus Stub

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P06`

## Prerequisites

- Required: Phase 05a (lifecycle impl verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P05" packages/core/src/hooks/`
- All P04 tests must be passing

## Requirements Implemented (Expanded)

### DELTA-HBUS-001: HookExecutionRequest/HookExecutionResponse interfaces

**Full Text**: SHALL declare and use HookExecutionRequest / HookExecutionResponse interfaces exclusively for bus communication
**Behavior**:
- GIVEN: A new file hookBusContracts.ts is created
- WHEN: TypeScript compiles
- THEN: HookExecutionRequest and HookExecutionResponse interfaces are exported
**Why This Matters**: Establishes typed contract for MessageBus communication

### DELTA-HEVT-001: HookEventHandler subscribes to MessageBus

**Full Text**: HookEventHandler SHALL subscribe to MessageBus HOOK_EXECUTION_REQUEST and route to fire-event handlers
**Behavior**:
- GIVEN: HookEventHandler is constructed with a MessageBus
- WHEN: Constructor runs
- THEN: Handler subscribes to 'HOOK_EXECUTION_REQUEST' channel
**Why This Matters**: Enables decoupled invocation via the bus

### DELTA-HEVT-002: Publish HOOK_EXECUTION_RESPONSE

**Full Text**: When HOOK_EXECUTION_REQUEST received, SHALL publish HOOK_EXECUTION_RESPONSE with same correlationId
**Behavior**:
- GIVEN: A HOOK_EXECUTION_REQUEST arrives on the bus
- WHEN: HookEventHandler processes it
- THEN: Exactly one HOOK_EXECUTION_RESPONSE is published with same correlationId
**Why This Matters**: Enables callers to correlate async responses

### DELTA-HEVT-003: Unsupported event name

**Full Text**: When mediated request references unsupported event name, SHALL publish failed response (no throw)
**Behavior**:
- GIVEN: A HOOK_EXECUTION_REQUEST with eventName='UnknownEvent'
- WHEN: Handler processes it
- THEN: Failed response published with code 'unsupported_event'; no exception thrown

### DELTA-HBUS-002: Bus-absent fallback

**Full Text**: If MessageBus unavailable, hook execution SHALL continue via direct fire-event methods
**Behavior**:
- GIVEN: HookEventHandler constructed WITHOUT messageBus
- WHEN: fire*Event() methods are called directly
- THEN: Execution proceeds normally as if no bus exists

### DELTA-HBUS-003: correlationId generation

**Full Text**: If HOOK_EXECUTION_REQUEST lacks correlationId, handler SHALL generate one via crypto.randomUUID()
**Behavior**:
- GIVEN: Request arrives without correlationId field
- WHEN: Handler processes it
- THEN: A UUID is generated and echoed in the response

### DELTA-HPAY-003: Model payload translation (both paths)

**Full Text**: HookEventHandler SHALL translate model payloads for BeforeModel/AfterModel/BeforeToolSelection for BOTH mediated and direct paths
**Behavior**:
- GIVEN: fireBeforeModelEvent({ modelRequest: {...} }) is called directly
- WHEN: Execution proceeds
- THEN: hookTranslator.translateBeforeModel* is called before executeHooksCore

## Implementation Tasks

### Files to Create

#### `packages/core/src/hooks/hookBusContracts.ts` (NEW)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P06
 * @requirement DELTA-HBUS-001
 */

// Stub interface declarations — will be full types used in Phase B implementation
export interface HookExecutionRequest {
  eventName: HookEventName;
  input: Record<string, unknown>;
  correlationId: string;
}

export interface HookExecutionResponse {
  correlationId: string;
  success: boolean;
  output?: AggregatedHookResult;
  error?: {
    code?: string;
    message: string;
    details?: unknown;
  };
}
```

### Files to Modify

#### `packages/core/src/hooks/hookEventHandler.ts`

Add stub methods for MessageBus integration. Methods may throw `new Error('NotYetImplemented')`
OR return stubs — tests written in P07 will fail naturally.

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P06
 * @requirement DELTA-HEVT-001
 */
private async onBusRequest(rawMessage: unknown): Promise<void> {
  // Stub — implemented in P08
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P06
 * @requirement DELTA-HEVT-002
 */
private publishResponse(response: HookExecutionResponse): void {
  // Stub — implemented in P08
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P06
 * @requirement DELTA-HBUS-003
 */
private extractCorrelationId(rawMessage: unknown): string {
  // Stub — return empty string for now
  return '';
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P06
 * @requirement DELTA-HPAY-003
 */
private translateModelPayload(
  eventName: HookEventName,
  input: Record<string, unknown>
): Record<string, unknown> {
  // Stub — return input unchanged for now
  return input;
}
```

Update constructor to call subscription:

```typescript
// In constructor body:
if (this.messageBus !== undefined) {
  // Stub: subscription wired in P08
  // this.busSubscription = this.messageBus.subscribe(
  //   'HOOK_EXECUTION_REQUEST',
  //   this.onBusRequest.bind(this)
  // );
}
```

Update `dispose()` stub:

```typescript
dispose(): void {
  this.isDisposed = true;
  // Stub: unsubscription wired in P08
}
```

Add `isDisposed` flag to class:

```typescript
private isDisposed = false;
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P06
 * @requirement DELTA-HBUS-001
 */
```

## Verification Commands

### Structural

```bash
# hookBusContracts.ts exists
ls packages/core/src/hooks/hookBusContracts.ts || exit 1
echo "PASS: hookBusContracts.ts created"

# Interfaces exported
grep -E "export interface HookExecutionRequest|export interface HookExecutionResponse" \
  packages/core/src/hooks/hookBusContracts.ts
# Expected: 2 matches

# Plan markers in new files
grep -rn "PLAN-20250218-HOOKSYSTEM.P06" packages/core/src/hooks/ | wc -l
# Expected: 6+

# TypeScript compiles
npm run typecheck
# Expected: 0 errors

# Stub methods exist on HookEventHandler
grep -n "onBusRequest\|publishResponse\|extractCorrelationId\|translateModelPayload\|isDisposed" \
  packages/core/src/hooks/hookEventHandler.ts
# Expected: all 5 present

# No V2/New/Copy files
find packages/core/src/hooks -name "*V2*" -o -name "*New*" -o -name "*Copy*"
# Expected: 0

# No TODO in stubs (NotYetImplemented acceptable)
grep -rn "TODO\|FIXME" packages/core/src/hooks/hookBusContracts.ts packages/core/src/hooks/hookEventHandler.ts
# Expected: 0
```

### Existing Tests Still Pass

```bash
npm test -- --testPathPattern="hookSystem-lifecycle"
# Expected: ALL P04 tests still pass

npm test -- --testPathPattern="hooks-caller"
# Expected: ALL pre-existing tests pass
```

## Success Criteria

- `hookBusContracts.ts` created with HookExecutionRequest/HookExecutionResponse interfaces
- Stub methods added to HookEventHandler (onBusRequest, publishResponse, extractCorrelationId, translateModelPayload)
- isDisposed flag added
- TypeScript compiles
- P04 tests still pass
- Plan markers on all new code

## Failure Recovery

If TypeScript fails:
1. Check import paths for HookEventName and AggregatedHookResult in new file
2. Fix import statements
3. Re-run typecheck

If the stub is incorrect or needs to be reset:
1. `git checkout -- packages/core/src/hooks/hookBusContracts.ts` (if created)
2. `git checkout -- packages/core/src/hooks/hookEventHandler.ts`
3. Re-read pseudocode lines 50–57 (subscription setup) and retry

If pre-existing tests regress:
1. `git checkout -- packages/core/src/hooks/hookEventHandler.ts`
2. Verify the stub does not modify existing method signatures
3. Re-run pre-existing tests to confirm baseline

Cannot proceed to P07 until TypeScript compiles and existing tests pass.

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P06.md`
