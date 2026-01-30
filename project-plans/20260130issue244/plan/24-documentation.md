# Phase 24: Documentation

## Phase ID
`PLAN-20260130-ASYNCTASK.P24`

## Prerequisites
- Required: Phase 23a completed

## Requirements Implemented

Documentation for users and developers.

## Implementation Tasks

### Files to Create/Update

1. **User Documentation** (`docs/async-tasks.md`)
   - Overview of async tasks
   - How to use async=true parameter
   - /tasks list command
   - /task end command
   - /set task-max-async setting
   - check_async_tasks tool

2. **Developer Documentation** (inline JSDoc)
   - AsyncTaskManager API
   - AsyncTaskReminderService API
   - AsyncTaskAutoTrigger API
   - CheckAsyncTasksTool API

3. **CHANGELOG Entry**
   - Add entry for async task feature

### User Documentation Content

```markdown
# Async Task Execution

## Overview

Async tasks allow the model to launch subagents in the background without blocking.
The foreground agent can continue working while subagents run in parallel.

## Using Async Mode

To launch a subagent asynchronously, use the `async=true` parameter:

\`\`\`
Task(subagent='researcher', goal='Research topic X', async=true)
\`\`\`

The Task tool returns immediately with a task ID. The subagent runs in the background.

## Monitoring Async Tasks

### Model Tool: check_async_tasks

The model can use the `check_async_tasks` tool to query task status:

- No arguments: List all async tasks
- `task_id`: Get details of a specific task (prefix matching supported)

### User Commands

- `/tasks list` - Show all async tasks with status
- `/task end <id>` - Cancel a running async task (prefix matching supported)

## Notifications

When an async task completes:

1. If the agent is idle: Auto-triggers with completion notification
2. If the agent is busy: Included in next turn's system reminder

## Configuration

Set maximum concurrent async tasks:

\`\`\`
/set task-max-async 10
\`\`\`

Default: 5. Use -1 for unlimited.

## Task Lifecycle

1. **Running**: Task is executing
2. **Completed**: Task finished successfully with output
3. **Failed**: Task encountered an error
4. **Cancelled**: Task was cancelled via /task end

Completed/failed/cancelled tasks are kept in history for notification delivery.
History is limited to 2x the max concurrent limit (or 10 if unlimited).
```

### CHANGELOG Entry

```markdown
## [Unreleased]

### Added
- Async task execution: Launch subagents with `async=true` to run in background
- `check_async_tasks` tool for model to query async task status
- `/tasks list` command to show all async tasks
- `/task end <id>` command to cancel async tasks
- `task-max-async` setting to limit concurrent async tasks (default: 5)
- Auto-trigger notifications when async tasks complete
```

## Verification Commands

```bash
# Check documentation created
ls -la docs/async-tasks.md

# Check JSDoc comments
grep -rn "@param\|@returns" packages/core/src/services/asyncTaskManager.ts
grep -rn "@param\|@returns" packages/core/src/services/asyncTaskReminderService.ts

# Check CHANGELOG updated
grep -n "async" CHANGELOG.md
```

## Success Criteria

- [ ] User documentation created
- [ ] JSDoc comments on public APIs
- [ ] CHANGELOG entry added

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P24.md`
