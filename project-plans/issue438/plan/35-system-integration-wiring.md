# Phase 35: System Integration Wiring

## Phase ID
`PLAN-20250212-LSP.P35`

## Prerequisites
- Required: Phase 34a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P34" packages/core/`
- Expected: All individual components implemented and tested:
  - packages/lsp: orchestrator, channels, main entry point
  - packages/core: LspServiceClient, edit/write integration, config integration, status command
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

This is the **MANDATORY integration phase** per PLAN.md. It verifies that all components work together as a system, not just individually. No new code is created — this phase wires together everything from Phases 03-32 and verifies the complete data flow.

### System Integration Verification Points

1. **Config → LspServiceClient → LSP Service**:
   Config.initialize() creates LspServiceClient, calls start(), which spawns Bun subprocess running packages/lsp/src/main.ts

2. **Edit Tool → LspServiceClient → LSP Service → Diagnostics**:
   edit.ts calls getLspServiceClient().checkFile() → JSON-RPC to LSP service → orchestrator.checkFile() → language servers → diagnostics back to edit tool → appended to llmContent

3. **Write Tool → LspServiceClient → LSP Service → Multi-File Diagnostics**:
   write-file.ts calls checkFile() + getAllDiagnostics() → multi-file diagnostics formatted and appended

4. **MCP → Navigation Tools → Orchestrator → Language Servers**:
   Direct MCP SDK Client connects to fd3/fd4 via custom Transport → MCP tools available → LLM calls lsp_goto_definition → MCP channel → orchestrator → language server → formatted result

5. **Graceful Degradation**:
   Without Bun → all tools work normally, no diagnostics, no errors
   LSP crash → tools continue, no diagnostics, no errors

6. **Shutdown**:
   Session end → Config cleanup → LspServiceClient.shutdown() → JSON-RPC lsp/shutdown → orchestrator.shutdown() → all language servers stopped → subprocess killed

## Implementation Tasks

### Files to Create

- `packages/core/src/lsp/__tests__/system-integration.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P35`
  - System integration tests that verify end-to-end wiring (10+):
    1. Config initializes LspServiceClient on startup (when Bun available)
    2. Config skips LspServiceClient when `lsp: false`
    3. Edit tool invocation → checkFile called on LspServiceClient → diagnostics in llmContent
    4. Write tool invocation → checkFile + getAllDiagnostics → multi-file diagnostics in llmContent
    5. Config shutdown → LspServiceClient shutdown called → subprocess terminated
    6. getLspServiceClient() returns same instance across multiple calls
    7. getLspConfig() returns config values that match what was passed to initialize
    8. Without Bun available → edit tool succeeds without diagnostics
    9. LSP service crash mid-session → subsequent edits succeed without diagnostics
    10. MCP navigation tools registered when navigationTools not false
    11. MCP navigation tools NOT registered when navigationTools is false
    12. /lsp status returns data from LspServiceClient.status()
  - These tests exercise REAL component interactions (not mocks)
  - May use test fixtures or controlled environments

### Verification of Existing Wiring

```bash
# Verify Config imports LspServiceClient
grep "import.*LspServiceClient" packages/core/src/config/config.ts && echo "PASS" || echo "FAIL"

# Verify edit.ts accesses getLspServiceClient
grep "getLspServiceClient" packages/core/src/tools/edit.ts && echo "PASS" || echo "FAIL"

# Verify write-file.ts accesses getLspServiceClient
grep "getLspServiceClient" packages/core/src/tools/write-file.ts && echo "PASS" || echo "FAIL"

# Verify Config has shutdown for LSP
grep "lspServiceClient.*shutdown\|shutdown.*lspServiceClient" packages/core/src/config/config.ts && echo "PASS" || echo "FAIL"

# Verify LspServiceClient spawns the correct entry point
grep "main.ts\|lsp.*main\|packages/lsp" packages/core/src/lsp/lsp-service-client.ts && echo "PASS" || echo "FAIL"

# Verify main.ts creates shared orchestrator
COUNT=$(grep -c "new Orchestrator" packages/lsp/src/main.ts)
[ "$COUNT" -eq 1 ] && echo "PASS: single orchestrator" || echo "FAIL: $COUNT instances"

# Verify main.ts passes orchestrator to both channels
grep "createRpcChannel.*orchestrator\|orchestrator.*createRpcChannel" packages/lsp/src/main.ts && echo "PASS: RPC" || echo "FAIL: RPC"
grep "createMcpChannel.*orchestrator\|orchestrator.*createMcpChannel" packages/lsp/src/main.ts && echo "PASS: MCP" || echo "FAIL: MCP"
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P35
 * System integration wiring tests
 */
```

## Verification Commands

### Automated Checks

```bash
# System integration tests pass
npx vitest run packages/core/src/lsp/__tests__/system-integration.test.ts
# Expected: All pass

# ALL existing tests still pass
cd packages/core && npm test
# Expected: All pass (zero regressions)

# LSP package tests still pass
cd packages/lsp && bunx vitest run
# Expected: All pass

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P35" packages/core/ | wc -l
# Expected: 1+

# Full TypeScript compilation
cd packages/core && npx tsc --noEmit
cd packages/lsp && bunx tsc --noEmit
```

### Deferred Implementation Detection (MANDATORY)

```bash
# System integration phase - check ALL modified files for deferred patterns:
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/lsp/ packages/core/src/tools/edit.ts packages/core/src/tools/write-file.ts packages/core/src/tools/apply-patch.ts packages/core/src/config/config.ts | grep -v test | grep -v __tests__
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/lsp/ packages/core/src/tools/edit.ts packages/core/src/tools/write-file.ts | grep -v test
# Expected: No matches

grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/lsp/src/ | grep -v test
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### End-to-End Data Flow Verification

##### Config → Service Startup
- [ ] Config reads `lsp` option from user settings
- [ ] Config creates LspServiceClient with config and workspaceRoot
- [ ] LspServiceClient.start() spawns Bun subprocess
- [ ] Subprocess runs packages/lsp/src/main.ts
- [ ] main.ts creates shared Orchestrator
- [ ] main.ts sets up RPC channel on stdin/stdout
- [ ] main.ts sets up MCP channel on fd3/fd4 (if navigationTools not false)
- [ ] Config registers MCP navigation via direct MCP SDK Client.connect(fdTransport) (if alive and navTools enabled)

##### Edit → Diagnostics Flow
- [ ] edit.ts calls config.getLspServiceClient()
- [ ] Checks isAlive() before proceeding
- [ ] Calls checkFile(filePath) which sends JSON-RPC lsp/checkFile
- [ ] LSP service orchestrator routes to correct language servers
- [ ] Language servers produce diagnostics
- [ ] Diagnostics returned via JSON-RPC response
- [ ] edit.ts filters, formats, and appends to llmContent
- [ ] try/catch ensures edit never fails on LSP error

##### Write → Multi-File Diagnostics Flow
- [ ] write-file.ts calls checkFile first, then getAllDiagnostics
- [ ] Multi-file diagnostics include written file + known affected files
- [ ] Caps and ordering applied correctly

##### Graceful Degradation
- [ ] No Bun → start() sets alive=false → no diagnostics → no errors
- [ ] No LSP package → start() sets alive=false → no diagnostics → no errors
- [ ] Service crash → alive=false → no diagnostics → no restart → no errors
- [ ] LSP disabled in config → no service created → tools work normally

##### Shutdown
- [ ] Session end → Config cleanup → LspServiceClient.shutdown()
- [ ] shutdown() sends lsp/shutdown → SIGTERM → SIGKILL
- [ ] All language servers stopped
- [ ] References cleaned up (no memory leaks)

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
# End-to-end wiring test (requires Bun):
npx vitest run packages/core/src/lsp/__tests__/system-integration.test.ts
# Expected: All tests pass — complete data flow verified
```

#### Integration Points Verified
- [ ] Config → LspServiceClient: config.ts creates and calls start()
- [ ] LspServiceClient → LSP Service: subprocess spawned with correct stdio
- [ ] Edit tool → LspServiceClient: edit.ts calls getLspServiceClient().checkFile()
- [ ] Write tool → LspServiceClient: write-file.ts calls checkFile() + getAllDiagnostics()
- [ ] MCP → Direct MCP SDK Client: fd3/fd4 streams registered via custom Transport for navigation tools
- [ ] Shutdown chain: Config.cleanup → LspServiceClient.shutdown → lsp/shutdown → orchestrator.shutdown

#### Lifecycle Verified
- [ ] Startup order: Config.initialize → LspServiceClient.start → Bun subprocess → channels ready
- [ ] Shutdown order: Config.cleanup → LspServiceClient.shutdown → subprocess exit → cleanup
- [ ] No orphaned subprocesses after shutdown
- [ ] All async operations properly awaited

#### Edge Cases Verified
- [ ] Bun not available → entire LSP chain disabled, tools work normally
- [ ] Service crashes mid-session → tools continue without diagnostics
- [ ] Config has `lsp: false` → no subprocess spawned, tools work normally
- [ ] Multiple rapid edits → diagnostic collection not queued/blocked

## Success Criteria
- All system integration tests pass
- All existing tests pass (zero regressions)
- End-to-end data flow verified from Config → edit/write → LspServiceClient → LSP service → diagnostics
- Graceful degradation verified
- Shutdown verified

## Failure Recovery
1. `git checkout -- packages/core/src/lsp/__tests__/system-integration.test.ts`
2. If integration issues found, identify which phase introduced them
3. Fix at the source phase, then re-verify Phase 33

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P35.md`
