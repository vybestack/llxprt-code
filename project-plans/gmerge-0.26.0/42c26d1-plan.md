# REIMPLEMENT Playbook: 42c26d1 — Improve keybindings MOVE_UP/MOVE_DOWN (keybinding chain 3/4)

## Dependency Preflight

Before starting implementation, verify the prerequisite commits are present in the branch:

```bash
git merge-base --is-ancestor 09a7301 HEAD && git merge-base --is-ancestor fb76408 HEAD
```

Both commands must exit with code 0. If either fails, apply the prior commits in the keybinding
chain (09a7301: remove \x7f bindings, fb76408: remove sequence binding) before proceeding.

## Upstream Change Summary

This commit adds `MOVE_UP` and `MOVE_DOWN` commands to the keybinding system and updates text buffer handling. The changes:

1. Adds `MOVE_UP` and `MOVE_DOWN` to the `Command` enum
2. Adds default keybindings for these commands (up/down arrow with no Ctrl/Cmd)
3. Updates `text-buffer.ts` to use `keyMatchers` for up/down movement instead of direct key name checks
4. Updates `commandCategories` and `commandDescriptions` with new commands
5. Updates `KeypressContext.tsx` to set `name: 'return'` instead of empty name in `bufferFastReturn`
6. Updates tests to expect `name: 'return'`

This standardizes movement commands to use the keybinding system.

**Files changed upstream:**
- `docs/cli/keyboard-shortcuts.md`
- `packages/cli/src/config/keyBindings.ts`
- `packages/cli/src/ui/components/shared/text-buffer.ts`
- `packages/cli/src/ui/contexts/KeypressContext.test.tsx`
- `packages/cli/src/ui/contexts/KeypressContext.tsx`

## LLxprt Current State

### `packages/cli/src/config/keyBindings.ts`

LLxprt currently does NOT have `MOVE_UP` and `MOVE_DOWN` commands. Current `Command` enum does not include them.

### `packages/cli/src/ui/contexts/KeypressContext.tsx`

LLxprt's `bufferFastReturn()` function:
```typescript
function bufferFastReturn(keypressHandler: KeypressHandler): KeypressHandler {
  let lastKeyTime = 0;
  return (key: Key) => {
    const now = Date.now();
    if (key.name === 'return' && now - lastKeyTime <= FAST_RETURN_TIMEOUT) {
      keypressHandler({
        ...key,
        name: '',        // CHANGE TO 'return'
        sequence: '\r',
        insertable: true,
      });
    } else {
      keypressHandler(key);
    }
    lastKeyTime = now;
  };
}
```

### Text Buffer Handling

Need to check `packages/cli/src/ui/components/shared/text-buffer.ts` for how up/down are handled.

## Adaptation Plan

### 1. Modify `packages/cli/src/config/keyBindings.ts`

Add new commands to `Command` enum:
```typescript
export enum Command {
  // ... existing commands
  UNDO = 'undo',
  REDO = 'redo',
  MOVE_UP = 'moveUp',      // ADD
  MOVE_DOWN = 'moveDown',  // ADD
  MOVE_LEFT = 'moveLeft',
  MOVE_RIGHT = 'moveRight',
  // ... rest
}
```

Add default keybindings:
```typescript
[Command.MOVE_UP]: [{ key: 'up', ctrl: false, command: false }],
[Command.MOVE_DOWN]: [{ key: 'down', ctrl: false, command: false }],
```

Add to `commandCategories`:
```typescript
{
  title: 'Cursor Movement',
  commands: [
    Command.HOME,
    Command.END,
    Command.MOVE_UP,      // ADD
    Command.MOVE_DOWN,    // ADD
    Command.MOVE_LEFT,
    Command.MOVE_RIGHT,
    // ...
  ],
},
```

Add descriptions:
```typescript
[Command.MOVE_UP]: 'Move the cursor up one line.',
[Command.MOVE_DOWN]: 'Move the cursor down one line.',
```

### 2. Modify `packages/cli/src/ui/contexts/KeypressContext.tsx`

Update `bufferFastReturn()`:
```typescript
if (key.name === 'return' && now - lastKeyTime <= FAST_RETURN_TIMEOUT) {
  keypressHandler({
    ...key,
    name: 'return',  // Changed from ''
    sequence: '\r',
    insertable: true,
  });
}
```

### 3. Modify `packages/cli/src/ui/components/shared/text-buffer.ts`

Update the `handleInput` function to use key matchers:

```typescript
// OLD:
else if (key.name === 'up') move('up');
else if (key.name === 'down') move('down');

// NEW:
else if (keyMatchers[Command.MOVE_UP](key)) move('up');
else if (keyMatchers[Command.MOVE_DOWN](key)) move('down');
```

Also update the `return` key handling to use `Command.RETURN`:
```typescript
// OLD:
if (
  !singleLine &&
  (key.name === 'return' ||
   input === '\r' ||
   input === '\n' ||
   input === '\\r')
)
  newline();

// NEW:
if (keyMatchers[Command.RETURN](key)) newline();
```

### 4. Update Tests

Update `packages/cli/src/ui/contexts/KeypressContext.test.tsx`:
```typescript
// OLD:
expect.objectContaining({
  name: '',
  sequence: '\r',
  insertable: true,
})

// NEW:
expect.objectContaining({
  name: 'return',
  sequence: '\r',
  insertable: true,
})
```

## keyMatchers Integration Verification

After adding `Command.MOVE_UP` and `Command.MOVE_DOWN` to `keyBindings.ts`, verify they are
available through `keyMatchers` before updating `text-buffer.ts`:

- `keyMatchers` is built from the `Command` enum and default bindings in `keyBindings.ts`
- `text-buffer.ts` imports `keyMatchers` from `../../keyMatchers.js` (verify this import path)
- Confirm `keyMatchers[Command.MOVE_UP]` and `keyMatchers[Command.MOVE_DOWN]` compile correctly
  after the `keyBindings.ts` changes; run `npm run typecheck` before touching `text-buffer.ts`

## Files to Read

1. `packages/cli/src/config/keyBindings.ts`
2. `packages/cli/src/ui/contexts/KeypressContext.tsx`
3. `packages/cli/src/ui/components/shared/text-buffer.ts`
4. `packages/cli/src/ui/contexts/KeypressContext.test.tsx`
5. `docs/cli/keyboard-shortcuts.md`

## Files to Modify

1. `packages/cli/src/config/keyBindings.ts` - Add MOVE_UP/MOVE_DOWN commands and bindings
2. `packages/cli/src/ui/contexts/KeypressContext.tsx` - Fix bufferFastReturn name
3. `packages/cli/src/ui/components/shared/text-buffer.ts` - Use keyMatchers for movement
4. `packages/cli/src/ui/contexts/KeypressContext.test.tsx` - Update test expectations
5. `docs/cli/keyboard-shortcuts.md` - Add MOVE_UP/MOVE_DOWN rows to the keyboard shortcuts table

## Specific Verification

Run the full verification suite:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

Additional manual checks:
- Up arrow moves cursor up one line in multi-line input
- Down arrow moves cursor down one line in multi-line input
- Ctrl+Up/Down should NOT trigger cursor movement (used for other purposes)

## Notes

This commit is part 3 of the keybinding chain. Apply after:
- 09a7301 (remove \x7f bindings)
- fb76408 (remove sequence binding)

The changes standardize cursor movement to use the keybinding system, making it consistent with other commands.
