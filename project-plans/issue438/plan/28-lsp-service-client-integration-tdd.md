# Phase 28: LspServiceClient Integration TDD

## Phase ID
`PLAN-20250212-LSP.P28`

## Prerequisites
- Required: Phase 27a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P27" packages/core/src/lsp/lsp-service-client.ts`
- Expected: LspServiceClient stub exists in packages/core
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

Integration tests that verify LspServiceClient correctly spawns a Bun subprocess, communicates via JSON-RPC, and handles lifecycle events. Written FIRST (vertical slice) before unit tests.

### REQ-GRACE-020: Bun Not Available
**Full Text**: If the Bun runtime is not available on the system (not installed or not in PATH), then the system shall silently disable all LSP functionality with no user-visible error, emitting only a debug-level log message.
**Behavior**:
- GIVEN: `bun` is not in PATH
- WHEN: `start()` is called
- THEN: `isAlive()` returns false, no error thrown

### REQ-GRACE-030: LSP Package Not Installed
**Full Text**: If the `@vybestack/llxprt-code-lsp` package is not installed, then the system shall silently disable all LSP functionality with no user-visible error.
**Behavior**:
- GIVEN: LSP package entry point does not exist
- WHEN: `start()` is called
- THEN: `isAlive()` returns false, no error thrown

### REQ-GRACE-040: isAlive After Crash
**Full Text**: If the LSP service is unavailable or has crashed, then `LspServiceClient.isAlive()` shall return `false`, and all subsequent `checkFile()` calls shall return an empty array immediately.
**Behavior**:
- GIVEN: LSP service process has exited unexpectedly
- WHEN: `isAlive()` is called
- THEN: Returns false
- WHEN: `checkFile()` is called
- THEN: Returns [] immediately

### REQ-LIFE-050: Graceful Shutdown
**Full Text**: When shutting down the LSP service, the system shall send an `lsp/shutdown` request, wait briefly for graceful exit, then kill the subprocess.
**Behavior**:
- GIVEN: LSP service is running
- WHEN: `shutdown()` is called
- THEN: JSON-RPC `lsp/shutdown` sent, subprocess killed after timeout

### REQ-LIFE-080: No Restart After Crash
**Full Text**: If the LSP service process itself dies, then the system shall not restart it. All LSP functionality shall degrade gracefully.
**Behavior**:
- GIVEN: LSP service process died
- WHEN: Any method is called
- THEN: Returns empty results, no restart attempted

## Implementation Tasks

### Files to Create

- `packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P28`
  - Integration tests that exercise the FULL lifecycle:
    1. start() with valid Bun + LSP package → isAlive() returns true
    2. start() without Bun in PATH → isAlive() returns false, no error
    3. start() with missing LSP package → isAlive() returns false, no error
    4. checkFile() with live service → returns Diagnostic[] (may be empty for valid file)
    5. checkFile() with dead service → returns [] immediately
    6. getAllDiagnostics() with live service → returns Record<string, Diagnostic[]>
    7. status() with live service → returns ServerStatus[]
    8. shutdown() sends shutdown and kills process
    9. After shutdown, isAlive() returns false, checkFile() returns []
    10. Process crash → isAlive() returns false, no restart attempted
    11. getMcpTransportStreams() returns stream pair when alive
    12. getMcpTransportStreams() returns null when dead
  - These are REAL integration tests — they may spawn actual subprocess or use test fixtures
  - Tests FAIL naturally on stubs (start() is no-op, isAlive() returns false)
  - NO testing for NotYetImplemented

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P28
 * @requirement REQ-GRACE-020
 * @scenario start() without Bun → graceful disable
 * @given Bun is not in PATH
 * @when start() is called
 * @then isAlive() returns false, no error thrown
 */
```

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts && echo "PASS" || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P28" packages/core/src/lsp/__tests__/ | wc -l
# Expected: 1+

# Sufficient tests
TEST_COUNT=$(grep -c "it(" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts)
[ "$TEST_COUNT" -ge 10 ] && echo "PASS: $TEST_COUNT tests" || echo "FAIL: only $TEST_COUNT tests"

# No reverse testing
grep -rn "NotYetImplemented" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts && echo "FAIL" || echo "PASS"

# No mock theater
grep -rn "toHaveBeenCalled\b" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts && echo "WARNING" || echo "PASS"

# Has behavioral assertions
grep -c "toBe\|toEqual\|toMatch\|toContain\|toStrictEqual" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts
# Expected: 10+

# Tests fail naturally (stubs return empty)
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts 2>&1 | tail -10
# Expected: Tests FAIL with assertion errors
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests verify graceful degradation?** — Tests for missing Bun and missing package
2. **Do tests verify crash resilience?** — Process death → empty results, no restart
3. **Do tests verify lifecycle?** — start → alive → shutdown → dead
4. **Would tests fail if implementation was removed?** — Yes, stubs return false/empty

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts
# Expected: No matches

grep -rn -E "(skip|xit|xdescribe|\.todo)" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts
# Expected: No skipped tests
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests verify graceful degradation?** — Tests for missing Bun and missing package
   - [ ] REQ-GRACE-020: Bun not in PATH → silently disabled
   - [ ] REQ-GRACE-030: Package not present → silently disabled
   - [ ] REQ-GRACE-045: Startup failure → no retry
2. **Do tests verify crash resilience?** — Process death → empty results, no restart
   - [ ] REQ-LIFE-080: Service crash → isAlive()=false, no restart
3. **Do tests verify lifecycle?** — start → alive → shutdown → dead
   - [ ] REQ-LIFE-050: Graceful shutdown sequence
4. **Would tests fail if implementation was removed?** — Yes, stubs return false/empty
   - [ ] All assertions check for specific behavior, not just "no error"

#### Feature Actually Works

```bash
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts 2>&1 | tail -5
# Expected: Tests FAIL on stubs
```

#### Integration Points Verified
- [ ] Tests import LspServiceClient from lsp-service-client.ts
- [ ] Tests verify subprocess spawning with correct command and stdio config
- [ ] Tests verify JSON-RPC communication over stdin/stdout
- [ ] Tests verify getMcpTransportStreams returns fd3/fd4 streams

#### Lifecycle Verified
- [ ] Tests verify: constructor → start() → isAlive()=true → shutdown() → isAlive()=false
- [ ] Tests verify Bun detection happens in start(), not constructor
- [ ] afterEach properly kills any spawned subprocesses

#### Edge Cases Verified
- [ ] start() called twice → no duplicate subprocess
- [ ] checkFile() before start() → returns empty array
- [ ] shutdown() when already dead → no-op, no error
- [ ] Service subprocess exits unexpectedly → isAlive()=false

## Success Criteria
- 10+ integration tests
- Tests cover: graceful degradation (Bun/package missing), crash resilience, lifecycle
- Tests fail naturally on stubs
- No reverse testing or mock theater
- All REQ-GRACE-* and REQ-LIFE-* requirements have at least one test

## Failure Recovery
1. `git checkout -- packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts`
2. Re-run Phase 28

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P28.md`
