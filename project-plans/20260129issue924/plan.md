# Plan: TODO Persistence and Slash Commands

Plan ID: PLAN-20260129-TODOPERSIST
Generated: 2026-01-29
Total Phases: 16
Requirements: [REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007]

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 0.5)
2. Defined integration contracts for multi-component features
3. Written integration tests BEFORE unit tests
4. Verified all dependencies and types exist as assumed

## Problem Statement

Currently, the TODO list is **automatically cleared** on every user prompt submission in `useTodoPausePreserver.ts`:

```typescript
controller.handleSubmit(() => {
  updateTodos([]);  // Clears TODOs on EVERY user submission
});
```

This prevents users from:
- Correcting the model mid-task without losing context
- Guiding the model with additional input while working on TODOs
- Manually managing the TODO list with slash commands

## Solution Overview

**Current Behavior**: User prompt → TODOs cleared (deleted)

**New Behavior**: User prompt → TODOs stay active UNLESS:
- All TODOs are completed (status=completed) → auto-clear
- User explicitly runs `/todo clear` → clear

**Key Changes**:
1. Conditional TODO clearing based on completion state
2. New `/todo` slash commands for manual management
3. Lazy model handling with continuation attempts
4. Session-aware TODO list history via `/todo list`

## Formal Requirements

### REQ-001: Conditional TODO Clearing
**Requirement Text**: The TODO list MUST persist across user prompts unless ALL todos have status='completed' OR the user explicitly runs `/todo clear`.

**Behavior**:
- GIVEN: User has active TODO list with items in 'pending' or 'in_progress' status
- WHEN: User submits a new prompt
- THEN: The TODO list remains active and visible to the model
- AND: The model can continue working on the same TODOs

**Why This Matters**: Enables users to provide mid-task corrections, additional context, or feedback without destroying the task context the model is working within.

**Edge Cases**:
- Empty TODO list → no clearing needed
- All completed → clear automatically
- Mix of completed and pending → keep active
- User runs `/todo clear` → clear regardless of state

### REQ-002: Lazy Model Continuation
**Requirement Text**: When the model streams a response without making tool calls AND active TODOs exist, the system MUST trigger automatic continuation prompts up to 3 attempts. After 3 attempts, the turn completes but TODOs remain active. When the user prompts again, the continuation attempt counter MUST reset.

**Behavior**:
- GIVEN: Model has TODO list with active items (not all completed)
- WHEN: Model responds with text but NO tool calls
- THEN: System sends continuation prompt "You have an active task: <description>..."
- AND: This repeats up to 3 times
- AND: After 3 attempts, turn completes, TODOs stay active
- AND: Next user prompt resets counter to 0

**Why This Matters**: Prevents the model from "talking its way out" of doing work while preserving the task context for the user to re-engage.

**Algorithm**:
```
1. DETECT stream end with no tool calls
2. CHECK active todos exist
3. CHECK continuation_attempts < MAX_CONTINUATION_ATTEMPTS (3)
4. IF all conditions true:
   4.1 INCREMENT continuation_attempts
   4.2 SEND continuation prompt to model
   4.3 GOTO 1
5. ELSE IF attempts >= 3:
   5.1 COMPLETE turn (stop streaming)
   5.2 KEEP todos active
   5.3 WAIT for user input
6. WHEN user submits prompt:
   6.1 RESET continuation_attempts to 0
   6.2 APPLY conditional clearing (REQ-001)
```

### REQ-003: /todo clear Command
**Requirement Text**: The `/todo clear` command MUST clear all TODOs from the active session memory and reset continuation state.

**Behavior**:
- GIVEN: User is in an active CLI session with TODOs (any state)
- WHEN: User executes `/todo clear`
- THEN: All TODOs are removed from memory
- AND: Storage file remains as historical record
- AND: Continuation attempts reset to 0
- AND: No automatic continuation occurs

**Why This Matters**: Gives users explicit control to abandon a task context without waiting for completion.

### REQ-004: /todo show Command
**Requirement Text**: The `/todo show` command MUST display the current TODO list in the same format the model sees.

**Behavior**:
- GIVEN: User is in an active CLI session
- WHEN: User executes `/todo show`
- THEN: Display current TODO list with:
  - Position numbers (1-based)
  - Status (pending, in_progress, completed)
  - Priority (high, medium, low)
  - Content description
  - Subtasks (if any) with nested position (1.1, 1.2, etc.)

**Why This Matters**: Provides visibility into what the model is working on and what tasks remain.

**Output Format**:
```
Current TODO List:
──────────────────────────────────────
1. [IN_PROGRESS] (HIGH) Implement feature X
   1.1 [PENDING] Write tests
   1.2 [COMPLETED] Create stub

2. [PENDING] (MEDIUM) Write documentation
──────────────────────────────────────
```

### REQ-005: /todo add Command
**Requirement Text**: The `/todo add <pos> <desc>` command MUST insert a new TODO at the specified position using 1-based numbering. Position "last" appends to end. For subtasks, use dotted notation (1.1, 1.2, etc.). When TODOs are added, they MUST become active.

**Behavior**:
- GIVEN: User is in an active CLI session
- WHEN: User executes `/todo add 2 "New task description"`
- THEN: New TODO is inserted at position 2 (0-indexed position 1)
- AND: Existing item at position 2 shifts to position 3
- AND: TODO list becomes active (if it wasn't already)
- AND: New TODO has status='pending', priority='medium' (defaults)

**Position Semantics** (1-based for user input):
- `1` → First top-level todo (index 0)
- `2` → Second top-level todo (index 1)
- `last` → Append as new last todo
- `1.1` → First subtask of todo 1
- `1.2` → Second subtask of todo 1
- `1.last` → Append as last subtask of todo 1

**Why This Matters**: Enables users to manually guide task decomposition and add forgotten items.

**Algorithm for Position Parsing**:
```
1. PARSE position string
2. IF position == "last":
   2.1 INSERT at todos.length
3. ELSE IF position matches /^\d+$/:
   3.1 PARSE as integer (1-based)
   3.2 VALIDATE 1 <= pos <= todos.length + 1
   3.3 INSERT at pos - 1 (convert to 0-based)
4. ELSE IF position matches /^(\d+)\.(\d+|last)$/:
   4.1 PARSE parent_pos, subtask_pos
   4.2 VALIDATE parent exists
   4.3 IF subtask_pos == "last":
       INSERT at parent.subtasks.length
   4.4 ELSE:
       INSERT at subtask_pos - 1
5. ELSE:
   5.1 THROW error "Invalid position format"
```

### REQ-006: /todo delete Command
**Requirement Text**: The `/todo delete <pos>` command MUST remove the TODO at the specified position. If deleting a parent TODO with subtasks, the entire TODO including all subtasks MUST be removed.

**Behavior**:
- GIVEN: User is in an active CLI session with TODOs
- WHEN: User executes `/todo delete 2`
- THEN: TODO at position 2 is removed
- AND: Subsequent TODOs shift up (position 3 becomes 2, etc.)
- IF: Parent TODO with subtasks is deleted
- THEN: All subtasks are removed with the parent

**Why This Matters**: Allows users to prune irrelevant or completed tasks from the active list.

**Algorithm for Position Parsing**:
```
1. PARSE position string using same logic as /todo add
2. IF position is top-level:
   2.1 REMOVE todos[pos - 1]
   2.2 IF parent has subtasks:
       2.2.1 REMOVE all subtasks
3. ELSE IF position is subtask:
   3.1 FIND parent todos[parent_pos - 1]
   3.2 REMOVE parent.subtasks[subtask_pos - 1]
4. SAVE updated list
```

### REQ-007: /todo list Command
**Requirement Text**: The `/todo list` command MUST scan the `~/.llxprt/todos/` directory for all saved TODO files, display them in temporally descending order (newest first), with the current session marked as [CURRENT SESSION].

**Behavior**:
- GIVEN: User is in an active CLI session
- WHEN: User executes `/todo list`
- THEN: System scans `~/.llxprt/todos/todo-*.json` files
- AND: Sorts by file modification time (newest first)
- AND: Displays current session first, marked as [CURRENT SESSION]
- AND: Shows summary for each: item count, status breakdown, first TODO title

**Note**: The selection/loading functionality is DEFERRED to future work. Phase 06 implementation should display the list only, without prompting for selection.

**Why This Matters**: Enables users to resume previous tasks or learn from past TODO patterns.

**Display Format**:
```
Saved TODO Lists:
────────────────────────────────────────────────────
1. [CURRENT SESSION] 3 items (1 in_progress, 2 pending)
   → "Implement feature X"

2. 2 hours ago │ 5 items (5 completed)
   → "Fix bug in parser"

3. 1 day ago │ 2 items (1 pending, 1 completed)
   → "Write documentation"
────────────────────────────────────────────────────
Enter number to load into current session (or blank to cancel):
```

**Algorithm for Temporal Sorting**:
```
1. SCAN directory ~/.llxprt/todos/
2. READ file stats (mtime) for all todo-*.json files
3. IDENTIFY current session file (match sessionId)
4. SORT files:
   4.1 Current session first
   4.2 Others by mtime descending
5. FOR each file:
   5.1 READ todos
   5.2 COUNT by status
   5.3 GET first todo title
   5.4 CALCULATE age from mtime
6. DISPLAY formatted list
```

**Note**: Steps 7-8 (selection prompt and loading) are DEFERRED to future work.

## Integration Analysis (CRITICAL)

### Existing Code That Will Use This Feature

1. **`packages/cli/src/ui/hooks/useTodoPausePreserver.ts`**
   - Currently: Unconditionally clears TODOs on every user prompt
   - Will: Call conditional clearing logic based on completion state
   - Requires: Access to current `todos` array to check completion

2. **`packages/cli/src/ui/contexts/TodoContext.tsx`**
   - Currently: Exposes `updateTodos()` for clearing
   - Will: May need to expose `todos` state for conditional checks
   - Integration point for slash commands to modify TODO state

3. **`packages/cli/src/services/BuiltinCommandLoader.ts`**
   - Currently: Registers all slash commands
   - Will: Import and register `todoCommand`
   - Simple addition to existing command registry

### Existing Code To Be Replaced

**None** - This is an additive feature. The only modification is the conditional clearing logic in `useTodoPausePreserver.ts`, which replaces the unconditional `updateTodos([])` call with conditional logic.

### User Access Points

1. **CLI Commands**:
   - `/todo clear` - Explicit clearing
   - `/todo show` - Display current TODOs
   - `/todo add <pos> <desc>` - Add TODO
   - `/todo delete <pos>` - Remove TODO
   - `/todo list` - View and load saved TODOs

2. **Automatic Behavior**:
   - User prompts with active incomplete TODOs → TODOs persist
   - User prompts with all completed TODOs → TODOs auto-clear
   - Model streams without tool calls → Automatic continuation (up to 3 times)

### Migration Requirements

**None** - Existing TODO storage format remains unchanged. Files in `~/.llxprt/todos/` are already correctly formatted and will work immediately with `/todo list`.

### Integration Test Requirements

1. **End-to-End Flow**:
   - User creates TODOs via model
   - User provides feedback (new prompt)
   - Verify TODOs persist (not cleared)
   - Verify model can see and continue working on same TODOs

2. **Lazy Model Flow**:
   - Model has active TODOs
   - Model responds without tool calls (3 times)
   - Verify continuation prompts sent
   - Verify TODOs remain active after 3 attempts
   - User prompts again
   - Verify counter reset, continuation works again

3. **Manual Management Flow**:
   - User runs `/todo add 1 "New task"`
   - Verify TODO inserted at correct position
   - User runs `/todo delete 2`
   - Verify correct TODO removed
   - User runs `/todo clear`
   - Verify all TODOs cleared

4. **Session History Flow**:
   - Multiple TODO sessions exist in storage
   - User runs `/todo list`
   - Verify sorted display (current first, then temporal)
   - User loads previous session
   - Verify TODOs activated in current session

## Files to Modify

### 1. `packages/cli/src/ui/hooks/useTodoPausePreserver.ts`
**Current Implementation**:
```typescript
controller.handleSubmit(() => {
  updateTodos([]);
});
```

**Required Change**:
```typescript
controller.handleSubmit(() => {
  const allCompleted = todos.length === 0 || 
    todos.every(todo => todo.status === 'completed');
  
  if (allCompleted) {
    updateTodos([]);
  }
  // Otherwise: keep TODOs active
});
```

**Integration Required**:
- Accept `todos: Todo[]` as parameter to `useTodoPausePreserver`
- Update all call sites to pass current todos

### 2. `packages/cli/src/services/BuiltinCommandLoader.ts`
**Required Change**:
- Import `todoCommand` from `../ui/commands/todoCommand.js`
- Add to `allDefinitions` array in `registerBuiltinCommands()`

**Integration Required**: None - simple addition to existing array

## Files to Create

### 1. `packages/cli/src/ui/commands/todoCommand.ts`
**Purpose**: Implement `/todo` slash command with all subcommands

**Required Exports**:
```typescript
export const todoCommand: SlashCommand = {
  name: 'todo',
  kind: CommandKind.System,
  description: 'Manage TODO list',
  subcommands: ['clear', 'show', 'add', 'delete', 'list'],
  // ... implementation
};
```

**Subcommand Implementations**:
- `clear` - Clear current TODOs from memory
- `show` - Display current TODO list with formatting
- `add <pos> <desc>` - Parse position, insert TODO
- `delete <pos>` - Parse position, remove TODO
- `list` - Scan storage, display sorted, allow loading

**Position Parsing** (shared by `add` and `delete`):
```typescript
/**
 * Parse user position input (1-based) into internal position.
 * @plan:PLAN-20260129-TODOPERSIST
 * @pseudocode lines 42-74
 */
interface ParsedPosition {
  parentIndex: number;
  subtaskIndex?: number;
  isLast: boolean;
}

function parsePosition(pos: string, todos: Todo[]): ParsedPosition {
  // Line 42: IF position == "last"
  if (pos === 'last') {
    return { parentIndex: todos.length, isLast: true };
  }
  
  // Line 47: ELSE IF position matches /^\d+$/
  if (/^\d+$/.test(pos)) {
    const index = parseInt(pos, 10) - 1; // Convert 1-based to 0-based
    if (index < 0 || index > todos.length) {
      throw new Error(`Position ${pos} out of range`);
    }
    return { parentIndex: index, isLast: false };
  }
  
  // Line 53: ELSE IF position matches /^(\d+)\.(\d+|last)$/
  const subtaskMatch = pos.match(/^(\d+)\.(\d+|last)$/);
  if (subtaskMatch) {
    const parentIndex = parseInt(subtaskMatch[1], 10) - 1;
    const parent = todos[parentIndex];
    
    if (!parent) {
      throw new Error(`Parent position ${subtaskMatch[1]} does not exist`);
    }
    
    if (subtaskMatch[2] === 'last') {
      return {
        parentIndex,
        subtaskIndex: parent.subtasks?.length || 0,
        isLast: true,
      };
    }
    
    const subtaskIndex = parseInt(subtaskMatch[2], 10) - 1;
    return { parentIndex, subtaskIndex, isLast: false };
  }
  
  // Line 70: ELSE throw error
  throw new Error(`Invalid position format: ${pos}. Use 1, 2, last, 1.1, or 1.last`);
}
```

**Markers Required**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P05
 * @requirement REQ-003
 */
```

### 2. `packages/cli/src/ui/commands/todoCommand.test.ts`
**Purpose**: Behavioral tests for all `/todo` subcommands

**Required Test Cases**:

#### /todo clear Tests (REQ-003)
```typescript
it('clears all TODOs from active session @plan:PLAN-20260129-TODOPERSIST.P04 @requirement:REQ-003', async () => {
  const ctx = createMockContext({ todos: [
    { id: '1', content: 'Task 1', status: 'pending', priority: 'high' },
    { id: '2', content: 'Task 2', status: 'in_progress', priority: 'medium' }
  ]});
  
  await todoCommand.execute(ctx, 'clear', {});
  
  expect(ctx.todoContext.updateTodos).toHaveBeenCalledWith([]);
});
```

#### /todo show Tests (REQ-004)
```typescript
it('displays current TODO list with formatting @plan:PLAN-20260129-TODOPERSIST.P04 @requirement:REQ-004', async () => {
  const ctx = createMockContext({ todos: [
    { id: '1', content: 'Parent task', status: 'in_progress', priority: 'high', 
      subtasks: [
        { id: '1.1', content: 'Subtask 1', status: 'completed' },
        { id: '1.2', content: 'Subtask 2', status: 'pending' }
      ]
    }
  ]});
  
  await todoCommand.execute(ctx, 'show', {});
  
  expect(ctx.output).toMatch(/1\. \[IN_PROGRESS\] \(HIGH\) Parent task/);
  expect(ctx.output).toMatch(/1\.1 \[COMPLETED\] Subtask 1/);
  expect(ctx.output).toMatch(/1\.2 \[PENDING\] Subtask 2/);
});
```

#### /todo add Tests (REQ-005)
```typescript
it('inserts TODO at numeric position @plan:PLAN-20260129-TODOPERSIST.P04 @requirement:REQ-005', async () => {
  const todos = [
    { id: '1', content: 'Task 1', status: 'pending', priority: 'high' },
    { id: '3', content: 'Task 3', status: 'pending', priority: 'low' }
  ];
  
  await todoCommand.execute(ctx, 'add', { pos: '2', desc: 'Task 2' });
  
  expect(updatedTodos[0].content).toBe('Task 1');
  expect(updatedTodos[1].content).toBe('Task 2');
  expect(updatedTodos[2].content).toBe('Task 3');
});

it('appends TODO with "last" position @plan:PLAN-20260129-TODOPERSIST.P04 @requirement:REQ-005', async () => {
  await todoCommand.execute(ctx, 'add', { pos: 'last', desc: 'Final task' });
  
  expect(updatedTodos[updatedTodos.length - 1].content).toBe('Final task');
});

it('inserts subtask at dotted position @plan:PLAN-20260129-TODOPERSIST.P04 @requirement:REQ-005', async () => {
  await todoCommand.execute(ctx, 'add', { pos: '1.2', desc: 'New subtask' });
  
  expect(updatedTodos[0].subtasks![1].content).toBe('New subtask');
});

it('rejects invalid position format @plan:PLAN-20260129-TODOPERSIST.P04 @requirement:REQ-005', async () => {
  await expect(
    todoCommand.execute(ctx, 'add', { pos: 'invalid', desc: 'Task' })
  ).rejects.toThrow('Invalid position format');
});
```

#### /todo delete Tests (REQ-006)
```typescript
it('removes TODO at numeric position @plan:PLAN-20260129-TODOPERSIST.P04 @requirement:REQ-006', async () => {
  const todos = [
    { id: '1', content: 'Task 1', status: 'pending', priority: 'high' },
    { id: '2', content: 'Task 2', status: 'pending', priority: 'medium' },
    { id: '3', content: 'Task 3', status: 'pending', priority: 'low' }
  ];
  
  await todoCommand.execute(ctx, 'delete', { pos: '2' });
  
  expect(updatedTodos).toHaveLength(2);
  expect(updatedTodos[0].content).toBe('Task 1');
  expect(updatedTodos[1].content).toBe('Task 3');
});

it('removes parent TODO with all subtasks @plan:PLAN-20260129-TODOPERSIST.P04 @requirement:REQ-006', async () => {
  const todos = [
    { id: '1', content: 'Parent', status: 'pending', priority: 'high',
      subtasks: [
        { id: '1.1', content: 'Sub 1' },
        { id: '1.2', content: 'Sub 2' }
      ]
    }
  ];
  
  await todoCommand.execute(ctx, 'delete', { pos: '1' });
  
  expect(updatedTodos).toHaveLength(0);
});
```

#### /todo list Tests (REQ-007)
```typescript
it('displays sorted TODO history with current session first @plan:PLAN-20260129-TODOPERSIST.P04 @requirement:REQ-007', async () => {
  // Mock filesystem with multiple todo files
  const files = [
    { name: 'todo-session1.json', mtime: new Date('2026-01-28'), todos: [...] },
    { name: 'todo-session2.json', mtime: new Date('2026-01-29'), todos: [...] },
    { name: 'todo-currentSession.json', mtime: new Date('2026-01-29'), todos: [...] }
  ];
  
  await todoCommand.execute(ctx, 'list', {});
  
  // Current session first
  expect(ctx.output).toMatch(/1\. \[CURRENT SESSION\]/);
  // Others sorted by mtime descending
  expect(ctx.output).toMatch(/2\. 2 hours ago/);
  expect(ctx.output).toMatch(/3\. 1 day ago/);
});

it('loads selected TODO list into current session @plan:PLAN-20260129-TODOPERSIST.P04 @requirement:REQ-007', async () => {
  // User selects option "2"
  await todoCommand.execute(ctx, 'list', { selection: '2' });
  
  expect(ctx.todoContext.updateTodos).toHaveBeenCalledWith(selectedTodos);
});
```

**Property-Based Tests** (30% requirement):
```typescript
import * as fc from 'fast-check';

test.prop([fc.array(fc.record({
  id: fc.string(),
  content: fc.string(),
  status: fc.constantFrom('pending', 'in_progress', 'completed'),
  priority: fc.constantFrom('high', 'medium', 'low')
}))])('position parsing always returns valid index @plan:PLAN-20260129-TODOPERSIST.P04', (todos) => {
  const validPositions = ['1', '2', 'last', '1.1', '1.last'];
  
  for (const pos of validPositions) {
    const result = parsePosition(pos, todos);
    expect(result.parentIndex).toBeGreaterThanOrEqual(0);
    expect(result.parentIndex).toBeLessThanOrEqual(todos.length);
  }
});
```

**Markers Required**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P04
 * @requirement REQ-003
 * @scenario /todo clear removes all TODOs
 */
```

## Phase Breakdown

### Phase 01: Conditional Clearing Stub

**Phase ID**: `PLAN-20260129-TODOPERSIST.P01`

**Prerequisites**:
- Preflight verification (Phase 0.5) completed
- Understanding of current `useTodoPausePreserver.ts` implementation

**Requirements Implemented**:

#### REQ-001: Conditional TODO Clearing (Stub)
**Full Text**: The TODO list MUST persist across user prompts unless ALL todos have status='completed' OR the user explicitly runs `/todo clear`.

**Stub Behavior**:
- Create skeleton function `shouldClearTodos(todos: Todo[]): boolean`
- Returns `false` (stub - never clears)
- Integrate into `useTodoPausePreserver` hook

**Why This Matters**: Establishes the integration point for conditional logic without implementing the actual logic yet.

**Implementation Tasks**:

#### Files to Modify

**`packages/cli/src/ui/hooks/useTodoPausePreserver.ts`**
- Line 33: Add `todos: Todo[]` parameter to `UseTodoPausePreserverOptions`
- Line 38: Import `shouldClearTodos` helper (to be created)
- Line 42: Replace `updateTodos([])` with conditional call:

### Phase 0.5: Preflight Verification

**Phase ID**: `PLAN-20260129-TODOPERSIST.P0.5`

**Prerequisites**: None (this is the first phase)

**Purpose**: Verify ALL assumptions before writing any code (MANDATORY per PLAN.md).

**Implementation Tasks**:

#### Dependency Verification
| Dependency | Verification Command | Status |
|------------|----------------------|--------|
| vitest | `npm ls vitest` | [to be verified] |
| fast-check | `npm ls fast-check` | [to be verified] |
| @vybestack/llxprt-code-core | `npm ls @vybestack/llxprt-code-core` | [to be verified] |

**Verification Commands**:
```bash
# Check test dependencies
npm ls vitest fast-check

# Check core package
npm ls @vybestack/llxprt-code-core
```

#### Type/Interface Verification
| Type Name | Expected Definition | Actual Location | Match? |
|-----------|---------------------|-----------------|--------|
| Todo | `{id: string, content: string, status: 'pending'\|'in_progress'\|'completed', priority?: 'high'\|'medium'\|'low', subtasks?: Todo[]}` | packages/core/src/types/todo-schemas.ts | [to be verified] |
| TodoStore | `class with readTodos(): Todo[], writeTodos(todos: Todo[]): void` | packages/core/src/services/TodoStore.ts or similar | [to be verified] |
| SlashCommand | `{name: string, kind: CommandKind, description: string, execute: (ctx: CommandContext, ...args: string[]) => Promise<MessageActionReturn>}` | packages/cli/src/ui/commands/types.ts | [to be verified] |

**Verification Commands**:
```bash
# Find Todo type definition
grep -rn "interface Todo\|type Todo" packages/core/src --include="*.ts"

# Find TodoStore class
grep -rn "class TodoStore\|export.*TodoStore" packages/core/src --include="*.ts"

# Find SlashCommand interface
grep -rn "interface SlashCommand\|type SlashCommand" packages/cli/src/ui/commands --include="*.ts"

# Verify Todo has expected fields
grep -A 10 "interface Todo" packages/core/src/types/todo-schemas.ts
```

#### Call Path Verification
| Function | Expected Location | Evidence |
|----------|-------------------|----------|
| useTodoPausePreserver | packages/cli/src/ui/hooks/useTodoPausePreserver.ts | [to be verified] |
| TodoContext (updateTodos) | packages/cli/src/ui/contexts/TodoContext.tsx | [to be verified] |
| BuiltinCommandLoader.registerBuiltinCommands | packages/cli/src/services/BuiltinCommandLoader.ts | [to be verified] |

**Verification Commands**:
```bash
# Verify useTodoPausePreserver exists
ls -la packages/cli/src/ui/hooks/useTodoPausePreserver.ts
grep -n "export.*useTodoPausePreserver" packages/cli/src/ui/hooks/useTodoPausePreserver.ts

# Verify TodoContext exists and exposes updateTodos
ls -la packages/cli/src/ui/contexts/TodoContext.tsx
grep -n "updateTodos\|TodoContext" packages/cli/src/ui/contexts/TodoContext.tsx

# Verify BuiltinCommandLoader exists
ls -la packages/cli/src/services/BuiltinCommandLoader.ts
grep -n "registerBuiltinCommands" packages/cli/src/services/BuiltinCommandLoader.ts

# Verify setCommand exists as reference pattern
ls -la packages/cli/src/ui/commands/setCommand.ts
```

#### Test Infrastructure Verification
| Component | Test File Pattern | Ready? |
|-----------|-------------------|--------|
| Commands | packages/cli/src/ui/commands/*.test.ts | [to be verified] |
| Hooks | packages/cli/src/ui/hooks/*.test.ts | [to be verified] |
| Vitest config | vitest.config.ts or similar | [to be verified] |

**Verification Commands**:
```bash
# Check if test files exist in commands directory
find packages/cli/src/ui/commands -name "*.test.ts" | head -5

# Check if test files exist in hooks directory  
find packages/cli/src/ui/hooks -name "*.test.ts" | head -5

# Find vitest configuration
find . -name "vitest.config.*" -o -name "vite.config.*" | grep -v node_modules

# Run a sample test to ensure infrastructure works
npm test -- --run packages/cli/src/ui/commands/setCommand.test.ts 2>&1 | head -20
```

#### Stream End Detection Integration Point
| Component | Expected Location | Evidence |
|----------|-------------------|----------|
| useTodoContinuation hook | packages/cli/src/ui/hooks/useTodoContinuation.ts | [to be verified] |
| Stream completion detection | Look for onStreamEnd, handleComplete, or similar | [to be verified] |

**Verification Commands**:
```bash
# Find where stream completion is detected
grep -rn "stream.*end\|stream.*complete\|onStreamEnd\|handleStreamComplete" packages/cli/src/ui --include="*.ts" --include="*.tsx" | grep -v test | head -10

# Check if useTodoContinuation hook exists
find packages/cli/src/ui/hooks -name "*continuation*" -o -name "*Continue*"

# Look for message handling that detects tool calls
grep -rn "toolCalls\|tool_calls\|hasToolCalls" packages/cli/src/ui --include="*.ts" --include="*.tsx" | grep -v test | head -10
```

#### Blocking Issues
[To be filled during verification - document any mismatches between expected and actual]

#### Verification Gate

**MANDATORY CHECKS** (ALL must pass before proceeding to Phase 01):

- [ ] vitest dependency exists and is ready
- [ ] fast-check dependency exists and is ready
- [ ] Todo type exists in @vybestack/llxprt-code-core with expected fields (id, content, status, priority, subtasks)
- [ ] TodoStore exists with readTodos()/writeTodos() methods OR alternative storage mechanism identified
- [ ] SlashCommand interface matches expected structure (name, kind, description, execute)
- [ ] useTodoPausePreserver hook exists and can be modified
- [ ] TodoContext exists and exposes updateTodos() or equivalent
- [ ] BuiltinCommandLoader exists with registerBuiltinCommands()
- [ ] Test infrastructure (vitest) works with sample test run
- [ ] setCommand.ts exists as reference pattern for new slash commands
- [ ] Stream end detection point identified (useTodoContinuation.ts or equivalent)

**IF ANY CHECKBOX IS UNCHECKED**: 
1. STOP immediately
2. Document the issue in "Blocking Issues" section above
3. Update this plan with corrected assumptions
4. Do NOT proceed to Phase 01

**Verification Success Criteria**:
- All checkboxes checked
- No blocking issues found
- All assumptions validated
- Integration points confirmed

**Required Code Markers** (for verification script):
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P0.5
 * @verification-complete
 */
```

Add this marker as a comment in the plan file once verification is complete.

---


  ```typescript
  if (shouldClearTodos(todos)) {
    updateTodos([]);
  }
  ```

**Create Helper Function** (same file):
```typescript
/**
 * Determines if TODOs should be cleared on user prompt.
 * @plan PLAN-20260129-TODOPERSIST.P01
 * @requirement REQ-001
 * STUB: Always returns false
 */
export function shouldClearTodos(_todos: Todo[]): boolean {
  return false; // Stub implementation
}
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P01
 * @requirement REQ-001
 */
```

**Verification Commands**:

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260129-TODOPERSIST.P01" packages/cli/src/ui/hooks/ | wc -l
# Expected: 2+ occurrences

# TypeScript compiles
npm run typecheck
# Expected: No errors

# No TODO comments in production code
grep -rn "TODO" packages/cli/src/ui/hooks/useTodoPausePreserver.ts
# Expected: No matches
```

**Structural Verification Checklist**:
- [ ] `shouldClearTodos` function created
- [ ] `useTodoPausePreserver` accepts `todos` parameter
- [ ] Conditional clearing integrated (calls `shouldClearTodos`)
- [ ] TypeScript compiles successfully
- [ ] No TODO/FIXME comments

**Semantic Verification Checklist**:
- [ ] Function signature correct: `(todos: Todo[]) => boolean`
- [ ] Integration point established in `handleSubmit`
- [ ] Stub returns `false` (preserves existing behavior for testing)

**Success Criteria**:
- Stub compiles and integrates into existing hook
- No runtime errors
- Existing tests still pass (behavior unchanged)

**Failure Recovery**:
```bash
git checkout -- packages/cli/src/ui/hooks/useTodoPausePreserver.ts
```

---

### Phase 02: Conditional Clearing TDD

**Phase ID**: `PLAN-20260129-TODOPERSIST.P02`

**Prerequisites**:
- Phase 01 completed
- Verification: `grep -r "@plan:PLAN-20260129-TODOPERSIST.P01" packages/cli/src/ui/hooks/`

**Requirements Implemented**:

#### REQ-001: Conditional TODO Clearing (TDD)
**Full Text**: The TODO list MUST persist across user prompts unless ALL todos have status='completed' OR the user explicitly runs `/todo clear`.

**Test Behavior**:
- Test with empty TODO list → returns true (clear)
- Test with all completed TODOs → returns true (clear)
- Test with mix of pending/completed → returns false (keep)
- Test with all pending → returns false (keep)
- Test with all in_progress → returns false (keep)

**Implementation Tasks**:

#### Files to Create

**`packages/cli/src/ui/hooks/useTodoPausePreserver.test.ts`**

```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P02
 * @requirement REQ-001
 */
describe('shouldClearTodos', () => {
  /**
   * @requirement REQ-001
   * @scenario Empty TODO list
   * @given todos = []
   * @when shouldClearTodos(todos) is called
   * @then Returns true (should clear)
   */
  it('returns true for empty TODO list @plan:PLAN-20260129-TODOPERSIST.P02 @requirement:REQ-001', () => {
    const result = shouldClearTodos([]);
    expect(result).toBe(true);
  });

  /**
   * @requirement REQ-001
   * @scenario All TODOs completed
   * @given todos = [{ status: 'completed' }, { status: 'completed' }]
   * @when shouldClearTodos(todos) is called
   * @then Returns true (should clear)
   */
  it('returns true when all TODOs are completed @plan:PLAN-20260129-TODOPERSIST.P02 @requirement:REQ-001', () => {
    const todos = [
      { id: '1', content: 'Task 1', status: 'completed' as const, priority: 'high' as const },
      { id: '2', content: 'Task 2', status: 'completed' as const, priority: 'medium' as const }
    ];
    const result = shouldClearTodos(todos);
    expect(result).toBe(true);
  });

  /**
   * @requirement REQ-001
   * @scenario Mix of completed and pending
   * @given todos = [{ status: 'completed' }, { status: 'pending' }]
   * @when shouldClearTodos(todos) is called
   * @then Returns false (should keep active)
   */
  it('returns false when some TODOs are incomplete @plan:PLAN-20260129-TODOPERSIST.P02 @requirement:REQ-001', () => {
    const todos = [
      { id: '1', content: 'Task 1', status: 'completed' as const, priority: 'high' as const },
      { id: '2', content: 'Task 2', status: 'pending' as const, priority: 'medium' as const }
    ];
    const result = shouldClearTodos(todos);
    expect(result).toBe(false);
  });

  /**
   * @requirement REQ-001
   * @scenario All TODOs pending
   * @given todos = [{ status: 'pending' }, { status: 'pending' }]
   * @when shouldClearTodos(todos) is called
   * @then Returns false (should keep active)
   */
  it('returns false when all TODOs are pending @plan:PLAN-20260129-TODOPERSIST.P02 @requirement:REQ-001', () => {
    const todos = [
      { id: '1', content: 'Task 1', status: 'pending' as const, priority: 'high' as const },
      { id: '2', content: 'Task 2', status: 'pending' as const, priority: 'medium' as const }
    ];
    const result = shouldClearTodos(todos);
    expect(result).toBe(false);
  });

  /**
   * @requirement REQ-001
   * @scenario All TODOs in progress
   * @given todos = [{ status: 'in_progress' }]
   * @when shouldClearTodos(todos) is called
   * @then Returns false (should keep active)
   */
  it('returns false when TODOs are in progress @plan:PLAN-20260129-TODOPERSIST.P02 @requirement:REQ-001', () => {
    const todos = [
      { id: '1', content: 'Task 1', status: 'in_progress' as const, priority: 'high' as const }
    ];
    const result = shouldClearTodos(todos);
    expect(result).toBe(false);
  });
});

/**
 * Property-based test: Any TODO array with at least one non-completed item should NOT clear
 */
test.prop([fc.array(fc.record({
  id: fc.string(),
  content: fc.string(),
  status: fc.constantFrom('pending' as const, 'in_progress' as const, 'completed' as const),
  priority: fc.constantFrom('high' as const, 'medium' as const, 'low' as const)
}), { minLength: 1 })])('never clears when incomplete TODOs exist @plan:PLAN-20260129-TODOPERSIST.P02', (todos) => {
  const hasIncomplete = todos.some(t => t.status !== 'completed');
  const result = shouldClearTodos(todos);
  
  if (hasIncomplete) {
    expect(result).toBe(false);
  }
});
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P02
 * @requirement REQ-001
 * @scenario [description]
 */
```

**Verification Commands**:

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260129-TODOPERSIST.P02" packages/cli/src/ui/hooks/ | wc -l
# Expected: 6+ occurrences (5 unit tests + 1 property test)

# Run tests - should FAIL naturally
npm test -- useTodoPausePreserver.test.ts
# Expected: Tests fail (stub returns false, but some tests expect true)

# No reverse testing patterns
grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow" packages/cli/src/ui/hooks/*.test.ts
# Expected: No matches

# No mock theater
grep -r "toHaveBeenCalled" packages/cli/src/ui/hooks/*.test.ts
# Expected: No matches (behavioral tests only)
```

**Structural Verification Checklist**:
- [ ] Test file created
- [ ] 5+ behavioral tests covering all scenarios
- [ ] 1+ property-based test (30% coverage)
- [ ] All tests tagged with plan and requirement IDs
- [ ] No reverse testing patterns
- [ ] No mock theater patterns

**Semantic Verification Checklist**:
- [ ] Tests verify actual boolean return values (not mocks)
- [ ] Tests cover all status combinations (empty, all completed, mixed, all pending, all in_progress)
- [ ] Property test verifies invariant: incomplete → false
- [ ] Tests FAIL naturally (stub returns false, some expect true)

**Success Criteria**:
- 6+ tests created
- Tests fail naturally with actual values (not "NotYetImplemented")
- Property-based test covers 30%+ of test cases

**Failure Recovery**:
```bash
git checkout -- packages/cli/src/ui/hooks/useTodoPausePreserver.test.ts
```

---

### Phase 03: Conditional Clearing Implementation

**Phase ID**: `PLAN-20260129-TODOPERSIST.P03`

**Prerequisites**:
- Phase 02 completed
- Verification: `grep -r "@plan:PLAN-20260129-TODOPERSIST.P02" packages/cli/src/ui/hooks/`
- Tests exist and fail naturally

**Requirements Implemented**:

#### REQ-001: Conditional TODO Clearing (Implementation)
**Full Text**: The TODO list MUST persist across user prompts unless ALL todos have status='completed' OR the user explicitly runs `/todo clear`.

**Implementation Approach**:
Follow algorithm from requirement specification exactly.

**Pseudocode Reference** (from REQ-001 edge cases):
```
Line 10: IF todos.length === 0
Line 11:   RETURN true (no todos, can clear)
Line 12: ELSE
Line 13:   CHECK every todo.status === 'completed'
Line 14:   RETURN result of check
```

**Implementation Tasks**:

#### Files to Modify

**`packages/cli/src/ui/hooks/useTodoPausePreserver.ts`**

Replace stub implementation:
```typescript
/**
 * Determines if TODOs should be cleared on user prompt.
 * @plan PLAN-20260129-TODOPERSIST.P03
 * @requirement REQ-001
 * @pseudocode lines 10-14
 */
export function shouldClearTodos(todos: Todo[]): boolean {
  // Line 10: IF todos.length === 0
  if (todos.length === 0) {
    // Line 11: RETURN true (no todos, can clear)
    return true;
  }
  
  // Line 13: CHECK every todo.status === 'completed'
  // Line 14: RETURN result of check
  return todos.every(todo => todo.status === 'completed');
}
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P03
 * @requirement REQ-001
 * @pseudocode lines 10-14
 */
```

**Verification Commands**:

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260129-TODOPERSIST.P03" packages/cli/src/ui/hooks/ | wc -l
# Expected: 1 occurrence (implementation function)

# All tests pass
npm test -- useTodoPausePreserver.test.ts
# Expected: All 6+ tests pass

# No test modifications
git diff packages/cli/src/ui/hooks/useTodoPausePreserver.test.ts
# Expected: No changes (tests unchanged from P02)

# Verify pseudocode followed (adjusted for actual implementation pattern)
grep -n "@pseudocode" packages/cli/src/ui/hooks/useTodoPausePreserver.ts
# Expected: At least 1 occurrence referencing pseudocode lines

# No debug code
grep -r "console\.\|TODO\|FIXME" packages/cli/src/ui/hooks/useTodoPausePreserver.ts
# Expected: No matches
```

**Deferred Implementation Detection**:
```bash
# MANDATORY: Run after implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/ui/hooks/useTodoPausePreserver.ts
# Expected: No matches

grep -rn -E "(in a real|in production|for now|placeholder)" packages/cli/src/ui/hooks/useTodoPausePreserver.ts
# Expected: No matches

grep -rn -E "return \[\]|return \{\}|return null" packages/cli/src/ui/hooks/useTodoPausePreserver.ts
# Expected: No matches (except in original code if present)
```

**Structural Verification Checklist**:
- [ ] Phase 02 markers present (tests exist)
- [ ] Implementation references pseudocode lines
- [ ] All tests pass
- [ ] No test modifications
- [ ] No TODO/debug code

**Semantic Verification Checklist**:

#### Does the code DO what the requirement says?
- [ ] Empty TODO list returns `true` (verified by reading implementation)
- [ ] All completed returns `true` (`.every(todo => todo.status === 'completed')`)
- [ ] Any incomplete returns `false` (inverse of `.every()`)

#### Is this REAL implementation?
- [ ] Deferred implementation detection passed (no TODO/HACK)
- [ ] No empty returns
- [ ] No "will be implemented" comments

#### Does the test actually TEST the behavior?
- [ ] Tests verify boolean returns with real TODO arrays
- [ ] Tests would fail if implementation returned opposite values
- [ ] Property test verifies invariant holds

#### Integration verified?
- [ ] `useTodoPausePreserver` hook calls this function
- [ ] Function is exported for testing
- [ ] Called with actual `todos` array from context

**Feature Actually Works**:
```bash
# Manual integration test (if possible to run in isolation)
# This will be fully verified in integration phase
echo "Manual verification deferred to Phase 09 (Integration)"
```

**Success Criteria**:
- All 6+ tests pass
- No tests modified
- Pseudocode followed line-by-line
- Implementation matches algorithm exactly

**Failure Recovery**:
```bash
git checkout -- packages/cli/src/ui/hooks/useTodoPausePreserver.ts
# Revert to stub (P01) and re-implement
```

---

### Phase 04: /todo Command Stub

**Phase ID**: `PLAN-20260129-TODOPERSIST.P04`

**Prerequisites**:
- Phase 03 completed
- Conditional clearing implemented and verified
- Understanding of SlashCommand pattern from `setCommand.ts`

**Requirements Implemented** (Stub):

#### REQ-003: /todo clear (Stub)
#### REQ-004: /todo show (Stub)
#### REQ-005: /todo add (Stub)
#### REQ-006: /todo delete (Stub)
#### REQ-007: /todo list (Stub)

**Stub Behavior**:
- Create command structure with all subcommands
- Each subcommand returns empty implementation
- Position parser skeleton (throws "Not implemented" for now)
- Compiles successfully

**Implementation Tasks**:

#### Files to Create

**`packages/cli/src/ui/commands/todoCommand.ts`**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260129-TODOPERSIST.P04
 * @requirement REQ-003, REQ-004, REQ-005, REQ-006, REQ-007
 */

import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import type { Todo } from '@vybestack/llxprt-code-core';

/**
 * Parsed position result for /todo add and /todo delete
 * @plan PLAN-20260129-TODOPERSIST.P04
 */
interface ParsedPosition {
  parentIndex: number;
  subtaskIndex?: number;
  isLast: boolean;
}

/**
 * Parse user position input (1-based) into internal position.
 * @plan PLAN-20260129-TODOPERSIST.P04
 * STUB: Throws error
 */
function parsePosition(_pos: string, _todos: Todo[]): ParsedPosition {
  throw new Error('Not implemented');
}

/**
 * /todo clear - Clear all TODOs
 * @plan PLAN-20260129-TODOPERSIST.P04
 * @requirement REQ-003
 */
async function handleClear(_ctx: CommandContext): Promise<MessageActionReturn> {
  return { action: 'noop' };
}

/**
 * /todo show - Display current TODOs
 * @plan PLAN-20260129-TODOPERSIST.P04
 * @requirement REQ-004
 */
async function handleShow(_ctx: CommandContext): Promise<MessageActionReturn> {
  return { action: 'noop' };
}

/**
 * /todo add <pos> <desc> - Add TODO at position
 * @plan PLAN-20260129-TODOPERSIST.P04
 * @requirement REQ-005
 */
async function handleAdd(_ctx: CommandContext, _args: string[]): Promise<MessageActionReturn> {
  return { action: 'noop' };
}

/**
 * /todo delete <pos> - Remove TODO at position
 * @plan PLAN-20260129-TODOPERSIST.P04
 * @requirement REQ-006
 */
async function handleDelete(_ctx: CommandContext, _args: string[]): Promise<MessageActionReturn> {
  return { action: 'noop' };
}

/**
 * /todo list - Show saved TODO history
 * @plan PLAN-20260129-TODOPERSIST.P04
 * @requirement REQ-007
 */
async function handleList(_ctx: CommandContext): Promise<MessageActionReturn> {
  return { action: 'noop' };
}

/**
 * Main /todo command dispatcher
 * @plan PLAN-20260129-TODOPERSIST.P04
 */
export const todoCommand: SlashCommand = {
  name: 'todo',
  kind: 'system' as CommandKind,
  description: 'Manage TODO list',
  
  async execute(ctx: CommandContext, ...args: string[]): Promise<MessageActionReturn> {
    const subcommand = args[0];
    
    switch (subcommand) {
      case 'clear':
        return handleClear(ctx);
      case 'show':
        return handleShow(ctx);
      case 'add':
        return handleAdd(ctx, args.slice(1));
      case 'delete':
        return handleDelete(ctx, args.slice(1));
      case 'list':
        return handleList(ctx);
      default:
        return {
          action: 'message',
          text: `Unknown subcommand: ${subcommand}. Use: clear, show, add, delete, list`,
        };
    }
  },
};
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P04
 * @requirement REQ-XXX
 */
```

#### Files to Modify

**`packages/cli/src/services/BuiltinCommandLoader.ts`**
- Line 57: Import `todoCommand`:
  ```typescript
  import { todoCommand } from '../ui/commands/todoCommand.js';
  ```
- Line 147 (in `allDefinitions` array): Add `todoCommand` to the list

**Verification Commands**:

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260129-TODOPERSIST.P04" packages/cli/src/ui/commands/ | wc -l
# Expected: 8+ occurrences (1 file + 5 handlers + helpers)

# TypeScript compiles
npm run typecheck
# Expected: No errors

# todoCommand registered
grep "todoCommand" packages/cli/src/services/BuiltinCommandLoader.ts
# Expected: 2 matches (import + array entry)

# No TODO comments in production code
grep -rn "TODO" packages/cli/src/ui/commands/todoCommand.ts
# Expected: No matches

# No version duplication
find packages/cli/src/ui/commands -name "*todo*" -o -name "*Todo*"
# Expected: Only todoCommand.ts (no TodoV2, TodoNew, etc.)
```

**Structural Verification Checklist**:
- [ ] todoCommand.ts created with all subcommands
- [ ] All handlers stubbed (return noop or throw)
- [ ] parsePosition helper stubbed
- [ ] Command registered in BuiltinCommandLoader
- [ ] TypeScript compiles
- [ ] No TODO/FIXME comments

**Semantic Verification Checklist**:
- [ ] Command structure matches SlashCommand interface
- [ ] Dispatcher routes to correct handlers
- [ ] All 5 subcommands present (clear, show, add, delete, list)
- [ ] Integration point established (registered in loader)

**Success Criteria**:
- Stub compiles and registers
- No runtime errors on load
- Command appears in help (if tested)

**Failure Recovery**:
```bash
git checkout -- packages/cli/src/ui/commands/todoCommand.ts
git checkout -- packages/cli/src/services/BuiltinCommandLoader.ts
```

---

### Phase 05: /todo Command TDD

**Phase ID**: `PLAN-20260129-TODOPERSIST.P05`

**Prerequisites**:
- Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20260129-TODOPERSIST.P04" packages/cli/src/ui/commands/`
- todoCommand stub exists and compiles

**Requirements Implemented** (TDD):

All tests from requirement specifications (see detailed test cases in "Files to Create" section above under `todoCommand.test.ts`).

**Implementation Tasks**:

#### Files to Create

**`packages/cli/src/ui/commands/todoCommand.test.ts`**

[See detailed test implementation in the "Files to Create" section above - includes all test cases for REQ-003 through REQ-007]

Key test coverage:
- `/todo clear`: 3 tests (empty, with todos, verification)
- `/todo show`: 4 tests (empty, single, with subtasks, formatting)
- `/todo add`: 6 tests (numeric, last, subtask, dotted, invalid position, edge cases)
- `/todo delete`: 5 tests (numeric, subtask, parent with subtasks, out of range, invalid)
- `/todo list`: 3 tests (empty dir, sorted display, current first) - **selection/loading deferred**
- Property-based: 3 tests (position parsing, add/delete invariants, list sorting)

**Total**: 24+ behavioral tests + 3 property-based tests (>30% coverage)

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P05
 * @requirement REQ-XXX
 * @scenario [description]
 */
```

**Verification Commands**:

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260129-TODOPERSIST.P05" packages/cli/src/ui/commands/ | wc -l
# Expected: 27+ occurrences (24 unit + 3 property tests)

# Run tests - should FAIL naturally
npm test -- todoCommand.test.ts
# Expected: Tests fail (stubs return noop, not actual behavior)

# No reverse testing patterns
grep -r "toThrow.*Not implemented\|expect.*not\.toThrow" packages/cli/src/ui/commands/todoCommand.test.ts
# Expected: No matches

# No mock theater
grep -r "toHaveBeenCalled" packages/cli/src/ui/commands/todoCommand.test.ts
# Expected: Limited to verifying updateTodos called (behavioral, not mock theater)

# Property-based test coverage (verify fc.assert pattern)
grep -c -E "test\.prop|fc\.assert" packages/cli/src/ui/commands/todoCommand.test.ts
# Expected: >= 3 occurrences (property-based tests)
```

**Structural Verification Checklist**:
- [ ] Test file created
- [ ] 24+ behavioral tests covering all subcommands
- [ ] 3+ property-based tests (using fc.assert pattern)
- [ ] All tests tagged with plan and requirement IDs
- [ ] No reverse testing patterns
- [ ] Behavioral assertions only (no mock theater)

**Semantic Verification Checklist**:
- [ ] Tests verify actual outcomes (TODO modifications, output text)
- [ ] Position parsing tests cover all formats (1, 2, last, 1.1, 1.last)
- [ ] Edge cases tested (empty list, out of range, invalid format)
- [ ] Property tests verify invariants (valid positions, state consistency)
- [ ] Tests FAIL naturally (stubs don't produce expected behavior)

**Success Criteria**:
- 27+ tests created
- Tests fail naturally with "noop" or undefined, not "Not implemented"
- Property-based tests use fc.assert pattern (3+ occurrences)
- All requirements REQ-003 through REQ-007 have test coverage

**Failure Recovery**:
```bash
git checkout -- packages/cli/src/ui/commands/todoCommand.test.ts
```

---

### Phase 06: /todo Command Implementation

**Phase ID**: `PLAN-20260129-TODOPERSIST.P06`

**Prerequisites**:
- Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20260129-TODOPERSIST.P05" packages/cli/src/ui/commands/`
- Tests exist and fail naturally

**Requirements Implemented**:

#### REQ-003: /todo clear (Implementation)
#### REQ-004: /todo show (Implementation)
#### REQ-005: /todo add (Implementation)
#### REQ-006: /todo delete (Implementation)
#### REQ-007: /todo list (Implementation)

**Implementation Approach**:
Follow pseudocode from requirement specifications line-by-line.

**Pseudocode References**:

**REQ-005 Position Parsing** (lines 42-74):
```
42: PARSE position string
43: IF position == "last"
44:   INSERT at todos.length
47: ELSE IF position matches /^\d+$/
48:   PARSE as integer (1-based)
49:   VALIDATE 1 <= pos <= todos.length + 1
50:   INSERT at pos - 1 (convert to 0-based)
53: ELSE IF position matches /^(\d+)\.(\d+|last)$/
54:   PARSE parent_pos, subtask_pos
55:   VALIDATE parent exists
56:   IF subtask_pos == "last"
57:     INSERT at parent.subtasks.length
58:   ELSE
59:     INSERT at subtask_pos - 1
70: ELSE
71:   THROW error "Invalid position format"
```

**REQ-007 Temporal Sorting** (lines 80-95):
```
80: SCAN directory ~/.llxprt/todos/
81: READ file stats (mtime) for all todo-*.json files
82: IDENTIFY current session file (match sessionId)
83: SORT files:
84:   Current session first
85:   Others by mtime descending
86: FOR each file:
87:   READ todos
88:   COUNT by status
89:   GET first todo title
90:   CALCULATE age from mtime
91: DISPLAY formatted list
92: PROMPT for number input
93: IF valid number:
94:   LOAD todos from selected file
95:   ACTIVATE todos
```

**Implementation Tasks**:

#### Files to Modify

**`packages/cli/src/ui/commands/todoCommand.ts`**

Replace all stub implementations with actual code:

```typescript
/**
 * Parse user position input (1-based) into internal position.
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-005
 * @pseudocode lines 42-74
 */
function parsePosition(pos: string, todos: Todo[]): ParsedPosition {
  // Line 43: IF position == "last"
  if (pos === 'last') {
    // Line 44: INSERT at todos.length
    return { parentIndex: todos.length, isLast: true };
  }
  
  // Line 47: ELSE IF position matches /^\d+$/
  if (/^\d+$/.test(pos)) {
    // Line 48: PARSE as integer (1-based)
    const index = parseInt(pos, 10) - 1;
    
    // Line 49: VALIDATE 1 <= pos <= todos.length + 1
    if (index < 0 || index > todos.length) {
      throw new Error(`Position ${pos} out of range (1-${todos.length + 1})`);
    }
    
    // Line 50: INSERT at pos - 1
    return { parentIndex: index, isLast: false };
  }
  
  // Line 53: ELSE IF position matches /^(\d+)\.(\d+|last)$/
  const subtaskMatch = pos.match(/^(\d+)\.(\d+|last)$/);
  if (subtaskMatch) {
    // Line 54: PARSE parent_pos, subtask_pos
    const parentIndex = parseInt(subtaskMatch[1], 10) - 1;
    
    // Line 55: VALIDATE parent exists
    const parent = todos[parentIndex];
    if (!parent) {
      throw new Error(`Parent position ${subtaskMatch[1]} does not exist`);
    }
    
    // Line 56: IF subtask_pos == "last"
    if (subtaskMatch[2] === 'last') {
      // Line 57: INSERT at parent.subtasks.length
      return {
        parentIndex,
        subtaskIndex: parent.subtasks?.length || 0,
        isLast: true,
      };
    }
    
    // Line 59: INSERT at subtask_pos - 1
    const subtaskIndex = parseInt(subtaskMatch[2], 10) - 1;
    return { parentIndex, subtaskIndex, isLast: false };
  }
  
  // Line 71: THROW error
  throw new Error(
    `Invalid position format: ${pos}. Use 1, 2, last, 1.1, or 1.last`
  );
}

/**
 * /todo clear - Clear all TODOs
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-003
 */
async function handleClear(ctx: CommandContext): Promise<MessageActionReturn> {
  const { todoContext } = ctx;
  
  if (!todoContext) {
    return {
      action: 'message',
      text: 'Error: TODO context not available',
    };
  }
  
  // Clear TODOs from memory
  todoContext.updateTodos([]);
  
  return {
    action: 'message',
    text: 'TODO list cleared',
  };
}

/**
 * /todo show - Display current TODOs
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-004
 */
async function handleShow(ctx: CommandContext): Promise<MessageActionReturn> {
  const { todoContext } = ctx;
  
  if (!todoContext) {
    return {
      action: 'message',
      text: 'Error: TODO context not available',
    };
  }
  
  const todos = todoContext.todos || [];
  
  if (todos.length === 0) {
    return {
      action: 'message',
      text: 'No active TODOs',
    };
  }
  
  // Format output
  const lines = ['Current TODO List:', '──────────────────────────────────────'];
  
  todos.forEach((todo, idx) => {
    const pos = idx + 1;
    const status = todo.status.toUpperCase();
    const priority = todo.priority.toUpperCase();
    lines.push(`${pos}. [${status}] (${priority}) ${todo.content}`);
    
    // Add subtasks
    if (todo.subtasks && todo.subtasks.length > 0) {
      todo.subtasks.forEach((subtask, subIdx) => {
        const subPos = `${pos}.${subIdx + 1}`;
        const subStatus = subtask.status?.toUpperCase() || 'PENDING';
        lines.push(`   ${subPos} [${subStatus}] ${subtask.content}`);
      });
    }
  });
  
  lines.push('──────────────────────────────────────');
  
  return {
    action: 'message',
    text: lines.join('\n'),
  };
}

/**
 * /todo add <pos> <desc> - Add TODO at position
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-005
 * @pseudocode lines 42-74
 */
async function handleAdd(ctx: CommandContext, args: string[]): Promise<MessageActionReturn> {
  const { todoContext } = ctx;
  
  if (!todoContext) {
    return {
      action: 'message',
      text: 'Error: TODO context not available',
    };
  }
  
  if (args.length < 2) {
    return {
      action: 'message',
      text: 'Usage: /todo add <position> <description>',
    };
  }
  
  const posStr = args[0];
  const description = args.slice(1).join(' ');
  const todos = [...(todoContext.todos || [])];
  
  try {
    const parsed = parsePosition(posStr, todos);
    
    // Create new TODO
    const newTodo: Todo = {
      id: `${Date.now()}`,
      content: description,
      status: 'pending',
      priority: 'medium',
    };
    
    if (parsed.subtaskIndex !== undefined) {
      // Adding subtask
      const parent = todos[parsed.parentIndex];
      if (!parent.subtasks) {
        parent.subtasks = [];
      }
      parent.subtasks.splice(parsed.subtaskIndex, 0, newTodo);
    } else {
      // Adding top-level TODO
      todos.splice(parsed.parentIndex, 0, newTodo);
    }
    
    todoContext.updateTodos(todos);
    
    return {
      action: 'message',
      text: `Added TODO at position ${posStr}: "${description}"`,
    };
  } catch (error) {
    return {
      action: 'message',
      text: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * /todo delete <pos> - Remove TODO at position
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-006
 * @pseudocode position parsing (same as add)
 */
async function handleDelete(ctx: CommandContext, args: string[]): Promise<MessageActionReturn> {
  const { todoContext } = ctx;
  
  if (!todoContext) {
    return {
      action: 'message',
      text: 'Error: TODO context not available',
    };
  }
  
  if (args.length < 1) {
    return {
      action: 'message',
      text: 'Usage: /todo delete <position>',
    };
  }
  
  const posStr = args[0];
  const todos = [...(todoContext.todos || [])];
  
  try {
    const parsed = parsePosition(posStr, todos);
    
    if (parsed.subtaskIndex !== undefined) {
      // Deleting subtask
      const parent = todos[parsed.parentIndex];
      if (!parent.subtasks || parsed.subtaskIndex >= parent.subtasks.length) {
        throw new Error(`Subtask position ${posStr} does not exist`);
      }
      const deleted = parent.subtasks.splice(parsed.subtaskIndex, 1)[0];
      
      todoContext.updateTodos(todos);
      
      return {
        action: 'message',
        text: `Deleted subtask at ${posStr}: "${deleted.content}"`,
      };
    } else {
      // Deleting top-level TODO (includes all subtasks)
      if (parsed.parentIndex >= todos.length) {
        throw new Error(`Position ${posStr} does not exist`);
      }
      const deleted = todos.splice(parsed.parentIndex, 1)[0];
      
      todoContext.updateTodos(todos);
      
      const subtaskNote = deleted.subtasks?.length 
        ? ` (and ${deleted.subtasks.length} subtask(s))`
        : '';
      
      return {
        action: 'message',
        text: `Deleted TODO at ${posStr}: "${deleted.content}"${subtaskNote}`,
      };
    }
  } catch (error) {
    return {
      action: 'message',
      text: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * /todo list - Show saved TODO history
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-007
 * @pseudocode lines 80-95
 */
async function handleList(ctx: CommandContext): Promise<MessageActionReturn> {
  const { todoContext, sessionId } = ctx;
  
  if (!todoContext || !sessionId) {
    return {
      action: 'message',
      text: 'Error: TODO context or session ID not available',
    };
  }
  
  try {
    // Line 80: SCAN directory ~/.llxprt/todos/
    const todoDir = path.join(os.homedir(), '.llxprt', 'todos');
    
    if (!fs.existsSync(todoDir)) {
      return {
        action: 'message',
        text: 'No saved TODO lists found',
      };
    }
    
    // Line 81: READ file stats for all todo-*.json files
    const files = fs.readdirSync(todoDir)
      .filter(f => f.startsWith('todo-') && f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(todoDir, f);
        const stats = fs.statSync(filePath);
        return { name: f, path: filePath, mtime: stats.mtime };
      });
    
    if (files.length === 0) {
      return {
        action: 'message',
        text: 'No saved TODO lists found',
      };
    }
    
    // Line 82: IDENTIFY current session file
    const currentSessionFile = `todo-${sessionId}.json`;
    
    // Line 83-85: SORT files
    files.sort((a, b) => {
      if (a.name === currentSessionFile) return -1;
      if (b.name === currentSessionFile) return 1;
      return b.mtime.getTime() - a.mtime.getTime(); // Descending
    });
    
    // Line 86-90: Format display
    const lines = ['Saved TODO Lists:', '────────────────────────────────────────'];
    
    files.forEach((file, idx) => {
      const isCurrent = file.name === currentSessionFile;
      const content = fs.readFileSync(file.path, 'utf8');
      const todos: Todo[] = JSON.parse(content);
      
      // Count by status
      const counts = {
        pending: todos.filter(t => t.status === 'pending').length,
        in_progress: todos.filter(t => t.status === 'in_progress').length,
        completed: todos.filter(t => t.status === 'completed').length,
      };
      
      const firstTitle = todos[0]?.content || '(empty)';
      const age = isCurrent ? '[CURRENT SESSION]' : formatAge(file.mtime);
      
      const statusSummary = [
        counts.in_progress && `${counts.in_progress} in_progress`,
        counts.pending && `${counts.pending} pending`,
        counts.completed && `${counts.completed} completed`,
      ].filter(Boolean).join(', ');
      
      lines.push(
        `${idx + 1}. ${age} │ ${todos.length} items (${statusSummary})`,
        `   → "${firstTitle}"`,
        ''
      );
    });
    
    lines.push('────────────────────────────────────────');
    
    // Line 91: DISPLAY formatted list
    // Note: Selection/loading functionality is DEFERRED to future work
    return {
      action: 'message',
      text: lines.join('\n'),
    };
  } catch (error) {
    return {
      action: 'message',
      text: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Helper: Format time ago from Date
 */
function formatAge(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-XXX
 * @pseudocode lines X-Y
 */
```

**Verification Commands**:

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260129-TODOPERSIST.P06" packages/cli/src/ui/commands/ | wc -l
# Expected: 6+ occurrences (parsePosition + 5 handlers)

# All tests pass
npm test -- todoCommand.test.ts
# Expected: All 28+ tests pass

# No test modifications
git diff packages/cli/src/ui/commands/todoCommand.test.ts
# Expected: No changes

# Verify pseudocode referenced
grep -n "@pseudocode" packages/cli/src/ui/commands/todoCommand.ts | wc -l
# Expected: At least 6 occurrences (parsePosition + 5 handlers)

# No debug code
grep -r "console\.\|TODO\|FIXME" packages/cli/src/ui/commands/todoCommand.ts
# Expected: No matches
```

**Deferred Implementation Detection**:
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/cli/src/ui/commands/todoCommand.ts
# Expected: No matches

grep -rn -E "(in a real|for now|placeholder)" packages/cli/src/ui/commands/todoCommand.ts
# Expected: No matches
```

**Structural Verification Checklist**:
- [ ] Phase 05 markers present (tests exist)
- [ ] All handlers implemented (no stubs remaining)
- [ ] parsePosition references pseudocode lines
- [ ] All tests pass
- [ ] No test modifications
- [ ] No TODO/debug code

**Semantic Verification Checklist**:

#### Does the code DO what the requirements say?
- [ ] `/todo clear` clears TODOs (verified by test)
- [ ] `/todo show` formats output correctly (verified by test)
- [ ] `/todo add` parses positions and inserts (verified by test)
- [ ] `/todo delete` removes TODOs and subtasks (verified by test)
- [ ] `/todo list` scans, sorts, displays (verified by test)

#### Is this REAL implementation?
- [ ] Deferred implementation detection passed
- [ ] No empty returns
- [ ] All handlers have actual logic

#### Integration verified?
- [ ] All handlers use `todoContext.updateTodos()`
- [ ] Position parsing works with real TODO arrays
- [ ] File I/O works with actual ~/.llxprt/todos/ directory

**Success Criteria**:
- All 28+ tests pass
- No tests modified
- Pseudocode followed line-by-line
- All 5 subcommands fully functional

**Failure Recovery**:
```bash
git checkout -- packages/cli/src/ui/commands/todoCommand.ts
# Revert to stub (P04) and re-implement
```

---

### Phase 07: Integration Stub

**Phase ID**: `PLAN-20260129-TODOPERSIST.P07`

**Prerequisites**:
- Phase 06 completed
- All unit tests passing
- Command implementation verified

**Requirements Implemented** (Integration Stub):

#### INT-001: useTodoPausePreserver Integration
**Requirement**: The `useTodoPausePreserver` hook MUST receive the current `todos` array and pass it to `shouldClearTodos()`.

**Stub Behavior**:
- Update `TodoContext` to expose `todos` if not already exposed
- Update call sites of `useTodoPausePreserver` to pass `todos`
- Integration compiles but behavior unchanged (stub still in place from P01-P03)

**Implementation Tasks**:

#### Files to Modify

**`packages/cli/src/ui/contexts/TodoContext.tsx`** (if changes needed)
- Verify `todos` is exposed in context
- If not, add to context value

**Call sites of `useTodoPausePreserver`** (find with grep)
```bash
grep -r "useTodoPausePreserver" packages/cli/src/ui --include="*.tsx" --include="*.ts"
```

Update each call site to pass `todos`:
```typescript
const { handleUserInputSubmit } = useTodoPausePreserver({
  controller,
  updateTodos,
  handleFinalSubmit,
  todos: todoContext.todos || [], // ADD THIS
});
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P07
 * @requirement INT-001
 */
```

**Verification Commands**:

```bash
# TypeScript compiles
npm run typecheck
# Expected: No errors

# useTodoPausePreserver receives todos parameter
grep -A 3 "useTodoPausePreserver\({" packages/cli/src/ui --include="*.tsx" --include="*.ts" | grep "todos:"
# Expected: At least 1 match

# Integration markers present
grep -r "@plan:PLAN-20260129-TODOPERSIST.P07" packages/cli/src/ui | wc -l
# Expected: 2+ occurrences
```

**Structural Verification Checklist**:
- [ ] TodoContext exposes `todos`
- [ ] Call sites updated to pass `todos`
- [ ] TypeScript compiles
- [ ] No runtime errors

**Semantic Verification Checklist**:
- [ ] `todos` array actually flows from context to hook
- [ ] Hook receives correct type (Todo[])
- [ ] No breaking changes to existing behavior

**Success Criteria**:
- Integration compiles
- Existing behavior unchanged (tests still pass)
- Data flow established

**Failure Recovery**:
```bash
git checkout -- packages/cli/src/ui/contexts/TodoContext.tsx
git checkout -- [call-site-files]
```

---

### Phase 08: Integration TDD

**Phase ID**: `PLAN-20260129-TODOPERSIST.P08`

**Prerequisites**:
- Phase 07 completed
- Integration stub in place

**Requirements Implemented** (Integration TDD):

#### INT-001: End-to-End TODO Persistence (TDD)
**Requirement**: When user submits a prompt with incomplete TODOs, the TODOs MUST persist and remain visible to the model.

**Test Scenarios**:

```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P08
 * @requirement INT-001
 */
describe('End-to-End TODO Persistence Integration', () => {
  /**
   * @requirement INT-001
   * @scenario User corrects model with incomplete TODOs
   * @given Model has TODO list with 2 pending items
   * @when User submits new prompt
   * @then TODOs remain active (not cleared)
   * @and Model receives same TODO list in context
   */
  it('preserves incomplete TODOs across user prompts @plan:PLAN-20260129-TODOPERSIST.P08 @requirement:INT-001', async () => {
    // Setup: Create session with active TODOs
    const todos = [
      { id: '1', content: 'Implement feature X', status: 'in_progress', priority: 'high' },
      { id: '2', content: 'Write tests', status: 'pending', priority: 'medium' }
    ];
    
    // Simulate model creating TODOs
    todoContext.updateTodos(todos);
    
    // User submits correction/feedback
    await submitUserInput('Add error handling to feature X');
    
    // Verify: TODOs still active
    expect(todoContext.todos).toHaveLength(2);
    expect(todoContext.todos[0].id).toBe('1');
    expect(todoContext.todos[1].id).toBe('2');
  });

  /**
   * @requirement INT-001
   * @scenario All TODOs completed triggers auto-clear
   * @given Model has TODO list with all completed items
   * @when User submits new prompt
   * @then TODOs are cleared automatically
   */
  it('auto-clears when all TODOs completed @plan:PLAN-20260129-TODOPERSIST.P08 @requirement:INT-001', async () => {
    // Setup: All completed
    const todos = [
      { id: '1', content: 'Task 1', status: 'completed', priority: 'high' },
      { id: '2', content: 'Task 2', status: 'completed', priority: 'medium' }
    ];
    
    todoContext.updateTodos(todos);
    
    // User submits new prompt
    await submitUserInput('Start new task');
    
    // Verify: TODOs cleared
    expect(todoContext.todos).toHaveLength(0);
  });

  /**
   * @requirement REQ-003
   * @scenario /todo clear explicitly clears
   * @given Model has TODO list with incomplete items
   * @when User runs /todo clear
   * @then TODOs are cleared immediately
   */
  it('clears TODOs on explicit /todo clear command @plan:PLAN-20260129-TODOPERSIST.P08 @requirement:REQ-003', async () => {
    // Setup: Active TODOs
    const todos = [
      { id: '1', content: 'Task 1', status: 'in_progress', priority: 'high' }
    ];
    
    todoContext.updateTodos(todos);
    
    // User runs /todo clear
    await executeCommand('/todo clear');
    
    // Verify: TODOs cleared
    expect(todoContext.todos).toHaveLength(0);
  });
});

/**
 * Integration test: Manual TODO management flow
 */
describe('Manual TODO Management Integration', () => {
  it('adds TODO and activates list @plan:PLAN-20260129-TODOPERSIST.P08 @requirement:REQ-005', async () => {
    // Start with empty
    expect(todoContext.todos).toHaveLength(0);
    
    // User adds TODO
    await executeCommand('/todo add last "Implement authentication"');
    
    // Verify: TODO added and list active
    expect(todoContext.todos).toHaveLength(1);
    expect(todoContext.todos[0].content).toBe('Implement authentication');
  });

  it('deletes TODO correctly @plan:PLAN-20260129-TODOPERSIST.P08 @requirement:REQ-006', async () => {
    // Setup: 3 TODOs
    todoContext.updateTodos([
      { id: '1', content: 'Task 1', status: 'pending', priority: 'high' },
      { id: '2', content: 'Task 2', status: 'pending', priority: 'medium' },
      { id: '3', content: 'Task 3', status: 'pending', priority: 'low' }
    ]);
    
    // User deletes middle TODO
    await executeCommand('/todo delete 2');
    
    // Verify: Correct TODO removed
    expect(todoContext.todos).toHaveLength(2);
    expect(todoContext.todos[0].content).toBe('Task 1');
    expect(todoContext.todos[1].content).toBe('Task 3');
  });
});
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P08
 * @requirement INT-001
 * @scenario [description]
 */
```

**Verification Commands**:

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260129-TODOPERSIST.P08" packages/cli/src/ui --include="*.test.ts" | wc -l
# Expected: 5+ occurrences (integration tests)

# Run tests - should FAIL (integration not implemented yet)
npm test -- --grep "Integration"
# Expected: Tests fail (todos not actually persisting yet)

# No reverse testing
grep -r "toThrow.*NotYetImplemented" packages/cli/src/ui --include="*.test.ts"
# Expected: No matches
```

**Structural Verification Checklist**:
- [ ] Integration test file created or tests added to existing suite
- [ ] 5+ integration tests covering end-to-end flows
- [ ] All tests tagged with plan and requirement IDs
- [ ] No reverse testing patterns

**Semantic Verification Checklist**:
- [ ] Tests verify actual TODO persistence across prompts
- [ ] Tests verify auto-clear when all completed
- [ ] Tests verify manual management commands work
- [ ] Tests FAIL naturally (integration not connected yet)

**Success Criteria**:
- 5+ integration tests created
- Tests fail naturally (not "NotYetImplemented")
- Tests verify end-to-end behavior (not just unit behavior)

**Failure Recovery**:
```bash
git checkout -- [integration-test-file]
```

---

### Phase 09: Integration Implementation

**Phase ID**: `PLAN-20260129-TODOPERSIST.P09`

**Prerequisites**:
- Phase 08 completed
- Integration tests exist and fail

**Requirements Implemented**:

#### INT-001: Complete TODO Persistence Integration
**Requirement**: Wire all components together so TODOs actually persist across user prompts.

**Implementation Tasks**:

This phase should be minimal because:
1. Conditional clearing already implemented (P03)
2. Command handlers already implemented (P06)
3. Integration stub already wired (P07)

**What needs to happen**:
- Verify `todos` flows from context → hook → `shouldClearTodos()`
- If any connection is missing, add it
- Ensure no code is preventing the flow

**Files to Verify/Modify**:

**`packages/cli/src/ui/hooks/useTodoPausePreserver.ts`**
- Verify `todos` parameter is used (should be from P03)
- Verify `shouldClearTodos(todos)` is called (should be from P03)

**Call sites** (from P07)
- Verify `todos` is passed from context

**If everything was done correctly in previous phases, this should be a verification-only phase.**

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P09
 * @requirement INT-001
 */
```

**Verification Commands**:

```bash
# All integration tests pass
npm test -- --grep "Integration"
# Expected: All 5+ integration tests pass

# No test modifications
git diff packages/cli/src/ui --include="*.test.ts"
# Expected: No changes

# End-to-end manual test
# (This would require actually running the CLI - document expected behavior)
echo "Manual verification:"
echo "1. Start CLI session"
echo "2. Have model create TODOs"
echo "3. Submit user prompt"
echo "4. Verify TODOs still visible in /todo show"
echo "5. Run /todo clear"
echo "6. Verify TODOs cleared"
```

**Deferred Implementation Detection**:
```bash
grep -rn -E "(TODO|FIXME|HACK)" packages/cli/src/ui/hooks/useTodoPausePreserver.ts packages/cli/src/ui/contexts/TodoContext.tsx
# Expected: No matches
```

**Structural Verification Checklist**:
- [ ] Integration tests pass
- [ ] No test modifications
- [ ] All components wired correctly

**Semantic Verification Checklist**:

#### Does the feature actually work end-to-end?
- [ ] User can submit prompt without clearing TODOs (when incomplete)
- [ ] User can submit prompt and auto-clear TODOs (when all completed)
- [ ] User can run `/todo clear` to explicitly clear
- [ ] User can run `/todo add` and TODO appears in list
- [ ] User can run `/todo delete` and TODO is removed
- [ ] User can run `/todo show` and sees formatted list

#### Integration points verified?
- [ ] TodoContext → useTodoPausePreserver (todos flow)
- [ ] shouldClearTodos → conditional clearing (logic flow)
- [ ] todoCommand → TodoContext (command mutations)

**Feature Actually Works**:
```bash
# Manual test procedure (to be executed by human tester):
# 1. npm run start
# 2. Interact with model to create TODOs
# 3. Type a user prompt (not slash command)
# 4. Run /todo show
# 5. Verify TODOs still present
# 6. Run /todo clear
# 7. Run /todo show
# 8. Verify "No active TODOs" message
```

**Success Criteria**:
- All integration tests pass
- Manual testing confirms end-to-end flow works
- No gaps in data flow

**Failure Recovery**:
```bash
# If integration broken, check each connection point:
git diff packages/cli/src/ui/hooks/useTodoPausePreserver.ts
git diff packages/cli/src/ui/contexts/TodoContext.tsx
# Identify and fix missing connections
```

---

### Phase 10: Lazy Model Continuation Stub

**Phase ID**: `PLAN-20260129-TODOPERSIST.P10`

**Prerequisites**:
- Phase 09 completed
- Basic TODO persistence working

**Requirements Implemented** (Stub):

#### REQ-002: Lazy Model Continuation
**Requirement**: When model streams without tool calls AND active TODOs exist, trigger continuation up to 3 times.

**Stub Behavior**:
- Create continuation detection logic skeleton
- Hook into stream end event in useTodoContinuation.ts
- Stub: Always returns without continuation (noop)

**Implementation Tasks**:

#### Files to Create/Modify

**Integration Point**: `packages/cli/src/ui/hooks/useTodoContinuation.ts`

This is where stream end detection happens. The continuation logic must be integrated here to detect when the model finishes streaming without making tool calls.

**Create continuation helper** (in useTodoContinuation.ts or separate helper file):
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P10
 * @requirement REQ-002
 */
interface ContinuationState {
  attempts: number;
  maxAttempts: number;
}

/**
 * Determines if continuation prompt should be sent.
 * @plan PLAN-20260129-TODOPERSIST.P10
 * @requirement REQ-002
 * STUB: Always returns false
 */
export function shouldContinue(
  _todos: Todo[],
  _hadToolCalls: boolean,
  _state: ContinuationState
): boolean {
  return false; // Stub
}

/**
 * Reset continuation attempts counter.
 * @plan PLAN-20260129-TODOPERSIST.P10
 * @requirement REQ-002
 */
export function resetContinuationAttempts(_state: ContinuationState): void {
  // Stub
}
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P10
 * @requirement REQ-002
 */
```

**Verification Commands**:

```bash
# TypeScript compiles
npm run typecheck
# Expected: No errors

# Stub functions exist
grep -r "shouldContinue\|resetContinuationAttempts" packages/cli/src --include="*.ts"
# Expected: At least 2 matches

# No TODO comments
grep -rn "TODO" [new-file-path]
# Expected: No matches
```

**Structural Verification Checklist**:
- [ ] Continuation state interface defined
- [ ] shouldContinue function stubbed
- [ ] resetContinuationAttempts function stubbed
- [ ] TypeScript compiles
- [ ] No TODO/FIXME comments

**Semantic Verification Checklist**:
- [ ] Integration point identified (where stream ends)
- [ ] Stub returns false (no continuation triggered)
- [ ] No breaking changes to existing behavior

**Success Criteria**:
- Stub compiles
- Existing behavior unchanged

**Failure Recovery**:
```bash
git checkout -- [new-file]
```

---

### Phase 11: Lazy Model Continuation TDD

**Phase ID**: `PLAN-20260129-TODOPERSIST.P11`

**Prerequisites**:
- Phase 10 completed
- Continuation stubs exist

**Requirements Implemented** (TDD):

#### REQ-002: Lazy Model Continuation (TDD)
**Full Text**: When the model streams without making tool calls AND active TODOs exist, system triggers continuation up to 3 times, then completes turn but keeps TODOs active. User prompt resets counter.

**Test Scenarios**:

```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P11
 * @requirement REQ-002
 */
describe('Lazy Model Continuation', () => {
  /**
   * @requirement REQ-002
   * @scenario Model streams without tool calls
   * @given Active TODOs exist, no tool calls, 0 attempts
   * @when shouldContinue is called
   * @then Returns true (should continue)
   */
  it('triggers continuation when model streams without tool calls @plan:PLAN-20260129-TODOPERSIST.P11 @requirement:REQ-002', () => {
    const todos = [{ id: '1', content: 'Task', status: 'pending', priority: 'high' }];
    const state = { attempts: 0, maxAttempts: 3 };
    
    const result = shouldContinue(todos, false, state);
    
    expect(result).toBe(true);
  });

  /**
   * @requirement REQ-002
   * @scenario Model made tool calls
   * @given Active TODOs exist, tool calls made
   * @when shouldContinue is called
   * @then Returns false (no continuation needed)
   */
  it('skips continuation when model made tool calls @plan:PLAN-20260129-TODOPERSIST.P11 @requirement:REQ-002', () => {
    const todos = [{ id: '1', content: 'Task', status: 'pending', priority: 'high' }];
    const state = { attempts: 0, maxAttempts: 3 };
    
    const result = shouldContinue(todos, true, state);
    
    expect(result).toBe(false);
  });

  /**
   * @requirement REQ-002
   * @scenario No active TODOs
   * @given No TODOs or all completed
   * @when shouldContinue is called
   * @then Returns false (no continuation needed)
   */
  it('skips continuation when no active TODOs @plan:PLAN-20260129-TODOPERSIST.P11 @requirement:REQ-002', () => {
    const todos: Todo[] = [];
    const state = { attempts: 0, maxAttempts: 3 };
    
    const result = shouldContinue(todos, false, state);
    
    expect(result).toBe(false);
  });

  /**
   * @requirement REQ-002
   * @scenario Max attempts reached
   * @given Active TODOs, no tool calls, 3 attempts already
   * @when shouldContinue is called
   * @then Returns false (max attempts reached)
   */
  it('stops continuation after 3 attempts @plan:PLAN-20260129-TODOPERSIST.P11 @requirement:REQ-002', () => {
    const todos = [{ id: '1', content: 'Task', status: 'pending', priority: 'high' }];
    const state = { attempts: 3, maxAttempts: 3 };
    
    const result = shouldContinue(todos, false, state);
    
    expect(result).toBe(false);
  });

  /**
   * @requirement REQ-002
   * @scenario User prompt resets counter
   * @given Continuation attempts at 3
   * @when resetContinuationAttempts is called
   * @then Attempts reset to 0
   */
  it('resets counter on user prompt @plan:PLAN-20260129-TODOPERSIST.P11 @requirement:REQ-002', () => {
    const state = { attempts: 3, maxAttempts: 3 };
    
    resetContinuationAttempts(state);
    
    expect(state.attempts).toBe(0);
  });
});

/**
 * Property-based test: Continuation logic invariants
 */
test.prop([
  fc.array(fc.record({ id: fc.string(), content: fc.string(), status: fc.constantFrom('pending', 'in_progress', 'completed'), priority: fc.constantFrom('high', 'medium', 'low') })),
  fc.boolean(),
  fc.integer({ min: 0, max: 5 })
])('never continues beyond max attempts @plan:PLAN-20260129-TODOPERSIST.P11', (todos, hadToolCalls, attempts) => {
  const state = { attempts, maxAttempts: 3 };
  const result = shouldContinue(todos, hadToolCalls, state);
  
  if (attempts >= 3) {
    expect(result).toBe(false);
  }
});
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P11
 * @requirement REQ-002
 * @scenario [description]
 */
```

**Verification Commands**:

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260129-TODOPERSIST.P11" packages/cli/src --include="*.test.ts" | wc -l
# Expected: 6+ occurrences (5 unit + 1 property test)

# Run tests - should FAIL
npm test -- [continuation-test-file]
# Expected: Tests fail (stub returns false, some expect true)

# No reverse testing
grep -r "toThrow.*NotYetImplemented" packages/cli/src --include="*.test.ts"
# Expected: No matches
```

**Structural Verification Checklist**:
- [ ] Test file created or tests added
- [ ] 5+ behavioral tests covering all scenarios
- [ ] 1+ property-based test
- [ ] All tests tagged with plan and requirement IDs
- [ ] No reverse testing patterns

**Semantic Verification Checklist**:
- [ ] Tests verify actual boolean returns
- [ ] Tests cover: no tool calls, had tool calls, no TODOs, max attempts, reset
- [ ] Property test verifies max attempts invariant
- [ ] Tests FAIL naturally (stub behavior incorrect)

**Success Criteria**:
- 6+ tests created
- Tests fail naturally
- Property test covers 30%+

**Failure Recovery**:
```bash
git checkout -- [test-file]
```

---

### Phase 12: Lazy Model Continuation Implementation

**Phase ID**: `PLAN-20260129-TODOPERSIST.P12`

**Prerequisites**:
- Phase 11 completed
- Continuation tests exist and fail

**Requirements Implemented**:

#### REQ-002: Lazy Model Continuation (Implementation)
**Full Text**: Implement continuation logic following pseudocode from REQ-002.

**Pseudocode Reference** (from REQ-002):
```
1: DETECT stream end with no tool calls
2: CHECK active todos exist
3: CHECK continuation_attempts < MAX_CONTINUATION_ATTEMPTS (3)
4: IF all conditions true:
  4.1 INCREMENT continuation_attempts
  4.2 SEND continuation prompt to model
  4.3 GOTO 1
5: ELSE IF attempts >= 3:
  5.1 COMPLETE turn
  5.2 KEEP todos active
  5.3 WAIT for user input
6: WHEN user submits prompt:
  6.1 RESET continuation_attempts to 0
  6.2 APPLY conditional clearing (REQ-001)
```

**Implementation Tasks**:

#### Files to Modify

**[Continuation logic file]** (from P10)

```typescript
/**
 * Determines if continuation prompt should be sent.
 * @plan PLAN-20260129-TODOPERSIST.P12
 * @requirement REQ-002
 * @pseudocode lines 1-5
 */
export function shouldContinue(
  todos: Todo[],
  hadToolCalls: boolean,
  state: ContinuationState
): boolean {
  // Line 2: CHECK active todos exist
  const hasActiveTodos = todos.length > 0 && 
    todos.some(t => t.status !== 'completed');
  
  // Line 1: DETECT stream end with no tool calls
  if (hadToolCalls) {
    return false;
  }
  
  // If no active TODOs, no continuation
  if (!hasActiveTodos) {
    return false;
  }
  
  // Line 3: CHECK continuation_attempts < MAX
  // Line 5: ELSE IF attempts >= 3
  if (state.attempts >= state.maxAttempts) {
    return false;
  }
  
  // Line 4: IF all conditions true
  return true;
}

/**
 * Reset continuation attempts counter.
 * @plan PLAN-20260129-TODOPERSIST.P12
 * @requirement REQ-002
 * @pseudocode line 6.1
 */
export function resetContinuationAttempts(state: ContinuationState): void {
  // Line 6.1: RESET continuation_attempts to 0
  state.attempts = 0;
}

/**
 * Increment continuation attempts counter.
 * @plan PLAN-20260129-TODOPERSIST.P12
 * @requirement REQ-002
 * @pseudocode line 4.1
 */
export function incrementContinuationAttempts(state: ContinuationState): void {
  // Line 4.1: INCREMENT continuation_attempts
  state.attempts++;
}
```

**Integration Point** (where stream ends):
```typescript
// On stream end:
if (shouldContinue(todos, hadToolCalls, continuationState)) {
  incrementContinuationAttempts(continuationState);
  // Line 4.2: SEND continuation prompt to model
  sendContinuationPrompt(todos);
}
```

**In user input handler**:
```typescript
// When user submits prompt:
resetContinuationAttempts(continuationState);
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P12
 * @requirement REQ-002
 * @pseudocode lines X-Y
 */
```

**Verification Commands**:

```bash
# All tests pass
npm test -- [continuation-test-file]
# Expected: All 6+ tests pass

# No test modifications
git diff [continuation-test-file]
# Expected: No changes

# Verify pseudocode followed
grep -A 5 "pseudocode" [continuation-file] | grep -c "Line"
# Expected: 6+ pseudocode line comments

# No debug code
grep -r "console\.\|TODO\|FIXME" [continuation-file]
# Expected: No matches
```

**Deferred Implementation Detection**:
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" [continuation-file]
# Expected: No matches

grep -rn -E "(in a real|for now|placeholder)" [continuation-file]
# Expected: No matches
```

**Structural Verification Checklist**:
- [ ] All tests pass
- [ ] No test modifications
- [ ] Pseudocode followed line-by-line
- [ ] No TODO/debug code

**Semantic Verification Checklist**:

#### Does the code DO what the requirement says?
- [ ] Returns true when: no tool calls AND active TODOs AND attempts < 3
- [ ] Returns false when: tool calls made OR no active TODOs OR attempts >= 3
- [ ] Reset function sets attempts to 0
- [ ] Increment function increases attempts

#### Is this REAL implementation?
- [ ] Deferred implementation detection passed
- [ ] No empty returns
- [ ] Actual logic implemented

#### Integration verified?
- [ ] shouldContinue called on stream end
- [ ] incrementContinuationAttempts called when continuing
- [ ] resetContinuationAttempts called on user prompt

**Success Criteria**:
- All 6+ tests pass
- No tests modified
- Pseudocode followed exactly
- Integration hooks in place

**Failure Recovery**:
```bash
git checkout -- [continuation-file]
# Revert to stub (P10) and re-implement
```

---

### Phase 13: Full System Integration TDD

**Phase ID**: `PLAN-20260129-TODOPERSIST.P13`

**Prerequisites**:
- Phase 12 completed
- All individual components implemented

**Requirements Implemented** (Integration TDD):

#### INT-002: Full System Integration
**Requirement**: All components work together: persistence + manual commands + lazy continuation.

**Test Scenarios**:

```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P13
 * @requirement INT-002
 */
describe('Full System Integration', () => {
  /**
   * @requirement INT-002
   * @scenario Complete workflow: create, persist, continue, clear
   * @given Fresh session
   * @when Model creates TODOs, user prompts, model lazy, user clears
   * @then All behaviors work correctly in sequence
   */
  it('handles complete TODO lifecycle @plan:PLAN-20260129-TODOPERSIST.P13 @requirement:INT-002', async () => {
    // Step 1: Model creates TODOs
    todoContext.updateTodos([
      { id: '1', content: 'Task 1', status: 'pending', priority: 'high' },
      { id: '2', content: 'Task 2', status: 'pending', priority: 'medium' }
    ]);
    
    // Step 2: User provides feedback
    await submitUserInput('Add error handling');
    
    // Verify: TODOs persisted
    expect(todoContext.todos).toHaveLength(2);
    
    // Step 3: Model responds without tool calls (lazy)
    await simulateModelResponse('I understand, working on it...', { hadToolCalls: false });
    
    // Verify: Continuation triggered
    expect(continuationState.attempts).toBe(1);
    
    // Step 4: Model lazy again
    await simulateModelResponse('Still working...', { hadToolCalls: false });
    
    // Verify: Second continuation
    expect(continuationState.attempts).toBe(2);
    
    // Step 5: User runs /todo clear
    await executeCommand('/todo clear');
    
    // Verify: TODOs cleared, attempts reset
    expect(todoContext.todos).toHaveLength(0);
    expect(continuationState.attempts).toBe(0);
  });

  /**
   * @requirement INT-002
   * @scenario Manual management during active session
   * @given Model has TODOs, user adds/deletes manually
   * @when User submits prompt
   * @then Manual changes persist
   */
  it('preserves manual TODO changes across prompts @plan:PLAN-20260129-TODOPERSIST.P13 @requirement:INT-002', async () => {
    // Model creates TODOs
    todoContext.updateTodos([
      { id: '1', content: 'Original task', status: 'pending', priority: 'high' }
    ]);
    
    // User adds TODO manually
    await executeCommand('/todo add last "Manual task"');
    
    // Verify: 2 TODOs
    expect(todoContext.todos).toHaveLength(2);
    
    // User submits prompt (not clearing)
    await submitUserInput('Continue working');
    
    // Verify: Manual TODO still there
    expect(todoContext.todos).toHaveLength(2);
    expect(todoContext.todos[1].content).toBe('Manual task');
  });

  /**
   * @requirement INT-002
   * @scenario Continuation counter resets on user prompt
   * @given Continuation attempts at 2
   * @when User submits prompt
   * @then Counter resets, continuation can happen again
   */
  it('resets continuation counter on user prompt @plan:PLAN-20260129-TODOPERSIST.P13 @requirement:INT-002', async () => {
    // Setup: Active TODOs, 2 continuation attempts
    todoContext.updateTodos([
      { id: '1', content: 'Task', status: 'pending', priority: 'high' }
    ]);
    continuationState.attempts = 2;
    
    // User submits prompt
    await submitUserInput('Please finish the task');
    
    // Verify: Counter reset
    expect(continuationState.attempts).toBe(0);
    
    // Model lazy again
    await simulateModelResponse('Working on it...', { hadToolCalls: false });
    
    // Verify: Continuation triggered (counter was reset)
    expect(continuationState.attempts).toBe(1);
  });
});
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P13
 * @requirement INT-002
 * @scenario [description]
 */
```

**Verification Commands**:

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260129-TODOPERSIST.P13" packages/cli/src --include="*.test.ts" | wc -l
# Expected: 3+ occurrences (integration tests)

# Run tests - should FAIL
npm test -- --grep "Full System Integration"
# Expected: Tests fail (components not fully integrated yet)
```

**Structural Verification Checklist**:
- [ ] Integration tests created
- [ ] 3+ end-to-end workflow tests
- [ ] All tests tagged with plan and requirement IDs

**Semantic Verification Checklist**:
- [ ] Tests verify complete workflows (not isolated behaviors)
- [ ] Tests cover: create → persist → continue → clear
- [ ] Tests verify manual management + auto behavior interactions
- [ ] Tests FAIL naturally

**Success Criteria**:
- 3+ integration tests created
- Tests verify end-to-end flows
- Tests fail naturally

**Failure Recovery**:
```bash
git checkout -- [integration-test-file]
```

---

### Phase 14: Full System Integration Implementation

**Phase ID**: `PLAN-20260129-TODOPERSIST.P14`

**Prerequisites**:
- Phase 13 completed
- Full integration tests exist and fail

**Requirements Implemented**:

#### INT-002: Complete System Integration
**Requirement**: Wire all components together for seamless operation.

**Implementation Tasks**:

**Most integration should already be done from previous phases. This phase verifies and completes any missing connections.**

#### Verification Points:

1. **Conditional Clearing** (P01-P03)
   - [ ] useTodoPausePreserver receives todos
   - [ ] shouldClearTodos is called
   - [ ] TODOs persist when incomplete

2. **Manual Commands** (P04-P06)
   - [ ] todoCommand registered
   - [ ] All subcommands functional
   - [ ] TODOs update via updateTodos()

3. **Lazy Continuation** (P10-P12)
   - [ ] shouldContinue called on stream end
   - [ ] incrementContinuationAttempts called
   - [ ] resetContinuationAttempts called on user prompt

4. **Data Flow**:
   - [ ] TodoContext → useTodoPausePreserver
   - [ ] TodoContext → todoCommand
   - [ ] ContinuationState → stream end handler
   - [ ] User prompt → resetContinuationAttempts

**If any connection is missing, add it.**

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P14
 * @requirement INT-002
 */
```

**Verification Commands**:

```bash
# All integration tests pass
npm test -- --grep "Full System Integration"
# Expected: All 3+ tests pass

# All unit tests still pass
npm test
# Expected: All tests pass

# No test modifications
git diff packages/cli/src --include="*.test.ts"
# Expected: No changes (or only additions from P13)
```

**Deferred Implementation Detection**:
```bash
# Check all modified files
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/cli/src/ui/hooks packages/cli/src/ui/commands packages/cli/src/ui/contexts --include="*.ts" --exclude="*.test.ts"
# Expected: No matches

grep -rn -E "(in a real|for now|placeholder)" packages/cli/src/ui/hooks packages/cli/src/ui/commands packages/cli/src/ui/contexts --include="*.ts" --exclude="*.test.ts"
# Expected: No matches
```

**Structural Verification Checklist**:
- [ ] All integration tests pass
- [ ] All unit tests still pass
- [ ] No test modifications
- [ ] No TODO/debug code

**Semantic Verification Checklist**:

#### Does the feature actually work end-to-end?
- [ ] Create TODOs → persist across prompts → manual add/delete → clear (verified by test)
- [ ] Lazy model → continuation → max attempts → user prompt reset (verified by test)
- [ ] All commands functional: /todo clear, show, add, delete, list

#### Integration points verified?
- [ ] TodoContext provides data to all consumers
- [ ] useTodoPausePreserver conditional clearing works
- [ ] todoCommand mutations apply correctly
- [ ] Continuation logic triggers at right times

#### Lifecycle verified?
- [ ] TODOs created → stored → persisted → displayed → cleared
- [ ] Continuation attempts increment → max out → reset on user prompt
- [ ] No memory leaks or state corruption

**Feature Actually Works**:
```bash
# Manual test procedure (execute and document results):
# 1. npm run start
# 2. Have model create TODOs via tool_write
# 3. Type "Add error handling" (user prompt)
# 4. Run /todo show
# 5. Expected: TODOs still visible
# 6. Have model respond without tool calls
# 7. Expected: Continuation prompt sent (log shows)
# 8. Run /todo add last "Manual task"
# 9. Run /todo show
# 10. Expected: Manual task in list
# 11. Run /todo delete 1
# 12. Run /todo show
# 13. Expected: First TODO removed
# 14. Run /todo clear
# 15. Run /todo show
# 16. Expected: "No active TODOs"
```

**Success Criteria**:
- All integration tests pass
- Manual testing confirms all behaviors work
- No gaps in integration

**Failure Recovery**:
```bash
# Identify which integration point failed
npm test -- --grep "Full System Integration" --verbose
# Fix the specific connection and re-verify
```

---

### Phase 15: Documentation and Cleanup

**Phase ID**: `PLAN-20260129-TODOPERSIST.P15`

**Prerequisites**:
- Phase 14 completed
- All tests passing
- Feature fully functional

**Requirements Implemented**:

#### DOC-001: User Documentation
**Requirement**: Document new `/todo` commands and behavior changes for users.

**Implementation Tasks**:

#### Files to Create/Modify

**User-facing documentation** (location TBD based on project structure):
- Update CLI help text for `/todo` command
- Add examples to user guide (if exists)
- Update CHANGELOG with feature description

**Developer documentation**:
- Update architecture docs with TODO persistence behavior
- Document continuation logic for future maintainers
- Add inline comments for complex logic

**Example Documentation**:
```markdown
# TODO Persistence

## Overview
The TODO list now persists across user prompts unless all items are completed.

## Commands

### /todo clear
Clears all TODOs from the active session.

Usage: `/todo clear`

### /todo show
Displays the current TODO list.

Usage: `/todo show`

Output:
```
Current TODO List:
──────────────────────────────────────
1. [IN_PROGRESS] (HIGH) Implement feature X
   1.1 [PENDING] Write tests
   1.2 [COMPLETED] Create stub
──────────────────────────────────────
```

### /todo add
Adds a new TODO at the specified position.

Usage: `/todo add <position> <description>`

Positions:
- `1`, `2`, etc. - Top-level positions (1-based)
- `last` - Append to end
- `1.1`, `1.2` - Subtask positions
- `1.last` - Append as last subtask

Examples:
```
/todo add 2 "Write documentation"
/todo add last "Deploy to production"
/todo add 1.1 "Write unit tests"
```

### /todo delete
Removes a TODO at the specified position.

Usage: `/todo delete <position>`

Note: Deleting a parent TODO removes all its subtasks.

Examples:
```
/todo delete 2
/todo delete 1.1
```

### /todo list
Shows all saved TODO lists from previous sessions.

Usage: `/todo list`

Output displays current session first, then others sorted by recency.

## Behavior Changes

### Persistence Across Prompts
Previously, the TODO list was cleared on every user prompt. Now:
- TODOs persist if any are incomplete
- TODOs auto-clear if all are completed
- TODOs can be explicitly cleared with `/todo clear`

### Lazy Model Handling
If the model responds without taking action (no tool calls) while TODOs are active:
- System sends up to 3 continuation prompts
- After 3 attempts, turn completes but TODOs remain active
- Next user prompt resets the counter

This prevents the model from "talking its way out" of doing work.
```

**Required Code Markers**:
```typescript
/**
 * @plan PLAN-20260129-TODOPERSIST.P15
 * @requirement DOC-001
 */
```

**Verification Commands**:

```bash
# Documentation files created/updated
ls -l docs/ README.md CHANGELOG.md
# Expected: Updated files

# Help text includes /todo
npm run start -- /help | grep "/todo"
# Expected: /todo command listed
```

**Structural Verification Checklist**:
- [ ] User documentation created/updated
- [ ] Developer documentation updated
- [ ] CHANGELOG entry added
- [ ] Help text updated

**Semantic Verification Checklist**:
- [ ] Documentation explains all 5 subcommands
- [ ] Examples provided for each command
- [ ] Behavior changes clearly explained
- [ ] Position syntax documented

**Success Criteria**:
- Complete user-facing documentation
- Clear developer notes for future maintenance
- CHANGELOG reflects new feature

**Failure Recovery**:
```bash
git checkout -- docs/ README.md CHANGELOG.md
# Re-create documentation
```

---

### Phase 16: Final Verification and Acceptance Testing

**Phase ID**: `PLAN-20260129-TODOPERSIST.P16`

**Prerequisites**:
- Phase 15 completed
- All previous phases verified
- Documentation complete

**Requirements Implemented**:

#### VERIFY-001: Complete Feature Verification
**Requirement**: Verify all requirements are met and feature is production-ready.

**Verification Tasks**:

#### 1. Requirement Coverage Check

```bash
# Verify all requirements have tests
for REQ in REQ-001 REQ-002 REQ-003 REQ-004 REQ-005 REQ-006 REQ-007; do
  COUNT=$(grep -r "@requirement:$REQ" packages/cli/src --include="*.test.ts" | wc -l)
  echo "$REQ: $COUNT tests"
  if [ $COUNT -lt 1 ]; then
    echo "FAIL: $REQ has no tests"
    exit 1
  fi
done
# Expected: All requirements have >= 1 test
```

#### 2. Test Coverage Verification

```bash
# Run all tests
npm test
# Expected: All tests pass

# Check coverage
npm run test:coverage
# Expected: >90% coverage for modified files
```

#### 3. Phase Marker Verification

```bash
# Verify all phases have markers in code
for PHASE in P01 P02 P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15; do
  COUNT=$(grep -r "@plan:PLAN-20260129-TODOPERSIST.$PHASE" packages/cli/src --include="*.ts" | wc -l)
  echo "$PHASE: $COUNT markers"
  if [ $COUNT -lt 1 ]; then
    echo "FAIL: $PHASE has no markers"
    exit 1
  fi
done
# Expected: All phases have markers
```

#### 4. No Deferred Implementation

```bash
# Final scan for deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/ui/hooks packages/cli/src/ui/commands packages/cli/src/ui/contexts --include="*.ts" --exclude="*.test.ts"
# Expected: No matches

grep -rn -E "(in a real|for now|placeholder|not yet)" packages/cli/src/ui/hooks packages/cli/src/ui/commands packages/cli/src/ui/contexts --include="*.ts" --exclude="*.test.ts"
# Expected: No matches
```

#### 5. Manual Acceptance Testing

Execute the following user scenarios and document results:

**Scenario 1: TODO Persistence**
```
1. Start CLI
2. Create TODOs (via model interaction)
3. Submit user prompt "Add validation"
4. Run /todo show
5. VERIFY: TODOs still present
[OK] PASS / [ERROR] FAIL: _______
```

**Scenario 2: Auto-Clear on Completion**
```
1. Have all TODOs marked completed
2. Submit user prompt "Start new task"
3. Run /todo show
4. VERIFY: "No active TODOs"
[OK] PASS / [ERROR] FAIL: _______
```

**Scenario 3: Manual Commands**
```
1. Run /todo add last "Test task"
2. Run /todo show
3. VERIFY: Task appears
4. Run /todo delete 1
5. Run /todo show
6. VERIFY: Task removed
[OK] PASS / [ERROR] FAIL: _______
```

**Scenario 4: Lazy Continuation**
```
1. Create TODOs
2. Have model respond without tool calls
3. Check logs for continuation prompt
4. VERIFY: Continuation triggered
5. Repeat 3 times
6. VERIFY: Turn completes after 3 attempts
7. Submit user prompt
8. VERIFY: Counter reset (continuation can happen again)
[OK] PASS / [ERROR] FAIL: _______
```

**Scenario 5: TODO History**
```
1. Create TODOs in session 1
2. Exit and start session 2
3. Create different TODOs
4. Run /todo list
5. VERIFY: Both sessions shown, current first, with summary info
Note: Selection/loading functionality is DEFERRED (display only for now)
[OK] PASS / [ERROR] FAIL: _______
```

#### 6. Performance Verification

```bash
# No performance regression
npm run benchmark # (if benchmarks exist)
# Expected: No significant slowdown in TODO operations
```

#### 7. Integration with Existing Features

```bash
# Verify existing features still work
npm test -- --grep "existing|legacy|regression"
# Expected: All tests pass
```

**Verification Checklist**:

- [ ] All requirements REQ-001 through REQ-007 have test coverage
- [ ] All phases P01-P15 have code markers
- [ ] All unit tests pass (28+ tests)
- [ ] All integration tests pass (8+ tests)
- [ ] Code coverage >90% for modified files
- [ ] No deferred implementation patterns
- [ ] No TODO/FIXME/HACK comments
- [ ] Manual scenarios all pass
- [ ] Documentation complete
- [ ] No performance regression
- [ ] Existing features unaffected

**Success Criteria**:
- All verification checkboxes checked
- All manual scenarios pass
- Production-ready for deployment

**Failure Recovery**:
```bash
# If any verification fails:
# 1. Identify failing component
# 2. Return to relevant phase (P01-P14)
# 3. Fix issue
# 4. Re-run verification
```

---

## Execution Tracker

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 0.5 | P0.5 | ⬜ | - | - | - | N/A | Preflight verification |
| 01 | P01 | ⬜ | - | - | - | ⬜ | Conditional clearing stub |
| 02 | P02 | ⬜ | - | - | - | ⬜ | Conditional clearing TDD |
| 03 | P03 | ⬜ | - | - | - | ⬜ | Conditional clearing impl |
| 04 | P04 | ⬜ | - | - | - | ⬜ | /todo command stub |
| 05 | P05 | ⬜ | - | - | - | ⬜ | /todo command TDD |
| 06 | P06 | ⬜ | - | - | - | ⬜ | /todo command impl |
| 07 | P07 | ⬜ | - | - | - | ⬜ | Integration stub |
| 08 | P08 | ⬜ | - | - | - | ⬜ | Integration TDD |
| 09 | P09 | ⬜ | - | - | - | ⬜ | Integration impl |
| 10 | P10 | ⬜ | - | - | - | ⬜ | Continuation stub |
| 11 | P11 | ⬜ | - | - | - | ⬜ | Continuation TDD |
| 12 | P12 | ⬜ | - | - | - | ⬜ | Continuation impl |
| 13 | P13 | ⬜ | - | - | - | ⬜ | Full system TDD |
| 14 | P14 | ⬜ | - | - | - | ⬜ | Full system impl |
| 15 | P15 | ⬜ | - | - | - | ⬜ | Documentation |
| 16 | P16 | ⬜ | - | - | - | ⬜ | Final verification |

## Completion Markers

- [ ] All phases have @plan markers in code
- [ ] All requirements have @requirement markers
- [ ] Verification script passes
- [ ] No phases skipped
- [ ] Manual acceptance testing complete
- [ ] Documentation complete
- [ ] Production-ready

---

## Risk Mitigation

### Risk 1: Continuation Logic Too Aggressive
**Mitigation**: MAX_CONTINUATION_ATTEMPTS set to 3 (configurable if needed)

### Risk 2: TODO Storage Conflicts
**Mitigation**: Each session has unique file (`todo-{sessionId}.json`)

### Risk 3: Position Parsing Edge Cases
**Mitigation**: Comprehensive TDD phase (P05) with property-based tests covering all formats

### Risk 4: Integration Breakage
**Mitigation**: Integration tests (P08, P13) verify end-to-end before deployment

### Risk 5: Performance with Large TODO Lists
**Mitigation**: TodoStore uses file I/O efficiently, lists are in-memory during session

---

## Success Metrics

Upon completion, this plan will deliver:

1. **Zero TODO Auto-Clear Issues**: Users can correct the model mid-task without losing context
2. **5 New Slash Commands**: Full manual TODO management capability
3. **Lazy Model Handling**: Prevents model from avoiding work (3-attempt limit)
4. **Session History**: Users can review past TODO lists (display only - selection/loading deferred)
5. **100% Test Coverage**: All requirements verified with behavioral + property tests
6. **Zero Deferred Implementation**: No TODO/FIXME/placeholder code
7. **Complete Documentation**: User guide + developer notes

**This plan is now ready for execution following the strict TDD workflow defined in PLAN.md.**
