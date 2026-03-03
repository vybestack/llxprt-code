# Deep Review of `project-plans/issue1652/plan.md`

Reviewer: deepthinker  
Date: 2026-03-02  
Scope: Independent review of design document for Issue #1652 — Multi-instance OAuth browser storm + token contamination in bucketed profiles.

All claims verified against actual source code. Every source file listed in the task has been read in full.

---

## Executive Summary

The plan correctly identifies three real, verified bugs and proposes a sound three-part fix (A: eliminate provider persistence, B: cross-process auth lock, C: TOCTOU defense-in-depth). The design is **directionally correct and should proceed**, with several issues to address during implementation. The plan has already been through one review round, and the current version addresses the blocking gaps from review-1 well — it now includes branch-by-branch migration details, compile-surface checklists, and explicit contracts. However, some newly-identified issues remain.

**Verdict: APPROVE with required fixes noted below.**

---

## Verified Claims

### Bug 1 — Token Contamination: **CONFIRMED**

All four providers persist tokens with hardcoded unbucketed keys:

| Provider | File | Line(s) | Unbucketed Write |
|----------|------|---------|-----------------|
| Anthropic | `anthropic-oauth-provider.ts` | 400 | `this._tokenStore.saveToken('anthropic', token)` in `completeAuth()` |
| Codex | `codex-oauth-provider.ts` | 307, 408 | `this.tokenStore.saveToken('codex', token)` in `completeAuth()` and `performDeviceAuth()` |
| Qwen | `qwen-oauth-provider.ts` | 299 | `this.tokenStore.saveToken('qwen', token)` in `initiateAuth()` |
| Gemini | `gemini-oauth-provider.ts` | 308 | `this.tokenStore.saveToken('gemini', token)` in `initiateAuth()` |

`KeyringTokenStore.accountKey()` resolves `bucket=undefined` to `'default'` (line 94). Sequential multi-bucket auth will overwrite `{provider}:default` with the last bucket's token. **Contamination vector is real.**

Additionally confirmed secondary write paths:
- `Qwen.refreshIfNeeded()` writes unbucketed at line 402
- `Qwen.refreshIfNeeded()` removes unbucketed at lines 434, 451
- `Codex.refreshIfNeeded()` writes unbucketed at line 502
- `Gemini.getToken()` writes unbucketed at line 363
- `Gemini.migrateFromLegacyTokens()` writes unbucketed at line 518
- `Gemini.refreshIfNeeded()` removes unbucketed at line 401
- `Anthropic.refreshIfNeeded()` writes unbucketed at line 566, removes at line 595

### Bug 2 — No Cross-Process Lock for Interactive Auth: **CONFIRMED**

`KeyringTokenStore` only has `acquireRefreshLock`/`releaseRefreshLock` (lines 300-385). These create lock files like `{provider}-refresh.lock` or `{provider}-{bucket}-refresh.lock`. There is no equivalent for interactive browser auth. `OAuthManager.authenticate()` (lines 334-404) calls `provider.initiateAuth()` with no cross-process coordination whatsoever.

### Bug 3 — TOCTOU in authenticateMultipleBuckets: **CONFIRMED**

Lines 2157-2171 check tokens upfront, then lines 2191-2202 authenticate sequentially. Between the check and auth of each bucket, another process could have completed auth for that bucket.

### OAuthManager.authenticate() Currently Calls provider.getToken(): **CONFIRMED**

Line 361: `const providerToken = await provider.getToken()` — this is how the manager currently retrieves the token after `initiateAuth()`. The plan correctly identifies this needs to change to use the returned token from `initiateAuth()`.

### BucketFailoverHandlerImpl.tryFailover() Pass 3 Calls authenticate(): **CONFIRMED**

Line 359: `await this.oauthManager.authenticate(this.provider, candidateBucket)`. So Change B's auth lock will automatically protect this path too. Plan is correct.

---

## BLOCKING Issues

### B1. `wrapMethod` Return Type Interaction with `initiateAuth()` → `Promise<OAuthToken>`

**Severity: BLOCKING — will cause implementation confusion if not clarified**

`AnthropicOAuthProvider.initiateAuth()` currently wraps its entire body in `this.errorHandler.wrapMethod()` (lines 190-376). The `wrapMethod` utility (in `oauth-errors.ts` lines 592-641) is generic: `wrapMethod<TArgs, TReturn>(method: (...args: TArgs) => Promise<TReturn>, ...)`. When the callback currently returns void (via bare `return;` at lines 337, 360, 372), the inferred `TReturn` is `void`.

When `initiateAuth()` changes to return `Promise<OAuthToken>`, all branches inside the `wrapMethod` callback **must** return `OAuthToken` — including fallback branches (callback failure → manual entry, etc.). The TypeScript compiler will catch omissions, but the plan should note this explicitly because:

1. The `wrapMethod` has no fallback parameter provided (line 374-376 just passes `this.name, 'initiateAuth'`), which means errors re-throw. Good.
2. But partial success paths that currently do `return;` must be changed to `return token;`. Any missed branch will produce a runtime `undefined` return from a `Promise<OAuthToken>` signature — TypeScript won't catch this if the branch returns implicitly.

**Specifically in Anthropic**: Lines 334-337 show `await this.completeAuth(authCode); return;` — the `return;` must become `return await this.completeAuth(authCode);` where `completeAuth()` returns `OAuthToken`. This applies to three separate branches. The plan describes this correctly in the branch-by-branch mapping, but should emphasize that `return;` after `completeAuth` is the exact pattern that needs surgical replacement in all branches.

**Fix**: Add a note in the plan that all `return;` statements following `completeAuth()` calls inside `wrapMethod` callbacks must be changed to `return await this.completeAuth(...)`, and that TypeScript's `noImplicitReturns` compiler option should be verified active to catch any missed branch.

### B2. Codex `authInProgress` Deduplication Breaks Under New Return Type

**Severity: BLOCKING — concurrent callers get `undefined` instead of token**

`CodexOAuthProvider.initiateAuth()` at lines 135-139:
```typescript
if (this.authInProgress) {
  await this.authInProgress;
  return;  // Currently: returns void
}
```

After the change to `Promise<OAuthToken>`, this `return;` returns `undefined`. The plan addresses this correctly (proposes changing `authInProgress` from `Promise<void> | null` to `Promise<OAuthToken> | null` and returning the result), but the implementation details need care:

The plan's proposed pattern is:
```typescript
if (this.authInProgress) {
  return this.authInProgress;
}
this.authInProgress = this.performAuth();
try {
  const token = await this.authInProgress;
  return token;
} finally {
  this.authInProgress = null;
}
```

**Problem**: If `this.authInProgress` is rejected (auth fails), the second caller that does `return this.authInProgress` will also get the rejection. This is correct behavior (both callers should fail). However, if the second caller awaits *after* the first caller's `finally` block clears `this.authInProgress = null`, there's a subtle timing issue: the promise is still the same rejected promise object, but `this.authInProgress` is already null. This is fine because the second caller already has a reference to the promise.

Actually, re-reading: the second caller returns the promise directly (not re-awaiting), so this is correct. **The proposed pattern works**, but should note that `performAuth()` must also change from `Promise<void>` to `Promise<OAuthToken>`, which cascades to `completeAuth()` and `performDeviceAuth()`. The plan describes all these changes.

**Verdict**: The plan's approach is correct. Downgrading to **IMPORTANT** — the plan already addresses this, but implementors should be aware of the cascading return type change through all Codex internal methods.

---

## IMPORTANT Issues

### I1. `AnthropicOAuthProvider.getUsageInfo()` Reads Unbucketed Token

**Severity: IMPORTANT — functional bug in multi-bucket profiles, not addressed by plan**

`AnthropicOAuthProvider.getUsageInfo()` at line 727:
```typescript
const token = await this._tokenStore.getToken('anthropic');
```

This reads the `anthropic:default` bucket. In a multi-bucket profile where the active session bucket is `claudius`, this returns the wrong token's usage info. After Change A eliminates the "last writer wins" behavior, this will consistently return the `default` bucket's token rather than the contaminated last-auth token — which is better, but still wrong if the user is using a non-default bucket.

The plan doesn't mention this method at all. While `getUsageInfo()` is a read-only method (no writes), it will produce incorrect results for non-default bucket users.

**Fix**: Either thread bucket through `getUsageInfo()`, or have `OAuthManager` expose usage info lookup with bucket awareness. Not a contamination risk, but a functional correctness issue. Can be deferred to a follow-up, but should be documented.

### I2. `Anthropic.refreshIfNeeded()` Still Writes Unbucketed — Residual Contamination Path

**Severity: IMPORTANT — the deprecated method can still cause contamination if invoked**

`AnthropicOAuthProvider.refreshIfNeeded()` at line 566:
```typescript
await this._tokenStore.saveToken('anthropic', refreshedToken);
```

The plan says to "deprecate with warning log" but does not specify removing the write. If `refreshIfNeeded()` is ever invoked (e.g., by leftover code paths, or by the provider's own `getToken()` in some future change), it will write an unbucketed token, causing contamination.

**Verified**: `AnthropicOAuthProvider.getToken()` (lines 456-469) does NOT currently call `refreshIfNeeded()` — it just reads from `_tokenStore.getToken('anthropic')`. This was fixed in Issue #1378. So the risk is low today.

However, `QwenOAuthProvider.getToken()` at line 355 DOES still call `refreshIfNeeded()`:
```typescript
if (token && this.isTokenExpired(token)) {
  return this.refreshIfNeeded();
}
```

And `GeminiOAuthProvider.getToken()` at line 354 also calls `refreshIfNeeded()`:
```typescript
let token = await this.refreshIfNeeded();
```

The plan correctly identifies both of these and proposes removing the `refreshIfNeeded()` calls from `getToken()`. The plan should be more explicit that the `saveToken` and `removeToken` calls inside `refreshIfNeeded()` for ALL providers must be removed (not just deprecated with warning), since the methods still exist as public API and could be called.

**Fix**: Remove all `saveToken`/`removeToken` calls from `refreshIfNeeded()` in all four providers, not just add deprecation warnings. The methods can stay as read-only shells that log warnings.

### I3. `Codex.refreshIfNeeded()` Also Writes Unbucketed

**Severity: IMPORTANT — same class of issue as I2**

`CodexOAuthProvider.refreshIfNeeded()` at line 502:
```typescript
await this.tokenStore.saveToken('codex', newToken);
```

This is not called from `CodexOAuthProvider.getToken()` — Codex's `getToken()` (lines 435-474) only reads from the store. But `refreshIfNeeded()` is public and could be called externally.

**Fix**: Same as I2 — remove the write from `refreshIfNeeded()`.

### I4. Lock Timeout of 60s May Be Too Short for Some Auth Flows

**Severity: IMPORTANT — UX degradation, not data corruption**

The plan proposes 60s wait for auth lock acquisition. Interactive OAuth flows can take longer if:
- User is on a slow connection
- User needs to create an account / reset password
- User is authenticating on a different device (Anthropic device flow has a 5-minute timeout at line 300)

The 6-minute stale threshold is good (covers the 5-minute timeout + exchange). But the 60s *wait* means a second process will throw an error after 60s even though the first process is legitimately still waiting for user input (up to 5 minutes).

However, the plan includes a recovery path: after lock timeout, it checks disk for a valid token. If the first process completes auth during the 60s-360s window, the second process's *next* auth attempt (triggered by retry or user action) will find the token on disk.

**Verdict**: The 60s wait is a reasonable tradeoff. The error message should be clear and actionable. Not blocking, but the plan should document that users of the second instance will see an error and need to retry or wait for the first instance to complete.

### I5. Plan Does Not Address `OAuthManager.authenticate()` Currently Calling `provider.getToken()`

**Severity: IMPORTANT — the plan's proposed `authenticate()` is correct but doesn't acknowledge the delta**

Current `OAuthManager.authenticate()` (lines 347-404):
```typescript
await provider.initiateAuth();       // step 1
const providerToken = await provider.getToken();  // step 2 — reads from provider
await this.tokenStore.saveToken(providerName, providerToken, bucket);  // step 3
```

The plan's proposed `authenticate()` replaces this with:
```typescript
const token = await provider.initiateAuth();  // returns token directly
await this.tokenStore.saveToken(providerName, token, bucket);
```

This eliminates step 2 (`provider.getToken()`). This is correct and important — it removes the dependency on providers having written the token to the store before `getToken()` reads it. But the plan should explicitly note that **`provider.getToken()` is no longer called inside `authenticate()`**, as this is a behavioral change that affects how providers expose their state.

Currently, if `provider.initiateAuth()` succeeds but `provider.getToken()` returns null (e.g., due to a storage error inside the provider), `authenticate()` throws at line 366. After the change, this failure mode is eliminated — the token comes directly from `initiateAuth()`.

**Fix**: Acknowledge this delta in the plan as a positive improvement (eliminates a failure mode).

### I6. Gemini's `getOauthClient()` Infrastructure Integration May Complicate Token Return

**Severity: IMPORTANT — hidden complexity in Gemini provider**

`GeminiOAuthProvider.initiateAuth()` (lines 200-346) delegates to `getOauthClient(config)` from `@vybestack/llxprt-code-core`. After the client is returned, it extracts credentials:
```typescript
const credentials = client.credentials;
if (credentials && credentials.access_token) {
  const token = this.credentialsToOAuthToken(credentials);
```

The plan proposes removing `this.tokenStore.saveToken('gemini', token)` (line 308) and instead returning `token`. This is straightforward. However, there's a subtlety: `credentialsToOAuthToken()` can return `null` if `credentials.access_token` is falsy (line 460-461). The current code handles this at line 334 by throwing. The plan's approach should preserve this throw.

Looking at the plan's description for Gemini, it says "Return the token from `initiateAuth()`: `return token;` after extracting from client" — this is correct because the null case is already handled by the existing throw at line 335.

**Fix**: No change needed, but implementors should be aware that the null check must be preserved.

### I7. `OAuthManager.getToken()` Also Triggers `authenticate()` Without Lock

**Severity: IMPORTANT — Change B's lock only protects `authenticate()`, but `getToken()` has its own auth trigger path**

`OAuthManager.getToken()` (starting line 617) can trigger authentication in two ways:
1. Via `this.authenticateMultipleBuckets()` (line 873) — which calls `this.authenticate()` internally
2. Via `this.authenticate(providerName)` directly (line 875)

Both paths go through `authenticate()`, which will have the lock after Change B. So this is actually fine — the lock is at the right level.

However, `getToken()` also has its own locking mechanism for the refresh case (lines 755-837) using `acquireRefreshLock`. The two locks (refresh lock and auth lock) are independent, which is correct — they protect different operations.

**Verdict**: No issue here, just confirming the design is sound. The auth lock in `authenticate()` properly protects all call paths that trigger interactive auth.

---

## MINOR Issues

### M1. Plan References Incorrect Line Numbers in Some Provider Descriptions

The plan references line numbers that don't match the current code. For example, it says "Writes to TokenStore unbucketed: `this._tokenStore.saveToken('anthropic', token)` (line 298)" but the actual line is 400. This suggests the plan was written against an older version of the code, or line numbers shifted.

**Fix**: Line numbers in the plan should be treated as approximate. The actual writes are present and verified — the plan's description of *what* happens is correct even if line numbers are off.

### M2. Naming: `acquireAuthLock` vs `acquireRefreshLock` Parallelism Is Good

The plan proposes `acquireAuthLock`/`releaseAuthLock` alongside existing `acquireRefreshLock`/`releaseRefreshLock`. The lock file naming (`{provider}-{bucket}-auth.lock` vs `{provider}-{bucket}-refresh.lock`) is clean and non-conflicting. DRY refactoring into shared `acquireLock`/`releaseLock` helpers is a good approach.

### M3. Test Coverage List Is Comprehensive

The plan includes 30+ specific test cases covering all branches, lock behavior, edge cases, and regressions. The branch-by-branch mapping for each provider is thorough. The test strategy follows behavioral conventions.

One addition: tests should verify that after Change A, `provider._tokenStore.saveToken` (or `provider.tokenStore.saveToken`) is NOT called during `initiateAuth()` — this is the most direct regression test for contamination prevention.

### M4. Compile-Surface Checklist Is Complete

The plan includes a table of all files needing `acquireAuthLock`/`releaseAuthLock` additions. Verified against grep results — there are at least 4 test files with `TokenStore` mocks that include `acquireRefreshLock: vi.fn()`. These all need corresponding `acquireAuthLock`/`releaseAuthLock` stubs. The plan lists them.

### M5. Implementation Order Is Correct

B → A → C makes sense. B is infrastructure (lock), A uses it (and removes contamination), C is defense-in-depth. Shipping B+A together in one PR prevents partial migration hazards. C can follow separately.

### M6. `Codex.getToken()` Reads Unbucketed — Consistent with Other Providers

`CodexOAuthProvider.getToken()` at line 441:
```typescript
const token = await this.tokenStore.getToken('codex');
```

This is an unbucketed read, same as all other providers. Since `OAuthManager.getOAuthToken()` reads from the token store directly with bucket awareness (line 1031), the provider's `getToken()` is effectively a legacy path. The plan notes this is for "legacy compatibility" and that `OAuthManager` reads directly from `TokenStore`. This is fine.

### M7. Single-Bucket Profiles and Non-OAuth Flows

The plan correctly identifies that single-bucket profiles map to `default` bucket (which is the current behavior) and that non-OAuth flows are completely unaffected. The `authenticate()` lock only triggers when `authenticate()` is called, which only happens for OAuth providers.

---

## Interface Safety Assessment: `initiateAuth() → Promise<OAuthToken>`

### All Callers of `initiateAuth()`

From grep, `initiateAuth()` is called in:
1. **`OAuthManager.authenticate()`** (line 352) — will use returned token. [OK]
2. **Test files** (30+ callsites) — all must be updated to expect token return. TypeScript will enforce. [OK]
3. **No other production callers** — `initiateAuth()` is only called through `OAuthManager.authenticate()`. [OK]

### All Providers Must Satisfy the Contract

| Provider | All success paths return `OAuthToken`? | All failure paths throw? |
|----------|---------------------------------------|-------------------------|
| Anthropic | [OK] (3 branches: callback, manual, non-interactive — all go through `completeAuth()`) | [OK] (cancel, timeout throw errors) |
| Codex | [OK] (callback, callback→device fallback, device-only — all end in `completeAuth()` or `performDeviceAuth()`) | [OK] (auth failure throws) |
| Qwen | [OK] (device flow → `pollForToken()` returns token) | [OK] (timeout/failure throws via `wrapMethod`) |
| Gemini | [OK] (OAuth client → `credentialsToOAuthToken()` returns token, null case throws) | [OK] (cancellation/error throw) |

**Assessment: The interface change is safe.** All four providers can be migrated to return `OAuthToken` from all success paths. TypeScript generics through `wrapMethod`/`handleGracefully` will propagate the return type correctly.

---

## Lock Design Assessment

### Auth Lock (proposed)
- Wait: 60s — reasonable for cross-process coordination
- Stale: 360s (6 min) — covers 5-min interactive timeout + exchange time
- Lock file: `{provider}-{bucket}-auth.lock` — properly scoped per provider+bucket
- Double-check pattern: re-reads token from disk after lock acquisition — correct

### Existing Refresh Lock
- Wait: 10s, Stale: 30s — tuned for quick network operations
- Not affected by this change

### Lock Cleanup
- Stale threshold handles crash cleanup
- Lock file contains PID + timestamp for debugging
- `finally` block ensures release on error/cancellation

### Edge Cases
- **Concurrent callers for same bucket**: First caller gets lock, second waits. After lock timeout, second checks disk. [OK]
- **Concurrent callers for different buckets**: Independent lock files, no interference. [OK]
- **Process crash while holding lock**: 6-minute stale threshold auto-cleans. [OK]
- **Lock file corruption**: Existing `catch` block in `acquireRefreshLock` handles unreadable/corrupt lock files by breaking them. Same pattern applied to auth lock. [OK]

---

## Backward Compatibility Assessment

| Scenario | Impact |
|----------|--------|
| Single-bucket profile | No change — `authenticate()` passes `bucket=undefined`, lock is on `{provider}-auth.lock` |
| Non-OAuth flows (API key, env var) | No change — `authenticate()` is never called |
| Existing single-instance usage | No change — lock acquired and released immediately, no contention |
| Provider `getToken()` callers | Behavior changes: no longer triggers refresh/migration side effects. This is intentional and correct. |
| `refreshToken()` method | No change — `OAuthManager` already owns all refresh persistence |
| Test mocks | Must add `acquireAuthLock`/`releaseAuthLock` stubs — plan includes compile-surface checklist |

**Assessment: No breaking backward compatibility issues.** The only observable change is that `provider.getToken()` stops triggering side effects, which is an improvement.

---

## Overall Assessment

### Strengths
1. All three bugs are real and verified in code
2. The design principle "provider layer is storage-agnostic" is correct and produces a clean architecture
3. Branch-by-branch migration details for all four providers are thorough
4. Lock design reuses existing infrastructure with appropriate timeouts
5. Test strategy is comprehensive with 30+ specific test cases
6. Compile-surface checklist prevents incomplete interface migration
7. Implementation order (B → A → C) is correct

### Weaknesses
1. Line number references in plan are stale (minor)
2. `getUsageInfo()` unbucketed read not addressed (functional issue in multi-bucket)
3. `refreshIfNeeded()` writes should be removed, not just deprecated
4. `wrapMethod` interaction with return type change needs explicit guidance

### Recommendation

**Proceed with implementation.** Address BLOCKING item B1 during implementation (ensure all `return;` after `completeAuth()` are converted to `return token;` with TypeScript's `noImplicitReturns` active). Address IMPORTANT items I1-I3 either in the same PR or as documented follow-ups.

The plan is well-designed, addresses real production bugs, and the proposed architecture (manager owns persistence, providers are stateless) is a significant improvement over the current design.
