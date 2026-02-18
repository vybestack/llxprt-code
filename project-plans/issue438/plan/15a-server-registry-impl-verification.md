# Phase 15a: Server Registry Implementation Verification

## Phase ID
`PLAN-20250212-LSP.P15a`

## Prerequisites
- Required: Phase 15 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P15" packages/lsp/src/service/server-registry.ts`

## Verification Commands

```bash
cd packages/lsp && bunx vitest run test/server-registry.test.ts
git diff --name-only packages/lsp/test/server-registry.test.ts && echo "FAIL: test modified" || echo "PASS"
grep -rn -E "(TODO|FIXME|HACK|STUB|placeholder)" packages/lsp/src/service/server-registry.ts && echo "FAIL" || echo "PASS"
LINES=$(wc -l < packages/lsp/src/service/server-registry.ts)
[ "$LINES" -le 800 ] && echo "PASS: $LINES" || echo "FAIL: $LINES"
cd packages/lsp && bunx tsc --noEmit && bunx eslint src/service/server-registry.ts
```

### Semantic Verification Checklist
- [ ] 5 built-in servers: TS, ESLint, Go, Python, Rust
- [ ] Each has command, args, extensions
- [ ] mergeUserConfig handles disable/custom/override
- [ ] Under 800 lines

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
- Phase 15 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 15 to fix issues
3. Re-run Phase 15a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P15a.md`
