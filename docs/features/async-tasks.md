# Async Task Execution

## Overview

Async tasks allow the model to launch subagents in the background without blocking.
The foreground agent can continue working while subagents run in parallel.

## Using Async Mode

To launch a subagent asynchronously, use the `async=true` parameter:

```
Task(subagent='researcher', goal='Research topic X', async=true)
```

The Task tool returns immediately with a task ID. The subagent runs in the background.

## Monitoring Async Tasks

### Model Tool: check_async_tasks

The model can use the `check_async_tasks` tool to query task status:

- No arguments: List all async tasks
- `task_id`: Get details of a specific task (prefix matching supported)

### User Commands

- `/tasks` or `/tasks list` - Show all async tasks with status
- `/task end <id>` - Cancel a running async task (prefix matching supported)

## Notifications

When an async task completes:

1. If the agent is idle: Auto-triggers with completion notification
2. If the agent is busy: Included in next turn's system reminder

## Configuration

Set maximum concurrent async tasks:

```
/set task-max-async 10
```

Default: 5. Use -1 for unlimited.

## Task Lifecycle

1. **Running**: Task is executing
2. **Completed**: Task finished successfully with output
3. **Failed**: Task encountered an error
4. **Cancelled**: Task was cancelled via /task end

Completed/failed/cancelled tasks are kept in history for notification delivery.
History is limited to 2x the max concurrent limit (or 10 if unlimited).
