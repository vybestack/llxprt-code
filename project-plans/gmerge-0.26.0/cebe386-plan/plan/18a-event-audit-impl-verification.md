# Phase 18a: Event Audit Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P18a`

## Prerequisites

- Required: Phase 18 completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P18.md`

## Verification Tasks

### 1. String Literal Enforcement

```bash
# Raw string in all quoting forms — only enum definition should match
grep -rn "'mcp-client-update'\|\"mcp-client-update\"\|\`mcp-client-update\`" packages/core/src packages/cli/src integration-tests/
# Expected: Only 1 match — the CoreEvent enum value definition

# All emit sites use enum constant
grep -rn "CoreEvent.McpClientUpdate" packages/core/src/tools/mcp-client-manager.ts
# Expected: 6+ matches (all emit sites)

# All listen sites use enum constant
grep -rn "CoreEvent.McpClientUpdate" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 2+ matches (on + off)
```

### 2. AppEvent Deprecation

```bash
# AppEvent.McpClientUpdate removed or deprecated
grep -rn "AppEvent\.McpClientUpdate" packages/
# Expected: 0 active usages (only @deprecated annotation if kept)

# No imports of AppEvent for McpClientUpdate purposes
grep -rn "AppEvent" packages/cli/src/ui/AppContainer.tsx | grep -i "mcp"
# Expected: 0
```

### 3. Non-MCP Events Intact

```bash
# Extension events still work
grep -rn "extensionsStarting\|extensionsStopping" packages/core/src
# Expected: Still present

# CLI-specific appEvents still present
grep -rn "OpenDebugConsole\|OauthDisplayMessage\|Flicker" packages/cli/src/utils/events.ts
# Expected: All present

# coreEvents subscribers unaffected
grep -rn "UserFeedback\|MemoryChanged\|ModelChanged\|ConsoleLog" packages/core/src/utils/events.ts
# Expected: All present
```

### 4. Full Suite

```bash
npm run test
npm run typecheck
npm run lint
```

## Success Criteria

- Zero raw string literals outside enum definition
- AppEvent.McpClientUpdate removed/deprecated
- All non-MCP events intact
- Full suite passes

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
grep -rn "'mcp-client-update'\|\"mcp-client-update\"\|\`mcp-client-update\`" packages/core/src packages/cli/src integration-tests/ | wc -l
# Expected behavior: Exactly 1 match (the enum definition)
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] McpClientManager emits → coreEvents (CoreEvent.McpClientUpdate)
- [ ] useMcpStatus listens → coreEvents (CoreEvent.McpClientUpdate)
- [ ] No AppEvent.McpClientUpdate in any active code path
- [ ] Config.getExtensionEvents() still returns injected emitter
- [ ] Extension lifecycle events still use injected emitter (not coreEvents)

### Edge Cases Verified

- [ ] Test files may still contain raw strings in assertions — acceptable if testing the enum value
- [ ] Deprecation annotation (if used) has clear migration guidance
- [ ] No circular imports introduced between events files

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P18a.md`
