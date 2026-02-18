# Phase 22: RPC Channel Implementation

## Phase ID
`PLAN-20250212-LSP.P22`

## Prerequisites
- Required: Phase 21a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P21" packages/lsp/test/rpc-channel.test.ts`
- Expected: RPC channel stub and 8+ tests exist, tests failing on stubs
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

### REQ-ARCH-020: JSON-RPC over stdin/stdout
**Full Text**: The system shall use JSON-RPC over stdin/stdout for the internal diagnostic channel between the agent process and the LSP service process.
**Behavior**:
- GIVEN: The LSP service is running with RPC channel set up on stdin/stdout
- WHEN: Core sends a JSON-RPC request `lsp/checkFile` with `{ filePath: "/project/src/foo.ts" }`
- THEN: The handler delegates to `orchestrator.checkFile(params.filePath)` and returns the `Diagnostic[]` result
**Why This Matters**: This is the core communication mechanism between the Node.js agent and the Bun LSP service for diagnostic collection.

### REQ-ARCH-070: JSON-RPC Methods
**Full Text**: The system shall expose the following internal JSON-RPC methods over the stdin/stdout channel: `lsp/checkFile`, `lsp/diagnostics`, `lsp/status`, and `lsp/shutdown`.
**Behavior**:
- GIVEN: RPC channel is connected
- WHEN: `lsp/checkFile` is called with `{ filePath: string }`
- THEN: Returns `Diagnostic[]` from `orchestrator.checkFile()`
- WHEN: `lsp/diagnostics` is called
- THEN: Returns `Record<string, Diagnostic[]>` with alphabetically sorted keys from `orchestrator.getAllDiagnostics()`
- WHEN: `lsp/status` is called
- THEN: Returns `ServerStatus[]` from `orchestrator.getStatus()`
- WHEN: `lsp/shutdown` is called
- THEN: Calls `orchestrator.shutdown()` and returns void
**Why This Matters**: These are the four internal RPC methods that LspServiceClient in core uses to communicate with the LSP service.

### REQ-ARCH-080: Deterministic Ordering
**Full Text**: When returning results from the `lsp/diagnostics` method, the system shall order file keys deterministically in ascending alphabetical path order.
**Behavior**:
- GIVEN: Orchestrator has diagnostics for files `["src/z.ts", "src/a.ts", "src/m.ts"]`
- WHEN: `lsp/diagnostics` method is invoked
- THEN: Response keys are ordered `["src/a.ts", "src/m.ts", "src/z.ts"]`
**Why This Matters**: Deterministic ordering ensures consistent tool output for the LLM regardless of server response order.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/channels/rpc-channel.ts`
  - MODIFY: Replace stub with full implementation
  - MUST include: `@plan:PLAN-20250212-LSP.P22`
  - MUST include: `@requirement:REQ-ARCH-020`, `@requirement:REQ-ARCH-070`, `@requirement:REQ-ARCH-080`
  - MUST follow pseudocode `rpc-channel.md` line-by-line:
    - Lines 01-06: JSON-RPC method type definitions (CheckFileMethod, DiagnosticsMethod, StatusMethod, ShutdownMethod)
    - Lines 10-17: createRpcChannel function signature, reader/writer/connection creation
    - Lines 22-30: lsp/checkFile handler — delegate to orchestrator.checkFile, catch errors → return []
    - Lines 32-44: lsp/diagnostics handler — delegate to orchestrator.getAllDiagnostics, sort keys alphabetically (REQ-ARCH-080), catch errors → return {}
    - Lines 46-53: lsp/status handler — delegate to orchestrator.getStatus, catch errors → return []
    - Lines 55-62: lsp/shutdown handler — delegate to orchestrator.shutdown, catch errors
    - Lines 64-67: connection.listen() and return connection

### Files NOT to Modify

- `packages/lsp/test/rpc-channel.test.ts` — DO NOT MODIFY

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P22
 * @requirement REQ-ARCH-020
 * @requirement REQ-ARCH-070
 * @pseudocode rpc-channel.md lines 10-67
 */
export function createRpcChannel(
  orchestrator: Orchestrator,
  input: ReadableStream,
  output: WritableStream
): MessageConnection {
  // Implementation following pseudocode
}
```

## Verification Commands

### Automated Checks

```bash
# All tests pass
cd packages/lsp && bunx vitest run test/rpc-channel.test.ts
# Expected: All pass

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P22" packages/lsp/src/channels/rpc-channel.ts | wc -l
# Expected: 1+

# No test modifications
git diff packages/lsp/test/rpc-channel.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified" || echo "PASS"

# Pseudocode compliance
grep -c "@pseudocode" packages/lsp/src/channels/rpc-channel.ts
# Expected: 1+

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|return \[\]|return \{\})" packages/lsp/src/channels/rpc-channel.ts | grep -v "catch"
# Expected: Only in catch blocks (error fallbacks), not in main path

# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit

# Lint
cd packages/lsp && bunx eslint src/channels/rpc-channel.ts
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/lsp/src/channels/rpc-channel.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/lsp/src/channels/rpc-channel.ts
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe: createRpcChannel creates a MessageConnection, registers 4 request handlers that delegate to orchestrator, and starts listening]

##### Does it satisfy the requirements?
- [ ] REQ-ARCH-020: Uses vscode-jsonrpc StreamMessageReader/Writer on stdin/stdout — cite import and connection creation
- [ ] REQ-ARCH-070: All 4 methods registered (checkFile, diagnostics, status, shutdown) — cite each onRequest call
- [ ] REQ-ARCH-080: Diagnostics method sorts file keys alphabetically — cite sort code in diagnostics handler

##### Data flow trace
[Trace: incoming JSON-RPC request on stdin → reader → connection → handler → orchestrator.method() → result → writer → stdout response]

##### Error handling
- [ ] Every handler has try/catch
- [ ] checkFile returns [] on error
- [ ] diagnostics returns {} on error
- [ ] status returns [] on error
- [ ] shutdown catches but doesn't return error
- [ ] No errors propagate to crash the connection

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
cd packages/lsp && bunx vitest run test/rpc-channel.test.ts
# Expected: All pass — JSON-RPC handlers delegate correctly and return expected shapes
```

#### Integration Points Verified
- [ ] createRpcChannel receives shared Orchestrator from main.ts
- [ ] vscode-jsonrpc MessageConnection created on provided streams
- [ ] Each handler delegates to correct Orchestrator method
- [ ] connection.listen() starts processing

#### Lifecycle Verified
- [ ] connection.listen() called to start the channel
- [ ] lsp/shutdown handler calls orchestrator.shutdown() and then process.exit()
- [ ] Connection properly disposed when process exits
- [ ] No dangling event listeners

#### Edge Cases Verified
- [ ] Orchestrator throws → handler catches, returns fallback ([], {}, [])
- [ ] lsp/shutdown handler calls orchestrator.shutdown() even on error
- [ ] lsp/diagnostics sorts keys alphabetically before returning

## Success Criteria
- All RPC channel tests pass
- No test files modified
- All 4 JSON-RPC methods implemented
- Error handling in every handler
- Deterministic key ordering in diagnostics response
- No deferred implementation patterns

## Failure Recovery
1. `git checkout -- packages/lsp/src/channels/rpc-channel.ts`
2. Do NOT revert tests
3. Re-run Phase 21

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P22.md`
