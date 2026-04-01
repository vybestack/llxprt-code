# REIMPLEMENT Playbook: aceb06a — fix(cli): fix newline support broken in previous PR

## Upstream Change Summary

**Commit:** aceb06a58729f2c10b4fcc78edad86c52560134c
**Author:** Tommaso Sciortino
**PR:** #17159

### Problem
Commit 645e2ec fixed KeypressContext to properly recognize Ctrl+J, but the text-buffer wasn't handling the `NEWLINE` command. Ctrl+J would generate a key with `name: 'j', ctrl: true` but the text buffer only handled `RETURN` for newlines.

### Solution
Added a single line to `text-buffer.ts` to handle the `NEWLINE` command:
```typescript
else if (keyMatchers[Command.NEWLINE](key)) newline();
```

### Files Changed (Upstream)
- `packages/cli/src/ui/components/shared/text-buffer.test.ts` — Added test for Ctrl+J newline
- `packages/cli/src/ui/components/shared/text-buffer.ts` — Added NEWLINE handler

---

## LLxprt Current State

> **IMPORTANT — Mandatory first step:** Before prescribing any edits, locate the actual target files in LLxprt via search. File paths are assumed below based on the upstream structure, but must be verified dynamically.

### Mandatory Pre-Flight: Locate Files

```bash
# Find text-buffer implementation
find packages -name "text-buffer.ts" | grep -v node_modules

# Find text-buffer tests
find packages -name "text-buffer.test.ts" | grep -v node_modules

# Locate Command.NEWLINE and keyMatchers definitions dynamically
grep -rn "Command\.NEWLINE\|NEWLINE" packages/cli/src --include="*.ts" | grep -v node_modules
grep -rn "keyMatchers" packages/cli/src --include="*.ts" | grep -v node_modules | head -20
```

Do NOT assume `packages/cli/src/ui/components/shared/text-buffer.ts` or `packages/cli/src/keyMatchers.ts` exist at those exact paths — **verify first**.

### Dependency Verification (645e2ec Must Be Present First)

Before applying this fix, prove that 645e2ec behavior is present in LLxprt:

```bash
# Prove KeypressContext already has the 645e2ec fix
grep -n "escaped && ch === '\\n'" packages/cli/src/ui/contexts/KeypressContext.tsx
```

If that grep returns no results, **stop** — the prerequisite 645e2ec fix is missing. Apply that playbook first.

### File: text-buffer.ts (path to be confirmed via search above)

Need to search for the input handling section where `Command.RETURN` is handled. The fix should add a similar line for `Command.NEWLINE`.

**Search pattern:**
```typescript
keyMatchers[Command.RETURN](key)
```

### Expected Current Code
```typescript
if (key.name === 'paste') insert(input, { paste: true });
else if (keyMatchers[Command.RETURN](key)) newline();
else if (keyMatchers[Command.MOVE_LEFT](key)) move('left');
// ... etc
```

### Required Change
```typescript
if (key.name === 'paste') insert(input, { paste: true });
else if (keyMatchers[Command.RETURN](key)) newline();
else if (keyMatchers[Command.NEWLINE](key)) newline();  // ADD THIS LINE
else if (keyMatchers[Command.MOVE_LEFT](key)) move('left');
// ... etc
```

---

## Adaptation Plan

### Step 0: Locate All Target Files (Run First)

```bash
# Confirm actual text-buffer paths
find packages -name "text-buffer.ts" -o -name "text-buffer.test.ts" | grep -v node_modules

# Confirm Command.NEWLINE and keyMatchers location
grep -rn "NEWLINE" packages/cli/src --include="*.ts" | grep -v "node_modules\|\.d\.ts"
grep -rn "Command\." packages/cli/src/keyMatchers.ts 2>/dev/null || \
  grep -rn "enum Command" packages/cli/src --include="*.ts" | grep -v node_modules
```

Use the results of these searches as the actual file paths for all subsequent steps.

### Step 1: Prove 645e2ec Prerequisite Is Present

```bash
grep -n "escaped && ch === '\\\\n'" packages/cli/src/ui/contexts/KeypressContext.tsx
```

If this returns no match, **stop and apply 645e2ec playbook first**.

### Step 2: Locate the handleInput function

In the **actual** text-buffer file (path confirmed in Step 0), find the `handleInput` function. Look for the if/else chain that handles key commands using `keyMatchers`.

### Step 3: Verify Command.NEWLINE and keyMatchers exist

Locate `Command.NEWLINE` and `keyMatchers` definitions using the search results from Step 0 — do NOT assume `packages/cli/src/keyMatchers.ts` is the correct path. Use the dynamically-found path.

Check that `Command.NEWLINE` is defined:
```typescript
export enum Command {
  // ...
  NEWLINE = 'newline',
  // ...
}
```

If absent, add `NEWLINE` to the enum and add a corresponding key matcher for `ctrl+j` (`name: 'j', ctrl: true`).

### Step 4: Add NEWLINE handler to text-buffer

In the **actual** text-buffer file, insert the NEWLINE handler immediately after the RETURN handler:
```typescript
else if (keyMatchers[Command.NEWLINE](key)) newline();
```

### Step 5: Add Test

**File:** actual text-buffer test file (path confirmed in Step 0)

First, **find the existing `handleInput` test block** in the test file. Locate existing Enter/newline/RETURN tests. Insert the Ctrl+J test case adjacent to those existing tests (do not append at end of file — keep newline-related tests together).

```typescript
it('should handle Ctrl+J as newline', () => {
  const { result } = renderHook(() =>
    useTextBuffer({ viewport, isValidPath: () => false }),
  );
  act(() =>
    result.current.handleInput({
      name: 'j',
      ctrl: true,
      meta: false,
      shift: false,
      insertable: false,
      sequence: '\n',
    }),
  );
  expect(getBufferState(result).lines).toEqual(['', '']);
});
```

---

## Files to Read

> All paths below are **assumed** based on upstream structure. Confirm via Step 0 searches before reading.

| File (assumed path) | Purpose |
|---------------------|---------|
| `packages/cli/src/ui/components/shared/text-buffer.ts` | Find input handling section — **verify path first** |
| `packages/cli/src/keyMatchers.ts` | Verify Command.NEWLINE exists — **verify path first** |
| `packages/cli/src/ui/components/shared/text-buffer.test.ts` | Check existing newline tests — **verify path first** |

## Files to Modify

> Use dynamically-located paths from Step 0 — not the assumed paths below.

| File (assumed path) | Changes |
|---------------------|---------|
| `packages/cli/src/ui/components/shared/text-buffer.ts` | Add NEWLINE handler after RETURN handler |
| `packages/cli/src/ui/components/shared/text-buffer.test.ts` | Add Ctrl+J test adjacent to existing newline tests |
| `packages/cli/src/keyMatchers.ts` | Add NEWLINE command if missing |

---

## Specific Verification

```bash
# 1. Confirm 645e2ec prerequisite (must pass before proceeding)
grep -n "escaped && ch === '\\n'" packages/cli/src/ui/contexts/KeypressContext.tsx

# 2. Run text-buffer tests (use actual path from Step 0)
npm run test -- <actual-text-buffer-test-path>

# 3. Manual test: Ctrl+J should insert newline
# Start LLxprt, type some text, press Ctrl+J, verify newline inserted (not submitted)

# 4. Run full test suite
npm run test
```

---

## Integration Notes

- This commit **depends on 645e2ec** (KeypressContext fix) — the prerequisite verification in Step 1 is mandatory
- Verify 645e2ec is present in LLxprt before applying any changes from this playbook
- The one-line text-buffer fix is only safe once the KeypressContext correctly emits `ctrl+j` for `\n`
- Test insertion: place new Ctrl+J test adjacent to existing Enter/newline/RETURN tests — find that block first
