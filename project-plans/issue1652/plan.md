# Issue #1652: Multi-instance OAuth Browser Storm + Token Contamination

## Problem Statement

When multiple llxprt-code instances share a multi-bucket OAuth profile and tokens expire simultaneously, two distinct bugs combine to produce a browser-opening storm:

1. **Token contamination**: All four `OAuthProvider` implementations (`AnthropicOAuthProvider`, `CodexOAuthProvider`, `QwenOAuthProvider`, `GeminiOAuthProvider`) perform token storage using hardcoded unbucketed keys (e.g., `'anthropic'`, `'codex'`). Since `KeyringTokenStore.accountKey()` resolves `bucket=undefined` to `'default'`, every provider's `completeAuth()`/`saveToken()`/`getToken()` silently operates on the `{provider}:default` keychain slot. When `OAuthManager.authenticate(provider, bucket)` runs sequentially for multiple buckets, each bucket's auth overwrites `{provider}:default`, corrupting the default bucket's token with the last bucket's token.

2. **No cross-process lock for interactive auth**: The existing `acquireRefreshLock` covers only token refresh. Interactive browser authentication (via `authenticate()`, `authenticateMultipleBuckets()`, and `tryFailover()` Pass 3) has zero cross-process coordination. N instances × B buckets = N×B simultaneous browser opens.

### Observed Incident

- ~10 concurrent instances using `opusthinkingbucketed` profile (3 Anthropic OAuth buckets: default, claudius, vybestack)
- All instances independently detected expired tokens and opened browsers
- Keychain forensics confirmed `anthropic:default` and `anthropic:vybestack` held byte-identical tokens (same access_token, refresh_token, expiry) — proving contamination
- `anthropic:claudius` held a different, valid token
- The contaminated refresh tokens caused cascading reauth loops as refreshing one invalidated the other

## Design Principles

- **Provider layer is storage-agnostic**: Providers exchange credentials but never persist — `OAuthManager` owns all `TokenStore` writes
- **Single writer per bucket**: Filesystem advisory lock prevents concurrent auth for the same provider+bucket across processes
- **Double-check pattern**: After acquiring lock, re-check disk before opening browser — another process may have just completed auth
- **Additive only**: All existing single-bucket and non-OAuth flows remain unchanged
- **DRY**: Reuse the existing `acquireRefreshLock`/`releaseRefreshLock` mechanism by generalizing lock naming (no new lock infrastructure)

---

## Execution Guide

### How to Execute This Plan

This plan is structured as TDD phases following `dev-docs/RULES.md`: tests first (RED), then implementation (GREEN), then verify. Each phase is one subagent task following `dev-docs/COORDINATING.md`.

**Line number note:** All line numbers in this plan are approximate (from the codebase as of 2026-03-02). Always locate targets by function/method name first (e.g., grep for `completeAuth`, `refreshIfNeeded`, `saveToken`), then confirm the line. Do NOT blindly edit by line number.

**Subagent assignments:**
- **typescriptexpert** (sonnetthinking): All implementation phases (tests + code)
- **typescriptreviewer** (opusthinkingbucketed): All verification phases

**Phase execution order:**
```
Phase 1:  Auth lock tests (RED)           → typescriptexpert
Phase 1v: Verify tests exist              → typescriptreviewer
Phase 2:  Auth lock implementation (GREEN) → typescriptexpert
Phase 2v: Verify tests pass               → typescriptreviewer
Phase 3:  Provider refactor tests (RED)    → typescriptexpert
Phase 3v: Verify tests exist              → typescriptreviewer
Phase 4:  Provider refactor impl (GREEN)   → typescriptexpert
Phase 4v: Verify tests pass               → typescriptreviewer
Phase 5:  TOCTOU + integration tests (RED) → typescriptexpert
Phase 5v: Verify tests exist              → typescriptreviewer
Phase 6:  TOCTOU impl + final GREEN       → typescriptexpert
Phase 6v: Full verification               → typescriptreviewer
```

**Verification suite (run after each GREEN phase):**
```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
```

**If a phase fails verification:** Remediate with typescriptexpert, re-verify with typescriptreviewer, loop until PASS or blocked per `dev-docs/COORDINATING.md`.

---

## Phase 1: Auth Lock Tests (RED)

**Entry criteria:** Clean main branch, `npm run test` passes, `npm run typecheck` passes.

Write failing tests for the cross-process auth lock before any implementation exists.

### Files to Create/Modify

| File | Action |
|------|--------|
| `packages/core/src/auth/keyring-token-store.test.ts` | Add auth lock test suite |

### Behavioral Tests

Each test follows GIVEN/WHEN/THEN per `dev-docs/RULES.md`.

#### Test 1.1: Auth lock acquire and release

```
GIVEN a KeyringTokenStore instance
WHEN acquireAuthLock('anthropic', { bucket: 'default' }) is called
THEN it returns true
AND a lock file exists at {lockDir}/anthropic-default-auth.lock
AND when releaseAuthLock('anthropic', 'default') is called
THEN the lock file is removed
```

#### Test 1.2: Auth lock blocks concurrent acquisition

```
GIVEN process A has acquired auth lock for anthropic/default
WHEN process B calls acquireAuthLock('anthropic', { bucket: 'default', waitMs: 100 })
THEN process B returns false (timeout)
AND when process A releases the lock
AND process B retries acquireAuthLock
THEN process B returns true
```

#### Test 1.3: Separate locks per bucket

```
GIVEN auth lock acquired for anthropic/default
WHEN acquireAuthLock('anthropic', { bucket: 'claudius' }) is called
THEN it returns true (different bucket = different lock)
```

#### Test 1.4: Stale lock broken

```
GIVEN a lock file exists with timestamp older than staleMs (360000ms)
WHEN acquireAuthLock is called with staleMs: 360000
THEN the stale lock is broken and new lock acquired (returns true)
```

#### Test 1.5: Auth lock separate from refresh lock

```
GIVEN refresh lock acquired for anthropic/default
WHEN acquireAuthLock('anthropic', { bucket: 'default' }) is called
THEN it returns true (different lock file)
```

#### Test 1.6: Default bucket lock file naming

```
GIVEN no bucket specified
WHEN acquireAuthLock('anthropic') is called
THEN the lock file is at {lockDir}/anthropic-auth.lock (no bucket suffix)
```

### What Must Fail

These tests must fail because `acquireAuthLock`/`releaseAuthLock` don't exist yet on `KeyringTokenStore` or `TokenStore`.

### Phase 1 Verification Criteria

- [ ] Test file compiles (may need stub types)
- [ ] Tests exist and are correctly structured
- [ ] Tests would fail if run (methods don't exist)
- [ ] No implementation code written

---

## Phase 2: Auth Lock Implementation (GREEN)

**Entry criteria:** Phase 1 tests exist and fail (methods don't exist yet). No production code changed.

Implement auth lock to make Phase 1 tests pass.

### Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/auth/token-store.ts` | Add `acquireAuthLock`, `releaseAuthLock` to `TokenStore` interface |
| `packages/core/src/auth/keyring-token-store.ts` | Extract shared lock helper, implement auth lock methods |
| All files with `TokenStore` mocks | Add `acquireAuthLock`/`releaseAuthLock` stubs |

### TokenStore Interface Addition

```typescript
// Add to TokenStore interface in token-store.ts
acquireAuthLock(
  provider: string,
  options?: { waitMs?: number; staleMs?: number; bucket?: string },
): Promise<boolean>;
releaseAuthLock(provider: string, bucket?: string): Promise<void>;
```

### KeyringTokenStore Implementation

**DRY refactor**: Extract the existing `acquireRefreshLock` body into a private helper, then call it from both methods:

```typescript
private authLockFilePath(provider: string, bucket?: string): string {
  const resolved = bucket ?? DEFAULT_BUCKET;
  if (resolved === DEFAULT_BUCKET) {
    return join(this.lockDir, `${provider}-auth.lock`);
  }
  return join(this.lockDir, `${provider}-${resolved}-auth.lock`);
}

// Extract shared logic from acquireRefreshLock into:
private async acquireLock(lockPath: string, waitMs: number, staleMs: number): Promise<boolean> { /* existing body */ }
private async releaseLock(lockPath: string): Promise<void> { /* existing body */ }

// Then both methods delegate:
async acquireRefreshLock(provider, options?) { return this.acquireLock(this.lockFilePath(...), ...); }
async acquireAuthLock(provider, options?) { return this.acquireLock(this.authLockFilePath(...), options?.waitMs ?? 60_000, options?.staleMs ?? 360_000); }
async releaseAuthLock(provider, bucket?) { return this.releaseLock(this.authLockFilePath(provider, bucket)); }
```

### Mock Updates (Compile-Surface Checklist)

**Every `TokenStore` mock/implementation must add these stubs in the same changeset.** Find all with:

```bash
grep -rn "acquireRefreshLock" packages/cli/src packages/core/src --include="*.ts" | grep -v node_modules | grep -v dist
```

Each mock needs:
```typescript
acquireAuthLock: vi.fn(async () => true),
releaseAuthLock: vi.fn(async () => undefined),
```

Or for class-based mocks:
```typescript
async acquireAuthLock(): Promise<boolean> { return true; }
async releaseAuthLock(): Promise<void> {}
```

### Phase 2 Verification Criteria

- [ ] Phase 1 tests all pass
- [ ] `npm run typecheck` passes (all mocks updated)
- [ ] `npm run test` passes (no regressions)
- [ ] `npm run lint && npm run format` clean
- [ ] `npm run build` succeeds

---

## Phase 3: Provider Refactor Tests (RED)

**Entry criteria:** Phase 2 complete — auth lock methods exist, Phase 1 tests pass, `npm run typecheck` passes.

Write failing tests for the provider-layer persistence removal before changing providers.

### Files to Create/Modify

| File | Action |
|------|--------|
| `packages/cli/src/auth/anthropic-oauth-provider.test.ts` | Add no-write tests |
| `packages/cli/src/auth/codex-oauth-provider.spec.ts` | Add no-write tests |
| `packages/cli/src/auth/qwen-oauth-provider.test.ts` | Add no-write tests |
| `packages/cli/src/auth/gemini-oauth-provider.test.ts` | Add no-write tests (create test file if needed — use `.test.ts` to match Anthropic/Qwen convention) |
| `packages/cli/src/auth/oauth-manager.auth-lock.spec.ts` (new file — follows existing topic-specific naming convention) | Add manager integration tests |

### Behavioral Tests — Per Provider

#### Anthropic

##### Test 3.1: initiateAuth returns token on success

```
GIVEN AnthropicOAuthProvider with mocked device flow
WHEN initiateAuth() completes successfully (auth code exchanged)
THEN it returns an OAuthToken with access_token, refresh_token, expiry
AND tokenStore.saveToken is NOT called by the provider
```

##### Test 3.2: initiateAuth throws on cancellation

```
GIVEN AnthropicOAuthProvider with mocked device flow
WHEN user cancels authentication
THEN initiateAuth() throws an error
AND tokenStore.saveToken is NOT called
```

##### Test 3.3: refreshIfNeeded does not write

```
GIVEN AnthropicOAuthProvider
WHEN refreshIfNeeded() is called
THEN tokenStore.saveToken is NOT called
AND tokenStore.removeToken is NOT called
```

##### Test 3.4: getToken is read-only even with expired token

```
GIVEN AnthropicOAuthProvider with an expired in-memory token
WHEN getToken() is called
THEN tokenStore.saveToken is NOT called
AND tokenStore.removeToken is NOT called
AND no HTTP requests are made (no refresh attempt)
```

#### Codex

##### Test 3.5: initiateAuth returns token (interactive callback)

```
GIVEN CodexOAuthProvider in interactive mode with mocked callback
WHEN initiateAuth() completes via callback
THEN it returns an OAuthToken
AND tokenStore.saveToken is NOT called by the provider
```

##### Test 3.6: initiateAuth returns token (device auth fallback)

```
GIVEN CodexOAuthProvider where callback fails
WHEN initiateAuth() falls back to device auth and completes
THEN it returns an OAuthToken
AND tokenStore.saveToken is NOT called by the provider
```

##### Test 3.7: concurrent initiateAuth deduplication

```
GIVEN CodexOAuthProvider
WHEN initiateAuth() is called twice concurrently
THEN both calls resolve to the same OAuthToken (via authInProgress dedup)
AND tokenStore.saveToken is NOT called by the provider
```

##### Test 3.8: refreshIfNeeded does not write

```
GIVEN CodexOAuthProvider
WHEN refreshIfNeeded() is called
THEN tokenStore.saveToken is NOT called
AND tokenStore.removeToken is NOT called
```

#### Qwen

##### Test 3.9: initiateAuth returns token

```
GIVEN QwenOAuthProvider with mocked device flow
WHEN initiateAuth() completes (device code polled successfully)
THEN it returns an OAuthToken
AND tokenStore.saveToken is NOT called by the provider
```

##### Test 3.10: getToken is read-only even with expired token

```
GIVEN QwenOAuthProvider with an expired in-memory token
WHEN getToken() is called
THEN tokenStore.saveToken is NOT called
AND tokenStore.removeToken is NOT called
AND no HTTP requests are made (no refresh attempt)
```

##### Test 3.11: refreshIfNeeded does not write

```
GIVEN QwenOAuthProvider
WHEN refreshIfNeeded() is called
THEN tokenStore.saveToken is NOT called
AND tokenStore.removeToken is NOT called
```

#### Gemini

##### Test 3.12: initiateAuth returns token

```
GIVEN GeminiOAuthProvider with mocked Google OAuth client
WHEN initiateAuth() completes successfully
THEN it returns an OAuthToken
AND tokenStore.saveToken is NOT called by the provider
```

##### Test 3.13: getToken does not write during legacy migration

```
GIVEN GeminiOAuthProvider with legacy credentials on disk
WHEN getToken() is called
THEN it returns a token (or null)
AND tokenStore.saveToken is NOT called
```

##### Test 3.14: refreshIfNeeded does not write

```
GIVEN GeminiOAuthProvider
WHEN refreshIfNeeded() is called
THEN tokenStore.removeToken is NOT called
```

### Behavioral Tests — OAuthManager Integration

##### Test 3.15: Manager persists with correct bucket

```
GIVEN OAuthManager with a mock provider whose initiateAuth() returns a token
WHEN authenticate('anthropic', 'claudius') is called
THEN tokenStore.saveToken is called with ('anthropic', token, 'claudius')
AND the provider's tokenStore.saveToken was NOT called
```

##### Test 3.16: Sequential multi-bucket auth produces distinct tokens

```
GIVEN OAuthManager with a mock provider that returns unique tokens per call
WHEN authenticate('anthropic', 'default') then authenticate('anthropic', 'claudius') then authenticate('anthropic', 'vybestack')
THEN tokenStore.getToken('anthropic', 'default') returns Token-A
AND tokenStore.getToken('anthropic', 'claudius') returns Token-B
AND tokenStore.getToken('anthropic', 'vybestack') returns Token-C
AND Token-A ≠ Token-B ≠ Token-C
```

##### Test 3.17: Default bucket not contaminated (regression)

```
GIVEN tokens for 3 buckets stored via sequential authenticate()
WHEN tokenStore.getToken('anthropic', 'default') is read
THEN it returns the FIRST token (Token-A), not the last (Token-C)
```

##### Test 3.18: Auth lock protects authenticate

```
GIVEN OAuthManager
WHEN two concurrent authenticate('anthropic', 'default') calls are made
THEN only ONE calls provider.initiateAuth()
AND the second reads the token from disk after lock release
```

##### Test 3.19: Double-check skips auth

```
GIVEN OAuthManager acquires auth lock for anthropic/default
AND another process has written a valid token to disk between lock request and acquire
WHEN authenticate() checks disk after acquiring lock
THEN provider.initiateAuth() is NOT called
AND the disk token is used
```

##### Test 3.20: Lock timeout with valid token

```
GIVEN auth lock held by another process
AND lock acquisition times out after waitMs
AND a valid token exists on disk
WHEN authenticate() fails to acquire lock
THEN it returns without error (uses disk token)
```

##### Test 3.21: Lock timeout without valid token

```
GIVEN auth lock held by another process
AND lock acquisition times out
AND NO valid token exists on disk
WHEN authenticate() fails to acquire lock
THEN it throws an error with message containing "lock timeout"
```

##### Test 3.22: Lock released on error

```
GIVEN OAuthManager acquires auth lock
AND provider.initiateAuth() throws an error
WHEN authenticate() exits
THEN releaseAuthLock was called (finally block)
```

##### Test 3.23: Token from initiateAuth is persisted directly

```
GIVEN OAuthManager with a mock provider whose initiateAuth() returns Token-X
WHEN authenticate('anthropic', 'default') is called
THEN tokenStore.saveToken is called with ('anthropic', Token-X, 'default')
AND Token-X is the exact token returned by initiateAuth() (same object reference or identical fields)
```

### What Must Fail vs. Regression Guards

Most Phase 3 tests MUST fail because:
- `initiateAuth()` currently returns `void`, not `OAuthToken` (Tests 3.1, 3.2, 3.5, 3.6, 3.7, 3.9, 3.12)
- Providers still call `saveToken()` internally in `refreshIfNeeded()` (Tests 3.3, 3.8, 3.14)
- `refreshIfNeeded()` still writes to tokenStore (Tests 3.11, 3.13 — Qwen/Gemini)
- `authenticate()` doesn't use auth lock yet (Tests 3.15-3.23 — manager integration tests covering lock acquisition, release, double-check, timeout, and persist behavior)

**Regression guards that may PASS in RED phase** (this is expected):
- Tests 3.4, 3.10: `getToken()` is already read-only for Anthropic/Qwen — these tests validate current behavior and guard against regression. It is acceptable for these to pass during Phase 3.

### Phase 3 Verification Criteria

- [ ] All test files compile
- [ ] Test structure follows GIVEN/WHEN/THEN behavioral pattern
- [ ] Most tests fail if run (expected — RED phase). Tests 3.4 and 3.10 may pass as regression guards.
- [ ] No implementation changes made to production code

---

## Phase 4: Provider Refactor Implementation (GREEN)

**Entry criteria:** Phase 3 tests exist. They fail because `initiateAuth()` returns void, providers still call `saveToken()`, `authenticate()` doesn't use auth lock. No production code changed in Phase 3.

Make all Phase 3 tests pass by removing provider-side persistence and wiring auth lock into `authenticate()`.

### Atomicity Rule

**All changes in Phase 4 must land together in a single working commit.** The `OAuthProvider.initiateAuth()` return type change, all 4 provider refactors, and the `OAuthManager.authenticate()` rewrite are interdependent — any partial state will break the build. The subagent must make all changes before running tests.

### Implementation Order Within Phase

1. Change `OAuthProvider.initiateAuth()` return type in `oauth-manager.ts`
2. Update all 4 providers (Anthropic → Codex → Qwen → Gemini)
3. Wire auth lock into `OAuthManager.authenticate()`
4. Run tests until GREEN

### Critical: Preserve In-Memory Token State

All providers have `this.currentToken` (or similar) in-memory cache fields. When removing `saveToken()` calls, **preserve** all `this.currentToken = token` assignments — these are in-memory cache updates used by `getToken()`, NOT persistence. Only remove `tokenStore.saveToken()` and `tokenStore.removeToken()` calls.

### refreshIfNeeded → No-Op Shell

For all providers, replace the **entire** `refreshIfNeeded()` body with a deprecation log + `return null`. Do NOT try to surgically remove only the write calls while keeping the rest of the logic. The method's logic (lock acquisition, refresh, persistence) is now handled by `OAuthManager.refreshTokenForBucket()`. All that remains is the shell for interface compatibility.

```typescript
async refreshIfNeeded(): Promise<OAuthToken | null> {
  this.logger.debug('refreshIfNeeded() is deprecated — refresh is handled by OAuthManager');
  return null;
}
```

### Provider Write-Path Removal Checklist

Every `saveToken`/`removeToken` call in provider code must be explicitly dispositioned. Use function/method names to locate (line numbers are approximate — grep to confirm):

| Provider | Method | Call | Disposition |
|----------|--------|------|-------------|
| Anthropic | `completeAuth()` | `saveToken('anthropic', token)` ~L400 | **REMOVE** — return token instead |
| Anthropic | `refreshIfNeeded()` | `saveToken('anthropic', refreshedToken)` ~L566 | **REMOVE** — no-op shell |
| Anthropic | `refreshIfNeeded()` | `removeToken('anthropic')` ~L595 | **REMOVE** — no-op shell |
| Anthropic | `refreshIfNeeded()` | `removeToken('anthropic')` ~L615 | **REMOVE** — no-op shell |
| Codex | `completeAuth()` | `saveToken('codex', token)` ~L307 | **REMOVE** — return token instead |
| Codex | `performDeviceAuth()` | `saveToken('codex', token)` ~L408 | **REMOVE** — return token instead |
| Codex | `refreshIfNeeded()` | `saveToken('codex', refreshedToken)` ~L502 | **REMOVE** — no-op shell |
| Qwen | `initiateAuth()` | `saveToken('qwen', token)` ~L299 | **REMOVE** — return token instead |
| Qwen | `refreshIfNeeded()` | `saveToken('qwen', refreshedToken)` ~L402 | **REMOVE** — no-op shell |
| Qwen | `refreshIfNeeded()` | `removeToken('qwen')` ~L434 | **REMOVE** — no-op shell |
| Qwen | `refreshIfNeeded()` | `removeToken('qwen')` ~L451 | **REMOVE** — no-op shell |
| Gemini | `initiateAuth()` | `saveToken('gemini', token)` ~L308 | **REMOVE** — return token instead |
| Gemini | `getToken()` | `saveToken('gemini', token)` ~L363 | **REMOVE** — return without writing |
| Gemini | `migrateFromLegacyTokens()` | `saveToken('gemini', token)` ~L518 | **REMOVE** — return without writing |
| Gemini | `refreshIfNeeded()` | `removeToken('gemini')` ~L401 | **REMOVE** — no-op shell |
| Anthropic | `logout()` | (no storage calls — only remote revocation via `deviceFlow.revokeToken()`) | N/A |
| Codex | `logout()` | `removeToken` ~L562 | **KEEP** — legitimate cleanup |
| Qwen | `logout()` | `removeToken` ~L515 | **KEEP** — legitimate cleanup |
| Gemini | `logout()` | `removeToken` ~L437 | **KEEP** — legitimate cleanup |

**Verification after Phase 4**: `grep -rn 'saveToken\|removeToken' packages/cli/src/auth/{anthropic,codex,qwen,gemini}-oauth-provider.ts | grep -v logout | grep -v '^\s*//' | grep -v test` should return zero matches (only `logout()` calls and comments remain).

### OAuthProvider Interface Change

In `packages/cli/src/auth/oauth-manager.ts`, change the `OAuthProvider` interface:

```typescript
export interface OAuthProvider {
  name: string;
  initiateAuth(): Promise<OAuthToken>;  // was Promise<void>
  getToken(): Promise<OAuthToken | null>;
  refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null>;
  logout?(token?: OAuthToken): Promise<void>;
}
```

### AnthropicOAuthProvider (`packages/cli/src/auth/anthropic-oauth-provider.ts`)

**Key locations** (verify line numbers against actual file before editing):
- `initiateAuth()` body is inside `wrapMethod` callback starting at ~line 190
- `completeAuth()` at ~line 383, `saveToken` at ~line 400
- `refreshIfNeeded()` has `saveToken` at ~line 566, `removeToken` at ~lines 595, 615

**Changes:**
1. `completeAuth()` → change signature to return `Promise<OAuthToken>`, remove `saveToken` call at line 400, return the token instead
2. `initiateAuth()` → change signature to return `Promise<OAuthToken>`. Inside the `wrapMethod` callback, every branch that calls `completeAuth()` (at lines ~335, ~358, ~371) must change from `await this.completeAuth(authCode); return;` to `return await this.completeAuth(authCode);`
3. `refreshIfNeeded()` → replace entire body with deprecation log + `return null` (see "refreshIfNeeded → No-Op Shell" section above). This replaces ~140 lines of logic that is now handled by OAuthManager.

**wrapMethod note**: Both `initiateAuth()` and `completeAuth()` use `this.errorHandler.wrapMethod(callback, provider, method)()` — note the trailing `()` that immediately invokes the returned function. `wrapMethod<TArgs, TReturn>` is generic; the callback's return type propagates through `TReturn`. When changing `void` → `OAuthToken`, the callback must explicitly return the token in every branch. TypeScript with `noImplicitReturns: true` will catch any branch that doesn't return. Audit every `return;` inside the callback.

### CodexOAuthProvider (`packages/cli/src/auth/codex-oauth-provider.ts`)

**Key locations:**
- `completeAuth()` has `saveToken` at ~line 307
- `performDeviceAuth()` has `saveToken` at ~line 408
- `refreshIfNeeded()` has `saveToken` at ~line 502
- `authInProgress` field used for deduplication

**Changes:**
1. `completeAuth()` → return `Promise<OAuthToken>`, remove `saveToken` at line 307, return token
2. `performDeviceAuth()` → return `Promise<OAuthToken>`, remove `saveToken` at line 408, return token
3. `performAuth()` → return `Promise<OAuthToken>`, propagate returns from `completeAuth`/`performDeviceAuth`
4. `initiateAuth()` → return `Promise<OAuthToken>`, propagate return from `performAuth()`
5. `authInProgress` type → `Promise<OAuthToken> | null` (was `Promise<void> | null`)
6. `refreshIfNeeded()` → remove `saveToken` at line 502, convert to no-op deprecation shell

**authInProgress dedup pattern:**
```typescript
if (this.authInProgress) {
  return this.authInProgress; // now returns Promise<OAuthToken>
}
this.authInProgress = this.performAuth();
try {
  const token = await this.authInProgress;
  return token;
} finally {
  this.authInProgress = null;
}
```

### QwenOAuthProvider (`packages/cli/src/auth/qwen-oauth-provider.ts`)

**Key locations:**
- `initiateAuth()` has `saveToken` at ~line 299
- `getToken()` calls `refreshIfNeeded()` at ~line 186 (inside `handleGracefully`)
- `refreshIfNeeded()` has `saveToken` at ~line 402, `removeToken` at ~lines 434, 451

**Changes:**
1. `initiateAuth()` → return `Promise<OAuthToken>`, remove `saveToken` at line 299, return token. Note: Qwen's `initiateAuth()` uses `this.errorHandler.wrapMethod(callback)()` at ~L189 — same pattern as Anthropic. The callback must return the token.
2. `getToken()` → remove `refreshIfNeeded()` call. Make it pure read-only.
3. `refreshIfNeeded()` → replace entire body with deprecation log + `return null`. The method's logic (refresh, persist) is now handled by `OAuthManager`. All that remains is the shell for interface compatibility.

**Note:** `removeToken` at ~line 515 is in `logout()`, NOT `refreshIfNeeded()` — leave it intact.

### GeminiOAuthProvider (`packages/cli/src/auth/gemini-oauth-provider.ts`)

**Key locations:**
- `initiateAuth()` has `saveToken` at ~line 308
- `getToken()` has `saveToken` at ~line 363 (legacy migration write)
- `migrateFromLegacyTokens()` has `saveToken` at ~line 518
- `refreshIfNeeded()` has `removeToken` at ~line 401

**Changes:**
1. `initiateAuth()` → return `Promise<OAuthToken>`, remove `saveToken` at line 308, return token. Preserve the existing null check on `credentialsToOAuthToken()` and throw.
2. `getToken()` → remove `saveToken` at line 363. Return token without writing.
3. `migrateFromLegacyTokens()` → remove `saveToken` at line 518. Return token without writing. Mark deprecated.
4. `refreshIfNeeded()` → remove `removeToken` at line 401. No-op deprecation shell.

**Note:** `removeToken` at ~line 437 is in `logout()`, NOT `refreshIfNeeded()` — leave it intact.

### OAuthManager.authenticate() Rewrite

In `packages/cli/src/auth/oauth-manager.ts`, rewrite `authenticate()`:

```typescript
async authenticate(providerName: string, bucket?: string): Promise<void> {
  const provider = this.providers.get(providerName);
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);

  // 1. Acquire cross-process auth lock
  const lockAcquired = await this.tokenStore.acquireAuthLock(providerName, {
    waitMs: 60_000,
    staleMs: 360_000,
    bucket,
  });

  if (!lockAcquired) {
    const diskToken = await this.tokenStore.getToken(providerName, bucket);
    const now = Math.floor(Date.now() / 1000);
    if (diskToken && diskToken.expiry > now + 30) {
      return; // Another process wrote a valid token
    }
    throw new Error(
      `Authentication lock timeout for ${providerName}/${bucket ?? 'default'}: another process may be authenticating. Please try again.`,
    );
  }

  try {
    // 2. Double-check: another process may have completed auth while we waited
    const existingToken = await this.tokenStore.getToken(providerName, bucket);
    const now = Math.floor(Date.now() / 1000);
    if (existingToken && existingToken.expiry > now + 30) {
      return;
    }

    // 3. Provider handles auth flow and RETURNS token (no persistence)
    const token = await provider.initiateAuth();

    // 4. Manager persists with correct bucket
    await this.tokenStore.saveToken(providerName, token, bucket);

    // 5. Mark provider as OAuth-enabled
    if (!this.isOAuthEnabled(providerName)) {
      this.setOAuthEnabledState(providerName, true);
    }
  } finally {
    await this.tokenStore.releaseAuthLock(providerName, bucket);
  }
}
```

**Behavioral delta from current code:** Current `authenticate()` calls `provider.getToken()` after `initiateAuth()` (line ~361 in current code). New code uses the token returned from `initiateAuth()` directly — eliminates a failure mode where `initiateAuth()` succeeds but `getToken()` returns null.

### Phase 4 Verification Criteria

- [ ] ALL Phase 3 tests pass (GREEN)
- [ ] ALL Phase 1 tests still pass
- [ ] `npm run test` — no regressions
- [ ] `npm run typecheck` — clean (all return types consistent)
- [ ] `npm run lint && npm run format` — clean
- [ ] `npm run build` — succeeds

---

## Phase 5: TOCTOU + Integration + Regression Tests (RED)

**Entry criteria:** Phase 4 complete — all Phase 3 tests pass, all Phase 1 tests pass, `npm run test && npm run typecheck` passes.

Write tests for the TOCTOU defense-in-depth fix and remaining regression scenarios.

### Behavioral Tests — TOCTOU (Change C)

##### Test 5.1: Cross-process auth skipped in onAuthBucket

```
GIVEN authenticateMultipleBuckets() with buckets [default, claudius]
AND default was unauthenticated at upfront check time
AND another process writes a valid token for default between upfront check and onAuthBucket execution
WHEN onAuthBucket runs for default
THEN authenticate() is NOT called for default (token appeared cross-process)
AND authenticate() IS called for claudius
```

##### Test 5.2: Upfront filter still reduces prompts

```
GIVEN authenticateMultipleBuckets() with buckets [default, claudius, vybestack]
AND default already has a valid token
WHEN the method runs
THEN default is filtered out in the upfront check
AND only claudius and vybestack go through the auth flow
```

### Behavioral Tests — Regression

##### Test 5.3: Single-bucket profile unchanged

```
GIVEN a profile with auth.type = 'oauth' and no buckets array
WHEN getToken('anthropic') is called
THEN behavior is identical to pre-fix (default bucket used, auth triggered if needed)
```

##### Test 5.4: Non-OAuth flows unchanged

```
GIVEN a profile with auth.type = 'key' (API key)
WHEN getToken() is called
THEN OAuth flow is NOT triggered
AND token store is NOT consulted for OAuth tokens
```

##### Test 5.5: Refresh flow uses refresh lock not auth lock

```
GIVEN an expired token with valid refresh_token
WHEN OAuthManager refreshes the token
THEN acquireRefreshLock is called (not acquireAuthLock)
AND the refreshed token is persisted with correct bucket
```

##### Test 5.6: Lock released on cancellation

```
GIVEN OAuthManager acquires auth lock
AND user cancels during initiateAuth() (throws)
WHEN authenticate() exits
THEN releaseAuthLock was called
AND no token was persisted
```

### Phase 5 Verification Criteria

- [ ] All new tests compile
- [ ] Tests follow GIVEN/WHEN/THEN behavioral pattern
- [ ] Tests would fail without Phase 6 changes (TOCTOU fix not yet in)
- [ ] No production code changes

---

## Phase 6: TOCTOU Implementation + Final GREEN

**Entry criteria:** Phase 5 tests exist and at least the TOCTOU tests (5.1) fail. All Phase 1-4 tests pass.

### TOCTOU Fix in authenticateMultipleBuckets

In `packages/cli/src/auth/oauth-manager.ts`, modify the `onAuthBucket` callback inside `authenticateMultipleBuckets()`:

```typescript
const onAuthBucket = async (provider: string, bucket: string, index: number, total: number) => {
  // Defense-in-depth: re-check token right before auth
  // Primary protection is the auth lock in authenticate()
  const existingToken = await this.tokenStore.getToken(provider, bucket);
  const now = Math.floor(Date.now() / 1000);
  if (existingToken && existingToken.expiry > now + 30) {
    logger.debug(`Bucket ${bucket} already authenticated (cross-process), skipping`);
    return;
  }

  logger.debug(`Authenticating bucket ${index} of ${total}: ${bucket}`);
  await this.authenticate(provider, bucket);
};
```

The existing upfront filter (lines ~2157-2171) stays as-is for prompt reduction.

### Phase 6 Verification Criteria

- [ ] ALL Phase 5 tests pass (GREEN)
- [ ] ALL Phase 3 tests still pass
- [ ] ALL Phase 1 tests still pass
- [ ] Full verification suite:
  - `npm run test` — all pass
  - `npm run lint` — clean
  - `npm run typecheck` — clean
  - `npm run format` — clean
  - `npm run build` — succeeds
  - `node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"` — works

---

## Technical Reference

This section provides detailed context for implementors. Read the relevant subsection when working on a specific phase.

### OAuthProvider Interface (Current vs. New)

```typescript
// CURRENT (oauth-manager.ts)
export interface OAuthProvider {
  name: string;
  initiateAuth(): Promise<void>;           // ← changes to Promise<OAuthToken>
  getToken(): Promise<OAuthToken | null>;   // stays (pure read-only)
  refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null>; // stays
  logout?(token?: OAuthToken): Promise<void>; // stays
}
```

### Contract Guarantees (All Providers)

1. **`initiateAuth()` always returns token on success**: Every code path that successfully obtains credentials MUST return `OAuthToken`. No path may return void/undefined after partial success.
2. **`initiateAuth()` throws on failure/cancellation**: User cancellation, timeout, or any auth failure MUST throw. Never return null on failure.
3. **`getToken()` is read-only**: MUST NOT call `refreshIfNeeded()` or any method that writes to `TokenStore`.
4. **`refreshToken()` is stateless**: Takes current token, returns refreshed token or null. MUST NOT persist.
5. **`refreshIfNeeded()` has zero writes**: All `saveToken()`/`removeToken()` calls removed. No-op deprecation shell.
6. **No provider-side bucket handling**: Providers MUST NOT infer, resolve, or persist buckets.

### Lock Timeout UX

When multiple processes attempt auth simultaneously:
- First process acquires lock, others wait up to 60s
- If timeout + valid token on disk → use it silently
- If timeout + no token → throw error: "Authentication lock timeout for {provider}/{bucket}: another process may be authenticating. Please try again."
- 6-minute stale threshold auto-cleans crashed lock files

### Known Limitations (Deferred)

**`AnthropicOAuthProvider.getUsageInfo()`** at line ~727 reads `getToken('anthropic')` without bucket. Read-only (no contamination), but returns wrong data for non-default session buckets. `OAuthManager.getAnthropicUsageInfo(bucket?)` is already bucket-aware. Deferred to follow-up issue.

---

## Files Modified Summary

| Package | File | Phase | Changes |
|---------|------|-------|---------|
| core | `src/auth/token-store.ts` | 2 | Add `acquireAuthLock`, `releaseAuthLock` to interface |
| core | `src/auth/keyring-token-store.ts` | 2 | DRY refactor lock helpers, add auth lock methods |
| core | `src/auth/keyring-token-store.test.ts` | 1,2 | Auth lock tests |
| cli | `src/auth/oauth-manager.ts` | 4,6 | `OAuthProvider.initiateAuth` return type, `authenticate()` lock+return, TOCTOU fix |
| cli | `src/auth/anthropic-oauth-provider.ts` | 4 | Remove saveToken from completeAuth, return token, strip refreshIfNeeded writes |
| cli | `src/auth/codex-oauth-provider.ts` | 4 | Remove saveToken from completeAuth/performDeviceAuth, return token, strip refreshIfNeeded writes |
| cli | `src/auth/qwen-oauth-provider.ts` | 4 | Remove saveToken from initiateAuth, remove refreshIfNeeded from getToken, strip writes |
| cli | `src/auth/gemini-oauth-provider.ts` | 4 | Remove saveToken from initiateAuth/getToken/migrate, strip refreshIfNeeded writes |
| core | `src/auth/proxy/proxy-token-store.ts` | 2 | Add `acquireAuthLock`/`releaseAuthLock` no-op stubs (same pattern as existing refresh lock stubs) |
| cli | All TokenStore mock files (~25-30 files) | 2 | Add acquireAuthLock/releaseAuthLock stubs. Run `npm run typecheck` to catch misses. |

## Acceptance Criteria

### Bug 1 (Token Contamination) Fixed

- [ ] All four providers return `OAuthToken` from `initiateAuth()`, throw on failure
- [ ] No provider calls `saveToken()` or `removeToken()` in `initiateAuth()`, `completeAuth()`, `performDeviceAuth()`, `getToken()`, or `refreshIfNeeded()`
- [ ] `OAuthManager.authenticate()` persists with correct bucket parameter
- [ ] Sequential multi-bucket auth produces distinct tokens per bucket (Test 3.16)
- [ ] Default bucket not contaminated by other bucket auth (Test 3.17)

### Bug 2 (Browser Storm) Fixed

- [ ] `TokenStore` interface includes `acquireAuthLock`/`releaseAuthLock`
- [ ] `KeyringTokenStore` implements with 60s wait, 6min stale
- [ ] `authenticate()` acquires auth lock, releases in finally block
- [ ] Double-check reads disk after lock acquire (Test 3.19)
- [ ] Concurrent auth blocked per provider+bucket (Test 3.18)

### TOCTOU Defense Complete

- [ ] `onAuthBucket` re-checks token before calling `authenticate()` (Test 5.1)

### All Tests Pass

- [ ] Full `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`
- [ ] Smoke test passes
