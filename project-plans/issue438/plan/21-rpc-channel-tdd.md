# Phase 21: RPC Channel TDD

## Phase ID
`PLAN-20250212-LSP.P21`

## Prerequisites
- Required: Phase 20a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P20" packages/lsp/src/channels/rpc-channel.ts`
- Expected: RPC channel stub with typed handler registrations

## Requirements Implemented (Expanded)

### REQ-ARCH-020: JSON-RPC over stdin/stdout
**Full Text**: The system shall use JSON-RPC over stdin/stdout for the internal diagnostic channel.
**Behavior**:
- GIVEN: An in-memory MessageConnection pair
- WHEN: A `lsp/checkFile` request is sent with `{ filePath: "/project/src/foo.ts" }`
- THEN: The handler delegates to orchestrator.checkFile("/project/src/foo.ts") and returns the Diagnostic[] result
**Why This Matters**: Tests verify the RPC channel correctly translates JSON-RPC requests into orchestrator calls and returns typed results.

### REQ-ARCH-070: JSON-RPC Methods
**Full Text**: The system shall expose lsp/checkFile, lsp/diagnostics, lsp/status, and lsp/shutdown.
**Behavior**:
- GIVEN: RPC channel is set up with all 4 handlers
- WHEN: Each method is called via JSON-RPC
- THEN: The correct orchestrator method is invoked with the correct parameters and the typed result is returned

## Implementation Tasks

### Files to Create

- `packages/lsp/test/rpc-channel.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P21`
  - Tests (8+):
    1. lsp/checkFile delegates to orchestrator.checkFile with correct params
    2. lsp/checkFile returns Diagnostic[] response
    3. lsp/diagnostics delegates to orchestrator.getAllDiagnostics
    4. lsp/diagnostics returns Record<string, Diagnostic[]>
    5. lsp/status delegates to orchestrator.status
    6. lsp/status returns ServerStatus[]
    7. lsp/shutdown delegates to orchestrator.shutdown
    8. Unknown method returns error
  - Tests create in-memory MessageConnection pair (vscode-jsonrpc provides `createMessageConnection` with stream pairs)
  - Tests use a controlled orchestrator with known return values — NOT mocks that verify call counts, but real orchestrator instances with deterministic inputs/outputs
  - Tests assert on the RESPONSE content, not on internal call mechanics
  - NO subprocess spawning needed — test the channel in-process

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P21
 * @requirement REQ-ARCH-070
 * @pseudocode rpc-channel.md lines 01-42
 */
```

## Verification Commands

### Automated Checks

```bash
# Test file exists
test -f packages/lsp/test/rpc-channel.test.ts && echo "PASS" || echo "FAIL"

# Sufficient tests
TEST_COUNT=$(grep -c "it(" packages/lsp/test/rpc-channel.test.ts)
[ "$TEST_COUNT" -ge 8 ] && echo "PASS: $TEST_COUNT tests" || echo "FAIL: only $TEST_COUNT tests"

# No reverse testing (NotYetImplemented checks)
grep -rn "NotYetImplemented" packages/lsp/test/rpc-channel.test.ts && echo "FAIL" || echo "PASS"

# Has behavioral assertions
grep -c "toBe\|toEqual\|toMatch\|toContain\|toStrictEqual" packages/lsp/test/rpc-channel.test.ts
# Expected: 8+

# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit

# Tests fail naturally on stubs
cd packages/lsp && bunx vitest run test/rpc-channel.test.ts 2>&1 | tail -5
# Expected: Tests FAIL (stubs don't produce real results yet)
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/lsp/test/rpc-channel.test.ts
# Expected: No matches — tests are complete, only implementation is missing
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests verify response CONTENT, not call mechanics?** — Assert on returned Diagnostic[], not "checkFile was called"
2. **Do tests cover all 4 methods?** — Each method has at least 1 test
3. **Do tests use in-memory connections (not subprocess)?** — createMessageConnection with stream pairs
4. **Do tests fail naturally on stubs?** — Stubs return empty/wrong results, tests expect real results

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
# TDD phase — verify tests exist and FAIL naturally on stubs:
cd packages/lsp && bunx vitest run test/rpc-channel.test.ts 2>&1 | tail -20
# Expected: Tests fail with assertion errors (stubs return empty), not import/compile errors
```

#### Integration Points Verified
- [ ] Tests import createRpcChannel from source module
- [ ] Tests create in-memory vscode-jsonrpc MessageConnection for isolation
- [ ] Tests provide a real (not mocked) Orchestrator stub that returns known data
- [ ] Tests verify JSON-RPC response content, not internal calls

#### Lifecycle Verified
- [ ] Tests properly create and dispose MessageConnection per test
- [ ] No dangling connections or streams after test suite
- [ ] Test setup/teardown is clean

#### Edge Cases Verified
- [ ] lsp/checkFile with non-existent file → handler returns fallback
- [ ] lsp/diagnostics with no tracked files → returns empty object
- [ ] lsp/shutdown handler → orchestrator.shutdown called
- [ ] Orchestrator throws error → handler catches and returns safe default

## Success Criteria
- 8+ tests covering all 4 JSON-RPC methods
- Tests use in-memory MessageConnection (not subprocess)
- Tests assert on response content (behavioral, not mock theater)
- Tests fail naturally on stubs (RED phase of TDD)

## Failure Recovery
1. `git checkout -- packages/lsp/test/rpc-channel.test.ts`
2. Re-run Phase 21

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P21.md`
