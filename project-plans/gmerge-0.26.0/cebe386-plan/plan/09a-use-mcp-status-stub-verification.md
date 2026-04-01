# Phase 09a: useMcpStatus Stub Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P09a`

## Prerequisites

- Required: Phase 09 completed
- Verification: `grep -r "@plan:PLAN-20260325-MCPSTATUS.P09" packages/cli/src/ui/hooks/useMcpStatus.ts`

## Verification Tasks

### 1. File Exists and Exports

```bash
test -f packages/cli/src/ui/hooks/useMcpStatus.ts && echo "OK" || echo "FAIL"
grep "export function useMcpStatus" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 1 match
```

### 2. State Initialization

```bash
# Verify useState initializes from manager
grep "getMcpClientManager\|getDiscoveryState\|getMcpServerCount" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 2+ (initializing discoveryState and mcpServerCount)
```

### 3. Event Subscription

```bash
# Verify useEffect with coreEvents subscription
grep "coreEvents.on.*McpClientUpdate\|CoreEvent.McpClientUpdate" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 1+ (in useEffect)

# Verify cleanup
grep "coreEvents.off" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 1+
```

### 4. isMcpReady Derivation

```bash
# Verify isMcpReady logic
grep "COMPLETED\|NOT_STARTED.*mcpServerCount.*0\|isMcpReady" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 2+ (derivation logic)
```

### 5. Return Shape

```bash
grep -A 5 "return" packages/cli/src/ui/hooks/useMcpStatus.ts | tail -10
# Expected: { discoveryState, mcpServerCount, isMcpReady }
```

### 6. TypeScript Compilation

```bash
npm run typecheck
```

### 7. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-MCPSTATUS.P09" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 1+
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: No matches
```

## Success Criteria

- Hook file exists with correct export
- State initialization from manager verified
- Event subscription with cleanup verified
- isMcpReady derivation logic verified
- Return shape correct
- TypeScript compiles

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
npm run typecheck && grep "export function useMcpStatus" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected behavior: TypeScript compiles, hook is exported
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Hook accepts Config parameter (matching AppContainer's config)
- [ ] Uses coreEvents singleton (same as McpClientManager emits to)
- [ ] Uses MCPDiscoveryState enum from core
- [ ] Return type is compatible with useMessageQueue and AppContainer

### Edge Cases Verified

- [ ] Config with no McpClientManager (returns NOT_STARTED, 0, true)
- [ ] Config with manager already COMPLETED
- [ ] Config with manager at IN_PROGRESS

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P09a.md`
