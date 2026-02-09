# Reimplementation Plan: Terminal Mode Cleanup (TDD)

**Upstream SHA**: `ba88707b1`
**Upstream subject**: Fix test to not leave terminal in mouse mode (#13232)
**LLxprt scope**: Broader — fix known terminal mode issue on exit
**Review**: Revised per deepthinker feedback (TDD ordering, mode inventory, TTY guard, signal coverage, no duplicate escapes)

## Why Broader Than Upstream

Upstream only adds mouse mocks to `gemini.test.tsx`. LLxprt has a known issue where bracketed paste and focus tracking modes are left enabled after exiting. This plan fixes both the test hygiene AND the production exit cleanup.

---

## Mode Inventory (source of truth)

Modes enabled at startup via `terminalContract.ts` → `TERMINAL_CONTRACT_SEQUENCES`:

| Mode                  | Enable sequence      | Disable sequence     | Currently disabled on exit? |
|-----------------------|----------------------|----------------------|-----------------------------|
| Mouse button events   | `\x1b[?1002h`       | `\x1b[?1002l`       | [OK] via `disableMouseEvents()` in `process.on('exit')` |
| SGR extended mouse    | `\x1b[?1006h`       | `\x1b[?1006l`       | [OK] via `disableMouseEvents()` in `process.on('exit')` |
| Bracketed paste       | `\x1b[?2004h`       | `\x1b[?2004l`       | [ERROR] **MISSING** |
| Focus tracking        | `\x1b[?1004h`       | `\x1b[?1004l`       | [ERROR] **MISSING** |
| Show cursor           | `\x1b[?25h`         | n/a (already default)| [OK] already default state |

**Key findings:**
- `disableMouseEvents()` in `mouse.ts` writes `DISABLE_MOUSE_EVENTS` = `'\x1b[?1006l\x1b[?1002l'` — covers both mouse sequences. No raw `\x1b[?1000l` needed (we don't enable `?1000h`).
- Bracketed paste (`?2004h`) and focus tracking (`?1004h`) are enabled but never disabled on exit → **these are the bugs**.
- `DISABLE_BRACKETED_PASTE` and `DISABLE_FOCUS_TRACKING` already exist as named constants in `terminalSequences.ts`.

## Signal Path Analysis

Current signal handling in `gemini.tsx`:
- **`process.on('exit')`** (line 298): Synchronous, calls `disableMouseEvents()`. [OK] Fires on `process.exit()` and normal exit.
- **`SIGINT`** (line 475): Calls `stdinManager.disable()` + `runExitCleanup()` + `process.exit(130)`. The `process.exit()` triggers `'exit'` handlers. [OK]
- **`SIGTERM`** (line 470): Same pattern → `process.exit(0)` → triggers `'exit'`. [OK]

**Conclusion**: Adding the missing mode disables to the existing `process.on('exit')` handler is sufficient — it already runs on SIGINT/SIGTERM because those handlers call `process.exit()`.

## Duplicate Escape Analysis

`disableMouseEvents()` writes: `\x1b[?1006l\x1b[?1002l`

The new cleanup code must **not** re-emit these sequences. It only needs to add:
- `\x1b[?2004l` (disable bracketed paste)
- `\x1b[?1004l` (disable focus tracking)

## TTY Guard

`process.stdout.write()` of escape sequences on non-TTY (CI, piped output) is harmless but unnecessary noise. The existing code already gates `enableMouseEvents()` behind `isMouseEventsEnabled()` which requires `alternateBuffer === true` (which requires TTY). However, `terminalContract.ts` modes (bracketed paste, focus tracking) are applied unconditionally in some paths. The cleanup handler should guard with `process.stdout.isTTY` for safety.

---

## Phase 1: Test Setup — Mock mouse utilities in `gemini.test.tsx`

### Modify: `packages/cli/src/gemini.test.tsx`

Add `vi.mock` for mouse utilities at file-level scope, alongside the existing `vi.mock` blocks (after line 116, before the first `describe`):

```typescript
vi.mock('./ui/utils/mouse.js', () => ({
  enableMouseEvents: vi.fn(),
  disableMouseEvents: vi.fn(),
  parseMouseEvent: vi.fn(),
  isIncompleteMouseSequence: vi.fn(),
  isMouseEventsActive: vi.fn(() => false),
  setMouseEventsActive: vi.fn(() => false),
  ENABLE_MOUSE_EVENTS: '',
  DISABLE_MOUSE_EVENTS: '',
}));
```

**Why full mock (not partial)**: `mouse.ts` top-level code calls `process.stdout.write()` via `enableMouseEvents`/`disableMouseEvents`. A partial mock would still execute the module body. A full mock with all exported symbols prevents any real terminal writes during tests. The symbols list comes from `packages/cli/src/ui/utils/mouse.ts` exports.

**Placement**: After the `vi.mock('./utils/relaunch.js', ...)` block (line 114-116) and before the first `describe` block (line 118). This matches the existing mock grouping convention.

---

## Phase 2: Failing Tests — RED

### 2a. Add terminal cleanup test to `gemini.test.tsx`

In the existing `startInteractiveUI` describe block, add a test that asserts the `process.on('exit')` handler writes the missing disable sequences. This test will **fail** before the production fix:

```typescript
it('should register exit handler that disables bracketed paste and focus tracking', async () => {
  const exitHandlers: Array<() => void> = [];
  const processOnSpy = vi.spyOn(process, 'on').mockImplementation(
    (event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'exit') {
        exitHandlers.push(handler as () => void);
      }
      return process;
    },
  );

  const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  // Ensure isTTY is true so the guard passes
  const originalIsTTY = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', {
    value: true,
    configurable: true,
  });

  const mouseEnabledConfig = {
    ...mockConfig,
    getScreenReader: () => false,
  } as Config;
  const mouseEnabledSettings = {
    merged: {
      ui: {
        hideWindowTitle: true,
        useAlternateBuffer: true,
        enableMouseEvents: true,
      },
    },
  } as unknown as LoadedSettings;

  try {
    await startInteractiveUI(
      mouseEnabledConfig,
      mouseEnabledSettings,
      mockStartupWarnings,
      mockWorkspaceRoot,
    );

    // Fire all exit handlers
    for (const handler of exitHandlers) {
      handler();
    }

    // Verify bracketed paste disabled
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('\x1b[?2004l'),
    );
    // Verify focus tracking disabled
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('\x1b[?1004l'),
    );
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
    processOnSpy.mockRestore();
    writeSpy.mockRestore();
  }
});
```

### 2b. Add TTY guard test to `gemini.test.tsx`

```typescript
it('should not write terminal escape sequences on exit when stdout is not a TTY', async () => {
  const exitHandlers: Array<() => void> = [];
  const processOnSpy = vi.spyOn(process, 'on').mockImplementation(
    (event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'exit') {
        exitHandlers.push(handler as () => void);
      }
      return process;
    },
  );

  const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const originalIsTTY = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', {
    value: false,
    configurable: true,
  });

  const mouseEnabledConfig = {
    ...mockConfig,
    getScreenReader: () => false,
  } as Config;
  const mouseEnabledSettings = {
    merged: {
      ui: {
        hideWindowTitle: true,
        useAlternateBuffer: true,
        enableMouseEvents: true,
      },
    },
  } as unknown as LoadedSettings;

  try {
    await startInteractiveUI(
      mouseEnabledConfig,
      mouseEnabledSettings,
      mockStartupWarnings,
      mockWorkspaceRoot,
    );

    // Clear any writes from render setup
    writeSpy.mockClear();

    // Fire all exit handlers
    for (const handler of exitHandlers) {
      handler();
    }

    // When not a TTY, should not write any escape sequences
    const calls = writeSpy.mock.calls.map((c) => c[0]);
    const hasEscapeSeq = calls.some(
      (arg) => typeof arg === 'string' && arg.includes('\x1b['),
    );
    expect(hasEscapeSeq).toBe(false);
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
    processOnSpy.mockRestore();
    writeSpy.mockRestore();
  }
});
```

---

## Phase 3: Production Implementation — GREEN

### Modify: `packages/cli/src/gemini.tsx`

**Step 3a**: Add imports for the disable constants.

At the existing import from `./ui/utils/terminalContract.js` (line 98), also import from `terminalSequences.js`:

```typescript
import {
  DISABLE_BRACKETED_PASTE,
  DISABLE_FOCUS_TRACKING,
} from './ui/utils/terminalSequences.js';
```

**Step 3b**: Extend the `process.on('exit')` handler (lines 298-300) to also disable bracketed paste and focus tracking, with a TTY guard.

Replace:
```typescript
    process.on('exit', () => {
      disableMouseEvents();
    });
```

With:
```typescript
    process.on('exit', () => {
      disableMouseEvents();
      if (process.stdout.isTTY) {
        process.stdout.write(DISABLE_BRACKETED_PASTE + DISABLE_FOCUS_TRACKING);
      }
    });
```

**Why not wrap `disableMouseEvents()` in the TTY guard?** `disableMouseEvents()` is only called when `mouseEventsEnabled` is true, which requires `alternateBuffer === true`, which already implies TTY. The guard is for the _new_ sequences which are part of the terminal contract applied through a different path.

**Why named constants instead of raw escapes?** They're already defined in `terminalSequences.ts` and used throughout the codebase. Using them ensures consistency and makes the disable↔enable symmetry self-documenting.

**No changes needed to `cleanup.ts`**: The `process.on('exit')` handler fires synchronously during `process.exit()`, which is already called by both SIGINT and SIGTERM handlers. The `registerCleanup`/`runExitCleanup` system is for async cleanup (like `instance.waitUntilExit()`). Terminal escape writes are synchronous and belong in the `'exit'` handler.

---

## Phase 4: Verify

```bash
cd packages/cli && npx vitest run src/gemini.test.tsx
cd packages/cli && npx vitest run src/utils/cleanup.test.ts
npm run lint
npm run typecheck
```

Manual verification:
1. Run LLxprt with alternate buffer + mouse events enabled
2. Ctrl+C to exit
3. Verify: `cat -v` shows no bracketed paste wrapper on paste, arrow keys work, no mouse-mode artifacts
4. Run LLxprt with output piped (`llxprt --prompt "hi" | cat`) — verify no escape sequences in output

---

## Files Modified

| File | Change |
|------|--------|
| `packages/cli/src/gemini.test.tsx` | Add `vi.mock('./ui/utils/mouse.js', ...)` (Phase 1); add 2 new tests (Phase 2) |
| `packages/cli/src/gemini.tsx` | Add import of `DISABLE_BRACKETED_PASTE`, `DISABLE_FOCUS_TRACKING`; extend exit handler (Phase 3) |

## Files NOT Modified

| File | Reason |
|------|--------|
| `packages/cli/src/utils/cleanup.ts` | Signal handlers already call `process.exit()` → triggers `'exit'` event. No changes needed. |
| `packages/cli/src/ui/utils/terminalContract.ts` | Read-only reference for mode inventory. No changes needed. |
| `packages/cli/src/ui/utils/mouse.ts` | `disableMouseEvents()` already covers mouse sequences. No changes needed. |
| `packages/cli/src/ui/utils/terminalSequences.ts` | Constants already exist. No changes needed. |
