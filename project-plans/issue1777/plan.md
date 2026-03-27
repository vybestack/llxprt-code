# Issue #1777: Stabilize oauth_add_item Bridge + Cross-Process Refresh Safety

## Problem Statement

Three related problems in the OAuth lifecycle:

1. **Bridge lifecycle instability (original #1777)**: The `global.__oauth_add_item` bridge is wired during React `useEffect` and deleted during cleanup. OAuth events that fire before mount or after cleanup are silently dropped, causing users to miss auth URLs.

2. **Provider-side event emission gap**: OAuth providers (anthropic, qwen, codex, gemini) call `globalOAuthUI.getAddItem()` and invoke the raw callback directly, bypassing any buffering. When the callback is undefined (UI not mounted), events are silently dropped.

3. **Cross-process refresh token replay (#1781)**: The TOCTOU guard in `ProactiveRenewalManager.hasTokenBeenRefreshedExternally()` only compares `access_token` strings. When two llxprt-code instances share the same unbucketed profile with a single-use refresh token, the second process can read the same token from disk before the first process saves its refreshed token. After lock acquisition, the second process re-reads from disk — if the first process has saved by then, the access_token check catches it. But the refresh_token provides an additional safety layer for edge cases where access_token comparison alone is insufficient (e.g., provider re-issues same access_token, or short-lived tokens where expiry-based checks are unreliable).

## Scope

This plan covers:
- **Phase 1-3**: GlobalOAuthUI buffering + stable bridge + provider migration (issue #1777)
- **Phase 4-5**: Cross-process refresh safety via refresh_token comparison (partial #1781)

Out of scope (separate issues):
- Mid-turn auth timeout and relogin (#1782)
- Comprehensive bucket failover test coverage (#1783)

## Design Principles

- **Additive only**: Existing OAuth flows must continue to work identically
- **No mock theater**: Tests use real implementations with controlled test doubles
- **DRY**: Reuse existing lock infrastructure, don't add new locking mechanisms
- **Single responsibility**: Each change has a clear, testable behavior
- **Fail-safe**: Buffer has bounded size; callback failures during flush are isolated

---

## Architecture

### Phase 1-3: GlobalOAuthUI Buffering + Provider Migration

**Current state — two producer paths, both drop events:**
```
Path A (core package):
  oauth2.ts → global.__oauth_add_item → (undefined if UI unmounted → event lost)

Path B (CLI providers):
  provider → this.addItem || globalOAuthUI.getAddItem() → (undefined → event lost)
```

**Target state — unified path through callAddItem with buffering:**
```
Path A (core package):
  oauth2.ts → global.__oauth_add_item → globalOAuthUI.callAddItem(...)
                                          ├── handler attached? → call directly
                                          └── no handler? → buffer event (capped at MAX_PENDING)

Path B (CLI providers):
  provider → globalOAuthUI.callAddItem(...)
              ├── handler attached? → call directly
              └── no handler? → buffer event (capped at MAX_PENDING)

React lifecycle:
  useEffect mount → globalOAuthUI.setAddItem(addItem) → flush buffered events
  useEffect cleanup → globalOAuthUI.clearAddItem() (bridge stays, events buffer again)
```

**Key design decisions:**
- Buffer is an array of `{itemData, baseTimestamp}` tuples, capped at `MAX_PENDING_ITEMS` (32)
- When cap is exceeded, oldest items are dropped with a debug log
- Buffer is flushed FIFO when a handler attaches
- During flush, each delivery is wrapped in try/catch — one failed delivery does not block others
- `clearAddItem()` does NOT clear the buffer — events persist for the next handler
- The global bridge function is registered once at module load and never deleted
- `getPendingCount()` and `clearPendingItems()` for test observability/cleanup
- Providers are migrated from `getAddItem()` + manual call to `callAddItem()` for consistent buffering
- `setAddItem()` assigns callback FIRST, then flushes pending (so handler is in place for new concurrent events during flush, and if flush throws, handler is still installed)

### Phase 4-5: Cross-Process Refresh Safety

**Current state (ProactiveRenewalManager):**
```
scheduleProactiveRenewal → stores access_token in proactiveRenewalTokens
runProactiveRenewal → acquireRefreshLock
                    → re-read token from disk
                    → hasTokenBeenRefreshedExternally: compares access_token only
                    → if same access_token: call provider.refreshToken(currentToken)
```

**Fix:**
1. Store `refresh_token` alongside `access_token` in `proactiveRenewalTokens`
2. After acquiring lock and re-reading from disk, compare BOTH access_token AND refresh_token
3. If refresh_token changed, another process already consumed it → skip refresh, reschedule
4. In `executeTokenRefresh` (reactive path in token-refresh-helper.ts), add the same refresh_token comparison — when refresh_token on disk differs from the original token, the old refresh_token has been consumed and should not be replayed

**Key insight:** The file lock already prevents truly concurrent refreshes. The refresh_token comparison adds defense-in-depth for the window between scheduling and lock acquisition — ensuring we never attempt to use a refresh_token that was consumed since we last read it.

**Behavior on refresh_token mismatch in reactive path:** When `executeTokenRefresh` detects a refresh_token mismatch after lock acquisition, it returns the disk token (if still valid) or null (if expired). When null, `getToken()` proceeds through its existing disk-check and auth-flow fallback paths. Note: `performDiskCheckUnderLock` may attempt one additional (doomed) refresh using the consumed refresh_token on disk — this fails harmlessly at the provider level (HTTP 400 from OAuth server), after which the normal re-auth flow proceeds. This is an accepted trade-off to avoid adding refresh_token tracking to the disk-check path.

**Reentrant events during flush:** When `setAddItem` flushes buffered items, the handler is already assigned. If a handler synchronously calls `callAddItem` during its flush-item processing (e.g., an auth handler that triggers another OAuth event), the reentrant event is delivered immediately (via the active handler), interleaved with the remaining flush queue. This is standard synchronous event system behavior and is documented/tested explicitly (Test 1.10).

**Flush semantics are snapshot-based:** `setAddItem` takes a snapshot of pending items via `splice(0)` before iterating. If `setAddItem` is called again during flush (e.g., rapid hook teardown/re-mount), the second call sees an empty pending array (already spliced) and installs the new callback. Remaining items in the first flush's local array continue delivery to the first callback (per the snapshot). New events arriving during the second call's setup are handled by the new callback. This is deterministic single-threaded behavior with no ambiguity.

---

## Execution Guide

### Phase Execution Order

```
Phase 1:  GlobalOAuthUI buffering tests (RED)             → typescriptexpert
Phase 1R: Review                                           → deepthinker
Phase 2:  GlobalOAuthUI buffering implementation (GREEN)   → typescriptexpert
Phase 2R: Review                                           → deepthinker
Phase 3:  Hook cleanup + provider migration (GREEN)        → typescriptexpert
Phase 3R: Review                                           → deepthinker
Phase 4:  Cross-process refresh safety tests (RED)         → typescriptexpert
Phase 4R: Review                                           → deepthinker
Phase 5:  Cross-process refresh safety implementation      → typescriptexpert
Phase 5R: Review                                           → deepthinker
Phase 6:  Integration tests + final verification           → typescriptexpert
Phase 6R: Final review                                     → deepthinker
```

**Verification suite (run after each GREEN phase):**
```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

---

## Phase 1: GlobalOAuthUI Buffering Tests (RED)

### File: `packages/cli/src/auth/__tests__/global-oauth-ui.test.ts` (NEW)

Create behavioral tests for the new buffering capability.

**Test 1.1: Items are buffered when no handler is attached**
```
@scenario BR-02 from issue #1783
@given GlobalOAuthUI with no handler attached
@when callAddItem is invoked with item data
@then getPendingCount() returns 1
@and callAddItem returns undefined (no handler to return an id)
```

**Test 1.2: Buffered items are flushed in FIFO order when handler attaches**
```
@scenario BR-03
@given GlobalOAuthUI with no handler, 3 items buffered via callAddItem
@when setAddItem is called with a handler
@then handler is called 3 times in order with the original item data and timestamps
@and getPendingCount() returns 0
```

**Test 1.3: Items go directly to handler when one is attached (no buffering)**
```
@scenario BR-05
@given GlobalOAuthUI with a handler attached via setAddItem
@when callAddItem is invoked
@then handler is called immediately with the item data
@and getPendingCount() returns 0
```

**Test 1.4: clearAddItem does NOT clear the buffer**
```
@scenario BR-04
@given GlobalOAuthUI with no handler, 2 items buffered
@when clearAddItem is called
@then getPendingCount() still returns 2
@when setAddItem is called with a new handler
@then both buffered items are delivered to the new handler
```

**Test 1.5: clearPendingItems empties the buffer**
```
@given GlobalOAuthUI with 3 buffered items
@when clearPendingItems is called
@then getPendingCount() returns 0
```

**Test 1.6: Stable global bridge is registered at module load and buffers**
```
@scenario BR-01
@given global-oauth-ui.ts is imported
@and no handler is set
@when global.__oauth_add_item is called with item data
@then global.__oauth_add_item is a function (not undefined)
@and getPendingCount() returns 1 (event was buffered through the bridge)
```

**Test 1.7: Multiple rapid events during unmounted state are all delivered in order**
```
@given GlobalOAuthUI with no handler
@when 10 items are buffered rapidly with sequential baseTimestamps
@and setAddItem is called
@then all 10 items are delivered in the exact order they were buffered
```

**Test 1.8: Buffer is capped at MAX_PENDING_ITEMS with correct drop-oldest**
```
@given GlobalOAuthUI with no handler
@when MAX_PENDING_ITEMS + 5 items are buffered, each with a unique sequential timestamp
@then getPendingCount() returns MAX_PENDING_ITEMS
@when handler attaches
@then handler receives MAX_PENDING_ITEMS items
@and the first item delivered has timestamp 6 (items 1-5 were dropped)
@and the last item delivered has timestamp MAX_PENDING_ITEMS + 5
```

**Test 1.9: Handler throwing during flush does not prevent other items from being delivered**
```
@given GlobalOAuthUI with 3 buffered items
@when setAddItem is called with a handler that throws on the 2nd call
@then items 1 and 3 are still delivered to the handler
@and getPendingCount() returns 0 after flush completes
```

**Test 1.10: Handler is installed before flush (concurrent events during flush go directly)**
```
@given GlobalOAuthUI with 2 buffered items
@when setAddItem is called with a handler
@then during flush, if callAddItem is called, it goes directly to handler (not buffered)
```

---

## Phase 2: GlobalOAuthUI Buffering Implementation (GREEN)

### File: `packages/cli/src/auth/global-oauth-ui.ts`

**Changes:**

1. Add constants and buffer:
```typescript
export const MAX_PENDING_ITEMS = 32;

// Inside class:
private pendingItems: Array<{
  itemData: Omit<HistoryItemWithoutId, 'id'>;
  baseTimestamp?: number;
}> = [];
```

2. Modify `callAddItem` to buffer when no handler, with cap:
```typescript
callAddItem(itemData, baseTimestamp): number | undefined {
  if (this.addItemCallback) {
    return this.addItemCallback(itemData, baseTimestamp);
  }
  if (this.pendingItems.length >= MAX_PENDING_ITEMS) {
    this.pendingItems.shift();
    logger.debug(() => `[OAUTH] Pending buffer full (${MAX_PENDING_ITEMS}), dropped oldest item`);
  }
  this.pendingItems.push({ itemData, baseTimestamp });
  return undefined;
}
```

3. Modify `setAddItem` — assign callback first, then flush:
```typescript
setAddItem(callback): void {
  this.addItemCallback = callback;
  const pending = this.pendingItems.splice(0);
  for (const item of pending) {
    try {
      callback(item.itemData, item.baseTimestamp);
    } catch (error) {
      logger.debug(
        () => `[OAUTH] Failed to deliver buffered item: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
```

4. Add test observability methods:
```typescript
getPendingCount(): number { return this.pendingItems.length; }
clearPendingItems(): void { this.pendingItems.length = 0; }
```

5. Register stable global bridge at module level (after singleton creation):
```typescript
export const globalOAuthUI = new GlobalOAuthUI();

(global as Record<string, unknown>).__oauth_add_item = (
  itemData: Omit<HistoryItemWithoutId, 'id'>,
  baseTimestamp?: number,
): number | undefined => globalOAuthUI.callAddItem(itemData, baseTimestamp);
```

---

## Phase 3: Hook Cleanup + Provider Migration (GREEN)

### 3A: useUpdateAndOAuthBridges cleanup fix

**File:** `packages/cli/src/ui/containers/AppContainer/hooks/useUpdateAndOAuthBridges.ts`

Remove the entire second `useEffect` that manages `global.__oauth_add_item`. The module-level bridge in `global-oauth-ui.ts` now handles this permanently. Only `globalOAuthUI.setAddItem(addItem)` and `globalOAuthUI.clearAddItem()` need to be wired, and these should be merged into the first `useEffect`.

**Remove this entire useEffect:**
```typescript
useEffect(() => {
  (global as Record<string, unknown>).__oauth_add_item = addItem;
  globalOAuthUI.setAddItem(addItem);

  return () => {
    delete (global as Record<string, unknown>).__oauth_add_item;
    globalOAuthUI.clearAddItem();
  };
}, [addItem]);
```

**Add to the first useEffect (setup phase):**
```typescript
globalOAuthUI.setAddItem(addItem);
```

**Add to the first useEffect (cleanup phase):**
```typescript
globalOAuthUI.clearAddItem();
```

This ensures: (1) The stable module-level bridge is never overwritten by the hook, (2) `setAddItem`/`clearAddItem` toggle the handler for buffered-vs-direct delivery, (3) Only one useEffect manages the OAuth bridge lifecycle.

### 3B: Provider migration to callAddItem

Migrate all 4 provider classes from the `getAddItem()` + manual invocation pattern to `callAddItem()`.

**Files to modify:**
- `packages/cli/src/auth/anthropic-oauth-provider.ts` (1 occurrence)
- `packages/cli/src/auth/qwen-oauth-provider.ts` (2 occurrences)
- `packages/cli/src/auth/codex-oauth-provider.ts` (2 occurrences)
- `packages/cli/src/auth/gemini-oauth-provider.ts` (3 occurrences)

**Two migration patterns depending on whether the method returns `addItem` for later reuse:**

#### Pattern A: Fire-and-forget sites (most occurrences)

Before:
```typescript
const addItem = this.addItem || globalOAuthUI.getAddItem();
if (addItem) {
  addItem(historyItem, baseTimestamp);
}
```

After:
```typescript
const addItem = this.addItem;
if (addItem) {
  addItem(historyItem, baseTimestamp);
} else {
  globalOAuthUI.callAddItem(historyItem, baseTimestamp);
}
```

Applies to: anthropic (1 site), gemini (3 sites), qwen logout (1 site), codex `displayAuthUrlAndOpenBrowser` (1 site).

#### Pattern B: Methods that return `addItem` for downstream use

Two methods return the captured `addItem` reference for use in subsequent messages (e.g., "Waiting for authorization...", "Authentication successful!"):
- `QwenOAuthProvider.displayQwenAuthUrl()` — returns `addItem ?? undefined`
- `CodexOAuthProvider.displayDeviceCodeToUser()` — returns `addItem ?? undefined`

These need a wrapper that routes through `callAddItem` when `this.addItem` is undefined:

Before:
```typescript
const addItem = this.addItem || globalOAuthUI.getAddItem();
if (addItem) {
  addItem(historyItem);
}
// ... other work ...
return addItem ?? undefined;
```

After:
```typescript
const addItem = this.addItem;
if (addItem) {
  addItem(historyItem);
} else {
  globalOAuthUI.callAddItem(historyItem);
}
// ... other work ...
// Return a stable callable for downstream use
const emitter = addItem ?? ((item: Omit<HistoryItemWithoutId, 'id'>, ts?: number) =>
  globalOAuthUI.callAddItem(item, ts));
return emitter;
```

This ensures downstream callers (e.g., `initiateAuth`, `performDeviceAuth`) always have a valid function to call, and events are routed through the buffering singleton when `this.addItem` is not set.

Note: The return type of the wrapper is `number | undefined` — callers of `displayQwenAuthUrl()` and `displayDeviceCodeToUser()` use the returned function to emit subsequent messages but do not rely on the returned numeric ID. If a call site does check the return, `undefined` correctly indicates the event was buffered rather than rendered. The existing return type annotation on these methods already allows `undefined`.

### 3D: Deprecate `getAddItem()`

After migration, mark `getAddItem()` as `@deprecated` in `GlobalOAuthUI` to prevent future non-buffered usage:
```typescript
/** @deprecated Use callAddItem() instead for consistent buffering */
getAddItem(): ... { ... }
```

This preserves backward compatibility but signals to future developers to use the buffered path.

### 3E: Regression search

Search for and update any tests asserting `global.__oauth_add_item` is `undefined` after cleanup:
```bash
grep -rn '__oauth_add_item' packages/
```

Update assertions to expect a function (the stable bridge) instead of undefined.

---

## Phase 4: Cross-Process Refresh Safety Tests (RED)

### File: `packages/cli/src/auth/__tests__/proactive-renewal-cross-process.spec.ts` (NEW)

**Test 4.1: Refresh skipped when refresh_token differs from scheduled**
```
@given ProactiveRenewalManager scheduled renewal for token T1 (access_token=A, refresh_token=R1)
@and Another process refreshed, disk now has T2 (access_token=B, refresh_token=R2)
@when runProactiveRenewal fires and re-reads T2 from disk
@then provider.refreshToken is NOT called
@and the new token T2 is used to reschedule proactive renewal
```

**Test 4.2: Refresh proceeds when both access_token and refresh_token match scheduled**
```
@given ProactiveRenewalManager scheduled renewal for token T1 (access_token=A, refresh_token=R1)
@and Disk still has T1 (no other process refreshed)
@when runProactiveRenewal fires and re-reads T1
@then provider.refreshToken IS called with T1
@and refreshed token is saved to disk
```

**Test 4.3: Refresh skipped when only refresh_token changed (access_token same)**
```
@given ProactiveRenewalManager scheduled renewal for token T1 (access_token=A, refresh_token=R1)
@and Disk has token with access_token=A but refresh_token=R2 (partial refresh by another process)
@when runProactiveRenewal fires and re-reads
@then provider.refreshToken is NOT called (refresh_token consumed)
```

### File: `packages/cli/src/auth/__tests__/token-access-coordinator.spec.ts` (UPDATE)

**Test 4.4: Reactive refresh path skips when refresh_token changed**
```
@given TokenAccessCoordinator with expired token T1 (refresh_token=R1)
@and While waiting for lock, another process refreshes → disk has T2 (refresh_token=R2)
@when executeTokenRefresh re-reads from disk after lock
@then refresh_token R2 ≠ R1 detected
@and provider.refreshToken is NOT called
@and T2 is returned (or null if T2 is also expired, leading to normal auth fallback)
```

**Test 4.5: Reactive refresh proceeds when refresh_token unchanged**
```
@given TokenAccessCoordinator with expired token T1 (refresh_token=R1)
@and Disk still has T1 after lock acquisition
@when executeTokenRefresh re-reads from disk
@then provider.refreshToken IS called
@and refreshed token is returned
```

**Test 4.6: Reactive path handles token with no refresh_token gracefully**
```
@given Token with no refresh_token (empty string or undefined)
@when executeTokenRefresh runs
@then existing behavior is preserved (no crash, refresh still attempted with what's available)
```

---

## Phase 5: Cross-Process Refresh Safety Implementation (GREEN)

### File: `packages/cli/src/auth/proactive-renewal-manager.ts`

**Changes:**

1. Change `proactiveRenewalTokens` type:
```typescript
private proactiveRenewalTokens: Map<string, { accessToken: string; refreshToken: string }> = new Map();
```

2. Update `scheduleProactiveRenewal` to store both:
```typescript
this.proactiveRenewalTokens.set(key, {
  accessToken: token.access_token,
  refreshToken: token.refresh_token ?? '',
});
```

3. Update `hasTokenBeenRefreshedExternally` to compare both:
```typescript
private hasTokenBeenRefreshedExternally(key: string, currentToken: OAuthToken): boolean {
  const scheduled = this.proactiveRenewalTokens.get(key);
  if (scheduled) {
    return (
      currentToken.access_token !== scheduled.accessToken ||
      (currentToken.refresh_token ?? '') !== scheduled.refreshToken
    );
  }
  const nowInSeconds = Math.floor(Date.now() / 1000);
  return currentToken.expiry > nowInSeconds + 30;
}
```

### File: `packages/cli/src/auth/token-refresh-helper.ts`

**Changes to `executeTokenRefresh`:**

After the TOCTOU expiry check, add refresh_token comparison:

```typescript
// Existing TOCTOU check (expiry-based):
if (recheckToken && recheckToken.expiry > thirtySecondsFromNow) {
  // ... return recheckToken (already refreshed by another process)
}

// NEW: Defense-in-depth — check if refresh_token was consumed
if (recheckToken && token.refresh_token &&
    recheckToken.refresh_token !== token.refresh_token) {
  logger.debug(
    () => `[FLOW] Refresh token changed for ${providerName} — another process refreshed, skipping`,
  );
  if (recheckToken.expiry > thirtySecondsFromNow) {
    proactiveRenewalManager.scheduleProactiveRenewal(
      providerName, bucketToUse, recheckToken,
    );
    return recheckToken;
  }
  // Disk token is still expired but refresh_token changed — return null
  // to let caller fall through to normal auth/disk-check paths
  return null;
}
```

Note: This requires `executeTokenRefresh` to accept `proactiveRenewalManager` (it already does).

---

## Phase 6: Integration Tests + Final Verification

### File: `packages/cli/src/auth/__tests__/global-oauth-ui.test.ts` (UPDATE)

**Test 6.1: Full lifecycle — pre-mount → mount → unmount → remount**
```
@given fresh globalOAuthUI (clearPendingItems + clearAddItem)
@when 2 events fire via callAddItem (pre-mount)
@then getPendingCount() = 2
@when handler1 attaches via setAddItem (mount)
@then handler1 receives 2 buffered events, getPendingCount() = 0
@when 3 more events fire via callAddItem (mounted)
@then handler1 receives 3 events directly (not buffered)
@when handler1 detaches via clearAddItem (unmount)
@and 1 event fires via callAddItem (between mounts)
@then event is buffered (getPendingCount() = 1)
@when handler2 attaches via setAddItem (remount)
@then handler2 receives the 1 buffered event
@and handler1 is NOT called for that event (no stale closure)
```

**Test 6.2: Global bridge survives cleanup and is never overwritten**
```
@given global.__oauth_add_item is registered at module load (capture reference)
@when globalOAuthUI.setAddItem(handler) is called (simulating mount)
@and globalOAuthUI.clearAddItem() is called (simulating unmount)
@then global.__oauth_add_item is the SAME function reference as captured at module load
@and calling it buffers the event (handler is cleared)
```

**Test 6.3: Provider-level event reaches buffer when UI not mounted**
```
@given globalOAuthUI has no handler attached (UI unmounted)
@when a provider calls globalOAuthUI.callAddItem(oauthUrlItem) (simulating provider event)
@then getPendingCount() returns 1
@when handler attaches (UI mounts)
@then handler receives the OAuth URL item
```

**Test 6.4: Reactive refresh path falls through to auth when refresh_token mismatch + expired disk token**
```
@given TokenAccessCoordinator with expired token T1 (refresh_token=R1)
@and Lock acquired, disk re-read returns T2 (refresh_token=R2, also expired)
@when executeTokenRefresh detects refresh_token mismatch
@then returns null (not the expired disk token)
@and getToken() proceeds to performDiskCheck and auth flow fallback paths
@and no infinite loop or hang occurs
```

**Test 6.5: Direct runProactiveRenewal without prior schedule uses expiry-based fallback**
```
@given ProactiveRenewalManager with no prior scheduleProactiveRenewal call
@when runProactiveRenewal is called directly for a provider/bucket
@and disk token has expiry > now + 30 seconds
@then hasTokenBeenRefreshedExternally returns true (expiry-based fallback)
@and provider.refreshToken is NOT called
```

### Regression verification

Run the full test suite with targeted OAuth suites first:
```bash
npx vitest run packages/cli/src/integration-tests/oauth-timing.integration.test.ts
npx vitest run packages/cli/src/ui/AppContainer.oauth-dismiss.test.ts
npx vitest run packages/cli/src/ui/oauth-submission.test.ts
npx vitest run packages/core/src/code_assist/oauth2.test.ts
npx vitest run packages/cli/src/auth/__tests__/proactive-renewal-manager.spec.ts
npx vitest run packages/cli/src/auth/oauth-manager.refresh-race.spec.ts
```

Then full verification:
```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

---

## Files Modified (Summary)

| File | Change Type | Phase |
|------|-------------|-------|
| `packages/cli/src/auth/global-oauth-ui.ts` | Modified: add buffering, stable bridge, MAX_PENDING_ITEMS | 2 |
| `packages/cli/src/auth/__tests__/global-oauth-ui.test.ts` | New: unit tests for buffering | 1, 6 |
| `packages/cli/src/ui/containers/AppContainer/hooks/useUpdateAndOAuthBridges.ts` | Modified: remove bridge deletion on cleanup | 3 |
| `packages/cli/src/auth/anthropic-oauth-provider.ts` | Modified: use callAddItem fallback | 3 |
| `packages/cli/src/auth/qwen-oauth-provider.ts` | Modified: use callAddItem fallback (2 sites) | 3 |
| `packages/cli/src/auth/codex-oauth-provider.ts` | Modified: use callAddItem fallback (2 sites) | 3 |
| `packages/cli/src/auth/gemini-oauth-provider.ts` | Modified: use callAddItem fallback (3 sites) | 3 |
| `packages/cli/src/auth/proactive-renewal-manager.ts` | Modified: store/compare refresh_token | 5 |
| `packages/cli/src/auth/token-refresh-helper.ts` | Modified: add refresh_token comparison | 5 |
| `packages/cli/src/auth/__tests__/proactive-renewal-cross-process.spec.ts` | New: cross-process safety tests | 4 |
| `packages/cli/src/auth/__tests__/token-access-coordinator.spec.ts` | Updated: reactive path refresh_token tests | 4 |

## Risk Assessment

- **Low-medium risk**: Phase 1-3 (GlobalOAuthUI buffering + provider migration — additive behavior, but changes process-global singleton and 4 provider files)
- **Medium risk**: Phase 4-5 (proactive renewal changes affect all OAuth providers — the `proactiveRenewalTokens` map shape changes from `string` to `{accessToken, refreshToken}`, which could break tests that inspect internals)
- **Regression areas**: Tests asserting `global.__oauth_add_item === undefined` after cleanup; tests mocking `proactiveRenewalTokens` as simple strings; provider tests that mock `globalOAuthUI.getAddItem()`

## Related Issues

- #1777 (this issue — original scope)
- #1781 (cross-process refresh race — partially addressed by Phase 4-5)
- #1782 (revoked token hang — out of scope, follow-on)
- #1783 (formal test coverage — provides scenario IDs referenced above)
