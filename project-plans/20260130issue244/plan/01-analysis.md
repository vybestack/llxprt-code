# Phase 01: Domain Analysis

## Phase ID
`PLAN-20260130-ASYNCTASK.P01`

## Prerequisites
- Required: Phase 00a (Preflight Verification) completed
- Verification: All checkboxes in 00a-preflight-verification.md are checked
- All blocking issues resolved

## Purpose

Analyze the domain model, state transitions, business rules, edge cases, and error scenarios for async subagent execution.

## Deliverables

Create: `project-plans/20260130issue244/analysis/domain-model.md`

### Required Sections

1. **Entity Relationships**
   - AsyncTaskInfo entity
   - Relationship to SubAgentScope
   - Relationship to OutputObject
   - Relationship to Config

2. **State Transitions**
   - AsyncTaskStatus state machine: `running → completed | failed | cancelled`
   - Terminal state rules (only one transition allowed)
   - Race condition handling

3. **Business Rules**
   - Resource limit enforcement (task-max-async)
   - History limit calculation (2 * max or 10 if unlimited)
   - Notification timing (mark AFTER delivery)
   - Auto-trigger serialization (only one in flight)

4. **Edge Cases**
   - Multiple tasks completing simultaneously
   - Task completing while model is mid-response
   - Cancellation during execution
   - Cancellation of already-terminal task (idempotency)
   - ID prefix collision handling
   - max=-1 (unlimited) → history limit 10
   - max=1 → history limit 2
   - Runtime change of task-max-async

5. **Error Scenarios**
   - Subagent execution failure
   - Timeout during async execution
   - Cancellation abort signal handling
   - Auto-trigger delivery failure

6. **Integration Points**
   - How AsyncTaskManager is accessed via Config
   - How reminders are injected via appendSystemReminderToRequest
   - How auto-trigger interacts with useGeminiStream
   - How check_async_tasks tool is registered

## Analysis Template

```markdown
# Async Subagent Execution - Domain Model

## 1. Entities

### AsyncTaskInfo
```typescript
interface AsyncTaskInfo {
  id: string;                    // Unique task ID (e.g., "researcher-abc123")
  subagentName: string;          // Name of subagent being run
  goalPrompt: string;            // The goal passed to the subagent
  status: AsyncTaskStatus;       // running | completed | failed | cancelled
  launchedAt: number;            // Timestamp of launch
  completedAt?: number;          // Timestamp of terminal state
  notifiedAt?: number;           // Timestamp when model was notified (AFTER delivery)
  output?: OutputObject;         // Subagent output (when completed)
  error?: string;                // Error message (when failed)
  abortController?: AbortController; // For cancellation
}
```

### AsyncTaskStatus
```typescript
type AsyncTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';
```

## 2. State Machine

[Diagram: running -> completed/failed/cancelled with rules]

### Transition Rules
- From `running`: Can transition to exactly ONE of {completed, failed, cancelled}
- From terminal state: NO transitions allowed (idempotent)
- First transition wins in race conditions

## 3. Business Rules

### BR-001: Resource Limits
- Maximum concurrent async tasks controlled by `task-max-async` setting
- Default: 5
- Range: -1 (unlimited) or > 0
- Enforcement: Check `canLaunchAsync()` before launching

### BR-002: History Limits
- Formula: `historyLimit = maxAsync === -1 ? 10 : maxAsync * 2`
- Applies to: completed + failed + cancelled tasks (all terminal)
- Enforcement: After each terminal transition, prune oldest if over limit

### BR-003: Notification Timing
- `notifiedAt` is set AFTER successful delivery to model
- If delivery fails, task remains in pending state for retry
- Prevents: Lost notifications, duplicate notifications

### BR-004: Auto-Trigger Serialization
- Only ONE auto-trigger in flight at a time
- Multiple completions while busy: queued in reminder for next turn
- Prevents: Overlapping agent turns, reordered responses

## 4. Edge Cases

[Detailed analysis of each edge case with expected behavior]

## 5. Error Scenarios

[Detailed analysis of each error scenario with recovery strategy]

## 6. Integration Map

[Diagram showing how components connect]
```

## Verification Commands

```bash
# Check domain model created
ls -la project-plans/20260130issue244/analysis/domain-model.md

# Check all sections present
grep -E "^## [0-9]" project-plans/20260130issue244/analysis/domain-model.md

# Check entities defined
grep -n "AsyncTaskInfo\|AsyncTaskStatus" project-plans/20260130issue244/analysis/domain-model.md

# Check state machine documented
grep -n "State Machine\|Transition" project-plans/20260130issue244/analysis/domain-model.md

# Check business rules documented
grep -n "BR-00" project-plans/20260130issue244/analysis/domain-model.md

# Check edge cases documented
grep -n "Edge Case\|completing simultaneously\|mid-response\|idempotent" project-plans/20260130issue244/analysis/domain-model.md
```

## Success Criteria

- [ ] domain-model.md created in analysis/
- [ ] All 6 sections present and complete
- [ ] State machine clearly defined with transition rules
- [ ] All edge cases from reviews addressed
- [ ] All business rules numbered and defined
- [ ] Integration points mapped
- [ ] No implementation details (analysis only)

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P01.md`
