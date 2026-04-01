# Playbook: Simplify Paste Handling (94d5ae5)

**Commit:** 94d5ae541
**Risk Level:** MEDIUM
**Scope:** ~17 files — remove `paste` boolean from Key interface, use `key.name === 'paste'`
**Approach:** SCRIPTED — do not hand-edit each file

---

## Executive Summary

This commit removes the redundant `paste: boolean` property from the `Key` and `KeyBinding` interfaces. Paste detection changes from `key.paste === true` to `key.name === 'paste'`. The `paste` field already duplicates information that `key.name` can carry.

This is valid for LLxprt — our paste handling came from the same upstream codebase and uses the identical `paste: boolean` pattern. LLxprt also has two extra files that use `paste` (not present upstream): `OAuthCodeDialog.tsx` and `vim.ts`.

---

## Execution Strategy: Script-Then-Apply

### Guiding Principle

~17 files need updating, most of which are test files removing `paste: false` from mock key objects. Write a script, dry-run, review, apply.

---

## Phase 0: Manual Interface Changes (3 files)

Do these by hand first to establish the new type shape. TypeScript will then flag every consumer that needs updating.

### Step 0.1: Remove `paste` from `KeyBinding` interface

**File:** `packages/cli/src/config/keyBindings.ts`

```typescript
// REMOVE from interface:
export interface KeyBinding {
  key?: string;
  sequence?: string;
  ctrl?: boolean;
  shift?: boolean;
  command?: boolean;
  // paste?: boolean;  ← DELETE THIS LINE
}
```

Also remove from bindings:
- `paste: false` from `Command.SUBMIT` binding
- `{ key: 'return', paste: true }` entire entry from `Command.NEWLINE` binding

### Step 0.2: Remove `paste` from `Key` interface

**File:** `packages/cli/src/ui/contexts/KeypressContext.tsx`

```typescript
export interface Key {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  // paste: boolean;  ← DELETE THIS LINE
  sequence: string;
  insertable?: boolean;
}
```

### Step 0.3: Update `bufferPaste()` in same file

Change the keypressHandler call to use `name: 'paste'` instead of `paste: true`:

```typescript
// OLD:
keypressHandler({
  name: '',
  shift: false,
  meta: false,
  ctrl: false,
  paste: true,
  sequence: buffer,
  insertable: true,
});

// NEW:
keypressHandler({
  name: 'paste',
  shift: false,
  meta: false,
  ctrl: false,
  sequence: buffer,
  insertable: true,
});
```

Do the same for the OSC 52 paste handler in `emitKeys()`.

### Step 0.4: Remove `paste` check from `keyMatchers.ts`

**File:** `packages/cli/src/ui/keyMatchers.ts`

Remove the `keyBinding.paste` comparison block from `matchKeyBinding()`.

### Step 0.5: Verify TypeScript Errors

```bash
npm run typecheck 2>&1 | head -50
```

This will show every remaining file that references `paste` on a `Key` or `KeyBinding` object. These are the targets for the script.

---

## Phase 1: Build the Transform Script

Create `scripts/gmerge/94d5ae5-paste.ts`.

### Script Requirements

1. **Accept `--dry-run` (default) and `--apply` flags**
2. **Find all files** matching `packages/{cli,core}/**/*.{ts,tsx}` (excluding `node_modules`)
3. **Transform these patterns:**

#### Pattern A: Remove `paste: false` from object literals (test mocks)
```typescript
// Match key objects like:
{ name: 'a', ctrl: false, meta: false, shift: false, paste: false, sequence: 'a' }
// Remove the `paste: false,` (including trailing comma/whitespace)
```

This is the bulk of changes (~50+ occurrences across test files).

#### Pattern B: Replace `key.paste` checks with `key.name === 'paste'`
```typescript
// OLD:                          // NEW:
key.paste                    →   key.name === 'paste'
!key.paste                   →   key.name !== 'paste'
if (key.paste)               →   if (key.name === 'paste')
if (!key.paste)              →   if (key.name !== 'paste')
key.paste && key.sequence    →   key.name === 'paste' && key.sequence
```

#### Pattern C: Replace `paste: true` in object literals
```typescript
// OLD:                          // NEW:
paste: true,                 →   (remove line, ensure name: 'paste' is set)
```

#### Pattern D: Remove `paste: key.paste` pass-throughs
```typescript
// OLD:
{ ...key, paste: key.paste }    →   { ...key }
insert(input, { paste: key.paste })  →  insert(input, { paste: key.name === 'paste' })
```

#### Pattern E: `paste: key.paste || false` in vim.ts
```typescript
// OLD:
paste: key.paste || false,    →   (remove line)
```

4. **In dry-run mode**: print each transformation
5. **In apply mode**: write files
6. **Flag ambiguous cases** for manual review

### LLxprt-Only Files (NOT in upstream)

The script MUST also process these LLxprt-specific files:

- `packages/cli/src/ui/components/OAuthCodeDialog.tsx` — has `if (key.paste && key.sequence)`
- `packages/cli/src/ui/hooks/vim.ts` — has `paste: key.paste || false`

---

## Phase 2: Dry-Run, Review, Apply

### Step 2.1: Run Dry-Run

```bash
npx tsx scripts/gmerge/94d5ae5-paste.ts
```

Review output. The bulk should be Pattern A (removing `paste: false` from test mocks).

### Step 2.2: Apply

```bash
npx tsx scripts/gmerge/94d5ae5-paste.ts --apply
```

### Step 2.3: Manual Fixup

Handle edge cases:
- `text-buffer.ts`: The `insert()` function takes `{ paste?: boolean }` — this signature may need updating, and callers need `{ paste: key.name === 'paste' }` or the `insert` signature changes to not use `paste` at all
- Any complex expressions the script flagged as ambiguous

---

## Phase 3: Verification

### Step 3.1: Grep for Residuals

```bash
# paste should only appear in string literals, comments, and the 'paste' key name:
grep -rn '\.paste\b' packages/cli/src --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '// ' | grep -v "name.*paste" | grep -v "'paste'"
# Expected: 0 results (or only the insert() signature if not yet updated)

grep -rn 'paste:' packages/cli/src --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v "name.*'paste'" | grep -v '// '
# Expected: only the insert() opts parameter, PASTE_CLIPBOARD command, and bufferPaste function name
```

### Step 3.2: Full Suite

```bash
npm run typecheck && npm run test && npm run lint && npm run format && npm run build
```

### Step 3.3: Smoke Test

```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

### Step 3.4: Functional Paste Test

Manually verify in an interactive session:
1. Paste text into the input — should appear correctly
2. Paste + Enter should NOT submit (should insert newline)
3. Regular Enter should submit
4. Paste in OAuthCodeDialog should work
5. Paste in vim mode should work

---

## Migration Order

Phase 0 removes the `paste` field from interfaces early to let TypeScript flag all consumers. The script then handles the bulk of consumer/test updates. The order is:

1. **Interface removal + producer updates** (Phase 0) — Remove `paste` from `Key` and `KeyBinding` interfaces, update `bufferPaste()`/`emitKeys()` to use `name: 'paste'`, remove paste check from `keyMatchers.ts`
2. **Script handles consumers + tests** (Phases 1-2) — `text-buffer.ts`, `InputPrompt.tsx`, `SettingsDialog.tsx`, `OAuthCodeDialog.tsx`, `vim.ts`, all test files
3. **Manual fixup** — edge cases the script flags as ambiguous

---

## Files Expected to Change

### Interfaces (Phase 0 — manual):
- `packages/cli/src/config/keyBindings.ts`
- `packages/cli/src/ui/contexts/KeypressContext.tsx`
- `packages/cli/src/ui/keyMatchers.ts`

### Consumer Code (Phase 1-2 — scripted):
- `packages/cli/src/ui/components/shared/text-buffer.ts`
- `packages/cli/src/ui/components/InputPrompt.tsx`
- `packages/cli/src/ui/components/SettingsDialog.tsx`
- `packages/cli/src/ui/components/OAuthCodeDialog.tsx` *(LLxprt-only)*
- `packages/cli/src/ui/hooks/vim.ts` *(LLxprt-only)*

### Tests (Phase 1-2 — scripted):
- `packages/cli/src/config/keyBindings.test.ts`
- `packages/cli/src/ui/AppContainer.test.tsx`
- `packages/cli/src/ui/auth/ApiAuthDialog.test.tsx`
- `packages/cli/src/ui/auth/LoginWithGoogleRestartDialog.test.tsx`
- `packages/cli/src/ui/components/InputPrompt.test.tsx`
- `packages/cli/src/ui/components/MultiFolderTrustDialog.test.tsx`
- `packages/cli/src/ui/components/SessionBrowser.test.tsx`
- `packages/cli/src/ui/components/shared/TextInput.test.tsx`
- `packages/cli/src/ui/components/shared/text-buffer.test.ts`
- `packages/cli/src/ui/contexts/KeypressContext.test.tsx`
- `packages/cli/src/ui/hooks/useKeypress.test.tsx`
- `packages/cli/src/ui/hooks/vim.test.tsx` *(LLxprt-only)*

---

## Rollback

```bash
git checkout -- packages/
```

---

## Cleanup

```bash
rm scripts/gmerge/94d5ae5-paste.ts
```

---

## Notes

- This is a pure code simplification — paste functionality is unchanged
- No user-facing behavior changes
- No settings or configuration impact
- The `PASTE_CLIPBOARD` command is unrelated (it's a keybinding command name, not the paste boolean)
