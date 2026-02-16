# Phase 36: E2E Tests

## Phase ID
`PLAN-20250212-LSP.P36`

## Prerequisites
- Required: Phase 35a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P35" packages/core/`
- Expected: All components implemented, integrated, and system-wiring verified
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

End-to-end tests that exercise the complete LSP integration from user-facing tool invocations through to diagnostic output. These tests verify the WHOLE system works as a user would experience it.

### E2E Scenario 1: Edit File → Get Diagnostics
**Full Text**: REQ-DIAG-010 + REQ-FMT-010 + REQ-FMT-020 + REQ-TIME-010
**Behavior**:
- GIVEN: A TypeScript project with a valid `src/index.ts`
- WHEN: LLM uses the edit tool to introduce a type error
- THEN: Tool response contains success message + `<diagnostics>` block with error details
**Why This Matters**: This is the core value proposition — immediate feedback on errors after edits.

### E2E Scenario 2: Write File → Get Multi-File Diagnostics
**Full Text**: REQ-DIAG-040 + REQ-DIAG-050 + REQ-DIAG-060 + REQ-DIAG-070
**Behavior**:
- GIVEN: A TypeScript project where `src/types.ts` is imported by `src/utils.ts`
- WHEN: LLM writes `src/types.ts` with a breaking change
- THEN: Tool response contains diagnostics for `src/types.ts` ("in this file") AND `src/utils.ts` ("in other files")

### E2E Scenario 3: Graceful Degradation Without Bun
**Full Text**: REQ-GRACE-020 + REQ-GRACE-050 + REQ-GRACE-055
**Behavior**:
- GIVEN: Bun is not in PATH
- WHEN: LLM uses edit tool
- THEN: Edit succeeds normally, no diagnostics, no error messages

### E2E Scenario 4: LSP Service Crash Resilience
**Full Text**: REQ-LIFE-080 + REQ-GRACE-040 + REQ-GRACE-055
**Behavior**:
- GIVEN: LSP service was running, then its subprocess is killed
- WHEN: LLM uses edit tool after the crash
- THEN: Edit succeeds normally, no diagnostics, no error, no restart

### E2E Scenario 5: Config Disable/Enable
**Full Text**: REQ-CFG-010 + REQ-CFG-015
**Behavior**:
- GIVEN: Config has `lsp: false`
- WHEN: LLM edits a file
- THEN: No LSP interaction at all, no diagnostics
- GIVEN: Config has no `lsp` key (default enabled)
- WHEN: LLM edits a file and Bun/LSP available
- THEN: Diagnostics appended

### E2E Scenario 6: /lsp status Command
**Full Text**: REQ-STATUS-010 + REQ-STATUS-020 + REQ-STATUS-030
**Behavior**:
- GIVEN: LSP service is running with active TypeScript server
- WHEN: User invokes `/lsp status`
- THEN: Output shows "typescript: active"

### E2E Scenario 7: Navigation Tools via MCP
**Full Text**: REQ-NAV-010 + REQ-NAV-020 + REQ-NAV-030
**Behavior**:
- GIVEN: MCP navigation tools are registered
- WHEN: LLM calls `lsp_goto_definition` for a known symbol
- THEN: Returns definition location as `relpath:line:col`

### E2E Scenario 8: Non-Goal Verification (Exclusions)
**Full Text**: REQ-EXCL-010, REQ-EXCL-020, REQ-EXCL-030, REQ-EXCL-040, REQ-EXCL-050
**Behavior**:
- Verify: No code completion tool exists in the tool list (REQ-EXCL-010)
- Verify: No auto-fix or code-action tool exists (REQ-EXCL-020)
- Verify: No formatting tool provided by LSP (REQ-EXCL-030)
- Verify: No watch-mode or poll-mode diagnostic collection (REQ-EXCL-040)
- Verify: No diagnostic rendering in TUI (REQ-EXCL-050)
**Why This Matters**: Explicit verification that non-goals were not accidentally implemented.

### E2E Scenario 9: CI Pipeline for packages/lsp
**Full Text**: REQ-PKG-025
**Behavior**:
- GIVEN: packages/lsp has its own lint, typecheck, test scripts
- WHEN: CI runs
- THEN: packages/lsp lint, typecheck, and test run as separate steps
**Why This Matters**: Ensures the LSP package has independent CI validation.

## Implementation Tasks

### Files to Create

- `packages/core/src/lsp/__tests__/e2e-lsp.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P36`
  - E2E tests (10+):
    1. **Edit → Diagnostics**: Edit a TypeScript file to introduce type error → diagnostics in response
    2. **Edit → No Errors**: Edit a TypeScript file correctly → no diagnostics
    3. **Write → Multi-File**: Write a types file breaking importers → multi-file diagnostics
    4. **Write → Written File First**: Verify written file diagnostics appear before other files
    5. **Write → Other File Cap**: Write breaking change affecting >5 files → only 5 other files shown
    6. **Graceful: No Bun**: Simulate no Bun → edit works, no diagnostics, no error
    7. **Graceful: Service Crash**: Kill service subprocess → subsequent edit works, no error
    8. **Config: lsp false**: Config with `lsp: false` → no diagnostics ever
    9. **Config: Default**: No lsp config → diagnostics work (when Bun available)
    10. **Status Command**: `/lsp status` shows running servers
    11. **Status Unavailable**: `/lsp status` without service → shows unavailable reason
    12. **Navigation Tools**: Call lsp_goto_definition → get definition location
    13. **Boundary Check**: Navigation tool with external path → rejected
    14. **Severity Filter**: Configure `includeSeverities: ['error', 'warning']` → warnings included
  - Tests may use:
    - Real Bun subprocess (if available in CI)
    - Fake LSP server fixture from packages/lsp/test/fixtures/
    - Controlled temp directories with TypeScript projects
  - Tests should be marked with a `@e2e` tag for selective execution

### Contract Drift Tests (RESEARCH — Source 5)

In addition to the E2E scenarios above, add a **type duplication drift test**:

  15. **Type Drift Guard**: Send a JSON-RPC message containing ALL fields of `Diagnostic`, `ServerStatus`, and `LspConfig` across the process boundary (core → lsp service → core). Verify both sides parse the message identically. This ensures the duplicated `types.ts` files in `packages/core/src/lsp/types.ts` and `packages/lsp/src/types.ts` have not diverged in a way that breaks wire compatibility.
  
   ```typescript
   // Scenario: Full-field contract test across JSON-RPC boundary
   // GIVEN: A Diagnostic with ALL fields populated (including all optional ones)
   const fullDiagnostic: Diagnostic = {
     file: 'src/app.ts', line: 10, character: 5,
     severity: 'error', message: 'Type mismatch',
     code: 2322, source: 'typescript'
   };
   // WHEN: Sent through JSON-RPC from lsp service → core (as part of lsp/checkFile response)
   // THEN: Deserialized Diagnostic on the core side deep-equals the original object.
   //       This catches: field additions (new field appears but isn't forwarded),
   //       field removals (field deleted from one side's types.ts but not the other),
   //       type changes (field changed from string to number in one side but not the other).
   // The test MUST populate EVERY field defined in the Diagnostic interface to
   // maximize coverage of potential drift. Use assert.deepStrictEqual or equivalent.
   ```

  This test, combined with the CI diff guard script (see Phase 03), provides two-layer protection against type drift.

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P36
 * @e2e
 */
```

## Verification Commands

### Automated Checks

```bash
# E2E tests pass
npx vitest run packages/core/src/lsp/__tests__/e2e-lsp.test.ts
# Expected: All pass (may need Bun available for full suite)

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P36" packages/core/ | wc -l
# Expected: 1+

# Sufficient tests
TEST_COUNT=$(grep -c "it(" packages/core/src/lsp/__tests__/e2e-lsp.test.ts)
[ "$TEST_COUNT" -ge 10 ] && echo "PASS: $TEST_COUNT tests" || echo "FAIL: only $TEST_COUNT tests"

# ALL existing tests still pass (final regression check)
cd packages/core && npm test
# Expected: All pass

cd packages/lsp && bunx vitest run
# Expected: All pass

# Full TypeScript compilation
cd packages/core && npx tsc --noEmit
cd packages/lsp && bunx tsc --noEmit

# Full lint
cd packages/core && npm run lint
cd packages/lsp && bunx eslint "src/**/*.ts"
```

### Deferred Implementation Detection (MANDATORY — FINAL CHECK)

```bash
# Check ALL implementation files for deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/core/src/lsp/ packages/core/src/tools/edit.ts packages/core/src/tools/write-file.ts packages/core/src/config/config.ts packages/lsp/src/ | grep -v test | grep -v __tests__
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/lsp/ packages/lsp/src/ | grep -v test
# Expected: No matches

# Check for empty returns in implementation code
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/lsp/lsp-service-client.ts packages/lsp/src/service/ packages/lsp/src/channels/ | grep -v "catch\|guard\|alive\|dead"
# Expected: Only in error handlers and alive-guards, not in main logic paths
```

### Semantic Verification Checklist (MANDATORY)

#### End-to-End Feature Verification

##### Scenario 1: Edit → Diagnostics
- [ ] Verified: edit tool modifies file → checkFile called → diagnostics formatted → appended to llmContent
- [ ] Output format: `<diagnostics file="relpath">ERROR [line:col] message (code)</diagnostics>`

##### Scenario 2: Write → Multi-File
- [ ] Verified: write tool → checkFile + getAllDiagnostics → multi-file output
- [ ] Written file first, other files alphabetical
- [ ] Caps applied (per-file, other-files, total lines)

##### Scenario 3: Graceful Degradation
- [ ] No Bun → tools work normally, no errors, no diagnostics
- [ ] Service crash → tools work normally, no restart, no errors

##### Scenario 4: Configuration
- [ ] `lsp: false` → completely disabled
- [ ] No lsp key → enabled with defaults
- [ ] `navigationTools: false` → diagnostics work, nav tools hidden

##### Scenario 5: Lifecycle
- [ ] Startup: Config → LspServiceClient → Bun subprocess → ready
- [ ] Shutdown: Session end → graceful shutdown → cleanup

##### Full System Health
- [ ] ALL core tests pass
- [ ] ALL lsp package tests pass
- [ ] TypeScript compiles in both packages
- [ ] Lint passes in both packages
- [ ] No deferred implementation in any file

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
# Run full E2E suite:
npx vitest run packages/core/src/lsp/__tests__/e2e-lsp.test.ts
# Expected: 10+ tests pass covering all key scenarios

# Manual smoke test (if Bun available):
# 1. Start llxprt session
# 2. Edit a .ts file to introduce type error
# 3. Verify diagnostics appear in tool response
# 4. Type /lsp status
# 5. Verify servers listed
```

#### Integration Points Verified
- [ ] E2E tests exercise real Config → LspServiceClient → LSP Service flow
- [ ] Edit tool → checkFile → diagnostics → llmContent verified end-to-end
- [ ] Write tool → multi-file diagnostics verified end-to-end
- [ ] /lsp status → status() → formatted output verified
- [ ] Navigation tools → MCP → orchestrator → language server verified

#### Lifecycle Verified
- [ ] Tests start and stop LSP service cleanly per test/suite
- [ ] No orphaned Bun subprocesses after test suite completes
- [ ] Graceful degradation tests properly simulate missing Bun/crash scenarios
- [ ] Test fixtures cleaned up (temp directories removed)

#### Edge Cases Verified
- [ ] Edit with no errors → no diagnostics block in output
- [ ] Edit with errors → diagnostics block present
- [ ] Write affecting >5 other files → capped at 5
- [ ] Total diagnostic lines >50 → capped at 50
- [ ] Severity filter → warnings included when configured
- [ ] Service crash → subsequent edit still succeeds
- [ ] External path in navigation → rejected

## Success Criteria
- 10+ E2E tests pass
- All existing tests pass (final regression check)
- No deferred implementation patterns in any file
- Full TypeScript compilation and lint pass
- End-to-end data flow verified for all key scenarios

## Failure Recovery
1. `git checkout -- packages/core/src/lsp/__tests__/e2e-lsp.test.ts`
2. Identify failing scenario → trace to implementation phase → fix
3. Re-run Phases 35a and 34

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P36.md`
