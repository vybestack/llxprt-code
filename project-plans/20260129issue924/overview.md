# Issue #924: TODO Persistence and Slash Commands

## Problem Statement

Currently, the TODO list is **automatically cleared** on every user prompt submission. This happens in `useTodoPausePreserver.ts`:

```typescript
controller.handleSubmit(() => {
  updateTodos([]);  // Clears TODOs on EVERY user submission
});
```

This is problematic because:
1. **Users can't correct the model** - If the model is working on a task and the user needs to provide feedback/correction, the entire TODO list is wiped
2. **No way to guide mid-task** - User input destroys context of what the model was working on
3. **No manual TODO management** - Users have no control over the TODO list

## Solution Overview

### Core Behavior Change

**Current**: User prompt → TODOs cleared (deleted)

**New**: User prompt → TODOs stay active UNLESS:
- All TODOs are completed (status=completed) → auto-clear
- User explicitly runs `/todo clear` → clear

The key insight: **user can correct the model mid-task without losing the TODO list**.

### New `/todo` Slash Commands

| Command | Effect |
|---------|--------|
| `/todo list` | Show all saved TODO lists (current session first, then temporally descending), allow loading one |
| `/todo clear` | Clear current TODOs, deactivate continuation |
| `/todo add <pos> <desc>` | Add todo at position, TODOs become/stay active |
| `/todo delete <pos>` | Remove todo at position |
| `/todo show` | Display current TODOs (same as what model sees) |

---

## State Transitions

### When User Submits a Prompt

```
┌─────────────────┐
│  User Submits   │
│     Prompt      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Check: Are ALL todos completed?    │
└────────┬───────────────┬────────────┘
         │               │
    YES (all done)    NO (work remains)
         │               │
         ▼               ▼
┌─────────────┐   ┌─────────────────┐
│ CLEAR TODOs │   │ KEEP ACTIVE     │ ← This is the change!
│             │   │ TODOs persist   │
└─────────────┘   │ Model continues │
                  │ after responding│
                  └─────────────────┘
```

### When Model Calls `todo_pause`

```
┌─────────────────┐
│  Model calls    │
│  todo_pause()   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  KEEP TODOs (don't clear)           │
│  SKIP next auto-continuation        │ ← preserveNextSubmission=true
│  Wait for user input                │
└─────────────────────────────────────┘
         │
         ▼
   User provides guidance/correction
         │
         ▼
┌─────────────────────────────────────┐
│  TODOs still active!                │
│  Model can continue working on them │
└─────────────────────────────────────┘
```

### When Model Streams Without Tool Calls ("Lazy Model")

This handles the scenario where model has active TODOs but just talks without taking action:

```
Model has TODO list:
  1. Implement feature X (in_progress)
  2. Write tests (pending)

Model responds:
  "Hey I did a good job on item 1! Just thought you should know "
  
  [NO TOOL CALLS - didn't mark complete, didn't call todo_pause]
```

**Behavior**:

```
Stream ends, no tool calls
         │
         ▼
   useTodoContinuation checks:
   - Are there active todos? YES
   - Were there tool calls? NO
   - Continuation attempts < MAX (3)? YES
         │
         ▼
   TRIGGER CONTINUATION PROMPT
   "You have an active task: 'Implement feature X'..."
         │
         ▼
   Model responds (still no tool calls)
         │
         ▼
   ... continues up to MAX_CONTINUATION_ATTEMPTS (3) ...
         │
         ▼
   After 3 attempts: TURN COMPLETES
   - TODOs remain ACTIVE (still displayed)
   - TODOs remain VISIBLE (user can see them)
   - No more auto-continuation until user prompts
         │
         ▼
   User prompts (e.g., "FUCKING DO THE TODO YOU ASSHOLE")
         │
         ▼
   Continuation attempt counter RESETS
   - 3 more attempts available
   - Model tries again with user's "encouragement"
```

**Key point**: TODOs never deactivate due to lazy model. They stay active. The turn just completes after max attempts. When user prompts again, the counter resets and continuation can try again.

### When User Runs `/todo clear`

```
┌─────────────────┐
│  /todo clear    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  CLEAR TODOs from active session    │
│  Storage file remains as history    │
└─────────────────────────────────────┘
```

---

## Complete State Transition Table

| Event | TODOs Active? | TODOs Cleared? | Continuation Attempts |
|-------|---------------|----------------|----------------------|
| User prompt (work remains) | YES | NO | Reset to 0 |
| User prompt (all completed) | NO | YES | N/A |
| Model calls `todo_pause` | YES (skip 1 continuation) | NO | Preserved |
| Model streams with tool calls | YES | NO | Reset to 0 |
| Model streams WITHOUT tool calls | YES | NO | Increment |
| 3 continuation attempts exhausted | YES (still active!) | NO | Turn completes, wait for user |
| User runs `/todo clear` | NO | YES (memory) | N/A |
| User loads from `/todo list` | YES | Replaced | Reset to 0 |

---

## `/todo list` - Session Awareness

### Storage Structure

From `TodoStore`:
```typescript
const fileName = `todo-${sessionId}.json`;  // or with agentId
```

Each session has ONE file at `~/.llxprt/todos/`. When session ends, file remains.

### `/todo list` Behavior

```
/todo list
         │
         ▼
   Scan ~/.llxprt/todos/todo-*.json
         │
         ▼
   Sort by file modification time (newest first / temporally descending)
         │
         ▼
   Display:
   
   Saved TODO Lists:
   ────────────────────────────────────────────────────
   1. [CURRENT SESSION] 3 items (1 in_progress, 2 pending)
      → "Implement feature X"
      
   2. 2 hours ago │ 5 items (5 completed)
      → "Fix bug in parser"
      
   3. 1 day ago │ 2 items (1 pending, 1 completed)  
      → "Write documentation"
   ────────────────────────────────────────────────────
   Enter number to load into current session:
```

- Current session's TODOs shown first (marked as CURRENT)
- Other sessions shown by recency (temporally descending)
- Loading a past TODO list copies it into current session and activates it

---

## Position Semantics for `/todo add` and `/todo delete`

Positions are **1-based** for user input, **0-based** internally.

| User Input | Meaning |
|------------|---------|
| `1` | First top-level todo |
| `2` | Second top-level todo |
| `last` | Append as new last todo |
| `1.1` | First subtask of todo 1 |
| `1.2` | Second subtask of todo 1 |
| `1.last` | Append as last subtask of todo 1 |

---

## Implementation Plan

### Phase 1: Conditional TODO Clearing

**File**: `packages/cli/src/ui/hooks/useTodoPausePreserver.ts`

Change:
```typescript
// Current
controller.handleSubmit(() => {
  updateTodos([]);
});

// New
controller.handleSubmit(() => {
  const allCompleted = todos.length === 0 || 
    todos.every(todo => todo.status === 'completed');
  
  if (allCompleted) {
    updateTodos([]);
  }
  // Otherwise: keep TODOs active
});
```

This requires passing `todos` into the hook.

### Phase 2: `/todo` Slash Commands

**New File**: `packages/cli/src/ui/commands/todoCommand.ts`

Implement:
- `clear` - Clear TODOs from memory
- `add` - Parse position, insert todo
- `delete` - Parse position, remove todo
- `show` - Display current TODOs
- `list` - Scan storage, display temporally descending, allow loading

**Modified File**: `packages/cli/src/services/BuiltinCommandLoader.ts`
- Import and register `todoCommand`

### Phase 3: Tests

**New File**: `packages/cli/src/ui/commands/todoCommand.test.ts`

- Test all subcommands
- Test position parsing edge cases
- Test storage scanning for `/todo list`

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/cli/src/ui/hooks/useTodoPausePreserver.ts` | Add `todos` param, conditional clearing |
| `packages/cli/src/ui/contexts/TodoContext.tsx` | May need to expose more state |
| `packages/cli/src/services/BuiltinCommandLoader.ts` | Register `todoCommand` |

## Files to Create

| File | Purpose |
|------|---------|
| `packages/cli/src/ui/commands/todoCommand.ts` | Slash command implementation |
| `packages/cli/src/ui/commands/todoCommand.test.ts` | Behavioral tests |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              User Input                                  │
└─────────────────────────────────────────────┬───────────────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                                                   │
                    ▼                                                   ▼
          ┌─────────────────┐                                ┌─────────────────┐
          │  Slash Command  │                                │  Normal Prompt  │
          │  /todo ...      │                                │                 │
          └────────┬────────┘                                └────────┬────────┘
                   │                                                  │
                   ▼                                                  ▼
          ┌─────────────────┐                                ┌─────────────────┐
          │ todoCommand.ts  │                                │ useTodoPause-   │
          │                 │                                │ Preserver.ts    │
          │ - list          │                                │                 │
          │ - clear         │                                │ Check: all done?│
          │ - add           │                                │ YES → clear     │
          │ - delete        │                                │ NO → keep       │
          │ - show          │                                └────────┬────────┘
          └────────┬────────┘                                         │
                   │                                                  │
                   └─────────────────────┬────────────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │    TodoProvider     │
                              │                     │
                              │  todos: Todo[]      │
                              │  updateTodos()      │
                              │  refreshTodos()     │
                              └──────────┬──────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │     TodoStore       │
                              │                     │
                              │ ~/.llxprt/todos/    │
                              │ todo-{session}.json │
                              └──────────┬──────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │    todoEvents       │
                              │                     │
                              │ emitTodoUpdated()   │
                              │ onTodoUpdated()     │
                              └─────────────────────┘
```

---

## Open Questions

1. **Should `/todo list` show a selection UI or just print the list?**
   - Leaning toward: Print list, user types number to load

2. **What happens if user loads a TODO list that has all completed items?**
   - Proposal: Still load it, but it will auto-clear on next user prompt

3. **Should `/todo add` without position default to `last`?**
   - Proposal: Yes, `/todo add "description"` = `/todo add last "description"`
