# Phase 01: Domain Analysis

## Phase ID

`PLAN-20260325-MCPSTATUS.P01`

## Prerequisites

- Required: Phase 00a (Preflight Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P00a.md`
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

This phase produces the domain analysis artifact that informs all subsequent phases. It does not directly implement requirements but provides the foundation for:

- All REQ-EVT-* (Core Event System) — by analyzing current event architecture
- All REQ-MGR-* (MCP Client Manager) — by analyzing emit sites and state transitions
- All REQ-HOOK-* (useMcpStatus) — by analyzing Config API and discovery lifecycle
- All REQ-QUEUE-* (useMessageQueue) — by analyzing submission flow in AppContainer
- All REQ-GATE-* (Submission Gating) — by analyzing handleFinalSubmit and slash commands

## Implementation Tasks

### Files to Create

- `project-plans/gmerge-0.26.0/cebe386-plan/analysis/domain-model.md`
  - Entity relationships (CoreEventEmitter, McpClientManager, Config, AppContainer, hooks)
  - State transitions (MCP discovery lifecycle, message queue lifecycle, isMcpReady derivation)
  - Business rules (event bus routing, queue semantics, slash command bypass)
  - Edge cases (zero servers, hook mount after completion, partial failure, listener leak)
  - Error scenarios (COMPLETED without emit, appEvents/coreEvents mismatch, infinite loop)

### Analysis Must Cover

1. **Entity inventory**: All types, interfaces, and classes involved in MCP status propagation
2. **Data flow**: How MCP discovery state flows from McpClientManager → coreEvents → useMcpStatus → AppContainer → handleFinalSubmit
3. **Current gaps**: Missing getMcpServerCount, COMPLETED without emit, no existing gating
4. **Event bus architecture**: coreEvents vs appEvents — what uses which and why
5. **Submission flow**: How handleFinalSubmit currently works and what changes
6. **Race conditions**: Hook mount timing, queue flush loop, stale closures

## Verification Commands

### Automated Checks

```bash
# Verify domain model file exists
test -f project-plans/gmerge-0.26.0/cebe386-plan/analysis/domain-model.md && echo "OK" || echo "FAIL"

# Verify it covers all entities
grep -c "CoreEventEmitter\|McpClientManager\|Config\|AppContainer\|useMcpStatus\|useMessageQueue\|MCPDiscoveryState\|handleFinalSubmit" \
  project-plans/gmerge-0.26.0/cebe386-plan/analysis/domain-model.md
# Expected: 8+
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

- [ ] All entities from the specification are documented
- [ ] State transitions cover the full MCP discovery and queue lifecycle
- [ ] Business rules are explicit and verifiable
- [ ] Edge cases include zero-server, mount-after-complete, partial-failure scenarios
- [ ] No implementation code — analysis only

## Success Criteria

- Domain model document exists with all required sections
- All entities from specification are covered
- No implementation details leaked into analysis

## Failure Recovery

If this phase fails:
1. Re-read the specification (`specification.md`)
2. Re-examine the codebase at the specific file paths
3. Recreate the domain model

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P01.md`
