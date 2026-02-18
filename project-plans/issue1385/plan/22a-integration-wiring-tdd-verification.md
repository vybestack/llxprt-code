# Phase 22a: Integration Wiring — TDD Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P22a`

## Prerequisites
- Required: Phase 22 completed
- Verification: `test -f project-plans/issue1385/.completed/P22.md`

## Verification Commands

```bash
# Test file exists (note .spec.ts per RULES.md)
test -f packages/cli/src/ui/__tests__/integrationWiring.spec.ts || echo "FAIL"

# Plan markers
grep "@plan PLAN-20260214-SESSIONBROWSER.P22" packages/cli/src/ui/__tests__/integrationWiring.spec.ts || echo "FAIL"

# Test count
TOTAL=$(grep -c "it(" packages/cli/src/ui/__tests__/integrationWiring.spec.ts)
echo "Total tests: $TOTAL"
# Expected: 15+

# Covers command registration
grep -c "register\|BuiltinCommand" packages/cli/src/ui/__tests__/integrationWiring.spec.ts
# Expected: 2+

# Covers dialog routing
grep -c "dialog\|sessionBrowser\|isSessionBrowserDialogOpen" packages/cli/src/ui/__tests__/integrationWiring.spec.ts
# Expected: 3+

# Covers metadata
grep -c "metadata\|SessionRecordingMetadata\|isResumed" packages/cli/src/ui/__tests__/integrationWiring.spec.ts
# Expected: 2+

# No mock theater
grep "toHaveBeenCalled\|vi.mock\|jest.mock" packages/cli/src/ui/__tests__/integrationWiring.spec.ts && echo "FAIL" || echo "OK"

# Tests fail against stubs
cd packages/cli && npx vitest run src/ui/__tests__/integrationWiring.spec.ts 2>&1 | tail -10
# Expected: FAIL
```

### Semantic Verification Checklist (YES/NO)
- [ ] YES/NO: Tests verify the glue code, not the individual components?
- [ ] YES/NO: Tests cover command → dialog → component chain?
- [ ] YES/NO: Tests cover metadata lifecycle (startup, resume, update)?
- [ ] YES/NO: Tests verify existing dialogs still work?
- [ ] YES/NO: Tests use behavioral assertions (state changes, return values), not mock theater?

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/__tests__/integrationWiring.spec.ts
rm -f packages/cli/src/ui/__tests__/integrationWiring.spec.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P22a.md`
