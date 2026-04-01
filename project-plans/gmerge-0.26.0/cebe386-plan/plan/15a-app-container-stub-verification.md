# Phase 15a: AppContainer Stub Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P15a`

## Prerequisites

- Required: Phase 15 completed
- Verification: `grep -r "@plan:PLAN-20260325-MCPSTATUS.P15" packages/cli/src/ui/AppContainer.tsx`

## Verification Tasks

### 1. Hook Integration

```bash
# useMcpStatus wired
grep "useMcpStatus" packages/cli/src/ui/AppContainer.tsx | wc -l
# Expected: 2+ (import + call)

# useMessageQueue wired
grep "useMessageQueue" packages/cli/src/ui/AppContainer.tsx | wc -l
# Expected: 2+ (import + call)
```

### 2. Gating Logic

```bash
# Slash command bypass
grep "isSlashCommand" packages/cli/src/ui/AppContainer.tsx | wc -l
# Expected: 2+ (import + usage)

# Queue path
grep "addMessage" packages/cli/src/ui/AppContainer.tsx | wc -l
# Expected: 2+ (destructuring + call in handleFinalSubmit)

# Direct submit path
grep "submitQuery" packages/cli/src/ui/AppContainer.tsx | wc -l
# Expected: 3+ (destructuring + slash path + direct path)
```

### 3. Info Message Tracking

```bash
# useRef for message flag
grep "hasShownMcpQueueMessage" packages/cli/src/ui/AppContainer.tsx | wc -l
# Expected: 3+ (declaration, reset in useEffect, check in handleFinalSubmit)

# Reset on IN_PROGRESS
grep -A 3 "hasShownMcpQueueMessage" packages/cli/src/ui/AppContainer.tsx | grep "IN_PROGRESS"
# Expected: 1+ match
```

### 4. Input History Preservation

```bash
# addInput before branch (verify order by proximity)
grep -n "addInput\|isSlashCommand\|addMessage" packages/cli/src/ui/AppContainer.tsx
# Expected: addInput line number < isSlashCommand line number < addMessage line number
```

### 5. TypeScript Compilation

```bash
npm run typecheck
```

### 6. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-MCPSTATUS.P15" packages/cli/src/ui/AppContainer.tsx
# Expected: 1+
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/cli/src/ui/AppContainer.tsx | grep -i "mcp\|queue\|gate\|slash"
# Expected: 0

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/ui/AppContainer.tsx | grep -i "mcp\|queue\|gate"
# Expected: 0
```

## Success Criteria

- useMcpStatus and useMessageQueue hooks wired
- Gating logic with slash bypass present
- Info message tracking via useRef with IN_PROGRESS reset
- Input history preserved before branch
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
npm run typecheck && grep -n "handleFinalSubmit\|isSlashCommand\|addMessage\|isMcpReady" packages/cli/src/ui/AppContainer.tsx | head -20
# Expected behavior: TypeScript compiles, gating logic visible in AppContainer
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] useMcpStatus receives Config from AppContainer's existing prop/context
- [ ] useMessageQueue receives streamingState and submitQuery from useGeminiStream
- [ ] useMessageQueue receives isMcpReady from useMcpStatus
- [ ] isSlashCommand imported from correct utils path
- [ ] coreEvents.emitFeedback available for info message
- [ ] handleFinalSubmit dependency array includes all read variables

### Edge Cases Verified

- [ ] Empty string submission → early return before gating logic
- [ ] Whitespace-only submission → early return (trimmedValue is empty)
- [ ] Slash command during streaming → still executes immediately
- [ ] Multiple rapid submissions while MCP not ready → all queued in order

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P15a.md`
