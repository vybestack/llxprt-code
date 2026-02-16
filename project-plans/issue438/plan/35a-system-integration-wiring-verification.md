# Phase 35a: System Integration Wiring Verification

## Phase ID
`PLAN-20250212-LSP.P35a`

## Prerequisites
- Required: Phase 33 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P35" packages/core/`

## Verification Commands

```bash
# System integration tests pass
npx vitest run packages/core/src/lsp/__tests__/system-integration.test.ts
# Expected: All pass

# ALL core tests pass (zero regressions)
cd packages/core && npm test
# Expected: All pass

# ALL LSP package tests pass
cd packages/lsp && bunx vitest run
# Expected: All pass

# Wiring verification
grep "getLspServiceClient" packages/core/src/tools/edit.ts && echo "PASS: edit wired" || echo "FAIL"
grep "getLspServiceClient" packages/core/src/tools/write-file.ts && echo "PASS: write wired" || echo "FAIL"
grep "LspServiceClient" packages/core/src/config/config.ts && echo "PASS: config wired" || echo "FAIL"
grep "lspServiceClient.*shutdown" packages/core/src/config/config.ts && echo "PASS: shutdown wired" || echo "FAIL"

# Single orchestrator in LSP service
COUNT=$(grep -c "new Orchestrator" packages/lsp/src/main.ts)
[ "$COUNT" -eq 1 ] && echo "PASS" || echo "FAIL: $COUNT orchestrator instances"

# Full TypeScript compilation
cd packages/core && npx tsc --noEmit && echo "PASS: core compiles" || echo "FAIL"
cd packages/lsp && bunx tsc --noEmit && echo "PASS: lsp compiles" || echo "FAIL"
```

### Semantic Verification Checklist
- [ ] Config → LspServiceClient → Bun subprocess → Orchestrator → Language Servers (full chain)
- [ ] Edit → diagnostics flow works end-to-end
- [ ] Write → multi-file diagnostics flow works end-to-end
- [ ] MCP navigation tools registered and accessible
- [ ] Graceful degradation: no Bun → tools work normally
- [ ] Graceful degradation: service crash → tools continue
- [ ] Shutdown: all resources cleaned up
- [ ] Zero regressions in existing test suite

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
- Phase 35 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 35 to fix issues
3. Re-run Phase 35a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P35a.md`
