# Phase 08a: MCP Manager Implementation Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P08a`

## Prerequisites

- Required: Phase 08 completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P08.md`

## Verification Tasks

### 1. Pseudocode Compliance

Compare implementation with `analysis/pseudocode/mcp-manager-emits.md`:

- [ ] Lines 01-29 (6 existing emit sites): All migrated to coreEvents + CoreEvent.McpClientUpdate
- [ ] Lines 31-40 (COMPLETED transition emit): Present immediately after state assignment
- [ ] Lines 41-50 (IN_PROGRESS transition emit): Present with NOT_STARTED guard
- [ ] Lines 51-64 (zero-server fast path): COMPLETED + emit + return

### 2. All Tests Pass

```bash
npm test -- packages/core/src/tools/mcp-client-manager.test.ts
# Expected: ALL pass (including new P07 tests)

npm run test
# Expected: Full suite passes
```

### 3. Comprehensive Emit Audit

```bash
# Count total CoreEvent.McpClientUpdate emit sites
grep -c "coreEvents.emit(CoreEvent.McpClientUpdate" packages/core/src/tools/mcp-client-manager.ts
# Expected: 8-9 (6 existing + COMPLETED + IN_PROGRESS + zero-server)

# Zero remaining raw strings
grep -c "'mcp-client-update'" packages/core/src/tools/mcp-client-manager.ts
# Expected: 0

# Verify COMPLETED path has emit
grep -B 2 -A 2 "MCPDiscoveryState.COMPLETED" packages/core/src/tools/mcp-client-manager.ts
# Expected: Each COMPLETED assignment is followed by a coreEvents.emit

# Verify no emit on injected eventEmitter for MCP events
grep "this.eventEmitter.*emit.*McpClientUpdate\|this.eventEmitter.*emit.*mcp-client-update" packages/core/src/tools/mcp-client-manager.ts
# Expected: 0
```

### 4. TypeScript and Lint

```bash
npm run typecheck
npm run lint
```

### 5. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-MCPSTATUS.P0[68]" packages/core/src/tools/mcp-client-manager.ts
# Expected: 2+
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/tools/mcp-client-manager.ts
# Expected: No new deferred work

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be)" packages/core/src/tools/mcp-client-manager.ts
# Expected: No cop-out comments

grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/tools/mcp-client-manager.ts | grep -v "\.test\."
# Expected: No empty returns in new implementation paths
```

## Success Criteria

- Pseudocode compliance confirmed
- All tests pass (unit + full suite)
- 8-9 emit sites all use coreEvents + CoreEvent.McpClientUpdate
- No raw string literals
- No emit on injected eventEmitter for MCP
- TypeScript compiles, lint passes

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
# Expected behavior: TypeScript compiles, all MCP manager tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] coreEvents.emit at COMPLETED transition (verified by reading code)
- [ ] coreEvents.emit at IN_PROGRESS transition (verified by reading code)
- [ ] Zero-server fast path: sets COMPLETED, emits, returns (verified by reading code)
- [ ] getMcpServerCount returns this.clients.size (verified by reading code)
- [ ] All existing emit sites migrated (verified by grep count)

### Edge Cases Verified

- [ ] Zero-server configuration → COMPLETED immediately
- [ ] All servers fail → still transitions to COMPLETED
- [ ] Single server succeeds → COMPLETED with populated clients map
- [ ] IN_PROGRESS only emitted once (not on every server)

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P08a.md`
