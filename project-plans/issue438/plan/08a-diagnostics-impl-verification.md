# Phase 08a: Diagnostics Formatting Implementation Verification

## Phase ID
`PLAN-20250212-LSP.P08a`

## Prerequisites
- Required: Phase 08 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P08" packages/lsp/src/service/diagnostics.ts`

## Verification Commands

### Automated Checks

```bash
# All tests pass
cd packages/lsp && bunx vitest run test/diagnostics.test.ts test/diagnostics-integration.test.ts
# Expected: All pass

# No test modifications
git diff --name-only packages/lsp/test/
# Expected: No output (tests unchanged from P06/P07)

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|placeholder|for now)" packages/lsp/src/service/diagnostics.ts
# Expected: No output

grep -rn -E "return \[\]|return \{\}|return ''|return undefined" packages/lsp/src/service/diagnostics.ts
# Expected: No output

# Pseudocode compliance
grep -c "@pseudocode" packages/lsp/src/service/diagnostics.ts
# Expected: 8+ references

# TypeScript strict
cd packages/lsp && bunx tsc --noEmit

# Lint passes
cd packages/lsp && bunx eslint src/service/diagnostics.ts

# Under max-lines
LINES=$(wc -l < packages/lsp/src/service/diagnostics.ts)
[ "$LINES" -le 800 ] && echo "PASS: $LINES lines" || echo "FAIL: exceeds 800"
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe the diagnostics module implementation — what each function does]

##### Does it satisfy the requirements?
[For each REQ-FMT-*, explain HOW the code satisfies it with code references]

##### Data flow trace
[Trace: raw LSP diagnostic object → normalize → filter → dedup → format → XML-tagged string]

##### What could go wrong?
[List edge cases: empty input, all filtered, cap exactly at limit, etc.]

##### Verdict
[PASS/FAIL]

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
- Phase 08 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 08 to fix issues
3. Re-run Phase 08a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P08a.md`
