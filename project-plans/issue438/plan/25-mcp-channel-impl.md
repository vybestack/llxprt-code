# Phase 25: MCP Channel Implementation

## Phase ID
`PLAN-20250212-LSP.P25`

## Prerequisites
- Required: Phase 24a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P24" packages/lsp/test/mcp-channel.test.ts`
- Expected: MCP channel stub and 12+ tests exist, tests failing on stubs
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

### REQ-NAV-010: Navigation Tools via MCP
**Full Text**: Where LSP is enabled and navigation tools are not disabled, the system shall expose the following tools to the LLM via MCP: `lsp_goto_definition`, `lsp_find_references`, `lsp_hover`, `lsp_document_symbols`, `lsp_workspace_symbols`, and `lsp_diagnostics`.
**Behavior**:
- GIVEN: MCP channel is connected with a live orchestrator
- WHEN: LLM calls `lsp_goto_definition` with file, line, character
- THEN: Orchestrator.gotoDefinition is called, results formatted as `relpath:line:col` per location
**Why This Matters**: Core navigation capability enabling the LLM to understand code structure.

### REQ-NAV-030: Workspace Boundary Enforcement
**Full Text**: The system shall enforce workspace boundary checks on all navigation tool file path parameters, refusing to operate on files outside the workspace root.
**Behavior**:
- GIVEN: workspaceRoot is "/project"
- WHEN: Tool called with file "../../etc/passwd"
- THEN: Returns MCP content with text "Error: File is outside workspace boundary"
**Why This Matters**: Security boundary — prevent LSP operations on arbitrary system files.

### REQ-NAV-040: Path Normalization
**Full Text**: The system shall normalize file paths passed to navigation tools before checking workspace boundaries or forwarding them to LSP servers.

### REQ-NAV-060: lsp_diagnostics Returns Known Files
**Full Text**: When the LLM invokes the `lsp_diagnostics` tool, the system shall return current diagnostics for all known files, using workspace-relative paths and deterministic alphabetical file ordering.

### REQ-BOUNDARY-010: Workspace Boundary at Orchestrator
**Full Text**: The system shall enforce workspace boundary checks at the LSP service (orchestrator) layer, rejecting any files outside the workspace root regardless of what the caller passes.

### REQ-BOUNDARY-030: Normalize Before Checking
**Full Text**: The system shall normalize file paths before checking workspace boundaries.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/channels/mcp-channel.ts`
  - MODIFY: Replace stubs with full implementations
  - MUST include: `@plan:PLAN-20250212-LSP.P25`
  - MUST include: `@requirement:REQ-NAV-010`, `@requirement:REQ-NAV-030`, `@requirement:REQ-NAV-060`
  - MUST follow pseudocode `mcp-channel.md` line-by-line:
    - Lines 01-06: createMcpChannel function signature (orchestrator, workspaceRoot, streams)
    - Lines 07-16: Logger, FdTransport, McpServer instantiation
    - Lines 20-26: validateFilePath — path.resolve + normalize + startsWith check (REQ-NAV-030/040, REQ-BOUNDARY-030)
    - Lines 30-51: lsp_goto_definition tool — validate path, call orchestrator.gotoDefinition, format locations
    - Lines 55-76: lsp_find_references tool — validate path, call orchestrator.findReferences, format locations
    - Lines 80-102: lsp_hover tool — validate path, call orchestrator.hover, return contents or "No hover information"
    - Lines 106-125: lsp_document_symbols tool — validate path, call orchestrator.documentSymbols, format symbols
    - Lines 129-145: lsp_workspace_symbols tool — call orchestrator.workspaceSymbols, format with relative paths
    - Lines 149-164: lsp_diagnostics tool — call orchestrator.getAllDiagnostics, sort keys, format
    - Lines 168-171: server.connect(transport), return server
    - Lines 175-203: Formatting helpers (formatLocation, formatDocumentSymbols, formatWorkspaceSymbols, formatAllDiagnostics)

### Files NOT to Modify

- `packages/lsp/test/mcp-channel.test.ts` — DO NOT MODIFY

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P25
 * @requirement REQ-NAV-010
 * @requirement REQ-NAV-030
 * @pseudocode mcp-channel.md lines 01-203
 */
```

## Verification Commands

### Automated Checks

```bash
# All tests pass
cd packages/lsp && bunx vitest run test/mcp-channel.test.ts
# Expected: All pass

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P25" packages/lsp/src/channels/mcp-channel.ts | wc -l
# Expected: 1+

# No test modifications
git diff packages/lsp/test/mcp-channel.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified" || echo "PASS"

# Pseudocode compliance
grep -c "@pseudocode" packages/lsp/src/channels/mcp-channel.ts
# Expected: 1+
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/lsp/src/channels/mcp-channel.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/lsp/src/channels/mcp-channel.ts
# Expected: No matches

grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/src/channels/mcp-channel.ts
# Expected: No matches in main logic paths (error handlers returning empty are OK)

# Under 800 lines
LINES=$(wc -l < packages/lsp/src/channels/mcp-channel.ts)
[ "$LINES" -le 800 ] && echo "PASS: $LINES" || echo "FAIL: $LINES"

# TypeScript + lint
cd packages/lsp && bunx tsc --noEmit && bunx eslint src/channels/mcp-channel.ts
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe: 6 MCP tools registered with input schemas, workspace boundary validation, formatting helpers for locations/symbols/diagnostics]

##### Does it satisfy the requirements?
- [ ] REQ-NAV-010: All 6 tools registered with correct names — cite each server.tool() call
- [ ] REQ-NAV-030: validateFilePath called before every file-accepting tool — cite calls in handlers
- [ ] REQ-NAV-040: path.resolve + path.normalize in validateFilePath — cite implementation
- [ ] REQ-NAV-060: lsp_diagnostics returns sorted, formatted diagnostics — cite sort and format code
- [ ] REQ-BOUNDARY-010/030: Path normalization and prefix check — cite validateFilePath

##### Data flow trace
[Trace: MCP tool call → validateFilePath → orchestrator.method() → format result → MCP content response]

##### Error handling
- [ ] Every tool handler has try/catch
- [ ] Boundary violation returns error text, not exception
- [ ] Orchestrator errors return error text content
- [ ] null hover result returns "No hover information"
- [ ] Empty results return "No definition found" / "No references found" etc.

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
cd packages/lsp && bunx vitest run test/mcp-channel.test.ts
# Expected: All tests pass — every MCP tool produces output, boundary rejects external paths
```

#### Integration Points Verified
- [ ] createMcpChannel receives shared Orchestrator from main.ts
- [ ] Each tool handler calls correct orchestrator method
- [ ] validateFilePath checks against workspaceRoot
- [ ] FdTransport wraps fd3/fd4 streams for MCP transport

#### Lifecycle Verified
- [ ] MCP server starts and listens on provided transport
- [ ] MCP server can be stopped/disconnected during shutdown
- [ ] No resource leaks (streams properly closed)
- [ ] Tool handlers do not hold references that prevent GC

#### Edge Cases Verified
- [ ] External path (e.g., /etc/passwd) → rejected with error message
- [ ] Non-existent file → orchestrator error propagated as text
- [ ] Empty workspace symbols query → returns empty list
- [ ] Null hover result → "No hover information"

## Success Criteria
- All 12+ MCP channel tests pass
- No test files modified
- All 6 MCP tools fully implemented
- Workspace boundary enforcement on all file-accepting tools
- Formatting helpers produce human-readable output
- No deferred implementation patterns

## Failure Recovery
1. `git checkout -- packages/lsp/src/channels/mcp-channel.ts`
2. Do NOT revert tests
3. Re-run Phase 23

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P25.md`
