# LLxprt Code: Todo Management System

The LLxprt Code features a sophisticated task management system to help AI agents track and execute multi-step workflows. This system is primarily composed of three core tools accessible to the AI model: `todo_read`, `todo_write`, and `todo_pause`. Additionally, a "Todo Continuation" system automatically prompts the AI to keep working under specific conditions.

## `todo_read` Tool

This built-in tool allows the AI model to read the current state of the todo list for the active session.

**Purpose**: To retrieve the list of tasks, their statuses, subtasks, and recent tool calls.
**Returns**: A markdown block that mirrors the Todo panel, including status icons (/○/→), subtasks, and the five most recent tool calls per todo.
**Parameters**: None.

## `todo_write` Tool

This built-in tool allows the AI model to create, update, or overwrite the entire todo list for the active session.

**Purpose**: To manage a structured list of tasks.
**Parameters**:

- `todos` (array[object], required): The complete list of todos to set for the session. Each todo object must contain the following fields:
  - `id` (string, required): A unique identifier for the todo item.
  - `content` (string, required): A clear, descriptive task for the AI to perform.
  - `status` (string, enum: "pending", "in_progress", "completed", required): The current status of the task.

**Behavior**:
The tool completely replaces the current todo list with the one provided in the `todos` array. In non-interactive sessions it returns a simplified markdown view of the list to the AI. In interactive sessions the CLI renders the Todo panel by default, but if you disable the panel (see below) LLxprt synthesizes the same structured markdown that `todo_read` now emits so the entire list remains visible in scrollback.

## `todo_pause` Tool

This built-in tool allows the AI model to pause its automatic workflow continuation if it encounters a blocker or a task it cannot perform.

**Purpose**: To signal an interruption in the AI's self-directed task execution loop.
**Parameters**:

- `reason` (string, 1-500 characters, required): A clear explanation of why the AI cannot proceed (e.g., "Missing configuration file", "Encountered an unknown error").
  **Behavior**:
  When called successfully, the AI's execution stream will halt, and the provided reason will be displayed to the user. This prevents the "Todo Continuation" system from automatically sending further prompts.

---

## Controlling the Todo Panel

Some users prefer all todo updates to remain in the scrollback instead of a separate Ink panel. Open `/settings` (or edit `.llxprt/settings.json`) and toggle **UI → Show Todo Panel**. When this setting is off:

- The Todo panel is hidden immediately—no restart required.
- `todo_write` tool calls render the full structured todo list inline (status icons, subtasks, recent tool calls) instead of the ` Todo list updated` placeholder.
- `todo_read` outputs the same formatter, so both tools always share one canonical textual representation.

Re-enable the toggle to restore the rich Ink panel without losing any history.

## Todo Continuation System

The `todo-continuation` ephemeral setting controls a powerful feature of LLxprt Code: its ability to automatically prompt the AI to continue working.

**Mechanism**: When `todo-continuation` is enabled (default `true`), LLxprt monitors each turn for signals of complex, multi-step work:

- Consecutive user prompts that contain ordered/sequential keywords ("first", "then", "next", etc.)
- Detected task lists, file references, or multiple questions extracted by the complexity analyzer
- Active todos that remain in `pending`/`in_progress`

If the AI finishes a response without making tool calls and the analyzer detects a backlog of tasks, LLxprt automatically emits a follow-up prompt such as "Continue working on this task: <todo content>". If the user never created a todo list, the system now escalates reminders (“Use TodoWrite now…”) once a threshold of complex turns is exceeded.

**Goal**: This creates a seamless, self-directed workflow where the AI can work through a list of tasks without requiring the user to manually prompt it after each step, while nudging the model to formalize todo lists for complex work.

**Control**: You can disable this feature for the current session using `/ephemeral todo-continuation false`.
