# Phase 27a: LspServiceClient Stub Verification

## Phase ID
`PLAN-20250212-LSP.P27a`

## Prerequisites
- Required: Phase 25 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P27" packages/core/src/lsp/lsp-service-client.ts`

## Verification Commands

```bash
# TypeScript compiles (core package)
cd packages/core && npx tsc --noEmit && echo "PASS" || echo "FAIL"

# Class exported
grep -q "export class LspServiceClient" packages/core/src/lsp/lsp-service-client.ts && echo "PASS" || echo "FAIL"

# All methods present
for method in start checkFile getAllDiagnostics status isAlive shutdown getMcpTransportStreams; do
  grep -q "$method" packages/core/src/lsp/lsp-service-client.ts && echo "PASS: $method" || echo "FAIL: $method missing"
done

# Under 80 lines
LINES=$(wc -l < packages/core/src/lsp/lsp-service-client.ts)
[ "$LINES" -le 80 ] && echo "PASS: $LINES lines" || echo "FAIL: $LINES lines"

# No Bun APIs in core
grep -rn "Bun\.\|import.*bun\|from.*bun" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL: Bun API" || echo "PASS"

# No TODO/FIXME
grep "TODO\|FIXME" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL" || echo "PASS"

# No version duplication
find packages/core/src/lsp -name "*V2*" -o -name "*New*" -o -name "*Copy*"
# Expected: No output
```

### Semantic Verification Checklist
- [ ] LspServiceClient is in packages/core/src/lsp/ (NOT packages/lsp/)
- [ ] Method signatures match pseudocode lsp-service-client.md
- [ ] Types imported from packages/core/src/lsp/types.ts (not from packages/lsp)
- [ ] isAlive() returns false (stub)
- [ ] No Bun-specific APIs used

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
- Phase 27 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 27 to fix issues
3. Re-run Phase 27a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P27a.md`
