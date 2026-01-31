# Phase 15: Slash Commands Stub

## Phase ID
`PLAN-20260130-ASYNCTASK.P15`

## Prerequisites
- Required: Phase 14a completed
- Pseudocode: `analysis/pseudocode/slash-commands.md`

## Requirements Implemented

### REQ-ASYNC-008: /tasks list Command
**Full Text**: User MUST be able to list async tasks via `/tasks list` command.
**Behavior**:
- GIVEN: User types `/tasks list`
- WHEN: Command processed
- THEN: Displays all async tasks with status, duration, goal
**Why This Matters**: User visibility into async tasks without using model.

### REQ-ASYNC-009: /task end Command
**Full Text**: User MUST be able to cancel an async task via `/task end <id>` command.
**Behavior**:
- GIVEN: User types `/task end abc`
- WHEN: Command processed and unique prefix found
- THEN: Task is cancelled, confirmation displayed
**Why This Matters**: User control over runaway or unwanted async tasks.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/ui/commands.ts` (or similar slash command handler)
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P15`
  - MUST include: `@requirement REQ-ASYNC-008, REQ-ASYNC-009`
  - Add `/tasks list` command stub
  - Add `/task end` command stub

### Required Code Structure

Research existing slash command patterns first:

```bash
# Find slash command implementation
grep -rn "slash.*command\|/.*command\|registerCommand" packages/cli/src
grep -rn "case.*'/" packages/cli/src
```

Then add:

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P15
 * @requirement REQ-ASYNC-008, REQ-ASYNC-009
 */

// In command handler:
case '/tasks':
  if (args === 'list' || args === '') {
    // @requirement REQ-ASYNC-008
    return { type: 'stub', message: 'NotYetImplemented: /tasks list' };
  }
  break;

case '/task':
  if (args.startsWith('end ')) {
    // @requirement REQ-ASYNC-009
    const taskId = args.slice(4).trim();
    return { type: 'stub', message: `NotYetImplemented: /task end ${taskId}` };
  }
  break;
```

### Files to Create (if tests needed in separate file)

- `packages/cli/src/ui/commands.test.ts` (or add to existing test file)
  - Empty describe block for async commands

## Verification Commands

```bash
# Check plan markers
grep -rn "@plan PLAN-20260130-ASYNCTASK.P15" packages/cli/src

# Check requirement markers
grep -rn "@requirement REQ-ASYNC-008\|@requirement REQ-ASYNC-009" packages/cli/src

# Check commands added
grep -rn "/tasks\|/task" packages/cli/src

# TypeScript compiles
npm run typecheck
```

## Success Criteria

- [ ] /tasks list command stub added
- [ ] /task end command stub added
- [ ] TypeScript compiles
- [ ] Plan/requirement markers present

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P15.md`
