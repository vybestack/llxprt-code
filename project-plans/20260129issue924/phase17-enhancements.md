# Phase 17-20: /todo Command Enhancements

## Plan ID: PLAN-20260129-TODOPERSIST-EXT
## Parent: PLAN-20260129-TODOPERSIST
## Status: PLANNING

---

## Overview

Extend the `/todo` command with additional subcommands and improved UX based on user feedback.

### New Features Required

1. **`/todo set <num>`** - Set a TODO's status to `in_progress` (mark as active)
2. **`/todo add` help** - Better inline help for position and description arguments
3. **`/todo delete` extended** - Support ranges (`1-5`), `all`, in addition to single position
4. **`/todo load <num>`** - Load a saved TODO session from `/todo list`

---

## Phase 17: `/todo set` Command

### Requirements
- `/todo set 2` → Sets TODO at position 2 to `in_progress`
- `/todo set 1.1` → Sets subtask 1.1 to active (if subtasks have status)
- Validation: Position must exist
- Output: "Set TODO 2 to in_progress: <content>"

### Implementation
1. Add `set` subcommand to `todoCommand.ts`
2. Reuse `parsePosition()` for position parsing
3. Update status in todos array
4. Call `updateTodos()` with modified array

### Tests (TDD)
- `/todo set 1` on valid TODO → status changes to `in_progress`
- `/todo set 99` on non-existent position → error message
- `/todo set` without args → usage help

---

## Phase 18: `/todo delete` Extended Syntax

### Requirements
- `/todo delete 2` → Delete single TODO (existing)
- `/todo delete 1-5` → Delete TODOs 1 through 5 (inclusive)
- `/todo delete all` → Delete all TODOs (equivalent to `/todo clear`)
- `/todo delete 1.1-1.3` → Delete subtasks 1.1 through 1.3

### Implementation
1. Extend position parsing to handle:
   - `all` keyword
   - Range syntax: `N-M` or `N.X-N.Y`
2. Modify delete action to handle multiple deletions
3. Delete in reverse order to maintain index stability

### Tests (TDD)
- `/todo delete 2-4` with 5 TODOs → deletes 3 items, 2 remain
- `/todo delete all` → clears list
- `/todo delete 1-1` → deletes single item (edge case)
- `/todo delete 5-2` → error (invalid range)
- Property-based: range deletion preserves non-deleted items

---

## Phase 19: `/todo load <num>` Command

### Requirements
- `/todo list` displays numbered list of saved sessions
- `/todo load 3` → Loads session #3 from the list
- Confirmation if current session has active TODOs: "Replace current TODOs? (y/n)"
- Output: "Loaded TODO session: <first task content>"

### Implementation
1. Add `load` subcommand to `todoCommand.ts`
2. Reuse file scanning logic from `list` action
3. Parse session file and call `updateTodos()` with loaded data
4. Consider: Add confirmation prompt if current todos exist

### Tests (TDD)
- `/todo load 1` with valid sessions → loads first session
- `/todo load 99` with fewer sessions → error message
- `/todo load` without args → usage help
- Property-based: loaded todos match file content

---

## Phase 20: Improved Help Text

### Requirements
- `/todo add` without args → detailed help:
  ```
  Usage: /todo add <position> <description>
  
  Position formats:
    1, 2, 3    - Insert at specific position (1-based)
    last       - Append to end of list
    1.1, 1.2   - Insert subtask under parent TODO 1
    1.last     - Append subtask to parent TODO 1
  
  Examples:
    /todo add 1 "Fix login bug"
    /todo add last "Write documentation"
    /todo add 2.1 "Add unit tests"
  ```
- `/todo delete` without args → detailed help with range syntax
- `/todo set` without args → detailed help

### Implementation
1. Update action handlers to show detailed help when args missing
2. Use multi-line MessageType.INFO output
3. Consistent formatting across all subcommands

### Tests
- Each subcommand without args → shows help (not error)
- Help text contains example usage

---

## Implementation Order

| Phase | Feature | Complexity | Dependencies |
|-------|---------|------------|--------------|
| 17 | `/todo set` | Low | None |
| 18 | `/todo delete` extended | Medium | Position parsing |
| 19 | `/todo load` | Medium | List scanning logic |
| 20 | Help text | Low | All subcommands |

---

## Position Parsing Extensions

Current `parsePosition()` handles:
- `"1"`, `"2"` → single position
- `"last"` → append position
- `"1.1"`, `"1.2"` → subtask position
- `"1.last"` → subtask append

New parsing needed:
- `"all"` → special keyword for delete
- `"1-5"` → range (returns start/end indices)
- `"1.1-1.3"` → subtask range

### Proposed Interface
```typescript
interface ParsedRange {
  type: 'single' | 'range' | 'all';
  start?: ParsedPosition;
  end?: ParsedPosition;
}

function parseDeleteTarget(target: string, todos: Todo[]): ParsedRange;
```

---

## Verification Checklist

- [ ] All new tests written first (TDD)
- [ ] Property-based tests for ranges
- [ ] TypeScript compiles
- [ ] All tests pass
- [ ] Lint passes
- [ ] Build succeeds
- [ ] Manual testing with synthetic profile
