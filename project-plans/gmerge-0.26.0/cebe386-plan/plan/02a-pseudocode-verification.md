# Phase 02a: Pseudocode Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P02a`

## Prerequisites

- Required: Phase 02 completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P02.md`

## Verification Tasks

### 1. Pseudocode Completeness

```bash
# Verify all pseudocode files exist and are non-empty
for f in core-events mcp-manager-emits use-mcp-status use-message-queue app-container; do
  path="project-plans/gmerge-0.26.0/cebe386-plan/analysis/pseudocode/$f.md"
  lines=$(wc -l < "$path" 2>/dev/null || echo 0)
  echo "$f.md: $lines lines"
  [ "$lines" -gt 20 ] && echo "  OK" || echo "  FAIL: too short"
done
```

### 2. Requirement Coverage Matrix

Verify each requirement is addressed by at least one pseudocode file:

| Requirement | Pseudocode File | Covered? |
|-------------|----------------|----------|
| REQ-EVT-001 | core-events.md | [ ] |
| REQ-EVT-002 | core-events.md | [ ] |
| REQ-EVT-003 | core-events.md | [ ] |
| REQ-EVT-004 | core-events.md | [ ] |
| REQ-MGR-001 | mcp-manager-emits.md | [ ] |
| REQ-MGR-002 | mcp-manager-emits.md | [ ] |
| REQ-MGR-003 | mcp-manager-emits.md | [ ] |
| REQ-MGR-004 | mcp-manager-emits.md | [ ] |
| REQ-MGR-005 | mcp-manager-emits.md | [ ] |
| REQ-MGR-006 | mcp-manager-emits.md | [ ] |
| REQ-HOOK-001 | use-mcp-status.md | [ ] |
| REQ-HOOK-002 | use-mcp-status.md | [ ] |
| REQ-HOOK-003 | use-mcp-status.md | [ ] |
| REQ-HOOK-004 | use-mcp-status.md | [ ] |
| REQ-HOOK-005 | use-mcp-status.md | [ ] |
| REQ-QUEUE-001 | use-message-queue.md | [ ] |
| REQ-QUEUE-002 | use-message-queue.md | [ ] |
| REQ-QUEUE-003 | use-message-queue.md | [ ] |
| REQ-QUEUE-004 | use-message-queue.md | [ ] |
| REQ-QUEUE-005 | use-message-queue.md | [ ] |
| REQ-QUEUE-006 | use-message-queue.md | [ ] |
| REQ-GATE-001 | app-container.md | [ ] |
| REQ-GATE-002 | app-container.md | [ ] |
| REQ-GATE-003 | app-container.md | [ ] |
| REQ-GATE-004 | app-container.md | [ ] |
| REQ-GATE-005 | app-container.md | [ ] |
| REQ-UI-001 | app-container.md | [ ] |

### 3. Cross-Reference Pseudocode ↔ Codebase

```bash
# Verify core-events references events.ts
grep -c "events.ts\|CoreEvent\|CoreEventEmitter" project-plans/gmerge-0.26.0/cebe386-plan/analysis/pseudocode/core-events.md

# Verify mcp-manager references mcp-client-manager.ts
grep -c "mcp-client-manager\|McpClientManager\|discoveryState" project-plans/gmerge-0.26.0/cebe386-plan/analysis/pseudocode/mcp-manager-emits.md

# Verify use-mcp-status references Config and coreEvents
grep -c "Config\|coreEvents\|getMcpClientManager" project-plans/gmerge-0.26.0/cebe386-plan/analysis/pseudocode/use-mcp-status.md

# Verify use-message-queue references StreamingState and submitQuery
grep -c "StreamingState\|submitQuery\|isMcpReady" project-plans/gmerge-0.26.0/cebe386-plan/analysis/pseudocode/use-message-queue.md

# Verify app-container references handleFinalSubmit and isSlashCommand
grep -c "handleFinalSubmit\|isSlashCommand\|addMessage" project-plans/gmerge-0.26.0/cebe386-plan/analysis/pseudocode/app-container.md
```

### 4. No Implementation Code

```bash
# Verify pseudocode blocks don't contain TypeScript imports/exports
for f in core-events mcp-manager-emits use-mcp-status use-message-queue app-container; do
  path="project-plans/gmerge-0.26.0/cebe386-plan/analysis/pseudocode/$f.md"
  awk '/^```$/,/^```$/' "$path" | grep -cE "^(import|export|const|let|var|function|class) " || echo "0"
done
# Expected: 0 for each (implementation code only in Interface Contracts sections)
```

## Success Criteria

- All 5 files present with 20+ lines each
- All requirements have coverage in at least one pseudocode file
- Pseudocode references real file paths
- No implementation code in pseudocode blocks

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
for f in core-events mcp-manager-emits use-mcp-status use-message-queue app-container; do
  path="project-plans/gmerge-0.26.0/cebe386-plan/analysis/pseudocode/$f.md"
  lines=$(wc -l < "$path" 2>/dev/null || echo 0)
  numbered=$(grep -cE "^[0-9]{2}:" "$path" 2>/dev/null || echo 0)
  echo "$f.md: $lines lines, $numbered numbered"
done
# Expected behavior: All 5 files exist with 20+ lines and numbered pseudocode
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Pseudocode references actual file paths in the codebase
- [ ] Interface contracts match actual TypeScript signatures
- [ ] Integration points between components are documented
- [ ] Anti-pattern warnings included

### Edge Cases Verified

- [ ] Zero-server handling documented in pseudocode
- [ ] Hook mount after completion documented
- [ ] Queue flush loop prevention documented
- [ ] Listener cleanup documented

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P02a.md`
