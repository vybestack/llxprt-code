# Phase 06a: MessageBus Stub Verification

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P06a`

## Prerequisites

- Required: Phase 06 (MessageBus stub) completed
- Verification: `ls packages/core/src/hooks/hookBusContracts.ts`

## Verification Commands

```bash
# 1. hookBusContracts.ts exists and exports both interfaces
ls packages/core/src/hooks/hookBusContracts.ts
grep -c "export interface Hookexecution" packages/core/src/hooks/hookBusContracts.ts
# Expected: 2

# 2. HookExecutionRequest has required fields
grep -A 5 "interface HookExecutionRequest" packages/core/src/hooks/hookBusContracts.ts
# Expected: eventName: HookEventName, input: Record<string, unknown>, correlationId: string

# 3. HookExecutionResponse has required fields
grep -A 10 "interface HookExecutionResponse" packages/core/src/hooks/hookBusContracts.ts
# Expected: correlationId, success, optional output and error

# 4. Stub methods on HookEventHandler
for method in "onBusRequest" "publishResponse" "extractCorrelationId" "translateModelPayload"; do
  grep -q "$method" packages/core/src/hooks/hookEventHandler.ts && \
    echo "PASS: $method stub exists" || echo "FAIL: $method missing"
done

# 5. isDisposed flag
grep -q "isDisposed" packages/core/src/hooks/hookEventHandler.ts && \
  echo "PASS: isDisposed flag present" || echo "FAIL: isDisposed missing"

# 6. TypeScript compiles
npm run typecheck 2>&1 | grep -c "error" || echo "PASS: 0 errors"

# 7. Plan markers
grep -c "PLAN-20250218-HOOKSYSTEM.P06" packages/core/src/hooks/ -r
# Expected: 6+

# 8. No TODO/FIXME
grep -rn "TODO\|FIXME" packages/core/src/hooks/hookBusContracts.ts
# Expected: 0

# 9. All P04 tests still pass
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | grep "passed"
# Expected: 15+ passed

# 10. Pre-existing hook tests pass
npm test -- --testPathPattern="hooks-caller" 2>&1 | grep -E "passed|failed"
# Expected: same pass count as before Phase A
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" \
  packages/core/src/hooks/hookBusContracts.ts \
  packages/core/src/hooks/hookEventHandler.ts | grep -v ".test.ts"
# Expected: 0 matches
```

### Semantic Verification

1. **Is the contract complete?**
   - [ ] HookExecutionRequest has eventName (HookEventName), input (Record), correlationId (string)
   - [ ] HookExecutionResponse has correlationId, success, optional output and error

2. **Are stubs truly minimal?**
   - [ ] onBusRequest body is empty or no-op
   - [ ] extractCorrelationId returns '' or placeholder (not real UUID)
   - [ ] translateModelPayload returns input unchanged

3. **Is backward compatibility preserved?**
   - [ ] All P04 tests still pass
   - [ ] All pre-existing hook tests pass
   - [ ] TypeScript compiles

#### Holistic Assessment

**What was created?**
Interface definitions in hookBusContracts.ts establishing the typed contract for
MessageBus communication. Stub methods on HookEventHandler for the bus integration
path (onBusRequest, publishResponse, extractCorrelationId, translateModelPayload).
isDisposed flag added.

**Is the contract correct?**
HookExecutionRequest and HookExecutionResponse match the data schemas in specification.md.
Interfaces will be imported by HookEventHandler in P08.

**Verdict**: PASS if TypeScript compiles, P04 tests pass, and all 5 stub methods
+ isDisposed flag are present.

## Success Criteria

- hookBusContracts.ts created with correct interface shapes
- All stub methods present
- TypeScript compiles
- P04 tests pass
- Pre-existing tests pass

## Failure Recovery

1. If TypeScript fails on imports, fix import paths in hookBusContracts.ts
2. If P04 tests regress, check if HookEventHandler changes broke lifecycle behavior
3. Cannot proceed to P07 until all checks pass

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P06a.md`
