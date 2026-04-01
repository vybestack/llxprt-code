# REIMPLEMENT Playbook: 645e2ec — fix(cli): resolve Ctrl+Enter/Ctrl+J newline issues

## Upstream Change Summary

**Commit:** 645e2ec0411cb843468dc2eb4fe8a1a17f2191a5
**Author:** imadraude
**PR:** #17021

### Problem
- `Ctrl+J` was not being recognized properly for newline insertion
- `Alt+Enter` (escaped newline `\x1b\n`) was being interpreted as 'enter' instead of 'return with meta'

### Solution
Modified `KeypressContext.tsx` to:
1. Recognize `\n` (LF) as `Ctrl+J` by NOT handling it in the escaped branch
2. Handle `\x1b\n` (Alt+Enter) as 'return' with `meta: true` (consistent with carriage return)

### Files Changed (Upstream)
- `packages/cli/src/ui/contexts/KeypressContext.test.tsx` — Added 2 tests
- `packages/cli/src/ui/contexts/KeypressContext.tsx` — Changed 3 lines

---

## LLxprt Current State

### File: `packages/cli/src/ui/contexts/KeypressContext.tsx`

**Lines 518-525 (current LLxprt):**
```typescript
    } else if (ch === '\r') {
      // carriage return
      name = 'return';
      meta = escaped;
    } else if (escaped && ch === '\n') {
      // Alt+Enter (linefeed), should be consistent with carriage return
      name = 'return';
      meta = escaped;
```

**Analysis:** LLxprt ALREADY has the fix applied! The condition `else if (escaped && ch === '\n')` correctly handles:
- Plain `\n` → falls through to be treated as Ctrl+J (not captured by this branch)
- `\x1b\n` (Alt+Enter) → captured as 'return' with meta=true

### Test Status
Need to verify if tests exist in LLxprt for these cases.

---

## Adaptation Plan

### No Changes Required

LLxprt already contains this fix. The code matches the upstream fix exactly:

| Upstream Change | LLxprt State |
|-----------------|--------------|
| `else if (escaped && ch === '\n')` | [OK] Already present |
| Comment: "Alt+Enter (linefeed), should be consistent with carriage return" | [OK] Already present |

### Verification Steps

1. **Verify tests exist:**
   ```bash
   # Check for the Ctrl+J test
   grep -n "should recognize.*LF.*as ctrl+j" packages/cli/src/ui/contexts/KeypressContext.test.tsx
   
   # Check for the Alt+Enter test  
   grep -n "should recognize.*Alt+Enter" packages/cli/src/ui/contexts/KeypressContext.test.tsx
   ```

2. **If tests missing, add them:**
   - Test: `\n` (LF) is recognized as `ctrl: true, name: 'j'`
   - Test: `\x1b\n` is recognized as `meta: true, name: 'return'`

---

## Files to Read

| File | Purpose |
|------|---------|
| `packages/cli/src/ui/contexts/KeypressContext.tsx` | Verify fix is present |
| `packages/cli/src/ui/contexts/KeypressContext.test.tsx` | Check if tests exist |

## Files to Modify

**None** — Fix already applied in LLxprt.

---

## File Mapping: Upstream → LLxprt

| Upstream File | LLxprt Equivalent | Notes |
|---------------|-------------------|-------|
| `packages/cli/src/ui/contexts/KeypressContext.tsx` | `packages/cli/src/ui/contexts/KeypressContext.tsx` | Same path; fix already present |
| `packages/cli/src/ui/contexts/KeypressContext.test.tsx` | `packages/cli/src/ui/contexts/KeypressContext.test.tsx` | Same path; verify tests |
| `packages/cli/src/ui/components/ChatInput.tsx` (upstream only) | **Does not exist in LLxprt** | Input is handled via `packages/cli/src/ui/components/shared/text-buffer.ts` + keypress config |

### Keypress Architecture Mapping

```
Upstream: KeypressContext.tsx → ChatInput.tsx
LLxprt:   KeypressContext.tsx (same)
           + packages/cli/src/config/keyBindings.ts (or equivalent — locate dynamically)
           + packages/cli/src/ui/components/shared/text-buffer.ts
```

**Upstream `KeypressContext` ↔ LLxprt `KeypressContext` + config/keyBindings + shared/text-buffer**

---

## Specific Verification

```bash
# 1. Run existing tests
npm run test -- packages/cli/src/ui/contexts/KeypressContext.test.tsx

# 2. Confirm fix is present
grep -n "escaped && ch" packages/cli/src/ui/contexts/KeypressContext.tsx
```

### Required Verification Tests

If the following tests are absent, add them to `KeypressContext.test.tsx`:

| Input | Expected output | Assertion |
|-------|-----------------|-----------|
| `\n` (plain LF) | `ctrl: true, name: 'j'` | Recognized as Ctrl+J, NOT handled by escaped branch |
| `\x1b\n` (Alt+Enter) | `meta: true, name: 'return'` | Captured as return with meta=true |
| Ctrl+J / Command.NEWLINE | Does NOT trigger submit | Buffer inserts newline instead |
| `\x1b\n` / meta+return | Does NOT trigger submit | Buffer inserts newline instead |


---

## Notes

- **Conclusion:** Code already patched; verification required
- The fix `else if (escaped && ch === '\n')` is present in LLxprt — confirm tests cover the expected key parse outcomes
- The follow-up commit `aceb06a` may still need attention (text-buffer `Command.NEWLINE` handler)
- No source changes expected; only test verification/addition if tests are absent
