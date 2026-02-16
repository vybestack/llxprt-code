# Phase 36a: E2E Tests Verification

## Phase ID
`PLAN-20250212-LSP.P36a`

## Prerequisites
- Required: Phase 34 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P36" packages/core/`

## Verification Commands

### Final Comprehensive Check

```bash
# E2E tests pass
npx vitest run packages/core/src/lsp/__tests__/e2e-lsp.test.ts
# Expected: All pass

# ALL core tests pass
cd packages/core && npm test
# Expected: All pass (zero regressions)

# ALL LSP package tests pass
cd packages/lsp && bunx vitest run
# Expected: All pass

# Full TypeScript compilation
cd packages/core && npx tsc --noEmit && echo "PASS: core" || echo "FAIL: core"
cd packages/lsp && bunx tsc --noEmit && echo "PASS: lsp" || echo "FAIL: lsp"

# Full lint
cd packages/core && npm run lint && echo "PASS: core lint" || echo "FAIL: core lint"
cd packages/lsp && bunx eslint "src/**/*.ts" && echo "PASS: lsp lint" || echo "FAIL: lsp lint"

# Final deferred implementation sweep
echo "=== Deferred Implementation Final Check ==="
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/core/src/lsp/ packages/core/src/tools/edit.ts packages/core/src/tools/write-file.ts packages/core/src/config/config.ts packages/core/src/commands/lsp-status.ts packages/lsp/src/ 2>/dev/null | grep -v test | grep -v __tests__ | grep -v node_modules
# Expected: No matches

echo "=== Cop-out Comment Final Check ==="
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/lsp/ packages/lsp/src/ 2>/dev/null | grep -v test | grep -v node_modules
# Expected: No matches

# Count all plan markers across the project
echo "=== Plan Marker Coverage ==="
grep -r "@plan:PLAN-20250212-LSP" packages/core/src/ packages/lsp/src/ | grep -v node_modules | wc -l
# Expected: 20+ markers across all implementation files

# Count all requirement markers
echo "=== Requirement Marker Coverage ==="
grep -r "@requirement:REQ-" packages/core/src/ packages/lsp/src/ | grep -v node_modules | wc -l
# Expected: 15+ requirement markers
```

## Holistic Functionality Assessment

### What was implemented?
[Describe in your own words: The complete LSP integration feature — from automatic diagnostic feedback in edit/write/apply-patch tools, to LSP navigation tools via MCP, to status visibility via /lsp status, to full graceful degradation and lifecycle management. Verify by reading the E2E tests, which exercise the actual end-to-end data flows, and by tracing the code from tool invocation through Config → LspServiceClient → LSP Service → Language Servers → Diagnostics → llmContent.]

### Does it satisfy the requirements?
[For each major requirement category, explain HOW the E2E tests verify it:
- REQ-DIAG-*: E2E test edits a file → verifies diagnostics appear in llmContent with correct format
- REQ-FMT-*: E2E test verifies XML tags, severity filtering, caps, overflow suffixes in actual output
- REQ-TIME-*: E2E test verifies timeout behavior (diagnostics returned within bounded time, partial results on timeout)
- REQ-GRACE-*: E2E test verifies edit works without Bun, after crash, with lsp:false
- REQ-CFG-*: E2E test verifies config options (disable, custom timeouts, severity filters)
- REQ-STATUS-*: E2E test verifies /lsp status output format and content
- REQ-NAV-*: E2E test verifies navigation tools are accessible and return results
- REQ-EXCL-*: E2E test verifies excluded features do NOT exist]

### What is the data flow?
[Trace the complete path for the core use case: User's LLM calls edit tool → edit.ts writes file → calls getLspServiceClient().checkFile(path) → JSON-RPC to LSP service process → Orchestrator resolves servers → LspClient sends didOpen to language server → language server sends publishDiagnostics → debounce → diagnostics collected → JSON-RPC response → edit.ts formats diagnostics → appended to llmContent → LLM sees errors and can self-correct. Cite specific test assertions that verify this path.]

### What could go wrong?
[Identify systemic risks: Bun version incompatibility on different platforms? Language server availability varies by system? Race conditions in parallel diagnostic collection? Memory leaks from accumulated known-files? Subprocess zombies on ungraceful shutdown? Performance impact of diagnostic collection on every file mutation? Verify each is addressed or documented as a known limitation.]

### Verdict
[PASS/FAIL — FINAL FEATURE VERDICT. This is the last gate before the LSP integration feature is considered complete. Explain your confidence level and any remaining risks.]

### Semantic Verification Checklist (FINAL)

#### Complete Feature Assessment

##### All Phases Verified
- [ ] Phase 03-04: Shared types and language map
- [ ] Phase 05-08: Diagnostics formatting (stub → TDD → impl)
- [ ] Phase 09-12: LSP client (stub → TDD → impl)
- [ ] Phase 13-15: Server registry (stub → TDD → impl)
- [ ] Phase 16-19: Orchestrator (stub → TDD → impl)
- [ ] Phase 20-21: RPC channel (stub+TDD → impl)
- [ ] Phase 22-23: MCP channel (stub+TDD → impl)
- [ ] Phase 24: Main entry point
- [ ] Phase 25-28: LspServiceClient in core (stub → TDD → impl)
- [ ] Phase 29: Edit tool integration
- [ ] Phase 30: Write tool integration
- [ ] Phase 31: Config integration
- [ ] Phase 32: Status slash command
- [ ] Phase 33: System integration wiring
- [ ] Phase 34: E2E tests

##### All Requirement Categories Covered
- [ ] REQ-DIAG-*: Diagnostic feedback after mutations
- [ ] REQ-FMT-*: Diagnostic output format
- [ ] REQ-TIME-*: Timing and timeouts
- [ ] REQ-NAV-*: Navigation tools
- [ ] REQ-LIFE-*: Server lifecycle
- [ ] REQ-ARCH-*: Architecture
- [ ] REQ-GRACE-*: Graceful degradation
- [ ] REQ-CFG-*: Configuration
- [ ] REQ-STATUS-*: Status visibility
- [ ] REQ-BOUNDARY-*: Workspace boundaries
- [ ] REQ-PKG-*: Packaging

##### Zero Regressions
- [ ] All existing core tests pass
- [ ] All existing LSP package tests pass
- [ ] TypeScript compiles in both packages
- [ ] Lint passes in both packages

##### Feature is REACHABLE
- [ ] User can edit a file → get diagnostics (via edit tool)
- [ ] User can write a file → get multi-file diagnostics (via write tool)
- [ ] User can use navigation tools (via MCP tools in LLM)
- [ ] User can check LSP status (via /lsp status)
- [ ] User can disable LSP (via lsp: false config)

##### Verdict
[PASS/FAIL — OVERALL LSP INTEGRATION FEATURE ASSESSMENT]

### Feature Actually Works

```bash
# Verify all tests pass with real implementation:
npm test
# Expected: All tests pass

# Run specific phase tests:
cd packages/lsp && bunx vitest run
cd packages/core && npx vitest run
# Expected: All pass
```

## Success Criteria
- All verification checks pass
- No deferred implementation patterns found
- Semantic verification confirms behavioral correctness
- Phase 36 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 36 to fix issues
3. Re-run Phase 36a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P36a.md`
Contents:
```markdown
Phase: P34a (FINAL)
Completed: YYYY-MM-DD HH:MM
Feature: LSP Integration (Issue #438)
Plan: PLAN-20250212-LSP
Total Phases Completed: 34 (plus verification phases)
All Tests Passing: [yes/no]
All Regressions Fixed: [yes/no]
Feature Reachable: [yes/no]
Final Verdict: [PASS/FAIL]
```
