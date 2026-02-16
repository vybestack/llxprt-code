# Phase 24: MCP Channel TDD

## Phase ID
`PLAN-20250212-LSP.P24`

## Prerequisites
- Required: Phase 23a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P23" packages/lsp/src/channels/mcp-channel.ts`
- Expected: MCP channel stub with all 6 tool registrations and validateFilePath helper

## Requirements Implemented (Expanded)

### REQ-NAV-010: Navigation Tools Exposed via MCP
**Full Text**: Where LSP is enabled and navigation tools are not disabled, the system shall expose 6 tools to the LLM via MCP.
**Behavior**:
- GIVEN: MCP channel is set up with all 6 tools
- WHEN: Each tool is called with valid parameters
- THEN: Returns correctly formatted results from orchestrator delegation
**Why This Matters**: Tests verify that each MCP tool correctly delegates to the orchestrator and formats results for LLM consumption.

### REQ-NAV-030: Workspace Boundary Checks
**Full Text**: The system shall enforce workspace boundary checks on all navigation tool file path parameters.
**Behavior**:
- GIVEN: workspaceRoot is "/project"
- WHEN: `lsp_goto_definition` is called with file `"../../etc/passwd"`
- THEN: Returns error text "File is outside workspace boundary"

### REQ-NAV-040: Path Normalization
**Behavior**:
- GIVEN: workspaceRoot is "/project"
- WHEN: Path `"src/../src/./foo.ts"` is passed
- THEN: Normalized to `"/project/src/foo.ts"` before boundary check

### REQ-NAV-060: lsp_diagnostics Tool
**Behavior**:
- GIVEN: Servers have diagnostics for files A, B, C
- WHEN: `lsp_diagnostics` is called
- THEN: Returns formatted diagnostics for all files in alphabetical order

### REQ-BOUNDARY-010: Workspace Boundary at Orchestrator Layer
### REQ-BOUNDARY-030: Path Normalization Before Boundary Check

## Implementation Tasks

### Files to Create

- `packages/lsp/test/mcp-channel.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P24`
  - Tests (12+):
    1. lsp_goto_definition delegates to orchestrator.gotoDefinition and returns formatted location
    2. lsp_goto_definition returns formatted location strings (relpath:line:col)
    3. lsp_goto_definition rejects file outside workspace boundary
    4. lsp_find_references delegates to orchestrator.findReferences and returns formatted locations
    5. lsp_find_references returns formatted location list
    6. lsp_find_references rejects external file path
    7. lsp_hover returns type info text from orchestrator
    8. lsp_hover returns "No hover information" for null result
    9. lsp_document_symbols returns formatted symbol list
    10. lsp_document_symbols rejects external file
    11. lsp_workspace_symbols returns formatted workspace-wide symbols
    12. lsp_diagnostics returns all diagnostics formatted with alphabetical file ordering
    13. Path normalization: `../` traversal blocked
    14. Path normalization: `./` sequences resolved
  - Tests call tool handlers via MCP server test harness (in-process, not subprocess)
  - Tests use a controlled orchestrator with known return values
  - Tests assert on RESPONSE CONTENT (formatted text), not on call mechanics
  - Tests FAIL naturally on stubs (stubs return empty/wrong results)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P24
 * @requirement REQ-NAV-010
 * @requirement REQ-NAV-030
 * @pseudocode mcp-channel.md lines 01-90
 */
```

## Verification Commands

### Automated Checks

```bash
# Test file exists
test -f packages/lsp/test/mcp-channel.test.ts && echo "PASS" || echo "FAIL"

# Sufficient tests
TEST_COUNT=$(grep -c "it(" packages/lsp/test/mcp-channel.test.ts)
[ "$TEST_COUNT" -ge 12 ] && echo "PASS: $TEST_COUNT tests" || echo "FAIL: only $TEST_COUNT tests"

# No reverse testing
grep -rn "NotYetImplemented" packages/lsp/test/mcp-channel.test.ts && echo "FAIL" || echo "PASS"

# Has behavioral assertions
grep -c "toBe\|toEqual\|toMatch\|toContain\|toStrictEqual" packages/lsp/test/mcp-channel.test.ts
# Expected: 12+

# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit

# Tests fail naturally on stubs
cd packages/lsp && bunx vitest run test/mcp-channel.test.ts 2>&1 | tail -5
# Expected: Tests FAIL with assertion errors (RED phase)
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/lsp/test/mcp-channel.test.ts
# Expected: No matches — tests are complete, only implementation is missing
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests verify workspace boundary enforcement?** — At least 3 tests with external paths
2. **Do tests verify actual MCP tool response content?** — Formatted text output, not just "method was called"
3. **Do tests cover all 6 tools?** — Each tool has at least 1 happy-path test
4. **Are path normalization tests included?** — `../` traversal and `./` normalization
5. **Does lsp_diagnostics test verify alphabetical ordering?** — Multi-file result ordering

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
# TDD phase — verify tests exist and FAIL naturally on stubs:
cd packages/lsp && bunx vitest run test/mcp-channel.test.ts 2>&1 | tail -20
# Expected: Tests fail with assertion errors (stubs return empty), not import/compile errors
```

#### Integration Points Verified
- [ ] Tests import createMcpChannel from source module
- [ ] Tests provide a real (not mocked) Orchestrator stub
- [ ] Tests verify MCP tool response content text
- [ ] Tests verify workspace boundary rejection message

#### Lifecycle Verified
- [ ] Tests properly set up and tear down MCP server per test/suite
- [ ] No resource leaks (streams closed)
- [ ] Test fixtures cleaned up

#### Edge Cases Verified
- [ ] External path (../../../etc/passwd) → rejected with boundary error
- [ ] Non-existent file → error text response (not crash)
- [ ] Empty workspace symbols query → empty result
- [ ] null hover result → "No hover information" text
- [ ] Path traversal with `./` and `../` → normalized before check
- [ ] lsp_diagnostics with multiple files → alphabetical ordering

## Success Criteria
- 12+ tests covering all 6 tools and boundary checks
- Tests assert on response content (behavioral)
- Tests fail naturally on stubs (RED phase of TDD)
- No reverse testing or mock theater

## Failure Recovery
1. `git checkout -- packages/lsp/test/mcp-channel.test.ts`
2. Re-run Phase 24

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P24.md`
