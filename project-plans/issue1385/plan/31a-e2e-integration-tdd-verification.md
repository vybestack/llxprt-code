# Phase 31a: End-to-End Integration — TDD Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P31a`

## Prerequisites

- Required: Phase 31 completed
- Verification: `test -f project-plans/issue1385/.completed/P31.md`

## Verification Commands

### Automated Checks

```bash
# 1. Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P31" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 15+

# 2. All requirements covered
for req in REQ-SW-001 REQ-SW-002 REQ-SW-006 REQ-SW-007 REQ-EN-001 REQ-EN-002 REQ-EN-004 REQ-CV-001 REQ-CV-002 REQ-EH-001 REQ-PR-001 REQ-PR-003; do
  count=$(grep -c "@requirement:$req" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# 3. Test count
grep -c "it(" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 19+

# 4. Property tests
grep -c "fc\.\|fast-check" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 3+

# 5. Forbidden patterns
grep -n "vi.mock\|jest.mock\|toHaveBeenCalled\|NotYetImplemented" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 0

# 6. Uses real filesystem
grep -c "mkdtemp\|tmpdir\|writeFile\|readFile" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 2+ (real filesystem operations)
```

### Semantic Verification Checklist

1. **Do tests cover the full integration flow?**
   - [ ] Resume via performResume → core resumeSession
   - [ ] Two-phase swap verification
   - [ ] History conversion (IContent → HistoryItem)
   - [ ] Error propagation

2. **Are tests truly end-to-end (not unit)?**
   - [ ] Tests exercise multiple components together
   - [ ] Tests use real JSONL files
   - [ ] Tests verify real side effects

### Pass/Fail Criteria

- **PASS**: 19+ tests, 12+ requirements covered, property tests present, no mocks
- **FAIL**: Missing tests, missing requirements, or mock theater

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P31a.md`
