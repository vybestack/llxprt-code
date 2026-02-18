# Phase 08: MessageBus Implementation

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P08`

## Prerequisites

- Required: Phase 07a (MessageBus TDD verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P07" packages/core/src/hooks/__tests__/`
- Tests from P07 MUST be failing naturally

## CRITICAL IMPLEMENTATION RULES

- Follow pseudocode EXACTLY — reference specific line numbers in comments
- Do NOT modify any test files from P07 or P04
- UPDATE existing files — never create V2/New/Copy versions
- No console.log, no TODO, no FIXME

## Requirements Implemented

DELTA-HEVT-001, DELTA-HEVT-002, DELTA-HEVT-003, DELTA-HBUS-001, DELTA-HBUS-002, DELTA-HBUS-003, DELTA-HPAY-003, DELTA-HPAY-004

## Implementation Tasks

### File: `packages/core/src/hooks/hookEventHandler.ts`

**Pseudocode Reference**: `analysis/pseudocode/message-bus-integration.md` lines 50–162
**Also Reference**: `analysis/pseudocode/hook-event-handler.md` lines 250–427

#### Constructor: wire subscription (lines 50–56 of message-bus-integration.md)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P08
 * @requirement DELTA-HEVT-001
 * @pseudocode message-bus-integration.md lines 50-56
 */
// In constructor, after storing messageBus:
if (this.messageBus !== undefined) {
  this.isDisposed = false;
  // Line 54: CALL messageBus.subscribe('HOOK_EXECUTION_REQUEST', this.onBusRequest.bind(this))
  // Line 55: STORE returned subscription handle as this.busSubscription
  this.busSubscription = this.messageBus.subscribe(
    'HOOK_EXECUTION_REQUEST',
    this.onBusRequest.bind(this)
  );
}
```

#### dispose(): real unsubscription (lines 130–136 of message-bus-integration.md)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P08
 * @requirement DELTA-HEVT-004
 * @pseudocode message-bus-integration.md lines 130-136
 */
dispose(): void {
  // Line 131: SET this.isDisposed = true
  this.isDisposed = true;
  // Lines 132-134: IF busSubscription → unsubscribe + clear
  if (this.busSubscription !== undefined) {
    this.messageBus!.unsubscribe(this.busSubscription);
    this.busSubscription = undefined;
  }
}
```

#### extractCorrelationId() (hook-event-handler.md lines 260–264)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P08
 * @requirement DELTA-HBUS-003
 * @pseudocode hook-event-handler.md lines 260-264
 */
private extractCorrelationId(rawMessage: unknown): string {
  // Lines 261-263: IF rawMessage.correlationId is non-empty string → return it
  if (
    rawMessage !== null &&
    typeof rawMessage === 'object' &&
    'correlationId' in rawMessage &&
    typeof (rawMessage as any).correlationId === 'string' &&
    (rawMessage as any).correlationId.length > 0
  ) {
    return (rawMessage as any).correlationId;
  }
  // Line 264: RETURN crypto.randomUUID()
  return crypto.randomUUID();
}
```

#### onBusRequest() (message-bus-integration.md lines 60–81)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P08
 * @requirement DELTA-HEVT-001, DELTA-HEVT-002
 * @pseudocode message-bus-integration.md lines 60-81
 */
private async onBusRequest(rawMessage: unknown): Promise<void> {
  // Line 61: IF disposed → return silently
  if (this.isDisposed) return;
  // Line 67: extract correlationId
  const correlationId = this.extractCorrelationId(rawMessage);
  try {
    // Lines 70-73: validate structure
    if (
      rawMessage === null || typeof rawMessage !== 'object' ||
      !('eventName' in rawMessage) || !('input' in rawMessage)
    ) {
      this.publishResponse({ correlationId, success: false,
        error: { code: 'invalid_request', message: 'Missing eventName or input' } });
      return;
    }
    // Line 77: delegate to routeAndExecuteMediated
    const result = await this.routeAndExecuteMediated(
      (rawMessage as any).eventName,
      (rawMessage as any).input,
      correlationId
    );
    // Line 78: publish success response
    this.publishResponse({ correlationId, success: true, output: result });
  } catch (error) {
    // Lines 79-80: catch → publish failure
    this.publishResponse({ correlationId, success: false,
      error: { code: 'internal_error', message: error instanceof Error ? error.message : String(error) } });
  }
}
```

#### routeAndExecuteMediated() (message-bus-integration.md lines 90–114)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P08
 * @requirement DELTA-HEVT-003, DELTA-HPAY-003
 * @pseudocode message-bus-integration.md lines 90-114
 */
private async routeAndExecuteMediated(
  eventName: unknown,
  input: unknown,
  correlationId: string
): Promise<AggregatedHookResult> {
  // Lines 92-95: validate eventName is known HookEventName
  if (!Object.values(HookEventName).includes(eventName as HookEventName)) {
    throw { code: 'unsupported_event', message: 'Unknown event: ' + eventName };
  }
  // Lines 97-101: validate payload (Phase C adds real validation; Phase B throws on unknown only)
  // NOTE: Full payload validation wired in P11
  // Lines 103-110: translate model payloads if needed
  let resolvedInput = input as Record<string, unknown>;
  if ([HookEventName.BeforeModel, HookEventName.AfterModel, HookEventName.BeforeToolSelection]
      .includes(eventName as HookEventName)) {
    resolvedInput = this.translateModelPayload(eventName as HookEventName, resolvedInput);
  }
  // Lines 112-114: execute through core
  return this.executeHooksCore(eventName as HookEventName, resolvedInput);
}
```

#### translateModelPayload() (message-bus-integration.md lines 140–161)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P08
 * @requirement DELTA-HPAY-003
 * @pseudocode message-bus-integration.md lines 140-161
 */
private translateModelPayload(
  eventName: HookEventName,
  input: Record<string, unknown>
): Record<string, unknown> {
  // Lines 141-161: switch on eventName
  switch (eventName) {
    case HookEventName.BeforeModel: {
      // Lines 142-145
      const hookLlmRequest = this.hookTranslator.translateBeforeModelRequest(input['model_request']);
      return { ...input, llm_request: hookLlmRequest };
    }
    case HookEventName.AfterModel: {
      // Lines 147-152
      const hookLlmRequest = this.hookTranslator.translateAfterModelRequest(input['model_request']);
      const hookLlmResponse = this.hookTranslator.translateAfterModelResponse(input['model_response']);
      return { ...input, llm_request: hookLlmRequest, llm_response: hookLlmResponse };
    }
    case HookEventName.BeforeToolSelection: {
      // Lines 154-157
      const hookLlmRequest = this.hookTranslator.translateBeforeToolSelectionRequest(input['model_request']);
      return { ...input, llm_request: hookLlmRequest };
    }
    default:
      // Line 159: no translation needed
      return input;
  }
}
```

#### publishResponse() (message-bus-integration.md lines 120–123)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P08
 * @pseudocode message-bus-integration.md lines 120-123
 */
private publishResponse(response: HookExecutionResponse): void {
  // Line 121: CALL this.messageBus.publish('HOOK_EXECUTION_RESPONSE', response)
  this.messageBus?.publish('HOOK_EXECUTION_RESPONSE', response);
}
```

Update `fireBeforeModelEvent` to apply translation on direct path too:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P08
 * @requirement DELTA-HPAY-003
 * @pseudocode hook-event-handler.md lines 155-168
 */
async fireBeforeModelEvent(params: { modelRequest: Record<string, unknown> }): Promise<AggregatedHookResult> {
  try {
    const base = this.buildBaseInput();
    base.hook_event_name = HookEventName.BeforeModel;
    const rawInput = { ...base, model_request: params.modelRequest };
    // Line 160: translate on direct path too
    const translatedInput = this.translateModelPayload(HookEventName.BeforeModel, rawInput);
    return this.executeHooksCore(HookEventName.BeforeModel, translatedInput);
  } catch (error) {
    return this.buildFailureEnvelope(error, 'fireBeforeModelEvent', { eventName: HookEventName.BeforeModel });
  }
}
// fireAfterModelEvent and fireBeforeToolSelectionEvent follow same pattern
```

## Verification Commands

### Primary: All P07 Tests Must Pass

```bash
npm test -- --testPathPattern="hookEventHandler-messagebus"
# Expected: ALL tests pass

# Also P04 tests must still pass
npm test -- --testPathPattern="hookSystem-lifecycle"
# Expected: ALL tests pass
```

### No Test Modifications

```bash
git diff packages/core/src/hooks/__tests__/
# Expected: no diff
```

### Pseudocode Compliance

```bash
grep -c "@pseudocode\|lines [0-9]" packages/core/src/hooks/hookEventHandler.ts
# Expected: 12+ references

# Verify subscription wired
grep -n "subscribe\|busSubscription" packages/core/src/hooks/hookEventHandler.ts
# Expected: subscribe call and busSubscription storage

# Verify isDisposed check in onBusRequest
grep -A 3 "onBusRequest" packages/core/src/hooks/hookEventHandler.ts | grep "isDisposed"
# Expected: isDisposed check present

# Verify crypto.randomUUID in extractCorrelationId
grep "randomUUID\|crypto" packages/core/src/hooks/hookEventHandler.ts
# Expected: crypto.randomUUID() present
```

### TypeScript and Build

```bash
npm run typecheck && echo "PASS"
npm run build && echo "PASS"
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" \
  packages/core/src/hooks/hookEventHandler.ts | grep -v ".test.ts"
# Expected: 0 matches

grep -rn "return EMPTY_SUCCESS_RESULT[^(]" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 (must use makeEmptySuccessResult())
```

## Success Criteria

- All P07 tests pass
- All P04 tests still pass
- TypeScript compiles, build succeeds
- Subscription wired (with stored handle)
- dispose() does real unsubscription
- extractCorrelationId uses crypto.randomUUID() for fallback
- translateModelPayload applied on both direct and mediated paths
- No test modifications

## Failure Recovery

If P07 tests fail:
1. Read specific failure and find corresponding pseudocode lines
2. Fix the implementation gap
3. Re-run P07 tests

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P08.md`
