# Phase 06a: MCP Manager Stub Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P06a`

## Prerequisites

- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20260325-MCPSTATUS.P06" packages/core/src/tools/mcp-client-manager.ts`

## Verification Tasks

### 1. getMcpServerCount Verification

```bash
# Verify method exists
grep -A 3 "getMcpServerCount" packages/core/src/tools/mcp-client-manager.ts
# Expected: method returning this.clients.size
```

### 2. Emit Site Migration

```bash
# Zero remaining raw string emits
grep -c "'mcp-client-update'" packages/core/src/tools/mcp-client-manager.ts
# Expected: 0

# CoreEvent.McpClientUpdate usage count
grep -c "CoreEvent.McpClientUpdate" packages/core/src/tools/mcp-client-manager.ts
# Expected: 6+ (all migrated sites)

# Payload wrapper used
grep -c "{ clients: this.clients }" packages/core/src/tools/mcp-client-manager.ts
# Expected: 6+ (wrapped in McpClientUpdatePayload)

# coreEvents used instead of this.eventEmitter for MCP events
grep "this.eventEmitter.*emit.*mcp-client-update\|this.eventEmitter.*emit.*McpClientUpdate" packages/core/src/tools/mcp-client-manager.ts
# Expected: 0 matches (all should use coreEvents.emit)
```

### 3. Import Verification

```bash
# coreEvents import exists
grep "import.*coreEvents\|import.*CoreEvent" packages/core/src/tools/mcp-client-manager.ts
# Expected: 1+ matches
```

### 4. TypeScript Compilation

```bash
npm run typecheck
# Expected: Exit code 0
```

### 5. Existing Tests Still Pass

```bash
npm test -- packages/core/src/tools/mcp-client-manager.test.ts
# Expected: All existing tests pass (some may need adjustment if they verified emit on injected emitter)
```

### 6. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-MCPSTATUS.P06" packages/core/src/tools/mcp-client-manager.ts
# Expected: 1+
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/tools/mcp-client-manager.ts
# Expected: No new markers
```

## Success Criteria

- getMcpServerCount method exists
- All 6 emit sites migrated to coreEvents + CoreEvent.McpClientUpdate
- No raw 'mcp-client-update' strings
- TypeScript compiles
- Existing tests pass

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
npm run typecheck && npm test -- packages/core/src/tools/mcp-client-manager.test.ts
# Expected behavior: TypeScript compiles, MCP manager tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] getMcpServerCount returns this.clients.size (not hardcoded 0)
- [ ] coreEvents.emit used at all 6 sites (verified by grep)
- [ ] Payload wrapper { clients: this.clients } at all sites
- [ ] Import of coreEvents and CoreEvent present

### Edge Cases Verified

- [ ] Existing eventEmitter still passed for extension events (not removed)
- [ ] getMcpServerCount returns 0 when no clients
- [ ] Existing tests that may have verified old emit pattern updated

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P06a.md`
