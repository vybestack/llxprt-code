# Phase 07a: MCP Manager TDD Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P07a`

## Prerequisites

- Required: Phase 07 completed
- Verification: `grep -r "@plan:PLAN-20260325-MCPSTATUS.P07" packages/core/src/tools/mcp-client-manager.test.ts`

## Verification Tasks

### 1. Test Coverage

```bash
# Count new MCP emit tests
grep -c "CoreEvent.McpClientUpdate\|McpClientUpdate" packages/core/src/tools/mcp-client-manager.test.ts
# Expected: 5+ (one per test scenario)

# Verify COMPLETED transition test exists
grep -c "COMPLETED.*emit\|emit.*COMPLETED\|transition.*COMPLETED" packages/core/src/tools/mcp-client-manager.test.ts
# Expected: 1+

# Verify zero-server test exists
grep -c "zero.*server\|no.*server\|empty.*config\|0.*server" packages/core/src/tools/mcp-client-manager.test.ts
# Expected: 1+

# Verify getMcpServerCount test exists
grep -c "getMcpServerCount" packages/core/src/tools/mcp-client-manager.test.ts
# Expected: 1+
```

### 2. No Mock Theater

```bash
# Tests should listen on real coreEvents, not mock it
grep -c "vi.mock.*events\|jest.mock.*events" packages/core/src/tools/mcp-client-manager.test.ts
# Expected: 0 (tests should use real coreEvents)
```

### 3. No Reverse Testing

```bash
grep -c "not\.toThrow\|NotYetImplemented" packages/core/src/tools/mcp-client-manager.test.ts
# Expected: 0
```

### 4. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-MCPSTATUS.P07" packages/core/src/tools/mcp-client-manager.test.ts
# Expected: 1+
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/tools/mcp-client-manager.test.ts
# Expected: No matches in new tests
```

## Success Criteria

- Tests cover COMPLETED, IN_PROGRESS, client change, zero-server, and getMcpServerCount
- Tests use real coreEvents (no mocking the event system)
- No mock theater or reverse testing
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
npm test -- packages/core/src/tools/mcp-client-manager.test.ts 2>&1 | tail -30
# Expected behavior: Some tests pass (existing emit sites), some may fail (new emits in P08)
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Tests listen on real coreEvents singleton
- [ ] Tests verify payload has { clients: Map } shape
- [ ] Tests verify discoveryState transitions
- [ ] Tests clean up listeners after each test

### Edge Cases Verified

- [ ] Zero-server case tested
- [ ] COMPLETED transition with mixed success/failure servers tested
- [ ] getMcpServerCount with 0 clients tested

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P07a.md`
