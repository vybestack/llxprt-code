# Phase 12a: useMessageQueue Stub Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P12a`

## Prerequisites

- Required: Phase 12 completed
- Verification: `grep -r "@plan:PLAN-20260325-MCPSTATUS.P12" packages/cli/src/ui/hooks/useMessageQueue.ts`

## Verification Tasks

### 1. File and Export

```bash
test -f packages/cli/src/ui/hooks/useMessageQueue.ts && echo "OK" || echo "FAIL"
grep "export function useMessageQueue" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 1 match
```

### 2. Gate Parameters

```bash
# All 4 gates referenced in the function signature or options type
grep "isConfigInitialized" packages/cli/src/ui/hooks/useMessageQueue.ts
grep "streamingState" packages/cli/src/ui/hooks/useMessageQueue.ts
grep "submitQuery" packages/cli/src/ui/hooks/useMessageQueue.ts
grep "isMcpReady" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: All match
```

### 3. Flush Logic

```bash
# One-at-a-time drain pattern
grep -c "setMessageQueue\|messageQueue" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 3+ (state, setter, condition)

# No message joining
grep "join\|concat\|combined\|merged" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 0
```

### 4. TypeScript Compilation

```bash
npm run typecheck
```

### 5. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-MCPSTATUS.P12" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 1+
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 0
```

## Success Criteria

- Hook exports useMessageQueue
- All 4 gate parameters accepted
- One-at-a-time flush (no joining)
- TypeScript compiles
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
npm run typecheck && grep "export function useMessageQueue" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected behavior: TypeScript compiles, hook is exported
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Accepts StreamingState type from existing types
- [ ] submitQuery signature matches useGeminiStream's return
- [ ] isMcpReady type matches useMcpStatus return
- [ ] Return type { messageQueue, addMessage } matches AppContainer needs

### Edge Cases Verified

- [ ] Empty queue + all gates open → no flush (nothing to submit)
- [ ] Non-empty queue + any gate closed → no flush
- [ ] addMessage with empty string → still queues (validation is caller's job)

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P12a.md`
