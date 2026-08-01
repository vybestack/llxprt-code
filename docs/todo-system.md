# Todo System

LLxprt Code can track multi-step work with a live todo list. When you give the
model a complex task, it can create, update, and complete items in that list so
you can watch progress in real time.

## What you see

When the model uses the todo tools, a **Todo panel** appears in the session
showing the current task list with status icons:

- ○ — pending (not started)
- → — in progress
- ✓ — completed

Each entry can carry subtasks. The panel updates automatically every time the
model modifies the list, so you can follow along without scrolling through tool
output.

## Show or hide the Todo panel

The Todo panel is on by default. To hide it:

1. Open the settings dialog with `/settings`.
2. Navigate to **UI → Show Todo Panel**.
3. Toggle it off.

The change takes effect immediately — no restart is needed. When the panel is
hidden, todo updates render inline in the scrollback as a structured text list
(status icons, subtasks, and recent tool calls) instead of a one-line
placeholder, so nothing is lost.

Toggle the setting back on to restore the panel.

You can also edit `.llxprt/settings.json` directly and set `showTodoPanel` to
`false`.

## Todo continuation

LLxprt Code can prompt the model to keep working after it finishes a response,
so a multi-step task can proceed without you re-sending each instruction.

### What it does

When **todo continuation** is enabled (the default), LLxprt Code monitors the
session for complex, multi-step work. If the model ends a response without
making tool calls and there is still pending work, LLxprt Code automatically
sends a follow-up prompt such as:

> Continue working on this task: \<todo content\>

If you never create a todo list, LLxprt Code may still nudge the model to
formalize one after detecting several complex turns.

### How to control it

Todo continuation is an **ephemeral setting** — it lasts for the current session
and does not modify your saved profiles.

```bash
# Disable for this session
/set todo-continuation false

# Re-enable (or set explicitly to true)
/set todo-continuation true
```

| Property    | Value                                                        |
| ----------- | ------------------------------------------------------------ |
| Setting key | `todo-continuation`                                          |
| Type        | boolean                                                      |
| Default     | enabled (the feature is on unless explicitly set to `false`) |
| Scope       | ephemeral (current session only)                             |
| Persistence | session only; use `/profile save` to keep it across sessions |

## What the model sees

The model interacts with the todo list through built-in tools (`todo_read`,
`todo_write`, `todo_pause`). You never call these directly — they are part of
the model's toolset. The behavioral details of how continuation detects
complexity and decides when to prompt are documented in
[Todo System Internals](../dev-docs/todo-system-internals.md).
