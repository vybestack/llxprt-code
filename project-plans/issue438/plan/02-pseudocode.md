# Phase 02: Pseudocode Development

## Phase ID
`PLAN-20250212-LSP.P02`

## Prerequisites
- Required: Phase 01a analysis verification completed
- Verification: `test -f project-plans/issue438/.completed/P01a.md`
- Expected files from previous phase: `analysis/domain-model.md`
- Preflight verification: Phase 00a MUST be completed before any implementation phase

## Requirements Implemented (Expanded)

This phase creates detailed pseudocode for all components. The pseudocode MUST be referenced by line number in all subsequent implementation phases. No requirements are directly implemented — pseudocode is the blueprint.

## Implementation Tasks

### Files to Create

All pseudocode files go under `analysis/pseudocode/`:

1. **`lsp-service-client.md`** — Core-side thin client (packages/core)
   - MUST have numbered lines
   - MUST include Interface Contracts, Integration Points, Anti-Pattern Warnings
   - Covers: Bun subprocess spawning, JSON-RPC connection, checkFile/getAllDiagnostics/status/shutdown

2. **`orchestrator.md`** — Central coordinator (packages/lsp)
   - Covers: Lazy startup, server routing, parallel diagnostic collection, workspace boundaries, navigation delegation

3. **`lsp-client.md`** — Single LSP server connection (packages/lsp)
   - Covers: Initialize handshake, didOpen/didChange, publishDiagnostics listener, debounce, waitForDiagnostics

4. **`diagnostics.md`** — Diagnostic formatting (packages/lsp)
   - Covers: Normalization, severity mapping, XML escaping, deduplication, per-file/multi-file formatting, cap ordering

5. **`server-registry.md`** — Built-in server configs (packages/lsp)
   - Covers: TypeScript, ESLint, Go, Python, Rust configs, extension index, user config merging

6. **`language-map.md`** — Extension-to-languageId mapping (packages/lsp)
   - Covers: ReadonlyMap of ~60 extension→languageId entries

7. **`rpc-channel.md`** — JSON-RPC handler (packages/lsp)
   - Covers: Request handlers for lsp/checkFile, lsp/diagnostics, lsp/status, lsp/shutdown

8. **`mcp-channel.md`** — MCP server (packages/lsp)
   - Covers: Tool definitions for 6 navigation tools, workspace boundary validation

9. **`main-entry.md`** — LSP service entry point (packages/lsp)
   - Covers: Orchestrator creation, channel setup, signal handling

10. **`edit-integration.md`** — Edit tool diagnostic integration (packages/core)
    - Covers: Append diagnostics to llmSuccessMessageParts, single-file scope

11. **`write-integration.md`** — Write tool diagnostic integration (packages/core)
    - Covers: Multi-file diagnostics, known-files set, caps, ordering

12. **`config-integration.md`** — Config schema extensions (packages/core)
    - Covers: LspConfig type, Config class additions, service lifecycle

### Files to Modify

None.

### Required Code Markers

N/A — pseudocode phase, no production code.

### Pseudocode Format Requirements

Every pseudocode file MUST have:

1. **Numbered lines** (01, 02, 03, ...) for reference in implementation phases
2. **Interface Contracts section** with INPUTS, OUTPUTS, DEPENDENCIES
3. **Integration Points section** with line-by-line call details
4. **Anti-Pattern Warnings section** with ERROR/OK pairs

## Verification Commands

### Automated Checks

```bash
# Verify all pseudocode files exist
for file in lsp-service-client orchestrator lsp-client diagnostics server-registry language-map rpc-channel mcp-channel main-entry edit-integration write-integration config-integration; do
  test -f "project-plans/issue438/analysis/pseudocode/${file}.md" && echo "PASS: ${file}" || echo "FAIL: missing ${file}"
done

# Verify numbered lines in each file
for file in project-plans/issue438/analysis/pseudocode/*.md; do
  grep -c "^[0-9][0-9]:" "$file" > /dev/null && echo "PASS: $(basename $file) has numbered lines" || echo "FAIL: $(basename $file) missing numbered lines"
done

# Verify interface contracts in each file
for file in project-plans/issue438/analysis/pseudocode/*.md; do
  grep -c "Interface Contracts" "$file" > /dev/null && echo "PASS: $(basename $file)" || echo "FAIL: $(basename $file) missing Interface Contracts"
done

# Verify anti-pattern warnings in each file
for file in project-plans/issue438/analysis/pseudocode/*.md; do
  grep -c "Anti-Pattern Warnings" "$file" > /dev/null && echo "PASS: $(basename $file)" || echo "FAIL: $(basename $file) missing Anti-Pattern Warnings"
done
```

### Structural Verification Checklist
- [ ] All 12 pseudocode files exist
- [ ] Every file has numbered lines
- [ ] Every file has Interface Contracts section
- [ ] Every file has Integration Points section
- [ ] Every file has Anti-Pattern Warnings section
- [ ] No actual TypeScript implementation code (pseudocode only)

### Deferred Implementation Detection (MANDATORY)

N/A — Pseudocode phase produces design documentation only, not implementation code. No deferred-implementation risk. However, pseudocode files should NOT contain actual TypeScript — that would indicate premature implementation.

```bash
# Verify no actual TypeScript implementation leaked into pseudocode
for file in project-plans/issue438/analysis/pseudocode/*.md; do
  grep -c "import {" "$file" && echo "WARNING: $(basename $file) may contain real imports"
done
# Expected: No matches — pseudocode uses plain-language descriptions, not real imports
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do the pseudocode algorithms cover all requirements?** — Cross-reference REQ-* tags
2. **Are integration points explicit?** — Each cross-component call has line number, caller, callee, data type
3. **Do anti-patterns reference real risks?** — Not generic warnings, but project-specific risks
4. **Is the pseudocode implementable?** — Can a worker follow it line-by-line without ambiguity?

#### Feature Actually Works

```bash
# Pseudocode phase — verify artifacts are substantive:
for file in project-plans/issue438/analysis/pseudocode/*.md; do
  LINES=$(wc -l < "$file")
  echo "$(basename $file): $LINES lines"
done
# Expected: Each file has 50+ lines of substantive pseudocode

# Verify numbered pseudocode coverage
for file in project-plans/issue438/analysis/pseudocode/*.md; do
  COUNT=$(grep -cE "^[0-9]{2,3}:" "$file" 2>/dev/null || echo "0")
  echo "$(basename $file): $COUNT numbered lines"
done
# Expected: Each file has 20+ numbered pseudocode lines
```

#### Integration Points Verified
- [ ] lsp-service-client.md references orchestrator.md methods (checkFile, getAllDiagnostics, status, shutdown)
- [ ] orchestrator.md references lsp-client.md (touchFile, waitForDiagnostics, gotoDefinition, etc.)
- [ ] orchestrator.md references server-registry.md (getServersForExtension)
- [ ] orchestrator.md references language-map.md (getLanguageIdForFile)
- [ ] rpc-channel.md references orchestrator.md (delegating RPC requests)
- [ ] mcp-channel.md references orchestrator.md (delegating MCP tool calls)
- [ ] main-entry.md references rpc-channel.md, mcp-channel.md, orchestrator.md
- [ ] edit-integration.md references lsp-service-client.md (checkFile)
- [ ] write-integration.md references lsp-service-client.md (checkFile, getAllDiagnostics)
- [ ] config-integration.md references lsp-service-client.md (start, shutdown, getMcpTransportStreams)

#### Lifecycle Verified
- [ ] Startup sequence documented across pseudocode files (config → service-client → main → orchestrator → lazy servers)
- [ ] Shutdown sequence documented (config → service-client → main → orchestrator → servers)
- [ ] Crash handling documented (lsp-client crash → orchestrator marks broken)

#### Edge Cases Verified
- [ ] Binary file handling in edit-integration.md / write-integration.md
- [ ] First-touch timeout vs normal timeout in orchestrator.md / lsp-client.md
- [ ] Multiple servers per extension in orchestrator.md / server-registry.md
- [ ] Workspace boundary rejection in orchestrator.md / mcp-channel.md

## Success Criteria
- All 12 pseudocode files exist with proper structure
- Numbered lines allow precise reference from implementation phases
- Interface contracts define clear boundaries between components
- Anti-pattern warnings prevent known failure modes

## Failure Recovery
If this phase fails:
1. Identify missing or malformed pseudocode files
2. Re-run Phase 02 for specific files
3. Cannot proceed to Phase 02.5 until all files exist and are verified

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P02.md`
