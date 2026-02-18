# Phase 15: Integration

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P15`

## Prerequisites

- Required: Phase 14a (semantics impl verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P14" packages/core/src/hooks/__tests__/`
- ALL prior phase tests must pass before starting this phase
- Pre-existing tests (hooks-caller-application.test.ts, hooks-caller-integration.test.ts) must pass

## Purpose

Verify that the complete refactored hook system is correctly integrated into the
existing codebase. This phase does not add new features — it confirms that all
four phases (A through D) work together end-to-end with the existing callers.

## Requirements Verified (Integration Scope)

All 5 original gaps are verified as closed:

1. **MessageBus integration** (Phase B): HOOK_EXECUTION_REQUEST → HOOK_EXECUTION_RESPONSE cycle works
2. **Payload validation** (Phase C): Invalid mediated payloads are rejected before reaching planner
3. **Model translation** (Phase B, DELTA-HPAY-003): BeforeModel/AfterModel/BeforeToolSelection translated on both paths
4. **Common-output processing** (Phase D): ProcessedHookResult fields surfaced from aggregated result
5. **Failure envelopes** (Phase D): All catch blocks return structured failure, not EMPTY_SUCCESS_RESULT

### Integration Requirements

```
[DELTA-HSYS-001] HookSystem wires MessageBus + DebugLogger into HookEventHandler
[DELTA-HSYS-002] HookSystem exposes setHookEnabled / getAllHooks
[DELTA-HEVT-004] dispose() unsubscribes and is called by HookSystem teardown
[DELTA-HBUS-002] Direct path continues when MessageBus absent
[DELTA-HPAY-006] fireSessionStartEvent / fireSessionEndEvent use typed enums
[DELTA-HAPP-001/002] ProcessedHookResult accessible by callers (stop semantics)
```

## Implementation Tasks

### Files to Create

#### `packages/core/src/hooks/__tests__/hookSystem-integration.test.ts` (NEW)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P15
 * @requirement DELTA-HSYS-001, DELTA-HSYS-002, DELTA-HEVT-004, DELTA-HBUS-002,
 *              DELTA-HPAY-006, DELTA-HAPP-001, DELTA-HAPP-002
 */
```

**Integration Test Scenarios**:

**Scenario 1: Full mediated path round-trip**
- Create HookSystem with real MessageBus and real hooks defined
- Publish HOOK_EXECUTION_REQUEST for BeforeTool with valid payload
- Verify HOOK_EXECUTION_RESPONSE published with correlationId echoed
- Verify response has success=true and non-empty output

**Scenario 2: Mediated path with invalid payload → validation failure**
- Publish HOOK_EXECUTION_REQUEST for BeforeTool WITHOUT tool_name
- Verify HOOK_EXECUTION_RESPONSE has success=false with code 'validation_failure'
- Verify hooks were NOT invoked

**Scenario 3: Direct path without MessageBus (backward compat)**
- Create HookSystem WITHOUT MessageBus
- Call hookSystem.eventHandler.fireBeforeToolEvent(...)
- Verify returns AggregatedHookResult successfully
- Verify no errors thrown

**Scenario 4: Management APIs**
- getAllHooks() returns list of defined hooks
- setHookEnabled(id, false) disables a hook
- Subsequent fire*Event skips disabled hook

**Scenario 5: dispose() / teardown**
- Create HookSystem with MessageBus
- Call hookSystem.dispose()
- Publish HOOK_EXECUTION_REQUEST after dispose
- Verify no response published (handler ignores post-dispose messages)

**Scenario 6: Model translation — direct path**
- Fire fireBeforeModelEvent with model_request
- Verify translated payload reaches planner (check via planner spy or hook output)

**Scenario 7: ProcessedHookResult stop semantics**
- Hook configured to signal stop with specific reason
- Call fire*Event that triggers that hook
- Verify returned result allows caller to detect shouldStop=true and stopReason

**Scenario 8: DebugLogger integration**
- Create HookSystem with real DebugLogger that records to array
- Execute hooks
- Verify log records contain 'hook:result' and 'hook:batch_summary' entries

**Scenario 9: fireSessionStartEvent typed parameter**
- Call fireSessionStartEvent({ source: SessionStartSource.INTERACTIVE })
- Verify no TypeScript compile error (type safety verified)
- Verify executes without error

**Scenario 10: Failure envelope from broken hook**
- Configure hook that will fail (bad command or throws)
- Execute via fire*Event
- Verify result has success=false with structured error (not EMPTY_SUCCESS_RESULT)
- Verify errors array has stage and message fields

### Files to Verify (existing integration tests must still pass)

```bash
# Pre-existing integration tests
npm test -- --testPathPattern="hooks-caller-application" 2>&1 | tail -5
# Expected: ALL pass

npm test -- --testPathPattern="hooks-caller-integration" 2>&1 | tail -5
# Expected: ALL pass
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P15
 * @requirement DELTA-HSYS-001
 * @scenario Full mediated path round-trip
 */
```

## Verification Commands

### Integration Test Quality

```bash
# Integration test file exists
ls packages/core/src/hooks/__tests__/hookSystem-integration.test.ts

# Test count
TOTAL=$(grep -c "^\s*it(" packages/core/src/hooks/__tests__/hookSystem-integration.test.ts)
[ "$TOTAL" -ge 8 ] && echo "PASS: $TOTAL tests" || echo "FAIL: Only $TOTAL"

# All 10 scenarios documented
for scenario in "mediated.*round.trip\|round.trip.*mediated" \
                "validation.*failure\|invalid.*payload" \
                "direct.*path\|without.*MessageBus" \
                "management\|setHookEnabled\|getAllHooks" \
                "dispose\|teardown" \
                "model.*translation\|BeforeModel" \
                "ProcessedHookResult\|shouldStop" \
                "DebugLogger\|batch_summary" \
                "SessionStartSource\|SessionEndReason" \
                "failure.*envelope\|buildFailureEnvelope"; do
  grep -qiE "$scenario" packages/core/src/hooks/__tests__/hookSystem-integration.test.ts && \
    echo "PASS: $scenario covered" || echo "WARN: $scenario may be missing"
done

# Requirements covered
for req in "DELTA-HSYS-001" "DELTA-HSYS-002" "DELTA-HEVT-004" "DELTA-HBUS-002"; do
  grep -q "$req" packages/core/src/hooks/__tests__/hookSystem-integration.test.ts && \
    echo "PASS: $req" || echo "FAIL: $req"
done

# No mocks in integration tests (real components used)
grep -cE "vi\.mock\|jest\.mock\|vi\.fn\(\)|jest\.fn\(\)" \
  packages/core/src/hooks/__tests__/hookSystem-integration.test.ts
# Expected: 0 or minimal (only HTTP-level mocking if needed)
```

### All Tests Pass

```bash
# New integration tests
npm test -- --testPathPattern="hookSystem-integration" 2>&1 | tail -10
# Expected: ALL pass

# All prior phase tests
npm test -- --testPathPattern="hookSemantics|hookValidators|hookSystem-lifecycle|hookEventHandler-messagebus" \
  2>&1 | tail -10
# Expected: ALL pass

# Pre-existing integration tests (MUST still pass)
npm test -- --testPathPattern="hooks-caller-application|hooks-caller-integration" \
  2>&1 | tail -10
# Expected: ALL pass

# Full test suite
npm test 2>&1 | tail -20
# Expected: ALL pass (or at least no regressions from this phase)
```

### TypeScript and Build

```bash
npm run typecheck && echo "PASS"
npm run build && echo "PASS"
```

### Integration Reachability (HARDENED — Reachability Proof Required)

Tracing from the CLI/API entrypoint to the hook system with observed runtime effect is MANDATORY.

```bash
# STEP 1: Trace CLI entrypoint → hook system instantiation
# Find where HookSystem is constructed in the composition root
grep -rn "new HookSystem\|HookSystem(" packages/core/src/ packages/cli/src/ 2>/dev/null | \
  grep -v ".test.ts"
# Expected: at least 1 result showing HookSystem constructed in composition root
# Record the file and line number → add to completion marker as "entrypoint trace"

# STEP 2: Trace composition root → caller → hook execution
# Find call site that reaches fire*Event
grep -rn "fire.*Event\|hookEvent\|hookSystem\." \
  packages/core/src/core/coreToolHookTriggers.ts \
  packages/core/src/core/ 2>/dev/null | head -15
# Expected: fire*Event calls present — record specific file:line

# STEP 3: Trace fire*Event → executeHooksCore (internal chain)
grep -n "executeHooksCore" packages/core/src/hooks/hookEventHandler.ts
# Expected: called from each fire*Event method — record call sites

# STEP 4: Observed runtime effect — end-to-end proof
# Run the real entrypoint with a hook configuration and verify the hook system responds
node scripts/start.js --profile-load synthetic "write me a haiku" 2>&1 | head -20
# Expected: output produced without crash — observable runtime effect at process boundary

# STEP 5: Verify MessageBus wiring reaches HookEventHandler from composition root
grep -n "new HookEventHandler\|messageBus" packages/core/src/hooks/hookSystem.ts
# Expected: HookEventHandler constructed with messageBus parameter (wired in composition)
```

**Completion marker requirement**: The P15.md completion marker MUST include:
```
Entrypoint trace:
  CLI entry:          <file>:<line> (e.g., packages/cli/src/index.ts:42)
  Composition root:   <file>:<line> (e.g., packages/core/src/app.ts:87 — new HookSystem(...))
  Caller:             <file>:<line> (e.g., packages/core/src/core/coreToolHookTriggers.ts:33)
  Hook execution:     <file>:<line> (e.g., packages/core/src/hooks/hookEventHandler.ts:95)
  Observed effect:    <describe what was observed in stdout/exit code>
```

```bash
# Verify coreToolHookTriggers.ts still calls fire*Event methods (backward compat)
grep -n "fire.*Event\|hookEvent" packages/core/src/core/coreToolHookTriggers.ts | head -10
# Expected: fire*Event calls present and unchanged

# Verify hookSystem.ts wires MessageBus into HookEventHandler (Phase A)
grep -n "new HookEventHandler\|messageBus" packages/core/src/hooks/hookSystem.ts
# Expected: HookEventHandler constructed with messageBus parameter
```

### Semantic Verification Checklist

1. **Is the feature reachable end-to-end?**
   - [ ] Existing callers (coreToolHookTriggers.ts) still work without changes
   - [ ] New MessageBus path is testable via integration test
   - [ ] Management APIs exposed and callable

2. **Are all 5 original gaps closed?**
   - [ ] MessageBus integration: P06-P08 tests pass
   - [ ] Payload validation: P09-P11 tests pass
   - [ ] Model translation: covered in P06-P08 and integration test
   - [ ] Common-output: P12-P14 tests pass
   - [ ] Failure envelopes: P12-P14 tests pass

3. **Are integration tests using real components?**
   - [ ] Real MessageBus (or test double at HTTP level, not service level)
   - [ ] Real HookRegistry with real hook definitions
   - [ ] Real HookPlanner, HookRunner, HookAggregator

4. **Is backward compatibility preserved?**
   - [ ] Pre-existing tests pass without modification
   - [ ] Direct-path callers work without changes
   - [ ] Return types compatible

## Success Criteria

- 8+ integration tests covering all 10 scenarios
- All integration tests pass
- All prior phase tests still pass
- Pre-existing hooks tests still pass
- TypeScript compiles, build succeeds
- Integration tests use real components (no mock theater)
- **Reachability proof present in P15.md completion marker**:
  - CLI/API entrypoint → composition root → hook system traced with file:line references
  - Observed runtime effect documented (stdout content or behavior from `node scripts/start.js`)
  - Full trace chain: entrypoint → HookSystem instantiation → fire*Event → executeHooksCore

## Failure Recovery

1. If integration test fails: trace to specific gap or wiring issue
2. If pre-existing test fails: check backward compatibility in hookEventHandler changes
3. If MessageBus round-trip test fails: check subscription/publish channel names match
4. Cannot proceed to P16 until all checks pass

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P15.md`
