# Phase 10a: useMcpStatus TDD Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P10a`

## Prerequisites

- Required: Phase 10 completed
- Verification: `grep -r "@plan:PLAN-20260325-MCPSTATUS.P10" packages/cli/src/ui/hooks/useMcpStatus.test.tsx`

## Verification Tasks

### 1. Test Coverage

```bash
# Count test cases
grep -c "it(\|test(" packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: 7+

# Verify all isMcpReady truth table entries
grep -c "isMcpReady.*true\|isMcpReady.*false" packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: 4+ (true for COMPLETED, true for NOT_STARTED+0, false for IN_PROGRESS, false for NOT_STARTED+N)

# Verify cleanup test
grep -c "unmount\|off\|cleanup\|removeListener" packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: 1+
```

### 2. No Mock Theater

```bash
grep -c "toHaveBeenCalled\b\|toHaveBeenCalledWith\b" packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: 0 or minimal (vi.fn() as mock config is OK)
```

### 3. No Reverse Testing

```bash
grep -c "not\.toThrow\|NotYetImplemented" packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: 0
```

### 4. Tests Pass

```bash
npm test -- packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: All pass
```

### 5. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-MCPSTATUS.P10" packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: 1+
```

## Success Criteria

- All isMcpReady state combinations covered
- Event-driven updates tested
- Cleanup tested
- All tests pass
- Plan markers present

## Semantic Verification Checklist (MANDATORY)

### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read the requirement text
   - [ ] I read the implementation code (not just checked file exists)
   - [ ] I can explain HOW the requirement is fulfilled
2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments
3. **Would the test FAIL if implementation was removed?**
   - [ ] Test verifies actual outputs, not just that code ran
   - [ ] Test would catch a broken implementation
4. **Is the feature REACHABLE by users?**
   - [ ] Code is called from existing code paths
   - [ ] There's a path from UI/CLI/API to this code
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

### Feature Actually Works

```bash
# Manual test command (RUN THIS and paste actual output):
npm test -- packages/cli/src/ui/hooks/useMcpStatus.test.tsx 2>&1 | tail -20
# Expected behavior: All useMcpStatus tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Tests use real coreEvents for emission
- [ ] Tests verify payload handling (clients map size → mcpServerCount)
- [ ] Tests verify initialization from manager state
- [ ] Mock config pattern matches existing test patterns

### Edge Cases Verified

- [ ] No manager (null) → defaults to NOT_STARTED, 0, true
- [ ] Manager already COMPLETED at mount time
- [ ] Rapid event emissions don't cause issues
- [ ] Unmount cleanup prevents stale updates

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P10a.md`
