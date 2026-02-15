# Phase 33a: Config Integration Verification

## Phase ID
`PLAN-20250212-LSP.P33a`

## Prerequisites
- Required: Phase 31 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P33" packages/core/src/config/config.ts`

## Verification Commands

```bash
# LSP config integration tests pass
npx vitest run packages/core/src/config/__tests__/config-lsp-integration.test.ts
# Expected: All pass

# Existing config tests still pass (no regression)
npx vitest run packages/core/src/config/__tests__/config.test.ts
# Expected: All pass

# No modifications to existing config tests
git diff --name-only packages/core/src/config/__tests__/config.test.ts && echo "FAIL: existing tests modified" || echo "PASS"

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|placeholder|for now)" packages/core/src/config/config.ts | grep -i "lsp" && echo "FAIL" || echo "PASS"

# Accessor methods present
grep -q "getLspServiceClient" packages/core/src/config/config.ts && echo "PASS" || echo "FAIL"
grep -q "getLspConfig" packages/core/src/config/config.ts && echo "PASS" || echo "FAIL"

# Shutdown in cleanup
grep -B2 -A5 "lspServiceClient.*shutdown\|shutdown.*lspServiceClient" packages/core/src/config/config.ts | head -10

# TypeScript + lint
cd packages/core && npx tsc --noEmit
```

### Semantic Verification Checklist
- [ ] `lsp: false` → no LspServiceClient created, accessors return undefined
- [ ] `lsp` absent → treated as enabled with defaults
- [ ] `lsp: { ... }` → enabled with user overrides
- [ ] LspServiceClient.start() called in initialize()
- [ ] isAlive() checked after start() before registering MCP
- [ ] navigationTools false → MCP registration skipped
- [ ] LspServiceClient.shutdown() called in cleanup
- [ ] Startup failure is non-fatal (logged, LSP disabled)
- [ ] Uses direct MCP SDK Client.connect(fdTransport) for LSP nav registration in config.ts (NOT McpClientManager)

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
- Phase 33 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 33 to fix issues
3. Re-run Phase 33a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P33a.md`
