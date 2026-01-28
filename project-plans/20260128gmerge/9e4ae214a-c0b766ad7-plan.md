# REIMPLEMENT Plan: KeypressContext Unified ANSI Parser

**Upstream Commits:** `9e4ae214a` + `c0b766ad7`
**Subject:** Revamp KeypressContext + Simplify switch case
**Priority:** HIGH (architectural improvement, fixes ESC+mouse garbage input)

---

## Overview

Upstream refactored KeypressContext to use a unified ANSI escape sequence parser, replacing the readline/PassThrough/kitty-buffer approach. This:

1. **Fixes issue #12613** - ESC+mouse garbage input
2. **Simplifies architecture** - One parser handles all escape sequences
3. **Keeps Kitty support** - Still handles CSI-u keycodes
4. **Uses table-driven dispatch** - `KEY_INFO_MAP` instead of switch statements

**Important:** Upstream did NOT remove Kitty protocol support. They simplified how it's parsed.

---

## Architectural Changes

### What Gets REMOVED

| Component | Location | Why Removed |
|-----------|----------|-------------|
| `readline` import/usage | KeypressContext.tsx | Replaced by custom parser |
| `PassThrough` stream | KeypressContext.tsx | Replaced by direct stdin handling |
| `pasteMarkerParser` | KeypressContext.tsx | Replaced by `bufferPaste` |
| `earliestPossiblePasteMarker` | KeypressContext.tsx | Integrated into `bufferPaste` |
| `parseKittyPrefix` | KeypressContext.tsx | Replaced by unified `emitKeys` |
| `couldBeKittySequence` | KeypressContext.tsx | Replaced by timeout-based handling |
| `kittyProtocolEnabled` prop | KeypressContext.tsx | No longer needed |
| `kittyProtocol` field in Key type | types.ts | Protocol detection internal now |
| `inputBuffer`/`inputTimeout` kitty buffering | KeypressContext.tsx | Replaced by ESC_TIMEOUT |
| `isIncompleteMouseSequence` | KeypressContext.tsx | Replaced by `nonKeyboardEventFilter` |
| Kitty overflow telemetry | telemetry/ | Optional: can remove or keep |

### What Gets ADDED

| Component | Purpose |
|-----------|---------|
| `emitKeys` generator | Unified ANSI escape sequence parser |
| `createDataListener` | Factory for stdin data handler |
| `bufferPaste` | Handles bracketed paste sequences |
| `bufferBackslashEnter` | Handles backslash+enter -> shift-enter |
| `nonKeyboardEventFilter` | Filters out mouse sequences |
| `ESC_TIMEOUT` | 100ms timeout for incomplete ESC sequences |
| `PASTE_TIMEOUT` | Timeout for paste buffering |
| `BACKSLASH_ENTER_TIMEOUT` | Timeout for backslash+enter |
| `KEY_INFO_MAP` | Table-driven key name/modifier lookup |

---

## Files to Modify

### Primary Changes

1. **`packages/cli/src/ui/contexts/KeypressContext.tsx`** (MAJOR)
   - Remove readline/PassThrough imports
   - Remove kitty-specific buffering logic
   - Add unified parser functions
   - Wire `stdin.on('data', dataListener)`
   - Add timeout handling for ESC sequences

2. **`packages/cli/src/ui/types.ts`** (MINOR)
   - Remove `kittyProtocol` field from `Key` type (if exists)

3. **`packages/cli/src/ui/utils/terminalSetup.ts`** (MINOR)
   - Move any used constants here (e.g., `VSCODE_SHIFT_ENTER_SEQUENCE`)

### Test Updates

4. **`packages/cli/src/ui/contexts/KeypressContext.test.tsx`** (MAJOR)
   - Update stdin.emit calls to use strings instead of Buffers
   - Add timer handling with `vi.useFakeTimers()`
   - Remove `kittyProtocolEnabled` test branches
   - Add multibyte string tests

5. **`packages/cli/src/ui/hooks/useKeypress.test.tsx`** (MINOR)
   - Update for new Key type

6. **`packages/cli/src/ui/hooks/useFocus.test.tsx`** (MINOR)
   - Update for new Key type

7. **`packages/cli/src/test-utils/render.tsx`** (MINOR)
   - Remove `kittyProtocolEnabled` from provider wrapper

### Call Site Updates

8. **`packages/cli/src/gemini.tsx`** (or LLxprt equivalent)
   - Remove `kittyProtocolEnabled` prop from `KeypressProvider`

9. **Various test files** using `KeypressProvider`
   - Remove `kittyProtocolEnabled` prop

### Optional: Telemetry Cleanup

10. **`packages/core/src/telemetry/types.ts`**
    - Remove `KittySequenceOverflowEvent` type

11. **`packages/core/src/telemetry/loggers.ts`**
    - Remove `logKittySequenceOverflow`

12. **`packages/core/src/telemetry/clearcut-logger/clearcut-logger.ts`**
    - Remove kitty overflow logging method

---

## Files to Delete

1. **`packages/cli/src/ui/utils/platformConstants.ts`** (if no longer used after refactor)

---

## Implementation Steps

### Step 1: Study Upstream Implementation

```bash
cd tmp/gemini-cli
git show 9e4ae214a > /tmp/keypress-revamp.diff
git show c0b766ad7 > /tmp/keypress-simplify.diff
```

Key functions to understand:
- `emitKeys()` generator - the core parser
- `bufferPaste()` - handles `\x1b[200~...\x1b[201~`
- `bufferBackslashEnter()` - handles `\\\n` -> shift-enter
- `nonKeyboardEventFilter()` - filters mouse sequences
- `KEY_INFO_MAP` - table-driven key lookup

### Step 2: Backup Current Implementation

```bash
cp packages/cli/src/ui/contexts/KeypressContext.tsx packages/cli/src/ui/contexts/KeypressContext.tsx.bak
```

### Step 3: Port Unified Parser

Replace the parsing logic in KeypressContext.tsx:

1. Remove imports:
   - `readline`
   - `PassThrough`
   - Any kitty-specific helpers

2. Add new parsing infrastructure:
   - Constants: `ESC_TIMEOUT`, `PASTE_TIMEOUT`, `BACKSLASH_ENTER_TIMEOUT`
   - `KEY_INFO_MAP` lookup table
   - `emitKeys()` generator function
   - `bufferPaste()` function
   - `bufferBackslashEnter()` function  
   - `nonKeyboardEventFilter()` function
   - `createDataListener()` factory

3. Update stdin wiring:
   ```typescript
   process.stdin.setEncoding('utf8');
   const dataListener = createDataListener(
     bufferPaste(
       bufferBackslashEnter(
         nonKeyboardEventFilter(
           (key) => { /* emit to subscribers */ }
         )
       )
     )
   );
   process.stdin.on('data', dataListener);
   ```

4. Preserve LLxprt-specific behavior:
   - DebugLogger usage ("Raw StdIn" category)
   - Mac alt key remapping
   - Any LLxprt-specific key handling

### Step 4: Update Key Type

Remove `kittyProtocol` field if it exists in the Key interface.

### Step 5: Update Provider Props

Remove `kittyProtocolEnabled` prop from:
- `KeypressContextType`
- `KeypressProvider` component
- All call sites

### Step 6: Update Tests

For each test file:

1. Replace `Buffer.from()` with string data:
   ```typescript
   // Before
   stdin.emit('data', Buffer.from('\x1b[A'));
   // After
   stdin.emit('data', '\x1b[A');
   ```

2. Add fake timers for ESC handling:
   ```typescript
   vi.useFakeTimers();
   stdin.emit('data', '\x1b');
   vi.advanceTimersByTime(100); // ESC_TIMEOUT
   vi.useRealTimers();
   ```

3. Remove kittyProtocolEnabled test branches

4. Add multibyte character tests:
   ```typescript
   test('handles multibyte characters', () => {
     stdin.emit('data', 'hello');
     expect(keys).toHaveLength(5);
   });
   ```

### Step 7: Verify

```bash
# Quick verify
npm run lint
npm run typecheck

# Full verify  
npm run test
npm run build
```

### Step 8: Manual Testing

1. **ESC + mouse sequences** - Should NOT emit garbage
2. **Bracketed paste** - Should emit single paste event
3. **Backslash + enter** - Should produce shift-enter
4. **Kitty terminal** - CSI-u sequences still work
5. **Mac alt key** - Alt mappings preserved

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ESC timing regressions | Medium | High | Use fake timers in tests, manual verify |
| Paste handling changes | Low | Medium | Port upstream paste tests |
| Platform-specific issues | Medium | Medium | Test on Linux, macOS, Windows |
| Missing key mappings | Low | Low | KEY_INFO_MAP covers common keys |

---

## Estimated Effort

**1-2 days** total:
- 4-6 hours: Port parser + update KeypressContext.tsx
- 2-4 hours: Update tests
- 1-2 hours: Call site updates + telemetry cleanup
- 1-2 hours: Manual testing + edge case fixes

---

## Verification Checklist

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes (all KeypressContext tests)
- [ ] ESC key works correctly
- [ ] Arrow keys work
- [ ] Bracketed paste works
- [ ] Backslash+enter produces shift-enter
- [ ] No garbage on ESC+mouse
- [ ] Works in regular terminal
- [ ] Works in tmux
- [ ] Works in VS Code terminal
