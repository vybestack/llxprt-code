# Phase 26a: Main Entry Point Verification

## Phase ID
`PLAN-20250212-LSP.P26a`

## Prerequisites
- Required: Phase 24 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P26" packages/lsp/src/main.ts`

## Verification Commands

```bash
# Tests pass
cd packages/lsp && bunx vitest run test/main.test.ts
# Expected: All pass

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|placeholder|for now)" packages/lsp/src/main.ts && echo "FAIL" || echo "PASS"

# Cop-out detection
grep -rn -E "(in a real|in production|ideally|not yet|will be|should be)" packages/lsp/src/main.ts && echo "FAIL" || echo "PASS"

# Single orchestrator instance
COUNT=$(grep -c "new Orchestrator" packages/lsp/src/main.ts)
[ "$COUNT" -eq 1 ] && echo "PASS: single orchestrator" || echo "FAIL: $COUNT orchestrator instances"

# Signal handlers present
grep -q "SIGTERM" packages/lsp/src/main.ts && echo "PASS: SIGTERM" || echo "FAIL: missing SIGTERM"
grep -q "SIGINT" packages/lsp/src/main.ts && echo "PASS: SIGINT" || echo "FAIL: missing SIGINT"

# Environment variable parsing
grep -q "LSP_BOOTSTRAP" packages/lsp/src/main.ts && echo "PASS" || echo "FAIL"

# Under 800 lines
LINES=$(wc -l < packages/lsp/src/main.ts)
[ "$LINES" -le 800 ] && echo "PASS: $LINES lines" || echo "FAIL: $LINES lines"

# TypeScript + lint
cd packages/lsp && bunx tsc --noEmit && bunx eslint src/main.ts
```

### Semantic Verification Checklist
- [ ] LSP_BOOTSTRAP is required (process exits with code 1 if missing)
- [ ] LSP_BOOTSTRAP.workspaceRoot must be non-empty string (exits if invalid)
- [ ] LSP_BOOTSTRAP.config is optional (defaults used if absent)
- [ ] Single orchestrator shared between RPC and MCP channels
- [ ] MCP channel skipped when navigationTools is false
- [ ] MCP channel failure is non-fatal (logged, diagnostics still work)
- [ ] Signal handlers shutdown orchestrator, close MCP, dispose RPC, exit
- [ ] Uncaught exceptions logged but don't crash process
- [ ] No stdout logging (stdout is the RPC channel)

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
- Phase 26 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 26 to fix issues
3. Re-run Phase 26a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P26a.md`
