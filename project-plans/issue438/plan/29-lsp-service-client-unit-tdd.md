# Phase 29: LspServiceClient Unit TDD

## Phase ID
`PLAN-20250212-LSP.P29`

## Prerequisites
- Required: Phase 28a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P28" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts`
- Expected: Integration tests exist, failing on stubs
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

Unit tests that detail edge cases for LspServiceClient — Bun detection, subprocess management, JSON-RPC communication, and error handling.

### REQ-GRACE-040: Dead Service Returns Empty
**Full Text**: If the LSP service is unavailable or has crashed, then `LspServiceClient.isAlive()` shall return `false`, and all subsequent `checkFile()` calls shall return an empty array immediately.
**Behavior**:
- GIVEN: service is not alive (never started or crashed)
- WHEN: checkFile("foo.ts") called
- THEN: Returns [] immediately without sending JSON-RPC

### REQ-GRACE-045: Permanent Disable on Startup Failure
**Full Text**: If LSP service startup fails, then the system shall keep LSP permanently disabled for the remainder of the session and shall not retry startup.
**Behavior**:
- GIVEN: start() failed
- WHEN: start() is called again
- THEN: Returns immediately, does not attempt another spawn

### REQ-LIFE-050: Shutdown Sequence
**Full Text**: Send `lsp/shutdown` request, wait briefly for graceful exit, then kill the subprocess.
**Behavior**:
- GIVEN: Service is alive
- WHEN: shutdown() is called
- THEN: Sends `lsp/shutdown` JSON-RPC request, waits up to 5000ms, then sends SIGTERM, then SIGKILL after 2000ms

### REQ-LIFE-060: Cleanup Prevents Leaks
**Full Text**: The system shall clean up diagnostic and file tracking maps to prevent memory leaks.
**Behavior**:
- GIVEN: Service was alive with active connections
- WHEN: shutdown() completes
- THEN: subprocess=null, rpcConnection=null, alive=false

### REQ-ARCH-060: vscode-jsonrpc Only
**Full Text**: The system shall add only `vscode-jsonrpc` as a new dependency to the core package.

### REQ-STATUS-035: Specific Failure Reason Stored
**Full Text**: If `/lsp status` reports LSP as unavailable, then the reason shall reflect the specific startup failure cause (e.g., "Bun not found in PATH," "LSP package not installed," or "service startup failed").
**Behavior**:
- GIVEN: start() fails because Bun is not in PATH
- WHEN: getUnavailableReason() is called
- THEN: Returns "Bun not found in PATH" (specific, not generic)
**Why This Matters**: Specific failure reasons let `/lsp status` show actionable messages.

### REQ-TIME-080: Abort Signal Honoured
**Full Text**: When awaiting diagnostics for a file mutation, the system shall honour request cancellation or abort signals and shall terminate diagnostic collection without failing the mutation operation.
**Behavior**:
- GIVEN: checkFile() is in progress
- WHEN: An AbortSignal fires
- THEN: checkFile() returns [] without throwing
**Why This Matters**: Prevents hung mutation tools when the user cancels.

## Implementation Tasks

### Files to Create

- `packages/core/src/lsp/__tests__/lsp-service-client.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P29`
  - Unit tests covering edge cases (15+):
    1. constructor stores config and workspaceRoot
    2. isAlive() returns false before start()
    3. start() detects Bun binary using which/execSync
    4. start() resolves LSP package path relative to core
    5. start() spawns with correct stdio array [pipe, pipe, pipe, pipe, pipe]
    6. start() passes LSP_BOOTSTRAP env var as JSON containing workspaceRoot and config
    7. start() LSP_BOOTSTRAP contains valid JSON with workspaceRoot and config fields
    8. start() creates MessageConnection from subprocess stdio
    9. start() listens for subprocess exit → alive=false
    10. start() listens for subprocess error → alive=false
    11. checkFile() when dead → returns [] without RPC call
    12. checkFile() when alive → sends lsp/checkFile request
    13. checkFile() on RPC error → returns [] (no throw)
    14. getAllDiagnostics() when dead → returns {}
    15. getAllDiagnostics() on RPC error → returns {}
    16. status() when dead → returns []
    17. shutdown() sends lsp/shutdown, then SIGTERM, sets alive=false
    18. shutdown() handles timeout → SIGKILL fallback
    19. shutdown() when already dead → no-op
    20. getMcpTransportStreams() returns stdio[3]/stdio[4] when alive
    21. getMcpTransportStreams() returns null when dead
    22. start() failure stores specific reason (REQ-STATUS-035): Bun not in PATH
    23. start() failure stores specific reason: LSP package not installed
    24. start() failure stores specific reason: service startup failed
    25. getUnavailableReason() returns undefined when alive
    26. checkFile() with AbortSignal → returns [] on abort (REQ-TIME-080)
    27. start() ready-wait timeout: GIVEN service subprocess does not send lsp/ready WHEN 10s timeout expires THEN subprocess is killed via process group (`process.kill(-pid, 'SIGTERM')`) AND notification listener is disposed AND RPC connection is closed AND service marked dead (alive=false) — never becomes alive
    28. start() ready-wait timeout cleanup: GIVEN ready-wait timeout fires THEN no dangling listeners remain AND subprocess.pid guard is checked before kill
  - Tests FAIL naturally on stubs
  - NO testing for NotYetImplemented

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P29
 * @requirement REQ-GRACE-040
 * @scenario checkFile when service is dead
 * @given LspServiceClient has not been started
 * @when checkFile is called
 * @then Returns empty array immediately
 */
```

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/lsp/__tests__/lsp-service-client.test.ts && echo "PASS" || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P29" packages/core/src/lsp/__tests__/lsp-service-client.test.ts | wc -l
# Expected: 1+

# Sufficient tests
TEST_COUNT=$(grep -c "it(" packages/core/src/lsp/__tests__/lsp-service-client.test.ts)
[ "$TEST_COUNT" -ge 15 ] && echo "PASS: $TEST_COUNT tests" || echo "FAIL: only $TEST_COUNT tests"

# No reverse testing
grep -rn "NotYetImplemented" packages/core/src/lsp/__tests__/lsp-service-client.test.ts && echo "FAIL" || echo "PASS"

# Has behavioral assertions
grep -c "toBe\|toEqual\|toMatch\|toContain\|toStrictEqual" packages/core/src/lsp/__tests__/lsp-service-client.test.ts
# Expected: 15+

# Tests fail naturally
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client.test.ts 2>&1 | tail -10
# Expected: Tests FAIL
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests verify Bun detection?** — which/execSync check
2. **Do tests verify subprocess spawning with correct args?** — stdio array, env vars, cwd
3. **Do tests verify JSON-RPC communication?** — sendRequest calls
4. **Do tests verify error handling?** — RPC errors → empty returns, no throws
5. **Do tests verify shutdown sequence?** — lsp/shutdown → SIGTERM → SIGKILL timeout

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/lsp/__tests__/lsp-service-client.test.ts
# Expected: No matches

grep -rn -E "(skip|xit|xdescribe|\.todo)" packages/core/src/lsp/__tests__/lsp-service-client.test.ts
# Expected: No skipped tests
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests verify Bun detection?** — which/execSync check for 'bun' binary
   - [ ] Test for Bun present → success
   - [ ] Test for Bun absent → graceful failure
2. **Do tests verify subprocess spawning with correct args?** — stdio:[pipe,pipe,pipe,pipe,pipe], env vars, cwd
   - [ ] Spawn args match lsp-service-client.md pseudocode lines 35-50
3. **Do tests verify JSON-RPC communication?** — sendRequest('lsp/checkFile', ...) → Diagnostic[]
   - [ ] Each of 4 RPC methods tested
4. **Do tests verify error handling?** — RPC errors → empty returns, no throws
   - [ ] REQ-GRACE-040: isAlive()=false → checkFile returns []
5. **Do tests verify shutdown sequence?** — lsp/shutdown → SIGTERM → SIGKILL timeout
   - [ ] REQ-LIFE-050: Graceful shutdown with kill fallback

#### Feature Actually Works

```bash
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client.test.ts 2>&1 | tail -5
# Expected: Tests FAIL on stubs
```

#### Integration Points Verified
- [ ] Tests import LspServiceClient from lsp-service-client.ts
- [ ] Tests verify types (Diagnostic, ServerStatus, LspConfig) from types.ts
- [ ] Tests verify getMcpTransportStreams returns correct stream types

#### Lifecycle Verified
- [ ] Tests cover: fresh constructor → start() → operational → shutdown() → dead
- [ ] Tests verify no auto-restart after crash (REQ-LIFE-080)
- [ ] afterEach kills any spawned subprocesses

#### Edge Cases Verified
- [ ] checkFile with empty string path
- [ ] getAllDiagnostics when no files have been checked
- [ ] status() when service just started (may have no servers yet)
- [ ] shutdown() timeout: service doesn't exit gracefully → killed with SIGKILL
- [ ] JSON-RPC connection error during checkFile → returns [] (REQ-GRACE-040)

## Success Criteria
- 15+ unit tests
- Tests cover: Bun detection, spawn args, JSON-RPC methods, error handling, shutdown, cleanup
- Tests fail naturally on stubs
- No reverse testing

## Failure Recovery
1. `git checkout -- packages/core/src/lsp/__tests__/lsp-service-client.test.ts`
2. Re-run Phase 29

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P29.md`
