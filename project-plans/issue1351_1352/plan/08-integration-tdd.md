# Phase 08: Integration TDD — End-to-End Flow Tests

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P08`

## Prerequisites

- Required: Phase 07 completed (KeyringTokenStore exported from core and CLI)
- Verification: `grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P07" packages/core/index.ts`
- Expected files from previous phase:
  - `packages/core/index.ts` (exports KeyringTokenStore)
  - `packages/cli/src/auth/types.ts` (re-exports KeyringTokenStore)
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R13.1: Replace MultiProviderTokenStore Instantiation Sites

**Full Text**: All production sites that instantiate `MultiProviderTokenStore` shall be changed to use `KeyringTokenStore`.
**Behavior**:
- GIVEN: Integration tests simulate the production usage pattern
- WHEN: Tests create KeyringTokenStore and use it for full token lifecycle
- THEN: Tests verify the same operations that production code performs
**Why This Matters**: Integration tests define the contract that Phase 09 wiring must satisfy.

### R17.1: Equivalent Test Coverage

**Full Text**: All `TokenStore` interface behaviors shall have equivalent coverage in new tests.
**Behavior**:
- GIVEN: Existing tests covered MultiProviderTokenStore behaviors
- WHEN: Integration tests are written for KeyringTokenStore
- THEN: Every TokenStore behavior is tested in context (not just unit isolation)
**Why This Matters**: Ensures the replacement is functionally equivalent.

### R17.2: Multiprocess Race Condition Tests

**Full Text**: Multiprocess race conditions (concurrent refresh, refresh+logout) shall be tested with spawned child processes.
**Behavior**:
- GIVEN: Two processes sharing the same keyring storage
- WHEN: Both attempt concurrent token refresh
- THEN: File-based locks prevent double-refresh; one waits, then succeeds
**Why This Matters**: Real-world scenario — multiple CLI instances running.

### R17.3: Full Lifecycle Test

**Full Text**: The full token lifecycle shall work end-to-end: login → store → read → refresh → logout.
**Behavior**:
- GIVEN: A new KeyringTokenStore instance
- WHEN: login stores token, read retrieves it, refresh cycle updates it, logout removes it
- THEN: Each step produces correct state; final state is clean (no token)
**Why This Matters**: The complete happy path must work.

### R17.4: Multiple Providers Simultaneously

**Full Text**: Multiple providers shall work simultaneously.
**Behavior**:
- GIVEN: KeyringTokenStore with tokens for anthropic, gemini, qwen
- WHEN: Operations target specific providers
- THEN: Each provider's token is independent; listing shows all; operations don't cross-contaminate
**Why This Matters**: Most users authenticate with multiple providers.

### R17.5: /auth login Stores in Keyring

**Full Text**: `/auth login` shall store tokens in keyring (not plaintext files).
**Behavior**:
- GIVEN: `authCommand.ts` login handler is wired to OAuthManager using KeyringTokenStore
- WHEN: `/auth login <provider>` is executed in an integration test harness and OAuth callback returns a token
- THEN: KeyringTokenStore.saveToken is reached through the real command/OAuthManager path, token is persisted, and no plaintext JSON file is created
**Why This Matters**: Store-level tests are not enough — this verifies the actual command path users invoke.

### R17.6: /auth status Reads from Keyring

**Full Text**: `/auth status` shall read tokens from keyring.
**Behavior**:
- GIVEN: A token exists from prior `/auth login`
- WHEN: `/auth status` is executed via authCommand integration test harness
- THEN: Status path resolves token through OAuthManager + KeyringTokenStore (not plaintext files) and reports authenticated state
**Why This Matters**: This proves command-level integration, not just direct TokenStore method calls.

### R17.7: Refresh Cycle

**Full Text**: Token refresh shall work: expire → lock → refresh → save → unlock.
**Behavior**:
- GIVEN: An expired token in KeyringTokenStore
- WHEN: Refresh cycle is simulated (acquire lock, save new token, release lock)
- THEN: Lock is acquired, token is updated, lock is released
**Why This Matters**: Background refresh is critical for session continuity.

### R18.1–R18.9: End-to-End Verification Flows

**Full Text**: Various end-to-end flows through KeyringTokenStore.
**Behavior**:
- GIVEN: KeyringTokenStore as the token storage backend
- WHEN: Various operations are performed (login, session start, refresh, renewal, failover, logout, status)
- THEN: Each operation works correctly through the keyring storage layer
**Why This Matters**: Comprehensive end-to-end coverage ensures nothing is missed.

### R18.6: Multi-Bucket Entries

**Full Text**: Multi-bucket configurations shall store each bucket as a separate keyring entry.
**Behavior**:
- GIVEN: provider='gemini', buckets=['default', 'work']
- WHEN: Tokens saved for both buckets
- THEN: SecureStore contains separate entries: 'gemini:default', 'gemini:work'
**Why This Matters**: Buckets must be independent.

### R18.7: Multi-Process Shared Storage

**Full Text**: Multiple processes share the same keyring storage; file locks prevent double-refresh.
**Behavior**:
- GIVEN: Two processes with separate KeyringTokenStore instances
- WHEN: Both attempt to read/write tokens
- THEN: Both see the same data; refresh locks coordinate correctly
**Why This Matters**: Users may have multiple terminal sessions.

## Implementation Tasks

### Files to Create

- `packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts`
  - MUST include: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P08`
  - MUST include: `@requirement` tags
  - Integration tests (NOT unit tests) covering:

  **Lifecycle Tests:**
  1. Full lifecycle: save → get → update → get → remove → get(null)
  2. Multi-provider: save anthropic + gemini + qwen → list → individual get → remove one → list shows two
  3. Multi-bucket: save gemini:default + gemini:work → listBuckets → get each → stats for each
  4. Codex round-trip: save token with account_id + id_token → get → verify extra fields preserved

  **Refresh Lock Integration:**
  5. Lock → refresh → save → unlock cycle (sequential)
  6. Stale lock recovery: write fake stale lock → acquire succeeds after break

  **Error Handling Integration:**
  7. Save with unavailable SecureStore → error propagates
  8. Get with corrupt data → null returned, no crash
  9. Remove with error → returns normally
  10. List with error → returns empty array

  **Concurrent Process Tests (spawned child processes):**
  11. Two processes: both read same token → both succeed
  12. Two processes: one refreshes (holds lock), other waits → second acquires after first releases
  13. Two processes: one refreshes, one removes → removal is best-effort

  **Multi-Instance Coherence:**
  14. Two KeyringTokenStore instances (same SecureStore) → save in one, read in other
  15. Save in one instance, list in another → consistent view

  **Property-Based Integration Tests:**
  16. Property: any sequence of save/get/remove for N providers produces consistent state
  17. Property: any sequence of lock/unlock is idempotent and consistent

  Each test has GIVEN/WHEN/THEN and @requirement tag.
  NO mock theater. Tests use real (injectable) SecureStore.
  30%+ property-based using fast-check.

- `packages/cli/src/ui/commands/__tests__/authCommand.keyring-integration.spec.ts`
  - MUST include: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P08`
  - MUST include: `@requirement:R17.5`, `@requirement:R17.6`, `@requirement:R17.7`
  - Command-level integration tests (real auth command path):

  **Auth Command Flow Tests:**
  1. `/auth login <provider>` executes login handler → OAuthManager → KeyringTokenStore.saveToken path
  2. `/auth status` executes status handler → OAuthManager → KeyringTokenStore.getToken path
  3. `/auth logout <provider>` executes logout handler → OAuthManager → KeyringTokenStore.removeToken path
  4. Command-level flows do not read/write plaintext `~/.llxprt/oauth/*.json`

  These tests validate user-reachable command behavior, not just direct TokenStore method calls.

  #### OAuth Callback Test Harness Strategy

  **Problem**: The `/auth login` flow calls `OAuthManager.authenticate(provider, bucket)`, which calls `provider.initiateAuth()` (opens a browser for OAuth) then `provider.getToken()` (returns the token received via OAuth callback). A real browser and OAuth authorization server cannot be used in tests. Without an explicit strategy, an implementer might mock `OAuthManager.authenticate` itself (mock theater) or skip the test entirely.

  **Solution**: Create a **test `OAuthProvider` implementation** that satisfies the `OAuthProvider` interface (from `packages/cli/src/auth/oauth-manager.ts`). The `OAuthProvider` interface has four methods: `initiateAuth()`, `getToken()`, `refreshToken(token)`, and optionally `logout?(token)`. This is NOT mocking internal wiring — the `OAuthProvider` is an *external dependency boundary* (it represents the OAuth authorization server + browser interaction). Replacing it with a test double is the same pattern as replacing a database driver with an in-memory store. Per `dev-docs/RULES.md`, this is sanctioned dependency injection, not mock theater.

  **How the OAuth callback is simulated**:

  In production, `OAuthManager.authenticate()` calls:
  1. `provider.initiateAuth()` — opens a browser, starts local HTTP callback server
  2. `provider.getToken()` — returns the token delivered by the OAuth redirect callback

  In tests, the `TestOAuthProvider` short-circuits both steps:
  - `initiateAuth()` resolves immediately (no browser, no HTTP server)
  - `getToken()` returns a pre-configured `OAuthToken` immediately (as if the callback already delivered it)

  This means `OAuthManager.authenticate()` executes its **real code path**: it calls `initiateAuth()`, calls `getToken()`, validates the returned token, and persists it via `tokenStore.saveToken()`. The only thing replaced is the external OAuth server interaction.

  **What IS real (not mocked) in the test chain:**
  - `AuthCommandExecutor.execute(context, 'anthropic login')` — the real command handler, parsing args and dispatching to `loginWithBucket()`
  - `AuthCommandExecutor.loginWithBucket()` — the real login method calling `oauthManager.authenticate(provider, bucket)`
  - `OAuthManager.authenticate()` — the real orchestrator (calls `provider.initiateAuth()` then `provider.getToken()` then `tokenStore.saveToken()`)
  - `OAuthManager.isAuthenticated()` / `OAuthManager.peekStoredToken()` — real status checks via `tokenStore.getToken()`
  - `OAuthManager.logout()` — real logout calling `tokenStore.removeToken()`
  - `KeyringTokenStore.saveToken()` / `.getToken()` / `.removeToken()` — the real token store
  - `SecureStore` — the real storage engine (with injectable `keytarLoader` for test isolation)

  **What IS replaced (external boundary):**
  - `OAuthProvider` — replaced with a `TestOAuthProvider` that:
    - `name`: the provider name string (e.g., `'anthropic'`)
    - `initiateAuth()`: resolves immediately (simulates successful browser auth without opening a browser or starting an HTTP server)
    - `getToken()`: returns a pre-configured `OAuthToken` (simulates the OAuth callback delivering a token to the local server)
    - `refreshToken(token)`: returns a new token with updated `access_token` and `expiry` (simulates the token endpoint returning a refreshed token)
    - `logout?()`: resolves immediately (simulates provider-side token revocation)

  **Test harness setup pattern:**
  ```typescript
  // 1. Create a real KeyringTokenStore backed by a test SecureStore (in-memory keytarLoader)
  const secureStore = new SecureStore('llxprt-code-oauth', {
    keyringLoader: async () => createMockKeyringAdapter(),  // in-memory Map-backed adapter
    fallbackPolicy: 'allow',
  });
  const tokenStore = new KeyringTokenStore({ secureStore });

  // 2. Create a real OAuthManager with the real TokenStore
  const oauthManager = new OAuthManager(tokenStore);

  // 3. Create and register a TestOAuthProvider (the external dependency replacement)
  const testToken: OAuthToken = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: 'openid',
  };
  const testProvider: OAuthProvider = {
    name: 'anthropic',
    initiateAuth: async () => {},  // No browser, no HTTP server
    getToken: async () => testToken,  // Immediate token delivery
    refreshToken: async (token) => ({ ...token, access_token: 'refreshed-token', expiry: Math.floor(Date.now() / 1000) + 7200 }),
  };
  oauthManager.registerProvider(testProvider);

  // 4. Create the real AuthCommandExecutor with the real OAuthManager
  const executor = new AuthCommandExecutor(oauthManager);

  // 5. Construct a minimal CommandContext (the command handler needs this)
  const mockContext: CommandContext = {
    services: { config: null, settings: {} as never, git: undefined, logger: {} as never },
    ui: {} as never,
    session: {} as never,
  };

  // 6. Exercise the real command path (AuthCommandExecutor.execute parses 'anthropic login')
  const result = await executor.execute(mockContext, 'anthropic login');

  // 7. Verify the token was persisted through the real chain
  const stored = await tokenStore.getToken('anthropic');
  expect(stored?.access_token).toBe(testToken.access_token);
  expect(result.type).toBe('message');
  ```

  **Why this is NOT mock theater (per dev-docs/RULES.md):**

  The `dev-docs/RULES.md` anti-pattern "Testing Implementation" shows `expect(mockDb.find).toHaveBeenCalledWith('123')` as BAD because it tests wiring, not behavior. Our tests do the opposite:

  - We are replacing an EXTERNAL dependency (OAuth authorization server + browser), not internal wiring. The `OAuthProvider` interface is the boundary with an external system — it's analogous to a database driver or HTTP client.
  - The entire internal chain `AuthCommandExecutor.execute() -> loginWithBucket() -> OAuthManager.authenticate() -> KeyringTokenStore.saveToken() -> SecureStore` is **real production code** executing with real logic.
  - Tests verify actual behavioral outcomes: "token is persisted in the store with correct values", "status reports authenticated state", "logout removes the token" — NOT "method X was called with args Y".
  - The `TestOAuthProvider` is analogous to an in-memory database in a repository test — it implements the real interface with controlled behavior.
  - This matches the existing project pattern: `oauth-manager.refresh-race.spec.ts` (line 44-55), `oauth-buckets.integration.spec.ts` (line 55-63), and `oauth-timing.integration.test.ts` (line 40-41) all create concrete `OAuthProvider` test implementations registered via `oauthManager.registerProvider()`.

  **Contrast with existing authCommand.test.ts (mock theater):**

  The existing `packages/cli/src/ui/commands/authCommand.test.ts` mocks the *entire* `OAuthManager` with `vi.fn()` stubs. Those tests verify that `AuthCommandExecutor` calls the right `OAuthManager` methods — which is mock theater. The P08 integration tests use a **real** `OAuthManager` with real `KeyringTokenStore`, replacing only the external `OAuthProvider`. Both test files serve different purposes and should coexist.

### Files to Modify

None — TDD phase creates only test files.

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
 * @requirement R[X].[Y]
 * @given [precondition]
 * @when [action]
 * @then [expected outcome]
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Verify test file exists
test -f packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts && echo "OK" || echo "FAIL"

# Count tests
grep -c "it(" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
# Expected: 15+

# Check plan markers
grep -c "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P08" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
# Expected: 15+

# Check for mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
# Expected: 0

# Check for reverse testing
grep -c "NotYetImplemented" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
# Expected: 0

# Property-based test count
TOTAL=$(grep -c "it(" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts)
PROPERTY=$(grep -c "fc\.\|test\.prop\|it\.prop" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts)
echo "Total: $TOTAL, Property: $PROPERTY"
# Expected: 30%+

# Run integration tests (some should pass now, some may fail until Phase 09 wiring)
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts 2>&1 | tail -10
```

### Structural Verification Checklist

- [ ] Integration test file created
- [ ] 15+ integration tests
- [ ] Plan and requirement markers present
- [ ] No mock theater
- [ ] No reverse testing
- [ ] 30%+ property-based tests
- [ ] Tests use injectable SecureStore (not OS keyring directly)

### Deferred Implementation Detection (MANDATORY)

N/A — TDD phase produces only test files.

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Do tests verify end-to-end flows?**
   - [ ] Lifecycle test covers save → get → update → remove
   - [ ] Multi-provider test uses 3+ providers simultaneously
   - [ ] Refresh test covers full lock → refresh → unlock cycle

2. **Are tests behavioral (not structural)?**
   - [ ] Tests verify actual token values, not just that calls completed
   - [ ] List tests verify specific provider/bucket names
   - [ ] Error tests verify specific error types and null returns

3. **Do concurrent tests use real concurrency?**
   - [ ] Spawned child processes (or at minimum, separate async operations)
   - [ ] Shared storage between concurrent actors
   - [ ] Lock contention is actually tested

4. **Is the feature REACHABLE?**
   - [ ] Tests import KeyringTokenStore from the public export
   - [ ] Tests simulate production usage patterns

5. **What's MISSING?**
   - [ ] Actual wiring into auth commands (Phase 09)
   - [ ] Legacy deletion (Phase 10)

## Success Criteria

- 15+ integration tests created
- Tests cover full lifecycle, multi-provider, multi-bucket, refresh locks, concurrent access
- 30%+ property-based tests
- No mock theater or reverse testing
- Tests that exercise KeyringTokenStore currently pass (unit-level operations)
- Wiring-dependent tests may fail until Phase 09

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts`
2. Or: `rm packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts`
3. Re-run Phase 08 with corrected test design
4. Cannot proceed to Phase 09 until integration tests are correct

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P08.md`
Contents:

```markdown
Phase: P08
Completed: YYYY-MM-DD HH:MM
Files Created: [packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts with line count]
Files Modified: [none]
Tests Added: [count]
Property-Based Tests: [count and percentage]
Verification: [paste of test run output]
```
