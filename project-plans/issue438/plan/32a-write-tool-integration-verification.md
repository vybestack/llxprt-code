# Phase 32a: Write Tool Integration Verification

## Phase ID
`PLAN-20250212-LSP.P32a`

## Prerequisites
- Required: Phase 30 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P32" packages/core/src/tools/write-file.ts`

## Verification Commands

```bash
# LSP integration tests pass
npx vitest run packages/core/src/tools/__tests__/write-file-lsp-integration.test.ts
# Expected: All pass

# Existing write tests still pass
npx vitest run packages/core/src/tools/__tests__/write-file.test.ts
# Expected: All pass (no regression)

# No modifications to existing tests
git diff --name-only packages/core/src/tools/__tests__/write-file.test.ts && echo "FAIL: existing tests modified" || echo "PASS"

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|placeholder|for now)" packages/core/src/tools/write-file.ts | grep -iv "existing" && echo "FAIL" || echo "PASS"

# try/catch wraps LSP code
grep -A2 "lspClient\|checkFile\|getAllDiagnostics" packages/core/src/tools/write-file.ts | grep -q "try\|catch" && echo "PASS" || echo "FAIL"

# Multi-file labels present
grep -q "in this file" packages/core/src/tools/write-file.ts && echo "PASS: this-file label" || echo "FAIL"
grep -q "in other files" packages/core/src/tools/write-file.ts && echo "PASS: other-files label" || echo "FAIL"

# TypeScript + lint
cd packages/core && npx tsc --noEmit
```

### Semantic Verification Checklist
- [ ] checkFile called first (trigger diagnostic update), then getAllDiagnostics
- [ ] Written file labeled "in this file", others "in other files"
- [ ] Written file always first in output (REQ-FMT-090)
- [ ] Other files sorted alphabetically
- [ ] Other files capped at maxProjectDiagnosticsFiles (default 5)
- [ ] Total lines capped at 50
- [ ] Overflow suffix does NOT count toward total line cap
- [ ] Severity filtering applied before caps
- [ ] try/catch wraps all LSP code
- [ ] Catch block is silent (no error text in llmContent)
- [ ] Existing write-file behavior unchanged when LSP unavailable

## Holistic Functionality Assessment

### What was implemented?
[Describe in your own words: The write-file tool is modified to append multi-file LSP diagnostics after a successful file write. It calls checkFile first to trigger an LSP update for the written file, then getAllDiagnostics to get the current known-files diagnostics, then uses the shared formatMultiFileDiagnostics pure function (REQ-FMT-068) to apply severity filter → per-file cap → total line cap → other-file cap, labels the written file as "in this file" and others as "in other files", and appends the result to llmContent. The entire path is wrapped in try/catch. Verify by reading write-file.ts.]

### Does it satisfy the requirements?
- [ ] REQ-DIAG-040: Write tool appends multi-file diagnostics — cite checkFile + getAllDiagnostics + format
- [ ] REQ-DIAG-045: Other files from known-files set — cite getAllDiagnostics source
- [ ] REQ-DIAG-050: Written file first ("in this file"), then others ("in other files") — cite labeling
- [ ] REQ-DIAG-060: Other-file cap (5, configurable) — cite maxProjectDiagnosticsFiles usage
- [ ] REQ-DIAG-070: Total diagnostic lines cap (50) — cite total line cap logic
- [ ] REQ-FMT-068: Cap order: severity → per-file → total; overflow excluded from total — cite the single pure function call
- [ ] REQ-FMT-090: File order: written first, then alphabetical — cite sort logic
- [ ] REQ-GRACE-050/055: try/catch, silent failure — cite the error handler

### What is the data flow?
[Trace: execute() → write file to disk → build success message → try { getLspServiceClient()?.isAlive() → checkFile(filePath) → getAllDiagnostics() → formatMultiFileDiagnostics(writtenFile, allDiags, config) → the pure function applies severity filter, per-file cap, total line cap, other-file cap → returns formatted XML string → append to llmContent } catch { /* silent */ } → return ToolResult. Show actual code.]

### What could go wrong?
[Identify risks: getAllDiagnostics returns stale data if checkFile hasn't completed propagation? The known-files set could include the written file itself (double-counting)? Total line cap counting off-by-one with overflow suffixes? Config values for caps not threaded correctly from user settings? Verify each risk.]

### Verdict
[PASS/FAIL with explanation. If PASS, explain confidence that multi-file diagnostics are correctly collected, formatted, capped, and appended. If FAIL, list gaps.]

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
- Phase 32 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 32 to fix issues
3. Re-run Phase 32a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P32a.md`
