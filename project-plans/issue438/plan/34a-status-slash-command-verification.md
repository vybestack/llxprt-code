# Phase 34a: Status Slash Command Verification

## Phase ID
`PLAN-20250212-LSP.P34a`

## Prerequisites
- Required: Phase 32 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P34" packages/core/`

## Verification Commands

```bash
# Tests pass
npx vitest run packages/core/src/commands/__tests__/lsp-status.test.ts
# Expected: All pass

# Sufficient tests
TEST_COUNT=$(grep -c "it(" packages/core/src/commands/__tests__/lsp-status.test.ts)
[ "$TEST_COUNT" -ge 8 ] && echo "PASS: $TEST_COUNT tests" || echo "FAIL: only $TEST_COUNT tests"

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|placeholder|for now)" packages/core/src/commands/lsp-status.ts 2>/dev/null && echo "FAIL" || echo "PASS"

# Command registered in slash command system
grep -r "lsp" packages/core/src/commands/ --include="*.ts" | grep -v test | grep -v __tests__ | head -5

# TypeScript + lint
cd packages/core && npx tsc --noEmit
```

### Semantic Verification Checklist
- [ ] `/lsp status` registered with existing slash command system
- [ ] Live service → shows all server statuses (active/starting/broken/disabled/unavailable)
- [ ] Dead service → shows "LSP unavailable: <reason>"
- [ ] Disabled via config (`lsp: false`) → shows "LSP disabled"
- [ ] Available when navigationTools is false
- [ ] Follows existing slash command output formatting patterns
- [ ] Status values match REQ-STATUS-020 exactly

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
- Phase 34 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 34 to fix issues
3. Re-run Phase 34a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P34a.md`
