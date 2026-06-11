# Phase P06: Confirmation Bus — RED Tests

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: TDD Tests
Prerequisites: P05a (policy source verified — P03b confirmation-bus skeletons already in place)

## Purpose

Write behavioral RED tests for the confirmation bus extraction. Skeleton stubs from P03b are in place — imports resolve but produce wrong behavioral results (placeholder enum values, no-op MessageBus methods, empty type shapes). Tests must fail on **behavioral assertions** (wrong confirmation outcomes, messages not delivered, enum values missing), NOT import-resolution failures.

## Worker / Verifier Assignment

- **Worker**: typescriptexpert (writes RED tests)
- **Verifier**: typescriptreviewer (verifies RED state in P06a)

## Expanded Requirements

- Tests import from `packages/policy/src/confirmation-bus/` paths — these resolve because P03b skeleton stubs exist
- Tests must fail on **behavioral assertions** because skeleton stubs return wrong values (placeholder ConfirmationOutcome values, no-op MessageBus, empty type shapes)
- Tests must NOT import from `@vybestack/llxprt-code-core` or `@google/genai`
- Tests must use `PolicyFunctionCall` (not `FunctionCall` from `@google/genai`)
- Tests must use `ConfirmationOutcome` (not `ToolConfirmationOutcome` from tools)
- Tests must use `PolicyToolCallState` (not `ToolCall` from scheduler)
- No mock theater — tests verify observable behavior (published messages, subscriber delivery, return values)
- **Observable behavior focus**: Instead of checking "calls PolicyEngine.evaluate()" or "custom logger receives debug/error calls", tests verify the observable **outcomes** of those calls:
  - A DENY decision results in a rejection message being published to subscribers (observable via subscriber callback receiving the message)
  - A custom logger injection results in logged messages being capturable (observable via collecting log output)
  - Timeout results in `false` return value (observable return value)
  - Subscriber delivery is verified by checking that subscribers received the correct message object

## @plan / @requirement Marker Requirements

Every test file and test case created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P06
 * @requirement REQ-003
 */
```

Each test case must include markers:

```typescript
it('requestConfirmation calls PolicyEngine.evaluate() @plan:PLAN-20260609-ISSUE1591.P06 @requirement:REQ-003.7', () => { ... });
```

## Source Review Requirement

Before writing RED tests, the worker must review the source to ensure tests accurately cover all fields and behaviors that need to be replicated in policy-owned types. Review these files:

- Read `packages/core/src/tools/tool-confirmation-types.ts` for `ToolConfirmationOutcome` / `ToolConfirmationPayload`
- Read `packages/core/src/confirmation-bus/types.ts` for `MessageBusType` and all message interfaces
- Read `packages/core/src/confirmation-bus/message-bus.ts` for `MessageBus` constructor and method signatures
- Read `packages/core/src/scheduler/types.ts` lines 33–130 for the `ToolCall` discriminated union shape

Document findings as comments in the test file.

### Exact Type Shapes (From Current Source — For Test Assertions)

**`PolicyFunctionCall`** (replaces `FunctionCall` from `@google/genai`):
```typescript
interface PolicyFunctionCall {
  id?: string;
  args?: Record<string, unknown>;
  name?: string;
}
```

**`PolicyToolCallState`** (replaces `ToolCall` discriminated union):
```typescript
interface PolicyToolCallState {
  status: string;
  request: { functionCall?: PolicyFunctionCall; [key: string]: unknown };
  [key: string]: unknown;
}
```

**`ConfirmationOutcome`** (replaces `ToolConfirmationOutcome`):
```typescript
enum ConfirmationOutcome {
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAlwaysAndSave = 'proceed_always_and_save',
  ProceedAlwaysServer = 'proceed_always_server',
  ProceedAlwaysTool = 'proceed_always_tool',
  ModifyWithEditor = 'modify_with_editor',
  SuggestEdit = 'suggest_edit',
  Cancel = 'cancel',
}
```

**`ConfirmationPayload`** (replaces `ToolConfirmationPayload`):
```typescript
interface ConfirmationPayload {
  newContent?: string;
  editedCommand?: string;
}
```

Tests must assert that `ConfirmationOutcome` has exactly these 8 values, that `PolicyFunctionCall` accepts objects with `name`/`args`/`id`, and that `PolicyToolCallState` accepts objects with `status` and `request`.

## Exact File Tasks

| File | Action | Description |
|------|--------|-------------|
| `packages/policy/src/confirmation-bus/message-bus.test.ts` | CREATE | Behavioral tests for MessageBus |

### Test Coverage Requirements

**message-bus.test.ts** (`@requirement REQ-003.1`–`REQ-003.8`):
- `requestConfirmation()` observable outcome: DENY decision → rejection message arrives at subscriber
- ALLOW decision → returns true, no message published to subscribers
- ASK_USER decision → ToolConfirmationRequest arrives at subscriber with correct tool name and call state
- Response: ProceedOnce → returns true (observable return value)
- Response: Cancel → returns false (observable return value)
- Timeout → returns false (observable return value, no subscriber callback needed)
- `publish()` delivers to correct subscribers by MessageBusType (subscriber receives the message object)
- `subscribe()` registers and `unsubscribe()` removes handlers (subscriber stops receiving after unsubscribe)
- ConfirmationOutcome enum has exactly these 8 values: ProceedOnce, ProceedAlways, ProceedAlwaysAndSave, ProceedAlwaysServer, ProceedAlwaysTool, ModifyWithEditor, SuggestEdit, Cancel
- ToolCallsUpdateMessage<T> is generic (can accept unknown)
- PolicyFunctionCall interface accepts objects with name?, args?, id? fields
- PolicyToolCallState interface accepts objects with status and request.functionCall
- PolicyLogger injection: custom logger collects debug/error output — verify collected output contains expected messages (not just that the function was called)

## Verification Commands

```bash
# Tests must FAIL (skeleton stubs return wrong values — behavioral RED)
npm run test --workspace @vybestack/llxprt-code-policy 2>&1 | rg -i "fail|AssertionError|expected"
# Expected: assertion failures (wrong enum values, no-op methods, empty results)
# NOT: "cannot find module" (skeleton stubs resolve imports)

# Verify imports resolve (skeletons in place)
node -e "
  import('./packages/policy/dist/index.js').then(m => {
    if (!m.MessageBus) { console.error('FAIL: MessageBus not exported'); process.exit(1); }
    console.log('PASS: imports resolve');
  });
"

# Verify no forbidden imports in tests
rg "@vybestack/llxprt-code-core|@google/genai|@vybestack/llxprt-code-telemetry" packages/policy/src/confirmation-bus -g '*.test.ts'
# Expected: zero matches

# Verify tests use PolicyFunctionCall, not FunctionCall
rg "FunctionCall" packages/policy/src/confirmation-bus -g '*.test.ts' | rg -v "PolicyFunctionCall"
# Expected: zero matches

# Verify tests use ConfirmationOutcome, not ToolConfirmationOutcome
rg "ToolConfirmationOutcome" packages/policy/src/confirmation-bus -g '*.test.ts'
# Expected: zero matches

# Verify @plan markers
rg "@plan.*PLAN-20260609-ISSUE1591\.P06" packages/policy/src/confirmation-bus -g '*.test.ts' --count
# Expected: 1+ files

# Verify @requirement markers
rg "@requirement:REQ-003" packages/policy/src/confirmation-bus -g '*.test.ts' --count
# Expected: 1+ files
```

## Success Criteria

- [ ] Test file created in `packages/policy/src/confirmation-bus/`
- [ ] Tests fail because skeleton stubs return wrong behavioral values — RED state confirmed
- [ ] RED failure is NOT import-resolution failure (skeletons make imports resolve)
- [ ] Tests contain full behavioral assertions (observable outcomes, not mock call checks)
- [ ] No forbidden imports in test file
- [ ] No mock theater
- [ ] Tests use PolicyFunctionCall (not FunctionCall from @google/genai)
- [ ] Tests use ConfirmationOutcome (not ToolConfirmationOutcome)
- [ ] Tests use PolicyToolCallState (not ToolCall from scheduler)
- [ ] Tests verify PolicyLogger injection behavior (observable: collected log output)
- [ ] Tests verify ToolCallsUpdateMessage<T> is generic
- [ ] Tests reference all message types by name in assertions (not just grep checks)
- [ ] @plan markers present
- [ ] @requirement markers map to REQ-003

## Failure Recovery

If tests pass immediately (not RED):
1. Skeleton stubs may be returning correct values — verify skeletons produce wrong results
2. Tests may have no assertions — add behavioral assertions with specific expected values
3. Tests may be importing from core — fix imports to use local paths
4. Do NOT proceed to P07 until RED state is confirmed (tests fail on wrong behavioral values)
