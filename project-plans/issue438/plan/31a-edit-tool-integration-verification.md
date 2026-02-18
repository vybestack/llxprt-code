# Phase 31a: Edit Tool Integration Verification

## Phase ID
`PLAN-20250212-LSP.P31a`

## Prerequisites
- Required: Phase 29 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P31" packages/core/src/tools/edit.ts`

## Verification Commands

```bash
# LSP integration tests pass
npx vitest run packages/core/src/tools/__tests__/edit-lsp-integration.test.ts
# Expected: All pass

# Existing edit tests still pass (no regression)
npx vitest run packages/core/src/tools/__tests__/edit.test.ts
# Expected: All pass

# No test modifications to existing tests
git diff --name-only packages/core/src/tools/__tests__/edit.test.ts && echo "FAIL: existing tests modified" || echo "PASS"

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|placeholder|for now)" packages/core/src/tools/edit.ts | grep -iv "existing" && echo "FAIL" || echo "PASS"

# Cop-out detection
grep -rn -E "(in a real|in production|ideally|not yet|will be|should be)" packages/core/src/tools/edit.ts | tail -5

# try/catch wraps LSP code
grep -A2 "lspClient\|checkFile" packages/core/src/tools/edit.ts | grep -q "try\|catch" && echo "PASS: try/catch present" || echo "FAIL"

# TypeScript + lint
cd packages/core && npx tsc --noEmit
```

### Semantic Verification Checklist
- [ ] Diagnostics appear AFTER success message in llmContent
- [ ] Only single-file diagnostics (checkFile, not getAllDiagnostics)
- [ ] try/catch wraps all LSP code — LSP failure never fails edit
- [ ] Catch block is silent (no error text appended to llmContent)
- [ ] Severity filtering applied before display
- [ ] Per-file cap applied with overflow suffix
- [ ] `<diagnostics file="relpath">` XML tags used
- [ ] Existing edit.ts behavior unchanged when LSP is unavailable
- [ ] No raw Diagnostic objects stored in ToolResult metadata

## Holistic Functionality Assessment

### What was implemented?
[Describe in your own words: The edit tool (edit.ts) and apply-patch tool (apply-patch.ts) are modified to optionally append single-file LSP diagnostics after successful file mutations. After writing the file, the code checks if an LSP service client is alive, calls checkFile to trigger diagnostic collection, formats the results using the shared diagnostics formatter, and appends the formatted XML block to llmContent. The entire LSP code path is wrapped in try/catch so that any failure silently degrades. Apply-patch classifies operations (write vs rename/delete) and only collects diagnostics for files with content writes. Verify by reading the actual modifications in edit.ts and apply-patch.ts.]

### Does it satisfy the requirements?
- [ ] REQ-DIAG-010: Edit tool appends error diagnostics to llmContent — cite the checkFile call and llmContent append
- [ ] REQ-DIAG-015: Apply-patch appends diagnostics same format as edit — cite the apply-patch integration code
- [ ] REQ-DIAG-017: Apply-patch per-file scope, skip rename/delete-only — cite the operation classification logic
- [ ] REQ-DIAG-020: Write succeeds before diagnostics — cite the ordering (success message built first, diagnostics appended after)
- [ ] REQ-DIAG-030: Single-file scope only — cite checkFile (not getAllDiagnostics)
- [ ] REQ-SCOPE-010: Only text/code files — cite the binary file check
- [ ] REQ-SCOPE-020/025: No diagnostics for rename/delete — cite the classification algorithm from apply-patch-integration.md
- [ ] REQ-GRACE-050: try/catch wraps every LSP call — cite the try/catch block
- [ ] REQ-GRACE-055: Failure returns normal success, no LSP error text — cite the empty catch block

### What is the data flow?
[Trace for edit: execute() → write file to disk → build success message → try { getLspServiceClient()?.isAlive() → checkFile(filePath) → format diagnostics with formatSingleFileDiagnostics() → append to llmContent } catch { /* silent */ } → return ToolResult. Trace for apply-patch: classifyOperations(operations) → for each op with hasContentWrite=true → checkFile(filePath) → format → append. Show the actual code paths.]

### What could go wrong?
[Identify risks: apply-patch with 50 modified files — does serial checkFile per file cause latency spikes? Is the operation classifier correct for all apply-patch edge cases (partial content + rename)? Does the shared formatter function handle being called with empty diagnostics (no-op)? Are file paths correctly relativized before formatting? Verify each.]

### Verdict
[PASS/FAIL with explanation. If PASS, explain confidence that edit and apply-patch correctly integrate single-file diagnostics with graceful degradation. If FAIL, list gaps.]

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK markers left in implementation:
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" [modified-files] | grep -v ".test.ts"
# Expected: No matches

# Check for cop-out comments:
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" [modified-files] | grep -v ".test.ts"
# Expected: No matches

# Check for empty/trivial implementations:
grep -rn -E "return \[\]|return \{\}|return null|return undefined" [modified-files] | grep -v ".test.ts"
# Expected: No matches in main logic paths (OK in error guards)
```

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
- Phase 31 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 31 to fix issues
3. Re-run Phase 31a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P31a.md`
