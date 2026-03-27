# Test Plan - Issue #1576

## Test-First Development

Per `dev-docs/RULES.md`: **Test behavior, not implementation.**

These tests verify **observable behavior** of the refactored AppContainer, not internal hook structure.

## Phase 0: Test Implementation (Do This First!)

### Existing Tests (Regression Guards - DO NOT MODIFY)

These tests already exist in `packages/cli/src/ui/` and **must continue passing** throughout the refactor. They test pure behavioral patterns and are completely independent of AppContainer's internal structure.

**Why they don't need changes:**
- They don't import or render AppContainer
- They test behavioral logic in isolation
- They verify patterns that must be preserved regardless of implementation

1. **`AppContainer.cancel-race.test.tsx`** - Cancel/restore prompt race condition
   - Tests the deferred restoration pattern
   - Verifies state machine behavior
   - **Status:** Keep as-is, must pass after each phase

2. **`AppContainer.oauth-dismiss.test.ts`** - OAuth dialog auto-dismiss behavior
   - Tests global flag polling logic
   - Verifies auto-dismiss conditions
   - **Status:** Keep as-is, must pass after each phase

**Verification:** Run these tests before AND after each phase to catch regressions.

### New Behavioral Tests (9 Total)

Implement these tests BEFORE extracting hooks. They verify the component still works correctly after refactoring.

---

#### Test 1: AppContainer.mount.test.tsx
```typescript
/**
 * Verifies component renders without errors
 * Behavior: AppContainer mounts and renders DefaultAppLayout
 */
describe('AppContainer', () => {
  it('should mount without errors', () => {
    // Setup: Mock all external dependencies
    // Action: render(<AppContainer {...defaultProps} />)
    // Assert: No throw, UIStateProvider and UIActionsProvider rendered
  });
});
```

---

#### Test 2: AppContainer.keybindings.test.tsx
```typescript
/**
 * Verifies keyboard shortcuts trigger correct actions
 * Behavior: Pressing keys invokes corresponding actions
 */
describe('AppContainer keybindings', () => {
  it('should quit on Ctrl+C double-press', () => {
    // Press Ctrl+C twice within window
    // Assert: handleSlashCommand called with '/quit'
  });

  it('should toggle copy mode with Ctrl+B in alternate buffer', () => {
    // Press Ctrl+B
    // Assert: copyModeEnabled toggled
  });

  it('should toggle markdown rendering with Alt+M', () => {
    // Press Alt+M
    // Assert: renderMarkdown toggled, refreshStatic called
  });
});
```

---

#### Test 3: AppContainer.exit.test.tsx
```typescript
/**
 * Verifies exit behavior and timing
 * Behavior: Double-press exit works, single press cancels
 */
describe('AppContainer exit behavior', () => {
  it('should exit on double-press within 1 second', () => {
    // Press Ctrl+C, wait 500ms, press again
    // Assert: process.exit(0) called
  });

  it('should not exit on single press', () => {
    // Press Ctrl+C once
    // Assert: No exit, shows "Press again to exit" message
  });

  it('should reset exit prompt after 1 second', () => {
    // Press Ctrl+C, wait 1100ms
    // Assert: ctrlCPressedOnce reset to false
  });
});
```

---

#### Test 4: AppContainer.oauth.test.tsx
```typescript
/**
 * Verifies OAuth dialog behavior
 * Behavior: Dialog opens when OAuth needed, closes when complete
 */
describe('AppContainer OAuth flow', () => {
  it('should open OAuth dialog when global flag set', () => {
    // Set global.__oauth_needs_code = true
    // Assert: appDispatch called with OPEN_DIALOG oauthCode
  });

  it('should close OAuth dialog when auth completes', () => {
    // Dialog open, set global.__oauth_browser_auth_complete = true
    // Assert: appDispatch called with CLOSE_DIALOG oauthCode
  });
});
```

---

#### Test 5: AppContainer.session.test.tsx
```typescript
/**
 * Verifies session initialization behavior
 * Behavior: Session starts once, history seeded if present
 */
describe('AppContainer session', () => {
  it('should trigger session start hook on mount', () => {
    // Mount with fresh config
    // Assert: triggerSessionStartHook called exactly once
  });

  it('should seed history when resumed history provided', () => {
    // Mount with resumedHistory array
    // Assert: loadHistory called with converted items
  });
});
```

---

#### Test 6: AppContainer.strictmode.test.tsx
```typescript
/**
 * Verifies StrictMode idempotency
 * Behavior: Double mount/unmount produces same final state as single
 */
describe('AppContainer StrictMode', () => {
  it('should be idempotent under double mount', () => {
    // Mount with StrictMode (triggers double mount)
    // Assert: Only one session start, no duplicate subscriptions
  });
});
```

---

#### Test 7: AppContainer.cleanup.test.tsx
```typescript
/**
 * Verifies resource cleanup on unmount
 * Behavior: All subscriptions and timers cleaned up
 */
describe('AppContainer cleanup', () => {
  it('should clean up all subscriptions on unmount', () => {
    // Mount component
    // Unmount
    // Assert: All unsubscribe functions called
  });

  it('should clear all timers on unmount', () => {
    // Mount component
    // Unmount
    // Assert: All clearInterval/clearTimeout called
  });
});
```

---

#### Test 8: AppContainer.render-budget.test.tsx
```typescript
/**
 * Verifies no excessive re-renders
 * Behavior: Callback identities stable, no render storms
 */
describe('AppContainer render budget', () => {
  it('should maintain stable callback identities', () => {
    // Mount, trigger state change
    // Assert: Callback references unchanged
  });
});
```

---

#### Test 9: AppContainer.integration.test.tsx
```typescript
/**
 * Verifies component works end-to-end after hook extraction
 * Behavior: Full user workflow still functions
 */
describe('AppContainer integration', () => {
  it('should handle complete user workflow', async () => {
    // Mount
    // Submit query
    // Cancel request
    // Open dialog
    // Close dialog
    // Assert: All actions complete without errors
  });
});
```

---

## Tests to NOT Write (Implementation Details)

Per RULES.md, do NOT write tests for:
- [ERROR] Internal hook structure or count
- [ERROR] Callback registration cardinality
- [ERROR] State machine internal transitions
- [ERROR] Builder object shapes
- [ERROR] Service swap internal timing
- [ERROR] Subscription rebinding details

These are **implementation details**, not observable behavior.

## Test Implementation Order

1. **First** (Before any extraction): Tests 1, 6, 7
   - Verify baseline mounting, StrictMode safety, cleanup

2. **Phase 1** (After keybindings extracted): Tests 2, 3
   - Verify keybinding behavior preserved

3. **Phase 2** (After OAuth extracted): Test 4
   - Verify OAuth flow works

4. **Phase 3** (After session extracted): Test 5
   - Verify session initialization

5. **Phase 4** (After all hooks): Tests 8, 9
   - Verify performance and integration

## Running Tests

```bash
# All AppContainer tests
npm test -- AppContainer

# With coverage
npm test -- AppContainer --coverage

# Watch mode
npm test -- AppContainer --watch
```

## Test Verification Checklist

Before each phase:
- [ ] All existing tests pass (cancel-race, oauth-dismiss)
- [ ] New behavioral tests pass (red → green)
- [ ] No console errors/warnings
- [ ] StrictMode tests pass
- [ ] Cleanup tests pass

## Remember (from RULES.md)

> **Test behavior, not implementation**
> 
> [OK] Public API behavior
> [OK] Input → Output transformations  
> [OK] Edge cases and error conditions
> [OK] Integration between units
> 
> [ERROR] Implementation details
> [ERROR] Private methods
> [ERROR] Internal structure
