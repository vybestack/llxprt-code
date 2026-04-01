# Phase 04a: Core Events TDD Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P04a`

## Prerequisites

- Required: Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20260325-MCPSTATUS.P04" packages/core/src/utils/events.test.ts`

## Verification Tasks

### 1. Test Coverage

```bash
# Count McpClientUpdate tests
grep -c "it\|test(" packages/core/src/utils/events.test.ts
# Track: total tests

# Verify emit/listen round-trip test exists
grep -c "emit.*McpClientUpdate\|McpClientUpdate.*emit" packages/core/src/utils/events.test.ts
# Expected: 1+

# Verify cleanup test exists
grep -c "off.*McpClientUpdate\|removeListener.*McpClientUpdate" packages/core/src/utils/events.test.ts
# Expected: 1+
```

### 2. No Mock Theater

```bash
grep -c "toHaveBeenCalled\b\|toHaveBeenCalledWith\b" packages/core/src/utils/events.test.ts
# Expected: 0 or minimal (vi.fn() as listener is OK, mock theater on implementations is not)
```

### 3. No Reverse Testing

```bash
grep -c "not\.toThrow\|NotYetImplemented" packages/core/src/utils/events.test.ts
# Expected: 0
```

### 4. Tests Pass

```bash
npm test -- packages/core/src/utils/events.test.ts
# Expected: All pass
```

### 5. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-MCPSTATUS.P04" packages/core/src/utils/events.test.ts
# Expected: 1+
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/utils/events.test.ts
# Expected: No matches
```

## Success Criteria

- Tests verify enum value, emit/listen round-trip, cleanup, non-interference
- No mock theater or reverse testing
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
npm test -- packages/core/src/utils/events.test.ts 2>&1 | tail -20
# Expected behavior: All McpClientUpdate tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Tests use the real coreEvents singleton (not a mock)
- [ ] Tests clean up listeners after each test (no leak between tests)
- [ ] Tests verify payload type correctness at runtime

### Edge Cases Verified

- [ ] Empty clients map payload handled
- [ ] Listener removal verified (no calls after off)
- [ ] Non-interference with existing event types verified

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P04a.md`
