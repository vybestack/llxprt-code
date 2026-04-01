# Phase 03a: Core Events Stub Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P03a`

## Prerequisites

- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20260325-MCPSTATUS.P03" packages/core/src/utils/events.ts`

## Verification Tasks

### 1. Enum Verification

```bash
# Verify McpClientUpdate exists in CoreEvent enum
grep "McpClientUpdate" packages/core/src/utils/events.ts
# Expected: McpClientUpdate = 'mcp-client-update'

# Verify unique string value (no duplicate)
grep -c "'mcp-client-update'" packages/core/src/utils/events.ts
# Expected: 1
```

### 2. Payload Interface Verification

```bash
# Verify McpClientUpdatePayload interface exists
grep -A 3 "interface McpClientUpdatePayload" packages/core/src/utils/events.ts
# Expected: interface with clients: ReadonlyMap<string, McpClient>

# Verify ReadonlyMap used (not mutable Map)
grep "ReadonlyMap.*McpClient" packages/core/src/utils/events.ts
# Expected: 1 match
```

### 3. CoreEvents Interface Entry

```bash
# Verify CoreEvents interface includes the new event
grep "McpClientUpdate.*McpClientUpdatePayload" packages/core/src/utils/events.ts
# Expected: 1 match
```

### 4. Overload Verification

```bash
# Verify on/off/emit overloads for McpClientUpdate
grep -c "CoreEvent.McpClientUpdate" packages/core/src/utils/events.ts
# Expected: 4+ (on, off, emit, interface entry)
```

### 5. TypeScript Compilation

```bash
npm run typecheck
# Expected: Exit code 0
```

### 6. No Duplicate Versions

```bash
find packages -name "*eventsV2*" -o -name "*eventsNew*"
# Expected: No results
```

### 7. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-MCPSTATUS.P03" packages/core/src/utils/events.ts
# Expected: 1+
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/utils/events.ts
# Expected: No new TODO/FIXME/HACK/STUB markers
```

## Success Criteria

- McpClientUpdate enum member exists
- McpClientUpdatePayload interface exported with correct type
- CoreEventEmitter overloads present
- CoreEvents interface includes new event
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
npm run typecheck && grep "McpClientUpdate" packages/core/src/utils/events.ts
# Expected behavior: TypeScript compiles, McpClientUpdate appears in enum + overloads
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] McpClientUpdate enum member has correct string value
- [ ] McpClientUpdatePayload uses ReadonlyMap (not mutable Map)
- [ ] CoreEventEmitter overloads match the pattern of existing events (UserFeedback, etc.)
- [ ] CoreEvents interface entry matches payload type

### Edge Cases Verified

- [ ] Enum value doesn't collide with any AppEvent values
- [ ] Import of McpClient type doesn't create circular dependency
- [ ] Existing events still compile with no changes

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P03a.md`
