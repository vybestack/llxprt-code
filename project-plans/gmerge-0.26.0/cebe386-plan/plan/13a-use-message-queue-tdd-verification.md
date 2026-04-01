# Phase 13a: useMessageQueue TDD Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P13a`

## Prerequisites

- Required: Phase 13 completed
- Verification: `grep -r "@plan:PLAN-20260325-MCPSTATUS.P13" packages/cli/src/ui/hooks/useMessageQueue.test.tsx`

## Verification Tasks

### 1. Test Coverage

```bash
# Count test cases
grep -c "it(\|test(" packages/cli/src/ui/hooks/useMessageQueue.test.tsx
# Expected: 8+

# FIFO test exists
grep -c "FIFO\|fifo\|order\|first.*second.*third\|A.*B.*C" packages/cli/src/ui/hooks/useMessageQueue.test.tsx
# Expected: 1+

# Gate tests exist
grep -c "not.*ready\|not.*idle\|not.*initialized\|streaming.*Responding\|while.*streaming\|while.*MCP" packages/cli/src/ui/hooks/useMessageQueue.test.tsx
# Expected: 3+
```

### 2. No Mock Theater

```bash
grep -c "toHaveBeenCalled\b" packages/cli/src/ui/hooks/useMessageQueue.test.tsx
# Expected: Limited — submitQuery is a vi.fn() so toHaveBeenCalledWith is OK here
# But should have behavioral assertions too (queue length, contents)
```

### 3. Tests Pass

```bash
npm test -- packages/cli/src/ui/hooks/useMessageQueue.test.tsx
# Expected: All pass
```

### 4. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-MCPSTATUS.P13" packages/cli/src/ui/hooks/useMessageQueue.test.tsx
# Expected: 1+
```

## Success Criteria

- 8+ tests covering all requirements
- FIFO and gate tests present
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
npm test -- packages/cli/src/ui/hooks/useMessageQueue.test.tsx 2>&1 | tail -20
# Expected behavior: All useMessageQueue tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Tests use StreamingState enum from existing types
- [ ] submitQuery mock matches signature from useGeminiStream
- [ ] isMcpReady boolean matches useMcpStatus return
- [ ] Queue contents verified (not just length)

### Edge Cases Verified

- [ ] Empty queue with all gates open → no crash, no submit
- [ ] Single message queued and flushed
- [ ] Multiple messages in FIFO order
- [ ] Each gate tested individually as the blocking condition

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P13a.md`
