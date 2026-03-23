# Remediation Plan: B20 - Bracketed Paste Issues (READY)

## Issue 1: State Update - Required Fix

### Investigation Result (Perform before implementing)
```bash
grep -n "bracketedPasteEnabled" packages/cli/src/ui/utils/terminalCapabilityManager.ts
```

### Required Change Based on Finding

**If `enableBracketedPasteMode()` already sets state:**
Remove the duplicate state assignment from `enableSupportedModes()`.

**If state is NOT set anywhere currently:**
Add state assignment in `enableBracketedPasteMode()` as the single source of truth.

```typescript
enableBracketedPasteMode(): void {
  // ... existing implementation ...
  this.bracketedPasteEnabled = true;  // ADD THIS LINE
}

disableBracketedPasteMode(): void {
  // ... existing implementation ...
  this.bracketedPasteEnabled = false;  // ADD THIS LINE
}

isBracketedPasteEnabled(): boolean {
  return this.bracketedPasteEnabled ?? false;
}
```

## Issue 2: Remove Conditional - Required Fix

### Required Change
Remove the Kitty protocol check:

```typescript
// IN FILE: packages/cli/src/ui/contexts/KeypressContext.tsx
// REMOVE this entire conditional:
// if (!terminalCapabilityManager.isKittyProtocolEnabled()) {
//   bufferFastReturn();
// }

// REPLACE with unconditional call:
bufferFastReturn();
```

## State Lifecycle (After Fix)

| Method | State After |
|--------|-------------|
| `enableBracketedPasteMode()` | `true` |
| `disableBracketedPasteMode()` | `false` |
| `cleanup()` | `false` (calls disable) |
| `isBracketedPasteEnabled()` | returns current state |

## Tests to Add/Update

### File: terminalCapabilityManager.test.ts
```typescript
describe('bracketed paste state', () => {
  it('state is true after enableBracketedPasteMode', () => {
    const mgr = new TerminalCapabilityManager();
    mgr.enableBracketedPasteMode();
    expect(mgr.isBracketedPasteEnabled()).toBe(true);
  });

  it('state is false after disableBracketedPasteMode', () => {
    const mgr = new TerminalCapabilityManager();
    mgr.enableBracketedPasteMode();
    mgr.disableBracketedPasteMode();
    expect(mgr.isBracketedPasteEnabled()).toBe(false);
  });

  it('state remains true on repeated enable calls', () => {
    const mgr = new TerminalCapabilityManager();
    mgr.enableBracketedPasteMode();
    mgr.enableBracketedPasteMode();
    expect(mgr.isBracketedPasteEnabled()).toBe(true);
  });
});
```

### File: KeypressContext.test.tsx
```typescript
it('always calls bufferFastReturn', () => {
  const mockBuffer = jest.fn();
  jest.spyOn(fastReturnModule, 'bufferFastReturn').mockImplementation(mockBuffer);
  
  // Test with Kitty enabled
  setKittyProtocol(true);
  context.handleInput();
  expect(mockBuffer).toHaveBeenCalledTimes(1);
  
  // Test with Kitty disabled  
  setKittyProtocol(false);
  context.handleInput();
  expect(mockBuffer).toHaveBeenCalledTimes(2);
});
```

## Files to Modify

1. `packages/cli/src/ui/utils/terminalCapabilityManager.ts` - Add state management
2. `packages/cli/src/ui/contexts/KeypressContext.tsx` - Remove conditional
3. `packages/cli/src/ui/utils/terminalCapabilityManager.test.ts` - Add tests
4. `packages/cli/src/ui/contexts/KeypressContext.test.tsx` - Update tests
