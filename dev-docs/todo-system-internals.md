# Todo System Internals

Implementation record for the todo management and continuation system. For the
user-facing guide, see [docs/todo-system.md](../docs/todo-system.md).

## Status and authority

Authoritative for the internal behavior of the todo tools and the continuation
engine. Updated alongside changes to the listed source files.

## Model-facing tool schemas

The model interacts with the todo list through three built-in tools. These
schemas describe what the model sends; users never invoke them directly.

### `todo_read`

Reads the current state of the todo list for the active session.

- **Returns**: a markdown block mirroring the Todo panel, including status icons
  (○/→/✓), subtasks, and the five most recent tool calls per todo.
- **Parameters**: none.

### `todo_write`

Creates, updates, or overwrites the entire todo list for the active session.

- **Parameters**:
  - `todos` (array of objects, required): the complete list of todos. Each
    object must contain:
    - `id` (string, required): unique identifier for the item.
    - `content` (string, required): a clear, descriptive task.
    - `status` (enum: `pending`, `in_progress`, `completed`, required): the
      current status.
    - `subtasks` (optional): nested task objects with the same shape.

- **Behavior**: the tool replaces the current todo list entirely. In
  non-interactive sessions it returns a simplified markdown view. In interactive
  sessions the CLI renders the Todo panel; when the panel is hidden
  (`showTodoPanel: false`), `todo_write` calls render the full structured list
  inline so scrollback remains complete.

### `todo_pause`

Signals an interruption in the model's self-directed execution loop.

- **Parameters**:
  - `reason` (string, 1–500 characters, required): why the model cannot proceed.
- **Behavior**: the execution stream halts, the reason is displayed to the user,
  and the continuation engine stops sending follow-up prompts.

## Continuation engine

### Source and test locations

- Service: `packages/agents/src/core/TodoContinuationService.ts`
- Complexity analyzer: `packages/core/src/services/complexity-analyzer.ts`
- Orchestration: `packages/agents/src/core/MessageStreamOrchestrator.ts`
- Reminder text: `packages/core/src/services/todo-reminder-service.ts`
- Characterization tests:
  `packages/agents/src/core/__tests__/todoContinuation.characterization.test.ts`
- Complexity tests:
  `packages/agents/src/core/TodoContinuationService.complexity.test.ts`
- E2E: `integration-tests/todo-continuation.e2e.test.ts`

### Setting

The ephemeral setting `todo-continuation` (boolean) gates the engine. The
service treats the setting as enabled when it is anything other than `false`,
so an unset (undefined) value means continuation is on by default. See
`packages/settings/src/settings/registry/registry-entries-2.ts`.

### Complexity analyzer

`ComplexityAnalyzer` (in `packages/core/src/services/complexity-analyzer.ts`)
scores each user message to decide whether it is complex enough to benefit from
a todo list.

Key defaults (constructor options, overridable in tests):

| Option                  | Default | Meaning                                                       |
| ----------------------- | ------- | ------------------------------------------------------------- |
| `complexityThreshold`   | `0.6`   | Minimum score (0–1) for a message to count as complex.        |
| `minTasksForSuggestion` | `3`     | Minimum detected tasks before a todo suggestion is generated. |

Detection signals:

- **Sequential keywords**: `first`, `second`, `third`, `then`, `next`, `after`,
  `after that`, `finally`, `lastly`, `subsequently`, `following`, `before`,
  `afterward`, `afterwards`, `once`, `when`.
- **Need-to triggers**: `need to`, `want to`, `have to`, `should`, `must`,
  `will`.
- **Action verbs**: `set up`, `configure`, `run`, `start`, `create`, `add`,
  `implement`, `build`, `deploy` (regex match).
- **Question count** and **message length** feed into the complexity score.
- **List-item extraction**: numbered or bulleted lines are treated as tasks.

File references are intentionally excluded to avoid false positives.

### Escalating reminder threshold

`TodoContinuationService` tracks consecutive complex turns. When the count
reaches `COMPLEXITY_ESCALATION_TURN_THRESHOLD` (constant: `3`), the reminder
text escalates from a base suggestion to a stronger "use TodoWrite now" prompt.

A cooldown (`complexitySuggestionCooldown`, default `300000` ms = 5 minutes,
wired in `packages/agents/src/core/client.ts`) prevents repeated suggestions
within the same window.

### Tool-call reminder levels

The service also tracks tool activity during a turn. After 4 tool calls the
reminder level rises to `base`; after more than 4 it escalates to `escalated`.

## Verification

- Run the characterization tests cited above.
- Run the e2e suite under `integration-tests/`.
- Confirm the `todo-continuation` default by checking the service reads the
  setting with `!== false` semantics.
