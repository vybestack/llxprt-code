# Phase 20a: Integration Implementation Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P20a`

## Prerequisites

- Required: Phase 20 completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P20.md`

## Verification Tasks

### 1. Full Test Suite

```bash
npm run test
# Expected: ALL pass (unit + integration)
```

### 2. TypeScript, Lint, Format, Build

```bash
npm run typecheck
npm run lint
npm run format
npm run build
# Expected: All clean, no changes from format
```

### 3. Wiring Matrix Spot Check

```bash
# McpClientManager → coreEvents
grep "coreEvents.emit(CoreEvent.McpClientUpdate" packages/core/src/tools/mcp-client-manager.ts | wc -l
# Expected: 6+ emit sites

# useMcpStatus → coreEvents listener
grep "coreEvents.on(CoreEvent.McpClientUpdate" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 1 match

# useMcpStatus → cleanup
grep "coreEvents.off(CoreEvent.McpClientUpdate" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 1 match

# AppContainer → useMcpStatus + useMessageQueue
grep "useMcpStatus\|useMessageQueue" packages/cli/src/ui/AppContainer.tsx | wc -l
# Expected: 4+ (import + call for each)

# handleFinalSubmit → isSlashCommand
grep "isSlashCommand" packages/cli/src/ui/AppContainer.tsx
# Expected: 1+ match
```

### 4. Plan Marker Coverage

```bash
# All phases represented in codebase
for p in P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15 P16 P17 P18 P19 P20; do
  count=$(grep -r "@plan:PLAN-20260325-MCPSTATUS.$p" packages/core/src packages/cli/src integration-tests/ 2>/dev/null | wc -l)
  echo "$p: $count markers"
done
# Expected: All phases have 1+ markers
```

### 5. No Deferred Work

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/utils/events.ts packages/core/src/tools/mcp-client-manager.ts packages/cli/src/ui/hooks/useMcpStatus.ts packages/cli/src/ui/hooks/useMessageQueue.ts packages/cli/src/ui/AppContainer.tsx | grep -v ".test."
# Expected: 0
```

## Success Criteria

- All tests pass
- TypeScript, lint, format, build all clean
- Wiring matrix verified
- All phase markers present in codebase
- No deferred implementation

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
npm run test && npm run typecheck && npm run lint && npm run build 2>&1 | tail -30
# Expected behavior: All pass, clean build
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] McpClientManager → coreEvents → useMcpStatus → useMessageQueue → submitQuery: full chain works
- [ ] Slash commands bypass entire chain
- [ ] Zero-server startup: no gating, no messages, direct submit
- [ ] Non-MCP events: all unaffected
- [ ] Extension events: all unaffected
- [ ] Input history: preserved for both queued and direct paths
- [ ] Info message: once per discovery cycle

### Edge Cases Verified

- [ ] MCP re-discovery (mid-session config change) → info message resets
- [ ] Rapid prompt submission during MCP init → all queued in order
- [ ] Queue flush interrupted by new streaming → stops and waits
- [ ] Unmount during MCP init → no listener leaks

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P20a.md`
