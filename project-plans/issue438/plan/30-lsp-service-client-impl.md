# Phase 30: LspServiceClient Implementation

## Phase ID
`PLAN-20250212-LSP.P30`

## Prerequisites
- Required: Phase 29a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P29" packages/core/src/lsp/__tests__/lsp-service-client.test.ts`
- Expected: Integration (P26) and unit (P27) tests exist, all failing on stubs
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

### REQ-ARCH-060: vscode-jsonrpc Only Dependency
**Full Text**: The system shall add only `vscode-jsonrpc` as a new dependency to the core package. This dependency shall be pure JavaScript with zero native modules.
**Behavior**:
- GIVEN: packages/core/package.json
- WHEN: vscode-jsonrpc is added as dependency
- THEN: It is the ONLY new dependency added; no vscode-languageserver-types or other LSP packages
**Why This Matters**: Keeps core's dependency footprint minimal and avoids native module compilation issues.

### REQ-GRACE-020: Bun Not Available → Silent Disable
**Full Text**: If the Bun runtime is not available on the system, then the system shall silently disable all LSP functionality with no user-visible error, emitting only a debug-level log message.
**Behavior**:
- GIVEN: Bun is not installed or not in PATH
- WHEN: start() is called
- THEN: Logs debug message, alive stays false, returns without error

### REQ-GRACE-030: LSP Package Missing → Silent Disable
**Full Text**: If the `@vybestack/llxprt-code-lsp` package is not installed, then the system shall silently disable all LSP functionality with no user-visible error.
**Behavior**:
- GIVEN: packages/lsp/src/main.ts does not exist
- WHEN: start() is called
- THEN: Logs debug message, alive stays false, returns without error

### REQ-GRACE-040: Dead Service Returns Empty
**Full Text**: If the LSP service is unavailable or has crashed, then `LspServiceClient.isAlive()` shall return `false`, and all subsequent `checkFile()` calls shall return an empty array immediately.

### REQ-GRACE-045: No Retry on Failure
**Full Text**: If LSP service startup fails, then the system shall keep LSP permanently disabled and not retry.

### REQ-STATUS-035: Specific Failure Reason Stored
**Full Text**: If `/lsp status` reports LSP as unavailable, then the reason shall reflect the specific startup failure cause (e.g., "Bun not found in PATH," "LSP package not installed," or "service startup failed").
**Behavior**:
- GIVEN: Bun is not installed
- WHEN: start() fails
- THEN: `getUnavailableReason()` returns "Bun not found in PATH"
- GIVEN: LSP package is not installed
- WHEN: start() fails
- THEN: `getUnavailableReason()` returns "LSP package not installed"
- GIVEN: Subprocess fails to spawn for other reason
- WHEN: start() fails
- THEN: `getUnavailableReason()` returns "service startup failed"
**Why This Matters**: The `/lsp status` command (Phase 34) needs this reason to display to users. LspServiceClient must capture and expose it.

### REQ-LIFE-050: Graceful Shutdown
**Full Text**: Send `lsp/shutdown`, wait briefly, then kill the subprocess.

### REQ-LIFE-080: No Restart After Crash
**Full Text**: If the LSP service process dies, the system shall not restart it.

## Implementation Tasks

### Files to Modify

- `packages/core/src/lsp/lsp-service-client.ts`
  - MODIFY: Replace stub with full implementation
  - MUST include: `@plan:PLAN-20250212-LSP.P30`
  - MUST include: `@requirement:REQ-ARCH-060`, `@requirement:REQ-GRACE-020`, `@requirement:REQ-GRACE-040`
  - MUST follow pseudocode `lsp-service-client.md` line-by-line:
    - Lines 001-007b: Private fields (subprocess, rpcConnection, alive, config, workspaceRoot, logger, unavailableReason) — NO local diagnosticEpoch field (epoch is server-authoritative via RPC)
    - Lines 009-012: Constructor
    - Lines 014-084: start() — Bun detection (lines 017-020, sets unavailableReason), LSP package detection (lines 022-026, sets unavailableReason), subprocess spawn with LSP_BOOTSTRAP env (lines 028-035) [RESEARCH DD-2], RPC connection creation (lines 036-040), event listeners (lines 042-049), connection.listen (line 051), **wait for lsp/ready notification** (lines 053-076) [RESEARCH DD-1], alive=true (line 078), catch sets unavailableReason (lines 081-084)
    - Lines 086-096: checkFile(filePath, text?, signal?) — alive guard, abort signal guard [REQ-TIME-080], sendRequest 'lsp/checkFile' with optional text [RESEARCH DD-3], AbortSignal→CancellationToken wiring, catch → [] (no local epoch increment — epoch is server-authoritative)
    - Lines 098-107: getAllDiagnostics() — alive guard, sendRequest 'lsp/diagnostics', catch → {}
    - Lines 109-118: status() — alive guard, sendRequest 'lsp/status', catch → []
    - Lines 120-121: isAlive() — return this.alive
    - Lines 122a-122n: getDiagnosticEpoch() — ASYNC RPC call to lsp/getDiagnosticEpoch, returns server-side epoch (no local mirror) [RESEARCH Bug 2]
    - Lines 122e-122n: getAllDiagnosticsAfter(afterEpoch, waitMs?) — sendRequest 'lsp/diagnosticsAfter', catch → {} [RESEARCH Bug 2]
    - Lines 122p-122r: getUnavailableReason() — return unavailableReason [REQ-STATUS-035]
    - Lines 123-138: shutdown() — alive guard, sendRequest 'lsp/shutdown' with timeout, SIGTERM, SIGKILL fallback with timer cleanup, cleanup refs
    - Lines 140-146: getMcpTransportStreams() — alive guard, return stdio[3]/stdio[4]

- `packages/core/package.json`
  - ADD: `"vscode-jsonrpc": "^8.2.1"` to dependencies (if not already present)

### Files NOT to Modify

- `packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts` — DO NOT MODIFY
- `packages/core/src/lsp/__tests__/lsp-service-client.test.ts` — DO NOT MODIFY

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P30
 * @requirement REQ-ARCH-060
 * @requirement REQ-GRACE-020
 * @requirement REQ-GRACE-040
 * @pseudocode lsp-service-client.md lines 001-148
 */
export class LspServiceClient {
  // Full implementation
}
```

## Verification Commands

### Automated Checks

```bash
# All unit tests pass
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client.test.ts
# Expected: All pass

# All integration tests pass
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts
# Expected: All pass

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P30" packages/core/src/lsp/lsp-service-client.ts | wc -l
# Expected: 1+

# No test modifications
git diff packages/core/src/lsp/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified" || echo "PASS"

# Pseudocode compliance
grep -c "@pseudocode" packages/core/src/lsp/lsp-service-client.ts
# Expected: 1+

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/lsp/lsp-service-client.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/lsp/lsp-service-client.ts
# Expected: No matches

# No empty returns in main paths (only in guards)
grep -rn -E "return \[\]|return \{\}" packages/core/src/lsp/lsp-service-client.ts
# Expected: Only in alive-guard checks and catch blocks
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/lsp/lsp-service-client.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/lsp/lsp-service-client.ts
# Expected: No matches

grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/lsp/lsp-service-client.ts
# Expected: Only in isAlive() guard clauses (alive=false → return []), not in main logic
```

### Continued Automated Checks

```bash
# No Bun APIs
grep -rn "Bun\.\|import.*bun" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL: Bun in core" || echo "PASS"

# vscode-jsonrpc in dependencies
grep "vscode-jsonrpc" packages/core/package.json && echo "PASS" || echo "FAIL"

# TypeScript compiles
cd packages/core && npx tsc --noEmit
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe: LspServiceClient that spawns Bun subprocess, creates JSON-RPC connection, provides checkFile/getAllDiagnostics/status/shutdown, handles graceful degradation]

##### Does it satisfy the requirements?
- [ ] REQ-ARCH-060: Only vscode-jsonrpc added to core — cite package.json
- [ ] REQ-GRACE-020: Bun detection → silent disable — cite which/execSync + early return
- [ ] REQ-GRACE-030: Package detection → silent disable — cite fs.accessSync + early return
- [ ] REQ-GRACE-040: Dead service returns [] — cite alive guard in checkFile
- [ ] REQ-GRACE-045: No retry — cite that start() doesn't retry
- [ ] REQ-LIFE-050: Shutdown sequence — cite lsp/shutdown + SIGTERM + SIGKILL
- [ ] REQ-LIFE-080: No restart — cite exit event handler sets alive=false only
- [ ] REQ-STATUS-035: Unavailability reason stored — cite getUnavailableReason() (line 122q) and where reason is set (lines 019a, 025a, 083a-083b)

##### Data flow trace
[Trace: start() → which('bun') → fs.access → spawn(env: LSP_BOOTSTRAP) [DD-2] → createMessageConnection → listen → waitForReadySignal('lsp/ready', 10s) [DD-1] → alive=true]
[Trace: checkFile(path, text?) → alive guard → sendRequest('lsp/checkFile', {filePath, text}) [DD-3] → Diagnostic[]]
[Trace: shutdown() → sendRequest('lsp/shutdown') → SIGTERM → SIGKILL timer → cleanup]

##### Error handling
- [ ] Every public method has try/catch (except isAlive which is synchronous)
- [ ] checkFile returns [] on error
- [ ] getAllDiagnostics returns {} on error
- [ ] status returns [] on error
- [ ] shutdown catches errors but still kills subprocess

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
# Run integration tests that exercise real subprocess lifecycle:
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts
# Expected: All pass — start, checkFile, shutdown
```

#### Integration Points Verified
- [ ] Config.initialize() calls LspServiceClient.start() — verified in P33
- [ ] edit.ts calls getLspServiceClient().checkFile() — verified in P31
- [ ] Config cleanup calls LspServiceClient.shutdown() — verified in P33
- [ ] getMcpTransportStreams() returns fd3/fd4 for MCP registration — verified by reading code

#### Lifecycle Verified
- [ ] start() → Bun check → package check → spawn → JSON-RPC connection → alive=true
- [ ] Subprocess exit → alive=false, no restart
- [ ] shutdown() → lsp/shutdown → SIGTERM → SIGKILL → cleanup

#### Edge Cases Verified
- [ ] Bun not in PATH → unavailableReason set, alive=false
- [ ] LSP package missing → unavailableReason set, alive=false
- [ ] Subprocess crash → alive=false, reason stored
- [ ] Double shutdown → no-op
- [ ] [RESEARCH DD-1] Service does not send lsp/ready within 10s → alive=false, marked dead
- [ ] [RESEARCH DD-2] LSP_BOOTSTRAP env var set correctly with JSON config
- [ ] [RESEARCH DD-3] checkFile passes text parameter through to RPC request

## Success Criteria
- All unit and integration tests pass
- No test files modified
- Pseudocode references present
- No deferred implementation patterns
- No Bun APIs in core
- vscode-jsonrpc added to core dependencies

## Failure Recovery
1. `git checkout -- packages/core/src/lsp/lsp-service-client.ts packages/core/package.json`
2. Do NOT revert tests
3. Re-run Phase 28

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P30.md`
