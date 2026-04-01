# REIMPLEMENT Playbook: ce35d84 — cleanup: Organize key bindings

## Upstream Change Summary

Upstream reorganized the key bindings enum and configuration for better organization:

1. **Command enum values renamed** to hierarchical format (e.g., `'return'` → `'basic.confirm'`)
2. **Commands reorganized into categories**: Basic Controls, Cursor Movement, Editing, Scrolling, History & Search, Navigation, Suggestions & Completions, Text Input, App Controls
3. **Some commands moved between categories** (e.g., CLEAR_SCREEN moved from "Screen Control" to "App Controls")
4. **Documentation updated** in `keyboard-shortcuts.md`
5. **Category structure changed** in `commandCategories`
6. **Description text improved** in `commandDescriptions`

## LLxprt Current State

**File**: `packages/cli/src/config/keyBindings.ts`

LLxprt has **additional commands** that must be preserved:
- `TOGGLE_TODO_DIALOG` - LLxprt-specific
- `TOGGLE_TOOL_DESCRIPTIONS` - LLxprt-specific
- `REFRESH_KEYPRESS` - LLxprt-specific
- `TOGGLE_MOUSE_EVENTS` - LLxprt-specific

LLxprt also has different key bindings for some commands:
- `SHOW_ERROR_DETAILS` bound to `Ctrl+O` (not `F12`)
- `TOGGLE_TODO_DIALOG` bound to `Ctrl+Q`
- `TOGGLE_TOOL_DESCRIPTIONS` bound to `Ctrl+T`
- `REFRESH_KEYPRESS` bound to `Ctrl+Shift+R`
- `TOGGLE_MOUSE_EVENTS` bound to `Ctrl+\`

LLxprt categories include additional sections:
- "Todo Dialog" category
- "Mouse" category

## Adaptation Plan

### File-by-File Changes

#### 1. `packages/cli/src/config/keyBindings.ts`

**DO NOT blindly adopt upstream's enum values** - LLxprt should keep its flat enum values to avoid breaking existing keybinding configurations and muscle memory.

**Instead, adopt the ORGANIZATIONAL improvements**:

1. **Reorganize `Command` enum** with comments for categories (keep LLxprt's flat values):
   ```typescript
   export enum Command {
     // Basic Controls
     RETURN = 'return',
     ESCAPE = 'escape',
     QUIT = 'quit',        // Add if not present
     EXIT = 'exit',        // Add if not present

     // Cursor Movement
     HOME = 'home',
     END = 'end',
     MOVE_UP = 'moveUp',
     // ... etc

     // Editing (new category from upstream)
     KILL_LINE_RIGHT = 'killLineRight',
     // ... text editing commands

     // Scrolling
     // ...

     // History & Search
     HISTORY_UP = 'historyUp',
     // ...

     // Navigation
     // ...

     // Suggestions & Completions
     // ...

     // Text Input
     SUBMIT = 'submit',
     NEWLINE = 'newline',

     // App Controls (merge "Screen Control" here)
     SHOW_ERROR_DETAILS = 'showErrorDetails',
     TOGGLE_TODO_DIALOG = 'toggleTodoDialog',      // LLXPRT-SPECIFIC - PRESERVE
     TOGGLE_TOOL_DESCRIPTIONS = 'toggleToolDescriptions', // LLXPRT-SPECIFIC - PRESERVE
     SHOW_IDE_CONTEXT_DETAIL = 'showIDEContextDetail',
     TOGGLE_MARKDOWN = 'toggleMarkdown',
     TOGGLE_COPY_MODE = 'toggleCopyMode',
     TOGGLE_YOLO = 'toggleYolo',
     TOGGLE_AUTO_EDIT = 'toggleAutoEdit',
     UNDO = 'undo',
     REDO = 'redo',
     // ... other app controls
     CLEAR_SCREEN = 'clearScreen',  // Moved from Screen Control
     REFRESH_KEYPRESS = 'refreshKeypress',  // LLXPRT-SPECIFIC - PRESERVE
     TOGGLE_MOUSE_EVENTS = 'toggleMouseEvents',  // LLXPRT-SPECIFIC - PRESERVE

     // Shell commands
     REVERSE_SEARCH = 'reverseSearch',
     // ...
   }
   ```

2. **Update `defaultKeyBindings`** organization (same bindings, reorganized comments)

3. **Update `commandCategories`** to match new structure:
   - Remove "Screen Control" category — move **both** `CLEAR_SCREEN` **and** `REFRESH_KEYPRESS` into "App Controls" (do not drop either one)
   - Keep "Todo Dialog" and "Mouse" categories (LLxprt-specific)
   - Add "Editing" category if not present

4. **Update `commandDescriptions`** with improved text from upstream where applicable

5. **Add missing commands** if any:
   - `QUIT` and `EXIT` should exist
   - `MOVE_UP`, `MOVE_DOWN` cursor movement
   - `DELETE_WORD_FORWARD` if missing

#### 2. Documentation (if exists)

Update `docs/cli/keyboard-shortcuts.md` to reflect the new organization, preserving LLxprt-specific commands.

## Files to Read

- `packages/cli/src/config/keyBindings.ts`
- Upstream diff for reference

## Files to Modify

- `packages/cli/src/config/keyBindings.ts`
- Optional: `docs/cli/keyboard-shortcuts.md` if it exists

## Specific Verification

1. Run tests: `npm run test -- packages/cli/src/config/keyBindings.test.ts` (if exists)
2. Verify no TypeScript errors
3. Manual: Test key bindings still work in the CLI
4. Ensure LLxprt-specific commands (`TOGGLE_TODO_DIALOG`, `REFRESH_KEYPRESS`, `TOGGLE_MOUSE_EVENTS`) are preserved

## Critical Preservation Requirements

- **DO NOT change enum values** (e.g., keep `'return'` not `'basic.confirm'`)
- **DO NOT change default key bindings** for existing commands
- **PRESERVE** `TOGGLE_TODO_DIALOG`, `TOGGLE_TOOL_DESCRIPTIONS`, `REFRESH_KEYPRESS`, `TOGGLE_MOUSE_EVENTS`
- **PRESERVE** LLxprt-specific categories ("Todo Dialog", "Mouse")
- **PRESERVE** LLxprt-specific key bindings (`Ctrl+Q` for todo, `Ctrl+O` for error details, etc.)
- **PRESERVE `REFRESH_KEYPRESS`** — command name, enum value (`'refreshKeypress'`), binding (`Ctrl+Shift+R`), and its placement in the final category structure must all survive the reorganization unchanged

## Verification Step

After completing the reorganization, verify all three LLxprt-specific commands exist with their exact bindings:

```
TOGGLE_TODO_DIALOG    → 'toggleTodoDialog'   → Ctrl+Q
TOGGLE_MOUSE_EVENTS   → 'toggleMouseEvents'  → Ctrl+\
REFRESH_KEYPRESS      → 'refreshKeypress'    → Ctrl+Shift+R
```

Run a grep to confirm none were dropped:
```bash
grep -E "TOGGLE_TODO_DIALOG|TOGGLE_MOUSE_EVENTS|REFRESH_KEYPRESS" packages/cli/src/config/keyBindings.ts
```
