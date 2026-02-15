# Phase 20: RPC Channel Stub

## Phase ID
`PLAN-20250212-LSP.P20`

## Prerequisites
- Required: Phase 19a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P19" packages/lsp/src/service/orchestrator.ts`
- Expected: Orchestrator fully implemented

## Requirements Implemented (Expanded)

### REQ-ARCH-020: JSON-RPC over stdin/stdout
**Full Text**: The system shall use JSON-RPC over stdin/stdout for the internal diagnostic channel.
**Behavior**:
- GIVEN: The LSP service process is running
- WHEN: Core sends a `lsp/checkFile` JSON-RPC request on stdin
- THEN: The RPC channel delegates to orchestrator.checkFile() and returns the result on stdout
**Why This Matters**: The RPC channel is the internal plumbing that connects the core agent process to the LSP service for diagnostic queries.

### REQ-ARCH-070: JSON-RPC Methods
**Full Text**: The system shall expose lsp/checkFile, lsp/diagnostics, lsp/status, and lsp/shutdown.
**Behavior**:
- GIVEN: RPC channel is set up
- WHEN: Each method is called
- THEN: Delegates to the corresponding orchestrator method
**Why This Matters**: These 4 methods form the complete internal API surface between core and the LSP service.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/channels/rpc-channel.ts`
  - MODIFY: Replace stub with typed function skeleton
  - MUST include: `@plan:PLAN-20250212-LSP.P20`
  - Export function `setupRpcChannel(connection: MessageConnection, orchestrator: Orchestrator): void`
  - Registers 4 request handlers as stubs: lsp/checkFile, lsp/diagnostics, lsp/status, lsp/shutdown
  - Stub handlers: typed signatures, throw or return empty results
  - Under 60 lines (pure interface, no implementation logic)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P20
 * @requirement REQ-ARCH-070
 * @pseudocode rpc-channel.md lines 01-22
 */
```

## Verification Commands

### Automated Checks

```bash
# File exists and has stub structure
test -f packages/lsp/src/channels/rpc-channel.ts && echo "PASS" || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P20" packages/lsp/src/channels/rpc-channel.ts | wc -l
# Expected: 1+

# All 4 methods registered
for method in checkFile diagnostics status shutdown; do
  grep -q "$method" packages/lsp/src/channels/rpc-channel.ts && echo "PASS: $method" || echo "FAIL: $method missing"
done

# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs may throw or return empty — expected for stub phase. No TODO/FIXME/HACK comments:
grep -rn -E "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP)" packages/lsp/src/channels/rpc-channel.ts
# Expected: No matches

# No cop-out comments:
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/lsp/src/channels/rpc-channel.ts
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/src/channels/rpc-channel.ts | grep -v ".test.ts"
# Expected: For stub phases, empty returns ARE expected (stubs return empty values by design).
# This check is for awareness — confirms stubs are minimal. In the impl phase (P21/P22), these should be gone.
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] REQ-ARCH-020: Function accepts MessageConnection (stdin/stdout) — cite parameter type
   - [ ] REQ-ARCH-070: All 4 methods present (checkFile, diagnostics, status, shutdown) — cite handler registrations
2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] For stub phase: stubs are expected to return empty/throw — confirmed minimal
3. **Would the test FAIL if implementation was removed?**
   - [ ] Not applicable for stub phase — tests written in TDD phase (P21)
4. **Is the feature REACHABLE by users?**
   - [ ] setupRpcChannel is called during service startup (main.ts)
   - [ ] Handler stubs call orchestrator methods with correct parameter types
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] Full implementation is deferred to the impl phase (P21/P22) — this is by design
   - [ ] [List any unexpected gaps]

#### Feature Actually Works

```bash
# Stub phase — verify function compiles and is importable:
cd packages/lsp && bunx tsc --noEmit
# Expected: Clean compilation
```

#### Integration Points Verified
- [ ] setupRpcChannel accepts MessageConnection from vscode-jsonrpc (verified by import)
- [ ] setupRpcChannel accepts Orchestrator instance (verified by parameter type)
- [ ] Handler stubs call orchestrator methods with correct parameter types
- [ ] Return types match JSON-RPC wire format (Diagnostic[], Record<string, Diagnostic[]>, ServerStatus[], void)

#### Lifecycle Verified
- [ ] setupRpcChannel is called once during service startup (main.ts)
- [ ] Connection.listen() is called to start listening (or deferred to main.ts)
- [ ] No resource leaks in stub (no processes spawned)

#### Edge Cases Verified
- [ ] Not applicable for stub phase — edge cases tested in P21/P22

## Success Criteria
- setupRpcChannel function compiles with correct types
- All 4 method stubs present
- TypeScript compiles

## Failure Recovery
1. `git checkout -- packages/lsp/src/channels/rpc-channel.ts`
2. Re-run Phase 20

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P20.md`
