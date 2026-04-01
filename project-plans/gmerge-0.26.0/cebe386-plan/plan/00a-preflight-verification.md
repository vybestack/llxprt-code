# Phase 0.5: Preflight Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P00a`

## Prerequisites

- Required: No prior phases — this is the entry point
- This phase MUST pass before ANY implementation phase begins

## Requirements Implemented (Expanded)

This phase does not implement requirements directly. It verifies all assumptions needed for implementation.

## Preflight Verification Tasks

### 1. Dependency Verification

| Dependency | Verification Command | Expected Status |
|------------|---------------------|-----------------|
| vitest | `npm ls vitest` | Installed |
| typescript | `npm ls typescript` | Installed |
| react | `npm ls react` | Installed |
| ink | `npm ls ink` | Installed |
| @testing-library/react | `npm ls @testing-library/react` | Installed |

```bash
# Verify the project builds cleanly before any changes
npm run typecheck
```

### 2. Type/Interface Verification

| Type Name | File | Expected | Verification Command |
|-----------|------|----------|---------------------|
| `CoreEvent` enum | `packages/core/src/utils/events.ts` | 7 members, no `McpClientUpdate` | `grep -c "McpClientUpdate" packages/core/src/utils/events.ts` → 0 |
| `MCPDiscoveryState` | `packages/core/src/tools/mcp-client.ts` | Enum with NOT_STARTED, IN_PROGRESS, COMPLETED | `grep -A 5 "enum MCPDiscoveryState" packages/core/src/tools/mcp-client.ts` |
| `McpClientManager.getDiscoveryState()` | `packages/core/src/tools/mcp-client-manager.ts` | Returns MCPDiscoveryState | `grep -n "getDiscoveryState" packages/core/src/tools/mcp-client-manager.ts` |
| `McpClientManager.getMcpServerCount()` | `packages/core/src/tools/mcp-client-manager.ts` | Does NOT exist yet | `grep -n "getMcpServerCount" packages/core/src/tools/mcp-client-manager.ts` → 0 |
| `Config.getMcpClientManager()` | `packages/core/src/config/config.ts` | Returns McpClientManager or undefined | `grep -n "getMcpClientManager" packages/core/src/config/config.ts` |
| `StreamingState` | `packages/cli/src/ui/hooks/useGeminiStream.ts` | Enum with Idle, Responding, WaitingForConfirmation | `grep -n "StreamingState" packages/cli/src/ui/hooks/useGeminiStream.ts \| head -3` |
| `AppEvent.McpClientUpdate` | `packages/cli/src/utils/events.ts` | Exists as `'mcp-client-update'` | `grep "McpClientUpdate" packages/cli/src/utils/events.ts` |

### 3. Call Path Verification

| Function | Expected Location | Verification Command |
|----------|-------------------|---------------------|
| `coreEvents` singleton | `packages/core/src/utils/events.ts` | `grep -n "export const coreEvents" packages/core/src/utils/events.ts` |
| `appEvents` singleton | `packages/cli/src/utils/events.ts` | `grep -n "export const appEvents" packages/cli/src/utils/events.ts` |
| `eventEmitter: appEvents` in CLI config | `packages/cli/src/config/config.ts:1508` | `grep -n "eventEmitter:" packages/cli/src/config/config.ts` |
| MCP emit sites (6 total) | `packages/core/src/tools/mcp-client-manager.ts` | `grep -cn "'mcp-client-update'" packages/core/src/tools/mcp-client-manager.ts` → 6 |
| `handleFinalSubmit` | `packages/cli/src/ui/AppContainer.tsx` | `grep -n "handleFinalSubmit" packages/cli/src/ui/AppContainer.tsx \| head -3` |
| `isSlashCommand` | `packages/cli/src/ui/utils/commandUtils.ts` | `grep -n "export.*isSlashCommand" packages/cli/src/ui/utils/commandUtils.ts` |
| Discovery state transitions | `packages/core/src/tools/mcp-client-manager.ts` | `grep -n "discoveryState\s*=" packages/core/src/tools/mcp-client-manager.ts` |
| COMPLETED without emit | `packages/core/src/tools/mcp-client-manager.ts:~240` | `grep -A5 "MCPDiscoveryState.COMPLETED" packages/core/src/tools/mcp-client-manager.ts` |

### 4. Non-Existence Verification

```bash
# useMcpStatus does NOT exist yet
ls packages/cli/src/ui/hooks/useMcpStatus* 2>&1
# Expected: "No such file or directory"

# useMessageQueue does NOT exist yet
ls packages/cli/src/ui/hooks/useMessageQueue* 2>&1
# Expected: "No such file or directory"

# getMcpServerCount does NOT exist yet
grep -n "getMcpServerCount" packages/core/src/tools/mcp-client-manager.ts
# Expected: no matches

# No MCP gating in useGeminiStream
grep -n "MCPDiscoveryState" packages/cli/src/ui/hooks/useGeminiStream.ts
# Expected: no matches

# No MCP gating in handleFinalSubmit
grep -A 20 "handleFinalSubmit" packages/cli/src/ui/AppContainer.tsx | grep -c "mcp\|MCP\|discovery"
# Expected: 0
```

### 5. Test Infrastructure Verification

| Component | Test File | Verification Command |
|-----------|-----------|---------------------|
| MCP Client Manager | `packages/core/src/tools/mcp-client-manager.test.ts` | `ls -la packages/core/src/tools/mcp-client-manager.test.ts` |
| Core events | (no dedicated test file) | `grep -rn "CoreEvent" packages/core/src --include="*.test.ts" \| head -5` |
| useGeminiStream | `packages/cli/src/ui/hooks/useGeminiStream.test.tsx` | `ls -la packages/cli/src/ui/hooks/useGeminiStream.test.tsx` |
| AppContainer (App test) | `packages/cli/src/ui/App.test.tsx` | `ls -la packages/cli/src/ui/App.test.tsx` |
| Test render utility | `packages/cli/src/test-utils/render.js` | `ls -la packages/cli/src/test-utils/render.*` |

### 6. File Existence Verification

```bash
# Core files to modify
ls -la packages/core/src/utils/events.ts
ls -la packages/core/src/tools/mcp-client-manager.ts
ls -la packages/core/src/tools/mcp-client.ts
ls -la packages/core/src/config/config.ts
ls -la packages/cli/src/ui/AppContainer.tsx
ls -la packages/cli/src/ui/hooks/useGeminiStream.ts
ls -la packages/cli/src/config/config.ts
ls -la packages/cli/src/utils/events.ts

# Test files
ls -la packages/core/src/tools/mcp-client-manager.test.ts
ls -la packages/cli/src/ui/hooks/useGeminiStream.test.tsx
ls -la packages/cli/src/ui/App.test.tsx

# Utility files
ls -la packages/cli/src/ui/utils/commandUtils.ts
```

### 7. Extension Event Audit

```bash
# Verify extension events use injected eventEmitter (NOT coreEvents)
grep -n "eventEmitter.*emit.*extensions" packages/core/src/utils/extensionLoader.ts
# Expected: 4 matches (extensionsStarting and extensionsStopping)

# Verify Config.getExtensionEvents returns eventEmitter
grep -n "getExtensionEvents" packages/core/src/config/config.ts
# Expected: Returns this.eventEmitter
```

## Verification Commands

```bash
# Run full typecheck to ensure clean baseline
npm run typecheck

# Run full test suite to ensure clean baseline
npm run test

# Verify build works
npm run build
```

## Preflight Verification Checklist

- [ ] All dependencies available (vitest, typescript, react, ink)
- [ ] `CoreEvent` enum has 7 members, no `McpClientUpdate`
- [ ] `MCPDiscoveryState` enum exists in core with 3 states
- [ ] `McpClientManager.getDiscoveryState()` exists
- [ ] `McpClientManager.getMcpServerCount()` does NOT exist (needs creation)
- [ ] `Config.getMcpClientManager()` exists
- [ ] `StreamingState` enum exists with Idle, Responding, WaitingForConfirmation
- [ ] `AppEvent.McpClientUpdate` exists in CLI events (will be deprecated)
- [ ] `coreEvents` singleton exported from core
- [ ] `appEvents` singleton exported from CLI
- [ ] CLI config passes `appEvents` as `eventEmitter` (line ~1508)
- [ ] 6 emit sites for `'mcp-client-update'` in MCP client manager
- [ ] `handleFinalSubmit` exists in AppContainer
- [ ] `isSlashCommand` exists in commandUtils
- [ ] COMPLETED transition does NOT currently emit (confirmed gap)
- [ ] `useMcpStatus` does NOT exist (needs creation)
- [ ] `useMessageQueue` does NOT exist (needs creation)
- [ ] No MCP gating in `useGeminiStream` (confirmed)
- [ ] Extension events use injected eventEmitter (not coreEvents)
- [ ] All test files exist for components being modified
- [ ] Baseline typecheck passes
- [ ] Baseline test suite passes
- [ ] Baseline build succeeds

## Blocking Issues Found

[To be filled during execution — any failed verification MUST be resolved before proceeding]

## Verification Gate

**This phase MUST pass before ANY implementation phase begins.**
- If ANY verification fails, update the plan FIRST
- Do NOT proceed with "we'll fix it later" mentality

## Success Criteria

- All checklist items verified
- No blocking issues remain
- Clean baseline: typecheck, tests, and build all pass

## Failure Recovery

If this phase fails:
1. Document which verifications failed
2. Update plan phases to account for discrepancies
3. Re-run preflight after plan updates

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
npm run typecheck && npm run test && npm run build
# Expected behavior: All pass — clean baseline established
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] All source files referenced in the plan exist on disk
- [ ] All test files referenced in the plan exist on disk
- [ ] All function signatures match plan expectations
- [ ] All line number references are within reasonable range

### Edge Cases Verified

- [ ] Missing getMcpServerCount method detected (documented — will be created in P06)
- [ ] COMPLETED transition without emit confirmed (documented — will be fixed in P08)
- [ ] No existing MCP gating confirmed (new feature, not refactor)

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P00a.md`
