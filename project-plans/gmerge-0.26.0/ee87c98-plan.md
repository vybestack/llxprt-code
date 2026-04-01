# REIMPLEMENT Playbook: ee87c98 — fix(patch): fast return buffer keypress flags

## Upstream Change Summary

**Commit:** ee87c98f43cf9953a7cde1de5b7a727cf6f5f36a
**Author:** gemini-cli-robot (cherry-pick)
**PR:** #17345

### Problem
The `bufferFastReturn` function in `KeypressContext.tsx` was converting rapid returns into insertable characters, but was NOT setting the `shift`, `ctrl`, and `meta` flags. This caused the return to be interpreted as a submission instead of a newline insertion.

### Solution
When buffering fast returns, explicitly set the key flags:
```typescript
keypressHandler({
  ...key,
  name: 'return',
  shift: true,  // Added: makes it a newline, not a submission
  meta: false,  // Added
  ctrl: false,  // Added
  sequence: '\r',
  insertable: true,
});
```

### Files Changed (Upstream)
- `packages/cli/src/ui/contexts/KeypressContext.test.tsx` — Added expected flags to test
- `packages/cli/src/ui/contexts/KeypressContext.tsx` — Added shift/meta/ctrl flags

---

## LLxprt Current State

### File: `packages/cli/src/ui/contexts/KeypressContext.tsx`

Confirmed pre-fix state (verified in actual source):

```typescript
function bufferFastReturn(keypressHandler: KeypressHandler): KeypressHandler {
  let lastKeyTime = 0;
  return (key: Key) => {
    const now = Date.now();
    if (key.name === 'return' && now - lastKeyTime <= FAST_RETURN_TIMEOUT) {
      keypressHandler({
        ...key,
        name: '',
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

**Analysis:** LLxprt does NOT have this fix. The flags are missing:
- No `shift: true`
- No `meta: false`
- No `ctrl: false`
- `name: ''` instead of `name: 'return'` — this differs from upstream and must be changed

### File: `packages/cli/src/ui/contexts/KeypressContext.test.tsx`

The fast return tests currently expect `name: ''` with no shift/meta/ctrl checks:

```typescript
expect(keyHandler).toHaveBeenLastCalledWith(
  expect.objectContaining({
    name: '',
    sequence: '\r',
    insertable: true,
  }),
);
```

Both the "unconditional" test and the "kitty protocol enabled" test need updating.

---

## Adaptation Plan

### Step 1: Update bufferFastReturn function

**File:** `packages/cli/src/ui/contexts/KeypressContext.tsx`

**Find:**
```typescript
function bufferFastReturn(keypressHandler: KeypressHandler): KeypressHandler {
  let lastKeyTime = 0;
  return (key: Key) => {
    const now = Date.now();
    if (key.name === 'return' && now - lastKeyTime <= FAST_RETURN_TIMEOUT) {
      keypressHandler({
        ...key,
        name: '',
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

**Replace with:**
```typescript
function bufferFastReturn(keypressHandler: KeypressHandler): KeypressHandler {
  let lastKeyTime = 0;
  return (key: Key) => {
    const now = Date.now();
    if (key.name === 'return' && now - lastKeyTime <= FAST_RETURN_TIMEOUT) {
      keypressHandler({
        ...key,
        name: 'return',
        shift: true, // to make it a newline, not a submission
        ctrl: false,
        meta: false,
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

**Key changes:**
1. `name: ''` → `name: 'return'` (matches upstream)
2. Add `shift: true` (critical: makes it a newline)
3. Add `ctrl: false` (explicit)
4. Add `meta: false` (explicit)

### Step 2: Update tests

**File:** `packages/cli/src/ui/contexts/KeypressContext.test.tsx`

Two tests in the "Fast return buffering" describe block currently check `name: ''`. Both must be updated to match the new behavior:

**Test 1** — "should always buffer return key pressed quickly after another key (unconditional)"

```typescript
expect(keyHandler).toHaveBeenLastCalledWith(
  expect.objectContaining({
    name: 'return',
    sequence: '\r',
    insertable: true,
    shift: true,
    ctrl: false,
    meta: false,
  }),
);
```

**Test 2** — "should buffer return key even when kitty protocol is enabled"

```typescript
expect(keyHandler).toHaveBeenLastCalledWith(
  expect.objectContaining({
    name: 'return',
    sequence: '\r',
    insertable: true,
    shift: true,
    ctrl: false,
    meta: false,
  }),
);
```

> Note: The test "should NOT buffer return key if delay is long enough" expects `name: 'return'` with NO shift/insertable — that test already passes correctly and does NOT need to change.

---

## Files to Read

| File | Purpose |
|------|---------|
| `packages/cli/src/ui/contexts/KeypressContext.tsx` | Find bufferFastReturn function |
| `packages/cli/src/ui/contexts/KeypressContext.test.tsx` | Find fast return test |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/cli/src/ui/contexts/KeypressContext.tsx` | Add shift/ctrl/meta flags |
| `packages/cli/src/ui/contexts/KeypressContext.test.tsx` | Update test expectations |

---

## Specific Verification

```bash
# 1. Run KeypressContext tests specifically
npm run test -- packages/cli/src/ui/contexts/KeypressContext.test.tsx

# 2. Validate newline routing via input/text-buffer tests
npm run test -- packages/cli/src/ui/hooks/useTextBuffer.test.ts

# 3. Run full test suite
npm run test
```

> The `shift: true` flag routes through `Command.NEWLINE` (not `Command.SUBMIT`) in `keyMatchers.ts`,
> which causes `useTextBuffer` to call `newline()` instead of submitting the prompt.

---

## Technical Context

### Why shift: true?

The `shift: true` flag signals to the text buffer that this return should insert a newline rather than submit the prompt. Looking at `keyMatchers.ts`:

```typescript
// RETURN: submits (no shift)
// NEWLINE: inserts newline (shift=true, like Shift+Enter)
```

The `Command.NEWLINE` matcher likely checks for `shift: true`, so setting this flag routes the fast return through the newline path.

### Related to aceb06a

This fix works with the `aceb06a` fix (NEWLINE handler in text-buffer). Together they ensure:
1. Fast return → `shift: true` set here
2. `keyMatchers[Command.NEWLINE](key)` matches (because shift=true)
3. Text buffer calls `newline()` function
