# Phase 05a: Diagnostics Formatting Stub Verification

## Phase ID
`PLAN-20250212-LSP.P05a`

## Prerequisites
- Required: Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P05" packages/lsp/src/service/diagnostics.ts`

## Verification Commands

### Automated Checks

```bash
# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit && echo "PASS" || echo "FAIL"

# Function signatures exist
for fn in escapeXml mapSeverity normalizeLspDiagnostic deduplicateDiagnostics filterBySeverity formatDiagnosticLine formatSingleFileDiagnostics formatMultiFileDiagnostics; do
  grep -q "export function ${fn}" packages/lsp/src/service/diagnostics.ts && echo "PASS: ${fn}" || echo "FAIL: ${fn} missing"
done

# Under 100 lines
LINES=$(wc -l < packages/lsp/src/service/diagnostics.ts)
[ "$LINES" -le 100 ] && echo "PASS: $LINES lines" || echo "FAIL: $LINES lines (max 100)"

# No TODO/FIXME
grep -rn "TODO\|FIXME" packages/lsp/src/service/diagnostics.ts
# Expected: No output

# No `any` types
grep -n ": any" packages/lsp/src/service/diagnostics.ts
# Expected: No output (except potentially in type guards)

# No version duplication
find packages/lsp -name "*diagnosticsV2*" -o -name "*diagnosticsNew*"
# Expected: No output
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do function signatures match pseudocode diagnostics.md?** — Verified by reading both files
2. **Are types correct?** — No `any`, proper Diagnostic types used
3. **Are stubs minimal?** — Throw or return empty, no logic

##### Verdict
[PASS/FAIL]


### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs are allowed to throw NotYetImplemented or return empty values.
# But they must NOT have TODO/FIXME/HACK comments:
grep -rn -E "(TODO|FIXME|HACK)" [modified-files] | grep -v ".test.ts"
# Expected: No matches

# No cop-out comments even in stubs:
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" [modified-files] | grep -v ".test.ts"
# Expected: No matches
```


### Feature Actually Works

```bash
# Stub phase — verify compilation only:
cd packages/lsp && bunx tsc --noEmit
cd packages/core && npx tsc --noEmit
# Expected: Both compile cleanly
```


## Success Criteria
- All verification checks pass
- No deferred implementation patterns found
- Semantic verification confirms behavioral correctness
- Phase 05 deliverables are complete and compliant


## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 05 to fix issues
3. Re-run Phase 05a verification


## Phase Completion Marker
Create: `project-plans/issue438/.completed/P05a.md`
