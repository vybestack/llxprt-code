# LLxprt Code: Todo Management System

The LLxprt Code features a sophisticated task management system to help AI agents track and execute multi-step workflows. This system is primarily composed of three core tools accessible to the AI model: `todo_read`, `todo_write`, and `todo_pause`. Additionally, a "Todo Continuation" system automatically prompts the AI to keep working under specific conditions.

## `todo_read` Tool

This built-in tool allows the AI model to read the current state of the todo list for the active session.

**Purpose**: To retrieve the list of tasks, their statuses, and priorities.
**Returns**: A formatted markdown string containing the list of todos, grouped by status (In Progress, Pending, Completed) and a summary of statistics (e.g., total tasks, tasks by priority).
**Parameters**: None.

## `todo_write` Tool

This built-in tool allows the AI model to create, update, or overwrite the entire todo list for the active session.

**Purpose**: To manage a structured list of tasks.
**Parameters**:

- `todos` (array[object], required): The complete list of todos to set for the session. Each todo object must contain the following fields:
  - `id` (string, required): A unique identifier for the todo item.
  - `content` (string, required): A clear, descriptive task for the AI to perform.
  - `status` (string, enum: "pending", "in_progress", "completed", required): The current status of the task.
  - `priority` (string, enum: "high", "medium", "low", required): The priority level of the task.

**Behavior**:
The tool completely replaces the current todo list with the one provided in the `todos` array. It also returns a simplified markdown view of the list to the AI for context, while a more detailed view is presented to the user in the CLI's todo panel.

## `todo_pause` Tool

This built-in tool allows the AI model to pause its automatic workflow continuation if it encounters a blocker or a task it cannot perform.

**Purpose**: To signal an interruption in the AI's self-directed task execution loop.
**Parameters**:

- `reason` (string, 1-500 characters, required): A clear explanation of why the AI cannot proceed (e.g., "Missing configuration file", "Encountered an unknown error").
  **Behavior**:
  When called successfully, the AI's execution stream will halt, and the provided reason will be displayed to the user. This prevents the "Todo Continuation" system from automatically sending further prompts.

---

## Todo Continuation System

The `todo-continuation` ephemeral setting controls a powerful feature of LLxprt Code: its ability to automatically prompt the AI to continue working.

**Mechanism**: If the `todo-continuation` setting is enabled (it is `true` by default) and the AI completes a response turn without making any tool calls, but the system detects there are still `pending` or `in_progress` todos, LLxprt Code will automatically generate a new prompt like "Continue working on this task: <todo content>" and send it to the model.

**Goal**: This creates a seamless, self-directed workflow where the AI can work through a list of tasks without requiring the user to manually prompt it after each step.

**Control**: You can disable this feature for the current session using `/ephemeral todo-continuation false`.
