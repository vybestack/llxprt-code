# Phase 23: MCP Channel Stub

## Phase ID
`PLAN-20250212-LSP.P23`

## Prerequisites
- Required: Phase 22a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P22" packages/lsp/src/channels/rpc-channel.ts`
- Expected: RPC channel fully implemented
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

### REQ-NAV-010: Navigation Tools Exposed via MCP
**Full Text**: Where LSP is enabled and navigation tools are not disabled, the system shall expose the following tools to the LLM via MCP: `lsp_goto_definition`, `lsp_find_references`, `lsp_hover`, `lsp_document_symbols`, `lsp_workspace_symbols`, and `lsp_diagnostics`.
**Behavior**:
- GIVEN: LSP is enabled and `navigationTools` is not `false`
- WHEN: The MCP channel is set up on fd3/fd4
- THEN: All 6 navigation tools are registered with typed schemas
**Why This Matters**: Navigation tools give the LLM deeper code understanding, enabling more accurate edits.

### REQ-NAV-030: Workspace Boundary Checks
**Full Text**: The system shall enforce workspace boundary checks on all navigation tool file path parameters.
**Behavior**:
- GIVEN: workspaceRoot is "/project"
- WHEN: A tool receives a file path outside the workspace
- THEN: Returns an error, does not forward to LSP servers

### REQ-NAV-040: Path Normalization
**Full Text**: The system shall normalize file paths passed to navigation tools before checking workspace boundaries.

### REQ-NAV-050: Hide MCP Tools When Disabled
**Full Text**: Where `lsp.navigationTools` is set to `false`, the system shall hide LSP navigation tools from the LLM while preserving diagnostic feedback functionality.
**Behavior**:
- GIVEN: Config has `navigationTools: false`
- WHEN: MCP channel initialization is attempted
- THEN: MCP channel is not created, no tools registered; diagnostic channel (RPC) still works
**Why This Matters**: Users may want diagnostics without cluttering the LLM's tool list.

### REQ-ARCH-030: MCP Over fd3/fd4
**Full Text**: The system shall use MCP over extra file descriptors (fd3/fd4) for the navigation tool channel between the agent process and the LSP service process.
**Behavior**:
- GIVEN: LSP service process is spawned by core
- WHEN: MCP channel is initialized
- THEN: Reads from fd3, writes to fd4 (extra file descriptors, not stdin/stdout)
**Why This Matters**: Separating MCP from the diagnostic channel (stdin/stdout) avoids protocol multiplexing complexity.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/channels/mcp-channel.ts`
  - MODIFY: Replace minimal stub with typed function skeleton
  - MUST include: `@plan:PLAN-20250212-LSP.P23`
  - Export function `createMcpChannel(orchestrator: Orchestrator, workspaceRoot: string, inputStream: ReadableStream, outputStream: WritableStream): Promise<McpServer>`
  - Register 6 tool stubs: lsp_goto_definition, lsp_find_references, lsp_hover, lsp_document_symbols, lsp_workspace_symbols, lsp_diagnostics
  - Include `validateFilePath(filePath: string, workspaceRoot: string): string` helper
  - Stub handlers: typed signatures, return empty/error results
  - Under 150 lines (pure interface, no implementation logic)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P23
 * @requirement REQ-NAV-010
 * @pseudocode mcp-channel.md lines 01-30
 */
```

## Verification Commands

### Automated Checks

```bash
test -f packages/lsp/src/channels/mcp-channel.ts && echo "PASS" || echo "FAIL"
grep -r "@plan:PLAN-20250212-LSP.P23" packages/lsp/src/channels/mcp-channel.ts | wc -l
# Expected: 1+

# All 6 tools registered
for tool in lsp_goto_definition lsp_find_references lsp_hover lsp_document_symbols lsp_workspace_symbols lsp_diagnostics; do
  grep -q "$tool" packages/lsp/src/channels/mcp-channel.ts && echo "PASS: $tool" || echo "FAIL: $tool missing"
done

# validateFilePath exists
grep -q "validateFilePath" packages/lsp/src/channels/mcp-channel.ts && echo "PASS" || echo "FAIL"

# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs may throw or return empty — expected for stub phase. No TODO/FIXME/HACK comments:
grep -rn -E "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP)" packages/lsp/src/channels/mcp-channel.ts
# Expected: No matches

# No cop-out comments:
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/lsp/src/channels/mcp-channel.ts
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/src/channels/mcp-channel.ts | grep -v ".test.ts"
# Expected: For stub phases, empty returns ARE expected (stubs return empty values by design).
# This check is for awareness — confirms stubs are minimal. In the impl phase (P24/P25), these should be gone.
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] REQ-NAV-010: All 6 tools registered with correct names and parameter schemas
   - [ ] REQ-NAV-030: validateFilePath helper present and accepts workspaceRoot
   - [ ] REQ-NAV-040: Path normalization logic present in validateFilePath
   - [ ] REQ-ARCH-030: Function accepts input/output streams for fd3/fd4
2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] For stub phase: stubs are expected to return empty/throw — confirmed minimal
3. **Would the test FAIL if implementation was removed?**
   - [ ] Not applicable for stub phase — tests written in TDD phase (P24)
4. **Is the feature REACHABLE by users?**
   - [ ] createMcpChannel is called during service startup when navigationTools is not false
   - [ ] Tool stubs delegate to orchestrator methods with correct parameter types
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] Full implementation is deferred to the impl phase (P24/P25) — this is by design
   - [ ] [List any unexpected gaps]

#### Feature Actually Works

```bash
# Stub phase — verify function compiles and is importable:
cd packages/lsp && bunx tsc --noEmit
# Expected: Clean compilation
```

#### Integration Points Verified
- [ ] createMcpChannel accepts Orchestrator instance (shared with RPC channel per REQ-ARCH-040)
- [ ] createMcpChannel accepts ReadableStream/WritableStream for fd3/fd4
- [ ] Tool stubs delegate to orchestrator methods with correct parameter types
- [ ] validateFilePath uses workspaceRoot for boundary checks

#### Lifecycle Verified
- [ ] createMcpChannel returns McpServer that can be shut down
- [ ] MCP channel creation is optional (per navigationTools config)
- [ ] No resource leaks in stubs

#### Edge Cases Verified
- [ ] Not applicable for stub phase — edge cases tested in P24/P25

## Success Criteria
- createMcpChannel function compiles with correct types
- All 6 tool stubs present
- validateFilePath helper present
- TypeScript compiles

## Failure Recovery
1. `git checkout -- packages/lsp/src/channels/mcp-channel.ts`
2. Re-run Phase 23

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P23.md`
