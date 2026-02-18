# Phase 13a: useSessionBrowser Hook — TDD Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P13a`

## Prerequisites
- Required: Phase 13 completed
- Verification: `test -f project-plans/issue1385/.completed/P13.md`

## Verification Commands

```bash
# Test file exists
test -f packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P13" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
# Expected: 1+

# Test count
TOTAL=$(grep -c "it(" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts)
echo "Total tests: $TOTAL"
# Expected: 60+

# Property tests
PROP=$(grep -c "fc\.\|property" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts)
echo "Property tests: $PROP"
# Expected: 5+

# Category coverage
echo "Loading: $(grep -c 'isLoading\|load' packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts)"
echo "Search: $(grep -c 'search\|filter' packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts)"
echo "Sort: $(grep -c 'sort\|newest\|oldest\|size' packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts)"
echo "Pagination: $(grep -c 'page\|PgUp\|PgDn' packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts)"
echo "Delete: $(grep -c 'delete\|Delete\|confirm' packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts)"
echo "Resume: $(grep -c 'resume\|Resume\|onSelect' packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts)"
echo "Escape: $(grep -c 'escape\|Escape\|close' packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts)"

# No mock theater
grep -c "vi.mock\|jest.mock" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
# Expected: 0 (or minimal for module resolution only)

# No reverse testing
grep "not.toThrow\|NotYetImplemented" packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts && echo "FAIL: reverse testing" || echo "OK"

# Tests fail against stub
cd packages/cli && npx vitest run src/ui/hooks/__tests__/useSessionBrowser.spec.ts 2>&1 | tail -10
# Expected: FAIL
```

### Semantic Verification Checklist
- [ ] Tests verify actual state changes (searchTerm, sortOrder, selectedIndex, page)
- [ ] Tests verify modal priority stack (delete confirm > conversation confirm > isResuming)
- [ ] Tests verify escape precedence (4-level priority)
- [ ] Tests verify search filtering logic (preview, provider, model, not-yet-loaded)
- [ ] Tests verify pagination (20 per page, PgUp/PgDn, bounds)
- [ ] Tests verify delete flow (confirmation, deletion, selection preservation)
- [ ] Tests verify resume flow (isResuming, success -> close, failure -> error)
- [ ] Property tests verify invariants (selection in bounds, page in bounds, sort order)

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
rm -f packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P13a.md`
