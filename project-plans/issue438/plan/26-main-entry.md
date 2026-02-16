# Phase 26: Main Entry Point

## Phase ID
`PLAN-20250212-LSP.P26`

## Prerequisites
- Required: Phase 25a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P25" packages/lsp/src/channels/mcp-channel.ts`
- Expected: Both RPC and MCP channels fully implemented
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

### REQ-ARCH-010: Separate Bun-Native Process
**Full Text**: The system shall run the LSP subsystem in a separate Bun-native child process, isolated from the main LLxprt agent process (Node.js).
**Behavior**:
- GIVEN: `packages/lsp/src/main.ts` is the entry point
- WHEN: Spawned via `bun run packages/lsp/src/main.ts`
- THEN: The process sets up both communication channels and is ready to receive requests
**Why This Matters**: Process isolation ensures LSP server crashes don't bring down the main agent.

### REQ-ARCH-040: Shared Orchestrator
**Full Text**: The system shall share a single LSP orchestrator instance and a single set of language server connections between the diagnostic channel and the navigation tool channel within the LSP service process.
**Behavior**:
- GIVEN: main.ts creates one Orchestrator instance
- WHEN: Both RPC channel and MCP channel are set up
- THEN: Both channels receive the same orchestrator reference
**Why This Matters**: Prevents duplicate language server processes, ensures diagnostics and navigation share state.

### REQ-LIFE-040: Session End Shutdown
**Full Text**: When the LLxprt session ends, the system shall shut down all running LSP servers.
**Behavior**:
- GIVEN: LSP service is running with active language servers
- WHEN: SIGTERM signal is received
- THEN: orchestrator.shutdown() is called, MCP server closed, RPC connection disposed, process exits
**Why This Matters**: Clean resource cleanup on session end prevents orphaned language server processes.

### REQ-LIFE-060: Cleanup Prevents Memory Leaks
**Full Text**: The system shall clean up diagnostic and file tracking maps to prevent memory leaks.

### REQ-CFG-070: Navigation Tools Optional
**Full Text**: Where LSP is enabled, the system shall allow users to disable navigation tools independently of diagnostic feedback via `"lsp": { "navigationTools": false }`.
**Behavior**:
- GIVEN: Config has `navigationTools: false`
- WHEN: main.ts starts
- THEN: RPC channel is set up (diagnostics work), MCP channel is NOT set up (no navigation tools)

## Implementation Tasks

### Files to Create

- `packages/lsp/src/main.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P26`
  - MUST include: `@requirement:REQ-ARCH-010`, `@requirement:REQ-ARCH-040`
  - MUST follow pseudocode `main-entry.md` line-by-line:
    - Lines 03-06: Logger initialization
    - Lines 12-23: [RESEARCH DD-2] Parse LSP_BOOTSTRAP env var (JSON with workspaceRoot + config), exit if missing or invalid
    - Lines 24-35: Create shared components (ServerRegistry, LanguageMap, Orchestrator) — single orchestrator (REQ-ARCH-040)
    - Lines 39-43: Create RPC channel on process.stdin/stdout
    - Lines 47-61: Conditionally create MCP channel on fd3/fd4 (skip if navigationTools is false)
    - Lines 65-81: Signal handlers (SIGTERM, SIGINT) — orchestrator.shutdown(), close MCP, dispose RPC, exit
    - Lines 85-93: Uncaught exception / unhandled rejection handlers — log but don't exit
    - Lines 95-95d: [RESEARCH DD-1] Send `lsp/ready` notification on stdout RPC connection as last step before blocking
    - Lines 99-102: main().catch → fatal error → process.exit(1)
    - Lines 106-111: createReadStreamFromFd / createWriteStreamFromFd helpers

### Files to Create (Tests)

- `packages/lsp/test/main.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P26`
  - Tests (9+):
    1. [RESEARCH DD-2] Exits with error if LSP_BOOTSTRAP not set
    2. [RESEARCH DD-2] Parses LSP_BOOTSTRAP JSON with workspaceRoot and config
    3. [RESEARCH DD-2] Exits if LSP_BOOTSTRAP is invalid JSON: GIVEN LSP_BOOTSTRAP with malformed JSON WHEN service starts THEN writes error to stderr AND exits with code 1
    4. [RESEARCH DD-2] Exits if LSP_BOOTSTRAP missing workspaceRoot: GIVEN LSP_BOOTSTRAP with missing workspaceRoot WHEN service starts THEN writes error to stderr AND exits with code 1
    5. [RESEARCH DD-2] Uses default config if LSP_BOOTSTRAP.config is absent
    6. [RESEARCH DD-2] Exits if LSP_BOOTSTRAP has invalid field types: GIVEN LSP_BOOTSTRAP with diagnosticTimeout as string WHEN service starts THEN writes validation error to stderr AND exits with code 1
    7. Creates single shared orchestrator for both channels
    8. Skips MCP channel when navigationTools is false
    9. Signal handler calls orchestrator.shutdown
    10. [RESEARCH DD-1] Sends lsp/ready notification on RPC connection after setup
  - Tests may need to spawn the main.ts as subprocess or test exported helpers

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P26
 * @requirement REQ-ARCH-010
 * @requirement REQ-ARCH-040
 * @pseudocode main-entry.md lines 05-102
 */
```

## Verification Commands

### Automated Checks

```bash
# Files exist
test -f packages/lsp/src/main.ts && echo "PASS" || echo "FAIL"
test -f packages/lsp/test/main.test.ts && echo "PASS" || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P26" packages/lsp/src/main.ts | wc -l
# Expected: 1+

# Requirement markers
grep -r "@requirement:REQ-ARCH-010" packages/lsp/src/main.ts | wc -l
# Expected: 1+

# Pseudocode reference
grep "@pseudocode" packages/lsp/src/main.ts
# Expected: 1+

# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/lsp/src/main.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/lsp/src/main.ts
# Expected: No matches
```

### Continued Automated Checks

```bash
# Uses shared orchestrator (single instance)
grep -c "new Orchestrator" packages/lsp/src/main.ts
# Expected: Exactly 1

# Signal handlers
grep -c "SIGTERM\|SIGINT" packages/lsp/src/main.ts
# Expected: 2+

# navigationTools conditional
grep "navigationTools" packages/lsp/src/main.ts
# Expected: 1+ (conditional MCP channel setup)

# Tests
cd packages/lsp && bunx vitest run test/main.test.ts
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe: main.ts entry point that parses env config, creates shared orchestrator, sets up RPC and MCP channels, handles signals]

##### Does it satisfy the requirements?
- [ ] REQ-ARCH-010: main.ts is the Bun entry point — cite the file and package.json main field
- [ ] REQ-ARCH-040: Single Orchestrator passed to both channels — cite the variable passed to createRpcChannel and createMcpChannel
- [ ] REQ-LIFE-040: SIGTERM/SIGINT handlers call orchestrator.shutdown — cite signal handler code
- [ ] REQ-CFG-070: MCP channel skipped when navigationTools is false — cite conditional check

##### Error resilience
- [ ] LSP_BOOTSTRAP parse failure writes error to stderr and exits with code 1
- [ ] MCP channel setup failure is non-fatal (diagnostics still work)
- [ ] Uncaught exceptions logged but don't exit process
- [ ] Fatal error in main() exits with code 1

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
# Run main.ts subprocess with test config:
cd packages/lsp && LSP_BOOTSTRAP='{"workspaceRoot":"/tmp/test-workspace","config":{}}' timeout 5 bun run src/main.ts 2>&1 || true
# Expected: Process starts, listens for RPC (blocks on stdin), exits on timeout
# Verify: No crash, no error output

# Tests pass:
cd packages/lsp && bunx vitest run test/main.test.ts
# Expected: All pass
```

#### Integration Points Verified
- [ ] main.ts is referenced in package.json "main" field
- [ ] LspServiceClient spawns `bun run packages/lsp/src/main.ts`
- [ ] Shared Orchestrator instance flows to both channels
- [ ] RPC channel on stdin/stdout, MCP channel on fd3/fd4

#### Lifecycle Verified
- [ ] Process starts cleanly with valid env
- [ ] SIGTERM triggers orchestrator.shutdown()
- [ ] Invalid config → defaults used, no crash

#### Edge Cases Verified
- [ ] [RESEARCH DD-2] Missing LSP_BOOTSTRAP → error with clear message and exit (code 1)
- [ ] [RESEARCH DD-2] LSP_BOOTSTRAP with missing workspaceRoot → error to stderr and exit (code 1)
- [ ] [RESEARCH DD-2] LSP_BOOTSTRAP with missing config → defaults used, no error
- [ ] [RESEARCH DD-2] Malformed LSP_BOOTSTRAP JSON → error to stderr and exit (code 1)
- [ ] [RESEARCH DD-2] LSP_BOOTSTRAP with invalid field types (e.g., diagnosticTimeout as string) → validation error to stderr and exit (code 1)
- [ ] navigationTools: false → MCP channel not created, RPC still works
- [ ] fd3/fd4 not available → MCP channel skipped with warning
- [ ] [RESEARCH DD-1] lsp/ready notification sent after all channels initialized

## Success Criteria
- main.ts creates and wires all components
- Single orchestrator shared between channels
- Signal handlers for graceful shutdown
- MCP channel conditionally created
- Tests verify key behaviors
- No deferred implementation patterns

## Failure Recovery
1. `git checkout -- packages/lsp/src/main.ts packages/lsp/test/main.test.ts`
2. Re-run Phase 24

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P26.md`
