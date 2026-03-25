# Phase 21: Final Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P21`

## Prerequisites

- Required: Phase 20a (Integration Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P20a.md`
- Expected: ALL prior phases completed and verified

## Requirements Implemented

### REQ-TEST-006: Full Verification Suite

**Full Text**: All changes shall pass the full LLxprt verification suite.
**Behavior**:
- GIVEN: All phases P03-P20 complete
- WHEN: Full verification suite runs
- THEN: All checks pass
**Why This Matters**: Final gate before the feature is declared complete.

## Implementation Tasks

This phase has NO implementation tasks — it is a pure verification gate. No code changes are made in this phase.

## Full Verification Suite

Run EVERY command below in sequence. ALL must pass.

### 1. Unit Tests

```bash
npm run test
# Expected: ALL pass, 0 failures
```

### 2. Lint

```bash
npm run lint
# Expected: 0 errors, 0 warnings (or pre-existing warnings only)
```

### 3. TypeScript

```bash
npm run typecheck
# Expected: 0 errors
```

### 4. Format

```bash
npm run format
# Expected: No files changed (code already formatted)
```

### 5. Build

```bash
npm run build
# Expected: Success, no errors
```

### 6. Smoke Test

```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
# Expected: Haiku generated successfully, no crashes, no MCP-related errors
```

### 7. String Literal Enforcement

```bash
grep -rn "'mcp-client-update'\|\"mcp-client-update\"\|\`mcp-client-update\`" packages/core/src packages/cli/src integration-tests/ | grep -v node_modules
# Expected: Only 1 match — the CoreEvent enum definition line
```

### 8. Plan Marker Audit

```bash
# All implementation phases have markers in codebase
for p in P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15 P16 P17 P18 P19 P20; do
  count=$(grep -r "@plan:PLAN-20260325-MCPSTATUS.$p" packages/core/src packages/cli/src integration-tests/ 2>/dev/null | wc -l)
  echo "$p: $count markers"
done
# Expected: All phases have 1+ markers
```

### 9. Deferred Implementation Sweep

```bash
# No TODO/FIXME/HACK/STUB in MCP-related files
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" \
  packages/core/src/utils/events.ts \
  packages/core/src/tools/mcp-client-manager.ts \
  packages/cli/src/ui/hooks/useMcpStatus.ts \
  packages/cli/src/ui/hooks/useMessageQueue.ts \
  packages/cli/src/ui/AppContainer.tsx \
  packages/cli/src/utils/events.ts \
  | grep -v ".test."
# Expected: 0 matches

# No cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|will be implemented)" \
  packages/core/src/utils/events.ts \
  packages/core/src/tools/mcp-client-manager.ts \
  packages/cli/src/ui/hooks/useMcpStatus.ts \
  packages/cli/src/ui/hooks/useMessageQueue.ts \
  packages/cli/src/ui/AppContainer.tsx \
  packages/cli/src/utils/events.ts
# Expected: 0 matches
```

### 10. Requirement Traceability

```bash
# All requirement areas have markers
for area in EVT MGR HOOK QUEUE GATE UI CFG TEST; do
  count=$(grep -r "@requirement.*REQ-${area}" packages/core/src packages/cli/src integration-tests/ 2>/dev/null | wc -l)
  echo "REQ-${area}: $count references"
done
# Expected: All areas have 1+ references
```

## Requirements Verification Summary

| Requirement | Component | Status |
|-------------|-----------|--------|
| REQ-EVT-001 | CoreEvent.McpClientUpdate defined | [ ] |
| REQ-EVT-002 | McpClientUpdatePayload typed | [ ] |
| REQ-EVT-003 | Single source of truth for event name | [ ] |
| REQ-EVT-004 | CoreEventEmitter typed overloads | [ ] |
| REQ-EVT-005 | Non-MCP events unaffected | [ ] |
| REQ-MGR-001 | Emit on COMPLETED transition | [ ] |
| REQ-MGR-002 | Emit on IN_PROGRESS transition | [ ] |
| REQ-MGR-003 | Emit on client map change | [ ] |
| REQ-MGR-004 | Emit on zero-server fast path | [ ] |
| REQ-MGR-005 | Server count accessible | [ ] |
| REQ-MGR-006 | Emit via coreEvents | [ ] |
| REQ-HOOK-001 | Initial state from manager | [ ] |
| REQ-HOOK-002 | Reactive state updates | [ ] |
| REQ-HOOK-003 | isMcpReady derivation | [ ] |
| REQ-HOOK-004 | Listener cleanup | [ ] |
| REQ-HOOK-005 | Hook return shape | [ ] |
| REQ-QUEUE-001 | Queue creation | [ ] |
| REQ-QUEUE-002 | Gate parameters | [ ] |
| REQ-QUEUE-003 | Auto-flush when gates open | [ ] |
| REQ-QUEUE-004 | No flush while streaming | [ ] |
| REQ-QUEUE-005 | No flush while MCP not ready | [ ] |
| REQ-QUEUE-006 | FIFO ordering | [ ] |
| REQ-GATE-001 | Slash command immediate execution | [ ] |
| REQ-GATE-002 | Prompt queuing when MCP not ready | [ ] |
| REQ-GATE-003 | Prompt direct submission when ready | [ ] |
| REQ-GATE-004 | Input history preserved | [ ] |
| REQ-GATE-005 | Non-idle prompt queuing | [ ] |
| REQ-UI-001 | First-queue info message | [ ] |
| REQ-UI-002 | No message on zero-server | [ ] |
| REQ-CFG-001 | MCP event propagation via coreEvents | [ ] |
| REQ-TEST-001 | useMcpStatus unit tests | [ ] |
| REQ-TEST-002 | useMessageQueue unit tests | [ ] |
| REQ-TEST-003 | McpClientManager emit tests | [ ] |
| REQ-TEST-004 | AppContainer integration tests | [ ] |
| REQ-TEST-005 | String literal enforcement | [ ] |
| REQ-TEST-006 | Full verification suite | [ ] |


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

## Semantic Verification Checklist (MANDATORY)

### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] Read each REQ in the traceability matrix
   - [ ] Confirmed implementation exists for each
   - [ ] Can trace HOW each requirement is fulfilled

2. **Is this a REAL implementation or a placeholder?**
   - [ ] Deferred implementation detection passed across entire codebase
   - [ ] No empty returns in any MCP/queue/gating code
   - [ ] No "will be implemented" comments

3. **Would the tests FAIL if implementation was removed?**
   - [ ] Tests verify actual outputs, not just that code ran
   - [ ] Tests would catch a broken implementation

4. **Is the feature REACHABLE by users?**
   - [ ] MCP readiness gating is wired into AppContainer
   - [ ] Queue actually holds and releases prompts
   - [ ] Info message actually renders

5. **What's MISSING?**
   - [ ] List any gaps found during full verification

### Feature Actually Works

```bash
# Smoke test with MCP servers configured:
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
# Expected: Starts successfully, MCP servers discovered, prompt processed
```

### Integration Points Verified

- [ ] CoreEvent.McpClientUpdate emitted by McpClientManager
- [ ] useMcpStatus receives events and tracks readiness
- [ ] useMessageQueue gates on isMcpReady + isConfigInitialized + streamingIdle
- [ ] AppContainer uses handleFinalSubmit gating
- [ ] Slash commands bypass queue

### Edge Cases Verified

- [ ] Zero MCP servers → immediate readiness
- [ ] Late hook mount → initializes from current state
- [ ] Discovery cycle reset → info message counter resets
- [ ] Non-MCP events on appEvents still function

## Success Criteria

- ALL 10 verification steps pass
- ALL 36 requirements checked off
- Zero deferred implementation
- Smoke test completes successfully

## Failure Recovery

If any verification step fails:
1. Identify the specific failure
2. Trace back to the phase that should have caught it
3. Fix at the source — do NOT patch around it
4. Re-run full verification from step 1

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P21.md`
Contents:

```markdown
Phase: P21
Completed: [DATE]
Verification Results:
  - npm run test: PASS
  - npm run lint: PASS
  - npm run typecheck: PASS
  - npm run format: PASS (no changes)
  - npm run build: PASS
  - Smoke test: PASS
  - String literal enforcement: PASS
  - Plan marker audit: PASS
  - Deferred implementation sweep: PASS
  - Requirement traceability: PASS
All 36 requirements verified.
Feature: MCP Status Hook Refactor — COMPLETE
```
