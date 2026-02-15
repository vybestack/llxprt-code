# Phase 13a: Server Registry Stub Verification

## Phase ID
`PLAN-20250212-LSP.P13a`

## Prerequisites
- Required: Phase 13 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P13" packages/lsp/src/service/server-registry.ts`

## Verification Commands

```bash
cd packages/lsp && bunx tsc --noEmit && echo "PASS" || echo "FAIL"
grep "export interface ServerRegistryEntry" packages/lsp/src/service/server-registry.ts && echo "PASS" || echo "FAIL"
grep "export function getBuiltinServers" packages/lsp/src/service/server-registry.ts && echo "PASS" || echo "FAIL"
grep "export function getServersForExtension" packages/lsp/src/service/server-registry.ts && echo "PASS" || echo "FAIL"
grep "export function mergeUserConfig" packages/lsp/src/service/server-registry.ts && echo "PASS" || echo "FAIL"
LINES=$(wc -l < packages/lsp/src/service/server-registry.ts)
[ "$LINES" -le 80 ] && echo "PASS" || echo "FAIL"
```

### Semantic Verification Checklist
- [ ] Interface matches pseudocode server-registry.md
- [ ] Stubs return empty values
- [ ] Compiles

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
- Phase 13 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 13 to fix issues
3. Re-run Phase 13a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P13a.md`
