# Phase 02: Pseudocode Development

## Phase ID

`PLAN-20260325-MCPSTATUS.P02`

## Prerequisites

- Required: Phase 01a (Analysis Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P01a.md`
- Expected files from previous phase: `analysis/domain-model.md`

## Requirements Implemented (Expanded)

This phase produces numbered pseudocode that will be referenced line-by-line in implementation phases. Covers all five implementation domains:

1. **Core Events** (REQ-EVT-001, EVT-002, EVT-003, EVT-004) — Enum, payload, overloads
2. **MCP Manager Emits** (REQ-MGR-001 through MGR-006) — Emit migration, COMPLETED emit, getMcpServerCount
3. **useMcpStatus** (REQ-HOOK-001 through HOOK-005) — React hook for MCP discovery state
4. **useMessageQueue** (REQ-QUEUE-001 through QUEUE-006) — Queue hook with multi-gate flush
5. **AppContainer** (REQ-GATE-001 through GATE-005, REQ-UI-001) — Submission gating + integration

## Implementation Tasks

### Files to Create

- `analysis/pseudocode/core-events.md` — Numbered pseudocode for CoreEvent enum, payload, overloads
  - McpClientUpdate enum member
  - McpClientUpdatePayload interface
  - CoreEventEmitter on/off overloads
  - CoreEvents interface entry

- `analysis/pseudocode/mcp-manager-emits.md` — Numbered pseudocode for emit migration
  - All 6 emit site migrations
  - IN_PROGRESS transition emit (new)
  - COMPLETED transition emit (new — critical)
  - Zero-server fast path
  - getMcpServerCount method

- `analysis/pseudocode/use-mcp-status.md` — Numbered pseudocode for useMcpStatus hook
  - State initialization from manager
  - Event subscription with cleanup
  - isMcpReady derivation

- `analysis/pseudocode/use-message-queue.md` — Numbered pseudocode for useMessageQueue hook
  - Queue state management
  - addMessage callback
  - Multi-gate flush effect
  - One-per-cycle drain

- `analysis/pseudocode/app-container.md` — Numbered pseudocode for AppContainer changes
  - Hook integration
  - handleFinalSubmit modification
  - Slash command bypass
  - Info message tracking

### Pseudocode Requirements

1. Every line MUST be numbered
2. No actual TypeScript implementation — algorithmic steps only
3. Interface contracts defined for each component
4. Integration points documented with line references
5. Anti-pattern warnings included

## Verification Commands

### Automated Checks

```bash
# Verify all pseudocode files exist
for f in core-events mcp-manager-emits use-mcp-status use-message-queue app-container; do
  test -f "project-plans/gmerge-0.26.0/cebe386-plan/analysis/pseudocode/$f.md" && \
    echo "OK: $f.md" || echo "FAIL: $f.md missing"
done

# Verify line numbering exists in each file
for f in core-events mcp-manager-emits use-mcp-status use-message-queue app-container; do
  count=$(grep -cE "^[0-9]{2}:" "project-plans/gmerge-0.26.0/cebe386-plan/analysis/pseudocode/$f.md" 2>/dev/null || echo 0)
  echo "$f.md: $count numbered lines"
done
# Expected: Each file has numbered lines
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

- [ ] Core-events pseudocode covers enum, payload, overloads, re-export
- [ ] MCP-manager pseudocode covers all 6+3 emit sites, getMcpServerCount
- [ ] useMcpStatus pseudocode covers initialization, subscription, cleanup, derivation
- [ ] useMessageQueue pseudocode covers queue, addMessage, flush gates, FIFO
- [ ] AppContainer pseudocode covers hook calls, handleFinalSubmit, slash bypass, info message
- [ ] All pseudocode has numbered lines
- [ ] Interface contracts defined for each component
- [ ] Anti-pattern warnings present

## Success Criteria

- All 5 pseudocode files created with numbered lines
- Each covers all relevant requirements
- No implementation code — pseudocode only
- Interface contracts and integration points documented

## Failure Recovery

If this phase fails:
1. Re-read domain model and specification
2. Recreate pseudocode files individually
3. Verify line numbering

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P02.md`
