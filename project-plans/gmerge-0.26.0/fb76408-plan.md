# REIMPLEMENT Playbook: fb76408 — Remove sequence binding (keybinding chain 2/4)

> **PREREQUISITE:** Commit 09a7301 (R3) MUST be applied first. All `\x7f` sequence bindings must already be removed before this commit can be applied. Do not attempt this commit until the `sequence: '\x7f'` entries are confirmed absent from `keyBindings.ts`.

## Upstream Change Summary

This commit removes the `sequence?: string` property from `KeyBinding` interface, making `key: string` required instead. The changes:

1. Removes `sequence?: string` from `KeyBinding` interface
2. Makes `key: string` required (was `key?: string`)
3. Removes sequence-based bindings from `OPEN_EXTERNAL_EDITOR` (the only remaining one)
4. Simplifies `matchKeyBinding()` to only check `key.name` match
5. Updates documentation generator to not handle sequence formatting
6. Updates tests to only test key-name-based bindings

This is part 2 of the keybinding chain - after part 1 removed `\x7f` sequences, this removes the last sequence binding and the interface support for it.

**Files changed upstream:**
- `packages/cli/src/config/keyBindings.test.ts`
- `packages/cli/src/config/keyBindings.ts`
- `packages/cli/src/ui/keyMatchers.test.ts`
- `packages/cli/src/ui/keyMatchers.ts`
- `scripts/generate-keybindings-doc.ts`

## LLxprt Current State

### `packages/cli/src/config/keyBindings.ts`

Current `KeyBinding` interface:
```typescript
export interface KeyBinding {
  key?: string;
  sequence?: string;  // TO REMOVE
  ctrl?: boolean;
  shift?: boolean;
  command?: boolean;
  paste?: boolean;  // Will be removed by commit 94d5ae5
}
```

Current bindings that use `sequence`:
```typescript
[Command.DELETE_WORD_BACKWARD]: [
  // ... other bindings
  { sequence: '\x7f', ctrl: true },     // Removed in 09a7301
  { sequence: '\x7f', command: true },  // Removed in 09a7301
],

[Command.DELETE_CHAR_LEFT]: [
  // ... other bindings  
  { sequence: '\x7f' },  // Removed in 09a7301
],

[Command.OPEN_EXTERNAL_EDITOR]: [
  { key: 'x', ctrl: true },
  { sequence: '\x18', ctrl: true },  // TO REMOVE in this commit
],

[Command.TOGGLE_MOUSE_EVENTS]: [
  { key: '\\', ctrl: true },
  { sequence: '\x1c' },  // REMOVE: sequence property is being removed from interface entirely; rely solely on key-based binding
],
```

**IMPORTANT**: LLxprt has `TOGGLE_MOUSE_EVENTS` which has a `{ sequence: '\x1c' }` binding. This sequence binding MUST be removed (see Adaptation Plan). The `{ key: '\', ctrl: true }` binding MUST be preserved.

### `packages/cli/src/ui/keyMatchers.ts`

Current `matchKeyBinding()` function:
```typescript
function matchKeyBinding(keyBinding: KeyBinding, key: Key): boolean {
  // Either key name or sequence must match (but not both should be defined)
  let keyMatches = false;

  if (keyBinding.key !== undefined) {
    keyMatches = keyBinding.key === key.name;
  } else if (keyBinding.sequence !== undefined) {
    keyMatches = keyBinding.sequence === key.sequence;
  } else {
    return false;
  }
  // ...
}
```

## Adaptation Plan

### 1. Modify `packages/cli/src/config/keyBindings.ts`

Remove `sequence` from `KeyBinding` interface:
```typescript
export interface KeyBinding {
  key: string;  // Now required, was optional
  // REMOVED: sequence?: string;
  ctrl?: boolean;
  shift?: boolean;
  command?: boolean;
  // paste will be removed by 94d5ae5
}
```

Remove sequence binding from `OPEN_EXTERNAL_EDITOR`:
```typescript
[Command.OPEN_EXTERNAL_EDITOR]: [
  { key: 'x', ctrl: true },
  // REMOVED: { sequence: '\x18', ctrl: true },
],
```

**TOGGLE_MOUSE_EVENTS decision (concrete):** Remove the `{ sequence: '\x1c' }` binding from `TOGGLE_MOUSE_EVENTS` and rely solely on `{ key: '\\', ctrl: true }`. This is necessary because the `sequence` property is being removed from the `KeyBinding` interface entirely — no sequence bindings can remain after this commit.

### 2. Modify `packages/cli/src/ui/keyMatchers.ts`

Simplify `matchKeyBinding()`:
```typescript
function matchKeyBinding(keyBinding: KeyBinding, key: Key): boolean {
  // OLD: Complex key/sequence matching logic
  // NEW: Simple key name match
  if (keyBinding.key !== key.name) {
    return false;
  }
  // ... rest of modifier checks
}
```

### 3. Modify `packages/cli/src/config/keyBindings.test.ts`

Update test to check for required `key` property:
```typescript
it('should have valid key binding structures', () => {
  for (const [_, bindings] of Object.entries(defaultKeyBindings)) {
    for (const binding of bindings) {
      // OLD: Check for key or sequence
      // NEW: Key is required
      expect(typeof binding.key).toBe('string');
      expect(binding.key.length).toBeGreaterThan(0);
      
      // Remove paste check (handled by 94d5ae5)
    }
  }
});
```

### 4. Modify `packages/cli/src/ui/keyMatchers.test.ts`

Remove sequence-based tests from `OPEN_EXTERNAL_EDITOR`:
```typescript
{
  command: Command.OPEN_EXTERNAL_EDITOR,
  positive: [
    createKey('x', { ctrl: true }),
    // REMOVED: { ...createKey('\x18'), sequence: '\x18', ctrl: true },
  ],
  negative: [createKey('x'), createKey('c', { ctrl: true })],
},
```

### 5. Documentation Generator (if exists)

If LLxprt has `scripts/generate-keybindings-doc.ts`:
- Remove the `formatSequence()` function entirely
- Remove all `binding.sequence` branches from the doc generator (any `if (binding.sequence)` or similar checks)
- Simplify to only format key names via `binding.key`

## Files to Read

1. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/keyBindings.ts`
2. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/keyMatchers.ts`
3. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/keyBindings.test.ts`
4. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/keyMatchers.test.ts`
5. Check for `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/scripts/generate-keybindings-doc.ts`

## Files to Modify

1. `packages/cli/src/config/keyBindings.ts` - Remove sequence from interface and bindings
2. `packages/cli/src/ui/keyMatchers.ts` - Simplify matchKeyBinding()
3. `packages/cli/src/config/keyBindings.test.ts` - Update validation tests
4. `packages/cli/src/ui/keyMatchers.test.ts` - Remove sequence-based tests
5. `scripts/generate-keybindings-doc.ts` - Remove sequence handling (if exists)

## Specific Verification

1. TypeScript compilation: `npm run typecheck`
2. All tests pass: `npm run test`
3. Run focused binding tests: `npm run test -- --testPathPattern=keyBindings`
4. Run focused matcher tests: `npm run test -- --testPathPattern=keyMatchers`
5. If doc generation script exists, run it and verify output contains no sequence references
6. Key bindings work correctly:
   - Ctrl+X opens external editor
   - Ctrl+\ toggles mouse events (TOGGLE_MOUSE_EVENTS key binding preserved)
   - All other keybindings still function

## Notes

This commit depends on commit 09a7301 which removes the `\x7f` sequences. Apply 09a7301 first.

**LLxprt-preservation requirement**: MUST preserve the following LLxprt-specific commands and their key-based bindings (not sequence-based):
- `TOGGLE_TODO_DIALOG` — preserve key binding as-is
- `TOGGLE_MOUSE_EVENTS` — preserve `{ key: '\\', ctrl: true }` binding; remove only the `{ sequence: '\x1c' }` entry
- `REFRESH_KEYPRESS` — preserve key binding as-is
