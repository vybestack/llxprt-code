# REIMPLEMENT Playbook: e1fd5be — Add Esc-Esc to clear prompt when not empty

## Upstream Change Summary

**Commit:** e1fd5be429a2a2e8b416c77d346e9deef6456f06
**Author:** Adib234
**PR:** #17131

### Problem
Previously, double-ESC behavior was inconsistent when the user had text in the prompt - they likely wanted to clear the input.

### Solution
Modified behavior of Esc:
1. Esc on non-empty buffer → show hint ("Press Esc again to clear prompt.")
2. Esc twice quickly on non-empty buffer → clear the buffer
3. Esc on empty buffer → no-op

### Files Changed (Upstream)
- `docs/cli/keyboard-shortcuts.md` — Updated docs
- `packages/cli/src/ui/components/Composer.test.tsx` — Updated buffer mock structure
- `packages/cli/src/ui/components/InputPrompt.test.tsx` — Added tests for new behavior
- `packages/cli/src/ui/components/InputPrompt.tsx` — Main logic change
- `packages/cli/src/ui/components/StatusDisplay.test.tsx` — Updated for escape prompt behavior
- `packages/cli/src/ui/components/StatusDisplay.tsx` — Updated escape prompt text
- `packages/cli/src/ui/components/__snapshots__/StatusDisplay.test.tsx.snap` — Snapshot updates

**Note:** In LLxprt, `ChatInput.tsx` does not exist. The actual input component is `InputPrompt.tsx`. `StatusDisplay` is a simple hook/context coordinator — it does NOT own the escape prompt UI.

---

## LLxprt Current State

### File: `packages/cli/src/ui/components/InputPrompt.tsx`

Looking at the current LLxprt code, the escape handling already has the desired behavior:

```typescript
if (escPressCount.current === 0) {
  if (buffer.text === '') {
    return;
  }
  escPressCount.current = 1;
  setShowEscapePrompt(true);
  // ...
} else {
  // clear input and immediately reset state
  buffer.setText('');
  resetCompletionState();
  resetEscapeState();
}
```

**Analysis:** LLxprt already implements the correct behavior:
- Esc on non-empty buffer → show hint (escPressCount becomes 1, showEscapePrompt = true)
- Esc twice → clear buffer
- Esc on empty buffer → early return (no-op)

No changes needed to `InputPrompt.tsx` for the core escape logic. The `showEscapePrompt` state is propagated up via `onEscapePromptChange` and rendered in `DefaultAppLayout.tsx`.

---

## Adaptation Plan

### Step 1: Verify InputPrompt behavior (read-only)

The current LLxprt code in `InputPrompt.tsx` already implements the correct behavior — no changes required to this file.

Confirm:
- `escPressCount` ref tracks how many times Esc has been pressed
- `showEscapePrompt` state triggers the hint display
- Empty buffer → early return (no-op)
- Second Esc → clears buffer via `buffer.setText('')`

The `showEscapePrompt` state is propagated up to `AppContainer.tsx` via `onEscapePromptChange`, then passed to `DefaultAppLayout.tsx` for rendering.

### Step 2: Verify escape hint text in DefaultAppLayout.tsx

**File:** `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`

`showEscapePrompt` is rendered in `DefaultAppLayout.tsx` (lines ~474 and ~646). Verify the displayed text reads:

```
Press Esc again to clear prompt.
```

**Do NOT modify `StatusDisplay.tsx`** — it is a simple hook/context coordinator and is not responsible for the escape prompt UI.

### Step 3: Update documentation

**File:** `docs/cli/keyboard-shortcuts.md`

Update the ESC-ESC documentation to reflect LLxprt behavior:
```markdown
- `Esc` pressed twice quickly clears the input prompt when it has text.
```

---

## Files to Read

| File | Purpose |
|------|---------|
| `packages/cli/src/ui/components/InputPrompt.tsx` | Verify current escape handling (read-only) |
| `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` | Check escape prompt hint text |
| `packages/cli/src/ui/AppContainer.tsx` | Check showEscapePrompt state wiring |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` | Verify/update escape hint text if needed |
| `packages/cli/src/ui/components/InputPrompt.test.tsx` | Verify/add tests for empty-buffer no-op |
| `docs/cli/keyboard-shortcuts.md` | Update documentation |

---

## Specific Verification

```bash
# 1. Run InputPrompt tests
npm run test -- packages/cli/src/ui/components/InputPrompt.test.tsx

# 2. Run DefaultAppLayout tests
npm run test -- packages/cli/src/ui/layouts/DefaultAppLayout.test.tsx

# 3. Manual test:
# - Start LLxprt
# - Type some text
# - Press ESC once: verify hint appears ("Press Esc again to clear prompt.")
# - Press ESC again: verify text is cleared
# - Press ESC on empty prompt: verify no-op (nothing happens)
```

---

## LLxprt-Specific Notes

**NO REWIND FEATURE:** LLxprt does not have a `/rewind` command or history rewind functionality.

- Do NOT reference `/rewind`, "browse previous interactions", or history-based fallback behavior anywhere in the implementation
- Do NOT touch `StatusDisplay.tsx` — it is not the right component for escape prompt UI
- The escape hint is rendered in `DefaultAppLayout.tsx` using `showEscapePrompt` from `AppContainer.tsx`

### Behavior for LLxprt:
| State | Esc Action |
|-------|-----------|
| Buffer has text, first Esc | Show hint: "Press Esc again to clear prompt." |
| Buffer has text, second Esc | Clear buffer |
| Buffer empty | No-op (early return) |
