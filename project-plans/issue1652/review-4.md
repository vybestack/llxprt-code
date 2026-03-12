# Review 4: Executability & RULES.md Compliance

**Reviewer focus:** Can a subagent execute each phase from scratch with only this plan + source files?

---

## BLOCKING

### B1: Anthropic `logout()` does NOT call `removeToken` — checklist is wrong

The write-path removal checklist states:

> | Anthropic | `logout()` | `removeToken` | **KEEP** — legitimate cleanup |

But Anthropic's `logout()` (line 666-690) does NOT call `removeToken`. It only calls `deviceFlow.revokeToken()` and logs. The `OAuthManager` handles token removal at the manager level. A subagent following the checklist would grep for a `removeToken` in `logout()`, not find it, and either waste time confused or incorrectly add one.

**Fix:** Remove the Anthropic `logout()` row from the checklist entirely, or change it to: "Anthropic | `logout()` | (no storage calls) | N/A — provider-side logout only does remote revocation."

### B2: `ProxyTokenStore` missing from mock update checklist

Phase 2's "Mock Updates" section says to grep for `acquireRefreshLock` and update all hits. `ProxyTokenStore` in `packages/core/src/auth/proxy/proxy-token-store.ts` (line 92-101) is a concrete `TokenStore` implementation (not a mock) that needs `acquireAuthLock`/`releaseAuthLock`. It's not in a test file — it's production code. But the plan's Phase 2 only mentions "All files with `TokenStore` mocks" and provides mock patterns (`vi.fn()`). A subagent would miss `ProxyTokenStore` because:

1. It's not a mock (it's a real class)
2. The grep instruction says `grep -rn "acquireRefreshLock" packages/cli/src packages/core/src` — this would find it, but the surrounding text only talks about mocks
3. A `npm run typecheck` would catch it eventually, but the subagent might be confused about what to add

**Fix:** Add an explicit row to Phase 2's file table:

| `packages/core/src/auth/proxy/proxy-token-store.ts` | Add `acquireAuthLock`/`releaseAuthLock` no-op stubs (same pattern as existing refresh lock stubs) |

### B3: Phase 3 tests are NOT all RED — some would pass already

The plan states: "These tests must fail because `initiateAuth()` currently returns `void`." But several tests would actually **pass** right now:

- **Test 3.3** (Anthropic `refreshIfNeeded` does not write): Anthropic's `refreshIfNeeded()` currently DOES call `saveToken` at L566 — so this test WOULD fail. OK.
- **Test 3.4** (Anthropic `getToken` read-only): Anthropic's `getToken()` (L456-469) is already read-only (`return this._tokenStore!.getToken('anthropic')`). This test would **PASS immediately** — it doesn't touch any write path. This is valid as a regression guard but contradicts the "must fail" assertion.
- **Test 3.8** (Codex `refreshIfNeeded` does not write): Would fail — Codex `refreshIfNeeded` writes at L502. Good.
- **Test 3.13** (Gemini `getToken` does not write during legacy migration): Would fail — `getToken()` at L363 writes. Good.
- **Test 3.14** (Gemini `refreshIfNeeded` does not write): Would fail — L401 removes. Good.

A subagent in Phase 3v verification is told "Tests would fail if run." If some pass, the verifier may report failure incorrectly.

**Fix:** Change the "What Must Fail" section to list which specific tests fail and why, and note that some (like 3.4) are regression guards that may pass in RED phase. Or restructure so only tests that genuinely fail are in Phase 3, and add regression-only tests in Phase 5.

### B4: Phase 1 Test 1.6 contradicts Phase 2 lock file naming

Test 1.6 specifies:
> WHEN `acquireAuthLock('anthropic')` is called (no bucket)
> THEN the lock file is at `{lockDir}/anthropic-auth.lock` (no bucket suffix)

But Phase 2's implementation shows:
```typescript
private authLockFilePath(provider: string, bucket?: string): string {
  const resolved = bucket ?? DEFAULT_BUCKET;
  if (resolved === DEFAULT_BUCKET) {
    return join(this.lockDir, `${provider}-auth.lock`);
  }
  ...
}
```

This is actually consistent — no bucket → resolved = DEFAULT_BUCKET → `anthropic-auth.lock`. However, the existing `lockFilePath` for refresh follows the SAME pattern: no bucket → `anthropic-refresh.lock`. So the test is correct.

Wait — actually the **method signature** in Phase 2 is `acquireAuthLock(provider: string, options?: { ... bucket?: string })` but Test 1.6 calls `acquireAuthLock('anthropic')` with no options object. This is fine — `options` is optional. But Test 1.1 calls `acquireAuthLock('anthropic', { bucket: 'default' })` which resolves bucket='default' explicitly, and the lock file should also be `anthropic-auth.lock` (since DEFAULT_BUCKET = 'default'). **This is consistent.** Not blocking after all — withdrawing this item.

---

## IMPORTANT

### I1: `completeAuth()` wrapMethod pattern not explicitly documented

Anthropic's `completeAuth()` uses `wrapMethod(callback)()` — the callback currently has no explicit return (void). When changing to return `OAuthToken`, the subagent must:
1. Add `return token;` at the end of the callback (after removing `saveToken`)
2. Ensure the `wrapMethod` generic `TReturn` infers `OAuthToken`
3. Change `completeAuth` signature from `Promise<void>` to `Promise<OAuthToken>`

The plan mentions this at a high level but the `wrapMethod(...)()` immediate-invocation pattern is subtle. A subagent unfamiliar with this codebase might try to change the return type of `completeAuth` without understanding that `wrapMethod` returns a *function* that is immediately called.

**Fix:** Add an explicit note in the Anthropic section: "Both `initiateAuth()` and `completeAuth()` use `this.errorHandler.wrapMethod(callback, provider, method)()` — note the trailing `()`. The callback's return type propagates through wrapMethod's generic `TReturn`. When changing void→OAuthToken, ensure the callback explicitly returns the token."

### I2: Qwen `handleGracefully` in `initiateAuth` not mentioned

Qwen's `initiateAuth()` at L189 uses `this.errorHandler.wrapMethod(...)` (same pattern as Anthropic). The plan's Qwen section doesn't call out the `wrapMethod` pattern or note that the callback must return the token. It just says "return `Promise<OAuthToken>`, remove `saveToken`, return token." This might be enough, but it's less detailed than the Anthropic section.

**Fix:** Add a note like: "Qwen's `initiateAuth()` uses `this.errorHandler.wrapMethod(callback)()` at L189. The callback must return the token after removing `saveToken` at L299."

### I3: Gemini `initiateAuth` has complex token extraction — plan doesn't address null path

Gemini's `initiateAuth()` at L304-306:
```typescript
const token = this.credentialsToOAuthToken(credentials);
if (token && this.tokenStore) {
  await this.tokenStore.saveToken('gemini', token);
```

The plan says: "Preserve the existing null check on `credentialsToOAuthToken()` and throw." But the current code structure is inside a nested `if (credentials && credentials.access_token)` with an else that already throws. The plan should clarify: after removing `saveToken`, the block becomes:
```typescript
if (token) {
  this.currentToken = token;
  // ... success message ...
  return token;
}
throw new Error('credentialsToOAuthToken returned null');
```

The `this.tokenStore` null guard can be dropped since the provider no longer writes. But `this.currentToken = token` might need to be preserved for in-memory caching used by `getToken()`. The plan doesn't address whether `this.currentToken` assignments should remain.

**Fix:** Add explicit guidance: "Preserve `this.currentToken = token;` assignments in all providers — these are in-memory cache updates, not persistence. Only remove `tokenStore.saveToken()` calls."

### I4: ~40 mock files need updating — plan should enumerate more

The grep for `acquireRefreshLock` in test files shows approximately 25-30 distinct test files with TokenStore mocks. The plan says "Find all with: `grep -rn 'acquireRefreshLock' ...`" which is correct, but the sheer volume means a subagent could easily miss one and only discover it during `typecheck`. The plan should at least note the approximate count (~30 files) so the subagent knows the scope.

**Fix:** Add: "Expect ~25-30 files. Run `npm run typecheck` after updates to catch any missed mocks."

### I5: Test 3.15-3.23 location unclear

Phase 3 says "packages/cli/src/auth/oauth-manager.spec.ts **or similar**" for manager integration tests. The "or similar" is ambiguous — there are already multiple oauth-manager spec files:
- `oauth-manager.spec.ts`
- `oauth-manager.concurrency.spec.ts`
- `oauth-manager.refresh-race.spec.ts`
- `oauth-manager.failover-wiring.spec.ts`
- etc.

A subagent might create a new file or append to an existing one without guidance.

**Fix:** Specify: "Create new file `packages/cli/src/auth/oauth-manager.auth-lock.spec.ts` for Tests 3.15-3.23" (to follow the existing naming convention of topic-specific spec files).

### I6: Codex `refreshIfNeeded` has no `removeToken` — plan omits this fact

The write-path checklist for Codex only lists `saveToken` at L502 for `refreshIfNeeded`. That's correct — there is no `removeToken` in Codex's `refreshIfNeeded()`. But unlike other providers, a subagent might wonder if they missed one. The asymmetry with Anthropic (which has two `removeToken` calls in `refreshIfNeeded`) could cause confusion.

**Fix:** Minor — no action needed beyond awareness. The checklist is accurate.

### I7: Phase 4 atomicity vs. TDD RED→GREEN

Phase 4 says "All changes must land together in a single working commit." This is pragmatically correct (partial changes break the build), but it somewhat contradicts strict TDD where you make one small change at a time. The plan should acknowledge this is a deliberate exception due to interface-level changes that are inherently atomic.

**Fix:** Already partly addressed by the "Atomicity Rule" section. Consider adding: "This is a deliberate exception to incremental TDD — the interface change forces all providers to update simultaneously."

---

## MINOR

### M1: Test naming convention inconsistency

The plan references both `.test.ts` and `.spec.ts` files:
- "Create `gemini-oauth-provider.test.ts` (use `.test.ts` to match Anthropic/Qwen convention)"
- But Codex uses `.spec.ts`: `codex-oauth-provider.spec.ts`

This is already noted in the plan so it's handled, but the test file table mixes both conventions without a clear rule.

### M2: Line number for Anthropic's `completeAuth` `saveToken` is accurate

Plan says "~L400" — actual is L400. Good.

### M3: Line number for Gemini's `migrateFromLegacyTokens` `saveToken` is accurate

Plan says "~L518" — actual is L518. Good.

### M4: Plan says Anthropic `refreshIfNeeded` → "no-op shell"

The plan says to convert `refreshIfNeeded()` to a "no-op deprecation shell." However, Anthropic's `refreshIfNeeded()` is quite large (L483-622) with lock acquisition, disk double-check, etc. "No-op shell" is ambiguous — does the subagent delete the entire body and replace with a log + `return null`? Or just remove the write calls? The plan is inconsistent:

- For Anthropic: "remove ALL `saveToken` and `removeToken` calls. Leave the method as a no-op shell that logs a deprecation warning and returns null."
- But if you remove writes from Anthropic's `refreshIfNeeded`, the remaining logic (lock, disk check, actual refresh via `deviceFlow`) would still execute — it just wouldn't persist. That's not a "no-op shell."

**Fix:** Clarify: "Replace the entire `refreshIfNeeded()` body with a deprecation log + `return null`. The method's logic (lock, refresh, persist) is now handled by `OAuthManager.refreshTokenForBucket()`. All that remains is the shell for interface compatibility."

### M5: Test 3.7 (Codex concurrent dedup) depends on understanding `authInProgress`

This test requires the subagent to understand Codex's deduplication via `authInProgress`. The plan explains the pattern but the test must verify that only one `initiateAuth` call actually reaches the device flow. This requires mocking at the right level.

### M6: Phase 5 Test 5.5 mentions "refresh flow uses refresh lock not auth lock"

This test verifies the refresh path hasn't been broken. Good regression guard. But it tests `OAuthManager` refresh internals which are already tested in `oauth-manager.refresh-race.spec.ts`. Consider noting this is additive to existing coverage.

---

## Summary

| Category | Count | Highest Risk |
|----------|-------|-------------|
| BLOCKING | 3 | B1 (wrong checklist), B2 (missing ProxyTokenStore), B3 (RED phase tests that pass) |
| IMPORTANT | 7 | I1 (wrapMethod pattern), I3 (currentToken preservation), I5 (test file location) |
| MINOR | 6 | M4 (no-op shell ambiguity) |

**Overall assessment:** The plan is well-structured and thorough. The TDD phase ordering is correct and follows RULES.md. The write-path checklist is almost complete — the two concrete errors (B1: phantom Anthropic logout removeToken, B2: missing ProxyTokenStore) would cause a subagent to stall or miss a compile error. The RED phase issue (B3) could confuse the verifier. Fix the 3 blocking issues and the plan is executable.
