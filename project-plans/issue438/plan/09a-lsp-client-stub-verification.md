# Phase 09a: LSP Client Stub Verification

## Phase ID
`PLAN-20250212-LSP.P09a`

## Prerequisites
- Required: Phase 09 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P09" packages/lsp/src/service/lsp-client.ts`

## Verification Commands

```bash
# Compiles
cd packages/lsp && bunx tsc --noEmit && echo "PASS" || echo "FAIL"

# Class exported
grep "export class LspClient" packages/lsp/src/service/lsp-client.ts && echo "PASS" || echo "FAIL"

# Key methods exist
for method in initialize touchFile waitForDiagnostics gotoDefinition findReferences hover documentSymbols isAlive shutdown; do
  grep -q "$method" packages/lsp/src/service/lsp-client.ts && echo "PASS: $method" || echo "FAIL: $method missing"
done

# Under 100 lines
LINES=$(wc -l < packages/lsp/src/service/lsp-client.ts)
[ "$LINES" -le 100 ] && echo "PASS: $LINES lines" || echo "FAIL: $LINES lines"

# No any types
grep ": any" packages/lsp/src/service/lsp-client.ts && echo "FAIL: any found" || echo "PASS"
```

### Semantic Verification Checklist
- [ ] Class matches pseudocode lsp-client.md interface
- [ ] All method signatures have correct return types
- [ ] Stub is minimal (no implementation logic)

##### Verdict
[PASS/FAIL]

### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs may throw NotYetImplemented or return empty values.
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
- Phase 09 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 09 to fix issues
3. Re-run Phase 09a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P09a.md`
