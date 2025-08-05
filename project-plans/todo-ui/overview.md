## Todo UI – Functional Overview

### 1️⃣ Where we are today

- The CLI uses **Ink + React** for the interactive interface (`packages/cli/src/gemini.tsx`).
- Todo management is performed via the `TodoWrite` and `TodoRead` tools.
- After each `TodoWrite` call the LLM returns a **Markdown block** that looks like:

```
## Todo List Updated

- Added: 3 tasks
- Total tasks: 7

## Todo List

- [x] 1 Refactor authentication module
- [ ] 2 Write unit tests …
```

- This block is printed to stdout; there is **no dedicated UI component**, so no highlighting of the current task, no sub‑task nesting, and no display of tool calls.
- The only UI element that could render a todo list is the **unimplemented** `TodoDisplay` component referenced in `project‑plans/todo‑lists/05‑ui‑integration.md`.

---

### 2️⃣ Target UI (emoji‑free)

- Compact, ASCII‑only display inside the interactive Ink UI.
- Tasks shown **in temporal order** with plain‑text markers:
  - `- [x]` – completed
  - `- [ ]` – pending
  - `- [→]` – *current* (bold with “← current task”).
- Subtasks indented by `•`, tool calls nested with `↳`.
- UI **does NOT scroll**; on each `TodoWrite` the block is **redrawn**.

#### Mock‑ups

**Current (auto‑generated Markdown)**
```
## Todo List Updated
- Added: 3
- Total: 7
```

**Target UI**
```
## Todo List (temporal order)
- [x] 1  Refactor authentication module
    • subtask: Update login flow
    • subtask: Add token‑refresh
- [x] 2  Write unit tests
    • subtask: Test token expiry
    • subtask: Verify errors
- [→] **3  Implement role‑based access control** ← current task
    • subtask: Define role enum
        ↳ runShellCommand('git add src/roles.ts')
        ↳ editFile('src/roles.ts')
    • subtask: Guard API endpoints
        ↳ writeFile('src/middleware/acl.ts')
        ↳ runShellCommand('npm run lint')
- [ ] 4  Document security model
    • subtask: Draft markdown
    • subtask: Add examples
- [ ] 5  Add CI checks
    • subtask: GitHub Action
    • subtask: Integrate tests
```
---

### 3️⃣ Functional Requirements

| # | Requirement | Description |
|---|---|---|
| FR‑01 | Temporal ordering | Render tasks in order of the stored array.
| FR‑02 | Status markers | `- [x]`, `- [ ]`, `- [→]`.
| FR‑03 | Current‑task highlight | Bold and add `← current task`.
| FR‑04 | Subtasks | Optional `subtasks` array displayed with `•`.
| FR‑05 | Tool‑calls | Optional `toolCalls` displayed with `↳`.
| FR‑06 | Redraw‑only UI | Replace previous block instead of appending.
| FR‑07 | No emojis | Use plain ASCII.
| FR‑08 | Responsive to `TodoWrite` | Re‑read and re‑render on updates.
| FR‑09 | Empty state | Show message if list empty.
---

### 4️⃣ How the UI works now

1. `TodoWrite` validates and stores todo list.
2. Generates markdown via `generateOutput`.
3. CLI prints markdown; no React component, no update.
---

### 5️⃣ What we need to change (high‑level plan)

1. **Create `TodoDisplay` component** – `packages/cli/src/ui/components/TodoDisplay.tsx`. It reads todos via `TodoRead`.
2. **Add state hook** in `AppWrapper` (or a context) to keep `todos` state, update after each `TodoWrite`.
3. **Render logic** – status markers, current‑task bold, subtasks, tool‑call nesting using ASCII symbols.
4. **Suppress markdown output** – `TodoWrite` will not emit the markdown block in interactive mode; it will return a minimal `ToolResult`. Tool calls are stored in the task’s `toolCalls` field.
5. **Update CLI flow** – after LLM response, if `TodoWrite` used, trigger `TodoRead` and re‑render `TodoDisplay`.
6. **Tests** – unit tests for `TodoDisplay`; integration test with `TodoWrite`/`TodoRead`.
---

### 6️⃣ Updated discussion

- **Suppress tool‑call output** – tool calls belonging to a task should be captured inside the task’s `toolCalls` array, not printed separately. This keeps the terminal clean.
- **UI‑only rendering** – the UI becomes the sole source of truth for the todo list. `TodoWrite` still validates and persists, but visual representation is handled exclusively by `TodoDisplay`.
- **Fallback** – keep markdown output for non‑interactive runs; interactive CLI relies on component.
- **State management** – introduce a `TodoContext` to hold the todo list, making it easy to trigger re‑render after each write.
---

### 7️⃣ Summary

- **Current**: Markdown printed to stdout; no UI component; tool‑calls displayed separately.
- **Goal**: Clean ASCII Ink component (`TodoDisplay`) showing tasks with status markers, subtasks, tool‑calls, and redraw on each `TodoWrite`.
- **Key changes**: Add `TodoDisplay`, hook it into app state, suppress markdown output in interactive mode, store tool calls within todo items, and add tests.


### 1️⃣ Where we are today

- The CLI uses **Ink + React** for the interactive interface (`packages/cli/src/gemini.tsx`).
- Todo management is performed via the `TodoWrite` and `TodoRead` tools.
- After each `TodoWrite` call the LLM returns a **Markdown block** that looks like:

```
## Todo List Updated

- Added: 3 tasks
- Total tasks: 7

## Todo List

- [x] 1 Refactor authentication module
- [ ] 2 Write unit tests …
```

- This block is simply printed to the terminal; there is **no dedicated UI component** rendering the list, so there is no visual highlighting of the current task, no nesting of subtasks, and no display of the exact tool calls.
- The only UI element that could render a todo list is the planned but **unimplemented** `TodoDisplay` component referenced in the project‑plan `project‑plans/todo-lists/05-ui-integration.md`.

---

### 2️⃣ Where we want to be (target UI)

- A **compact, emoji‑free** display shown directly inside the interactive Ink UI.
- Tasks are displayed **in temporal order** (the order they will be executed).
- Each task is shown once with a **plain‑text status marker**:
  - `- [x]` – completed
  - `- [ ]` – pending
  - `- [→]` – *current* task (bolded and labelled “← current task”).
- Subtasks are indented with a bullet (`•`) and can contain **nested tool‑call entries** (prefixed with `↳`).
- The UI **does not scroll**; on every `TodoWrite` the existing block is **redrawn**, effectively updating the status in place.
- No emoji or icon clutter – only simple ASCII symbols.

#### Mock‑ups

**Current (auto‑generated Markdown)**
```
## Todo List Updated

- Added: 3 tasks
- Total tasks: 7

## Todo List

- [x] 1 Refactor authentication module
- [ ] 2 Write unit tests for auth utils
- [ ] 3 Implement role‑based access control
```

**Target UI (as we just displayed)**
```
## Todo List (temporal order)

- [x] 1  Refactor authentication module
    • subtask: Update login flow
    • subtask: Add token‑refresh logic

- [x] 2  Write unit tests for auth utils
    • subtask: Test token‑expiry handling
    • subtask: Verify error messages

- [→] **3  Implement role‑based access control**   ← current task
    • subtask: Define role enum
        ↳ runShellCommand('git add src/roles.ts')
        ↳ editFile('src/roles.ts')
    • subtask: Guard API endpoints
        ↳ writeFile('src/middleware/acl.ts')
        ↳ runShellCommand('npm run lint')

- [ ] 4  Document security model
    • subtask: Draft markdown page
    • subtask: Add examples

- [ ] 5  Add CI checks for permissions
    • subtask: Create GitHub Action workflow
    • subtask: Integrate with test suite
```
---

### 3️⃣ Functional Requirements

| # | Requirement | Description |
|---|-------------|-------------|
| FR‑01 | **Temporal ordering** | Tasks must be rendered in the exact order they appear in the stored todo array.
| FR‑02 | **Status markers** | Render `- [x]` for completed, `- [ ]` for pending, `- [→]` for the task whose status is `in_progress`.
| FR‑03 | **Current‑task highlight** | The current task should be bolded and have a trailing note `← current task`.
| FR‑04 | **Subtask support** | Each todo may contain an optional `subtasks` array (string). Render each subtask indented with `•`.
| FR‑05 | **Tool‑call nesting** | Subtasks can contain an optional `toolCalls` array (string). Render each call indented under its subtask with `↳`.
| FR‑06 | **Redraw‑only UI** | The UI component must replace the previous rendered block instead of appending, keeping the terminal output height constant.
| FR‑07 | **No emojis** | Use only plain ASCII symbols (`-`, `[`, `]`, `•`, `↳`).
| FR‑08 | **Responsive to TodoWrite** | Whenever `TodoWrite` updates the stored list, the UI component must re‑read the list (via `TodoRead`) and re‑render.
| FR‑09 | **Graceful empty state** | If the list is empty, show a short message: "Todo list is empty – use TodoWrite to add tasks."
---

### 4️⃣ How the UI works now

1. `TodoWrite` receives an array of `Todo` objects and writes them to `TodoStore`.
2. The tool returns a markdown block (generated in `TodoWrite.generateOutput`).
3. The CLI prints that markdown directly to stdout; there is no React component consuming it.
4. No component subscribes to changes, so the terminal output simply grows with each write.
---

### 5️⃣ What we need to change (high‑level implementation plan)

1. **Create the `TodoDisplay` component**
   - Path: `packages/cli/src/ui/components/TodoDisplay.tsx`.
   - It will accept the todo array as a prop or retrieve it via the existing `TodoRead` tool.
2. **Add a subscription hook**
   - The core `AppWrapper` (or a new context provider) should call `TodoRead` after every `TodoWrite` execution and update a React state (`todos`).
   - This triggers a re‑render of `TodoDisplay`.
3. **Render logic**
   - Map over `todos` in temporal order.
   - For each todo render the appropriate status marker.
   - If `status === 'in_progress'` apply bold styling and the “← current task” note.
   - Render optional `subtasks` and nested `toolCalls` with the required ASCII prefixes.
4. **Replace the auto‑generated markdown**
   - Modify `TodoWrite` to **omit** the markdown block that is currently printed (or keep it for non‑interactive mode only).
   - In interactive mode, return only a minimal `ToolResult` (e.g., a short success message) because the UI will now display the list.
5. **Update the CLI flow**
   - In `gemini.tsx` after the LLM response is received, detect if a `TodoWrite` was part of the tool usage.
   - If so, trigger the state update that causes `TodoDisplay` to re‑render.
6. **Add tests**
   - Unit test the component rendering with a sample todo array containing subtasks and tool calls.
   - Integration test that a `TodoWrite` call results in the UI updating (using the existing `todo-system.test.ts`).
---

### 6️⃣ Summary

- **Current state:** Todo list is pure markdown printed to stdout; no UI component; no highlighting or nesting.
- **Goal state:** A clean, emoji‑free Ink component (`TodoDisplay`) that shows tasks in temporal order, highlights the current task, nests subtasks and tool calls, and redraws on each `TodoWrite`.
- **Key changes:** add `TodoDisplay`, hook it into the app state, adjust `TodoWrite` output, and write tests.

Once the component is in place the CLI will give developers a concise, constantly‑updated view of what the assistant is doing, matching the behaviour described in Claude Code’s own todo UI.
