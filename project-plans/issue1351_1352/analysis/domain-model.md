# Domain Model: KeyringTokenStore & Wiring

Plan ID: `PLAN-20260213-KEYRINGTOKENSTORE`
Issues: #1351 (KeyringTokenStore), #1352 (Wire as Default)

---

## 1. Entity Relationships

```
┌──────────────────────┐
│     OAuthManager     │  Existing. Programs against TokenStore interface.
│                      │  Receives TokenStore via constructor injection.
└──────────┬───────────┘
           │ TokenStore interface
           ▼
┌──────────────────────┐
│  KeyringTokenStore   │  NEW. Implements TokenStore.
│                      │  Thin wrapper over SecureStore.
│                      │  Owns: naming, validation, serialization, locks.
└──────────┬───────────┘
           │ SecureStore.set/get/delete/list/has
           ▼
┌──────────────────────┐
│     SecureStore      │  EXISTING. Service: 'llxprt-code-oauth'.
│                      │  Handles: OS keyring + AES-256-GCM fallback.
│                      │  Probe caching, failure tracking.
└──────────────────────┘

┌──────────────────────┐
│ MultiProviderToken   │  EXISTING → TO BE DELETED.
│ Store (legacy)       │  Plaintext JSON in ~/.llxprt/oauth/*.json.
│                      │  Replaced entirely by KeyringTokenStore.
└──────────────────────┘
```

### Key Relationships

| Entity | Depends On | Depended On By |
|---|---|---|
| KeyringTokenStore | SecureStore, OAuthTokenSchema, fs (locks) | OAuthManager, authCommand, profileCommand, runtimeContextFactory, oauth-provider-registration, providerManagerInstance |
| SecureStore | KeyringAdapter (OS keyring), crypto (fallback) | KeyringTokenStore, ProviderKeyStorage, KeychainTokenStorage, ToolKeyStorage, ExtensionSettingsStorage |
| TokenStore (interface) | (none — pure interface) | KeyringTokenStore, all consumers via DI |
| MultiProviderTokenStore | fs, OAuthTokenSchema | (same consumers as above — all must be swapped) |

---

## 2. State Transitions

### Token Lifecycle States

```
┌─────────────┐  /auth login   ┌──────────────┐
│  ABSENT     │ ──────────────→ │  STORED      │
│ (no token)  │                 │ (in keyring) │
└─────────────┘                 └──────┬───────┘
      ▲                                │
      │  /auth logout                  │ Token expiry detected
      │  (removeToken)                 ▼
      │                         ┌──────────────┐
      │                         │  REFRESHING  │
      │                         │ (lock held)  │
      │                         └──────┬───────┘
      │                                │
      │          ┌─────────────────────┼────────────────┐
      │          │ Success             │ Failure         │
      │          ▼                     ▼                 │
      │   ┌──────────────┐     ┌──────────────┐         │
      │   │  STORED      │     │  EXPIRED     │         │
      │   │ (refreshed)  │     │ (needs login)│─────────┘
      │   └──────────────┘     └──────────────┘
      │                                │
      └────────────────────────────────┘
```

### Lock States

```
┌─────────────┐  createLock(wx)  ┌──────────────┐
│  UNLOCKED   │ ────────────────→│  LOCKED      │
│             │                  │  (pid, ts)   │
└─────────────┘                  └──────┬───────┘
      ▲                                 │
      │  releaseRefreshLock             │ age > staleMs
      │  (unlink)                       ▼
      │                          ┌──────────────┐
      │                          │  STALE       │
      │                          │  (break it)  │
      │                          └──────┬───────┘
      │                                 │ breakLock (unlink)
      └─────────────────────────────────┘
```

### Corrupt Token Detection States

```
SecureStore.get(key) ──→ null?       ──→ Return null (normal: unauthenticated)
                    ──→ non-null string
                         │
                         ▼
                    JSON.parse() fails? ──→ Log warning (SHA-256 hash), return null
                         │
                         ▼
                    OAuthTokenSchema
                    .passthrough()
                    .parse() fails?    ──→ Log warning (SHA-256 hash), return null
                         │
                         ▼
                    Return validated token (success)
```

---

## 3. Business Rules

### BR-1: Account Key Formation
- Account key = `{provider}:{bucket}`
- Default bucket = `"default"` when bucket is omitted
- Both provider and bucket validated against `/^[a-zA-Z0-9_-]+$/`
- Colon separator is safe because validation excludes colons from names

### BR-2: Schema Validation
- `.passthrough()` MUST be used (not `.parse()`) to preserve provider-specific fields
- Codex tokens have `account_id` and `id_token` beyond base schema
- Without `.passthrough()`, round-tripping would silently lose these fields

### BR-3: Error Propagation Asymmetry
- `saveToken`: ALL SecureStoreErrors propagate (user initiated action, needs clear error)
- `getToken`: CORRUPT → log + null; UNAVAILABLE/LOCKED/DENIED/TIMEOUT → propagate
- `removeToken`: ALL errors caught and logged (best-effort cleanup)
- `listProviders`/`listBuckets`: ALL errors → empty array (degraded but functional)

### BR-4: Lock File Naming ≠ Account Key Naming
- Account keys use colon: `provider:bucket`
- Lock files use dash: `provider-bucket-refresh.lock`
- Lock files live in `~/.llxprt/oauth/locks/` (separate from inert old token dir)
- Lock files contain `{pid, timestamp}` JSON — no secrets

### BR-5: No Backward Compatibility
- Old `~/.llxprt/oauth/*.json` plaintext files are completely ignored
- No migration code, no detection code, no acknowledgment
- Users re-authenticate with `/auth login`

### BR-6: Probe-Once Constraint
- SecureStore caches its keyring availability probe for its lifetime
- Sharing a single KeyringTokenStore instance satisfies this
- runtimeContextFactory already maintains a shared instance pattern

### BR-7: Dual-Mode Transparency
- Keyring available → use keyring
- Keyring unavailable → encrypted file fallback (SecureStore handles this)
- No toggle, no user choice — automatic and transparent

---

## 4. Edge Cases

### EC-1: Empty Bucket Name
When bucket parameter is `undefined` or omitted → use `"default"` bucket.
Account key: `{provider}:default`.

### EC-2: Corrupt Token Data
- Invalid JSON → log warning with SHA-256 hash of `provider:bucket`, return null
- Valid JSON but invalid schema → log warning with SHA-256 hash, return null
- Corrupt data is NOT deleted from SecureStore (preserved for inspection)

### EC-3: Concurrent Refresh Across Processes
- Process A acquires lock, starts refresh
- Process B attempts lock, waits (100ms poll intervals)
- Process A completes refresh, releases lock
- Process B acquires lock, refreshes (may be redundant but safe)

### EC-4: Stale Lock (Crashed Process)
- Process A acquires lock, crashes without releasing
- Process B attempts lock, reads lock file
- Lock age > 30s → break lock (delete), retry acquisition
- Process B acquires and proceeds

### EC-5: Corrupt Lock File
- Lock file exists but unreadable (binary corruption, permission denied on read)
- Break the lock (delete), retry acquisition
- This is safe because worst case: two processes refresh concurrently (last-writer-wins for token save)

### EC-6: Name Validation Rejection
- Provider name `"my provider"` (has space) → throw error immediately
- Bucket name `"work/dev"` (has slash) → throw error immediately
- Error message includes invalid name and allowed character set

### EC-7: SecureStore UNAVAILABLE
- Both keyring and fallback are inaccessible
- `saveToken` → error propagates: "Credential storage unavailable. Use --key..."
- `getToken` → error propagates (user must know storage is down)
- `listProviders` → returns empty array (degraded but keeps UI functional)

### EC-8: getBucketStats for Non-Existent Token
- Calls `getToken()` internally to check existence
- Token not found → return `null`
- Token found → return `{ bucket, requestCount: 0, percentage: 0, lastUsed: undefined }`

### EC-9: Lock Directory Creation
- `~/.llxprt/oauth/locks/` may not exist on first use
- Created on demand with mode `0o700`
- Parent directories created recursively

### EC-10: Race During Lock Creation
- Two processes try `wx` write simultaneously
- One succeeds (EEXIST for the other)
- Losing process falls into poll-and-wait loop

---

## 5. Error Scenarios

### ES-1: Keyring Locked (GNOME Keyring)
- SecureStore throws `SecureStoreError(LOCKED)`
- `saveToken` → propagate → login command shows "Unlock your keyring"
- `getToken` → propagate → API call fails with actionable message

### ES-2: Keyring Access Denied
- SecureStore throws `SecureStoreError(DENIED)`
- `saveToken` → propagate → "Check permissions, run as correct user"
- `getToken` → propagate → same message

### ES-3: Timeout During Keyring Operation
- SecureStore throws `SecureStoreError(TIMEOUT)`
- All CRUD operations propagate this error
- User retries

### ES-4: Lock Wait Timeout
- `acquireRefreshLock` returns `false` after `waitMs` (default 10s)
- Caller skips refresh for this attempt (next API call will retry)
- No error thrown — timeout is a normal outcome

### ES-5: ENOENT During Lock Release
- Lock file already deleted (by another process, or manual cleanup)
- `releaseRefreshLock` silently succeeds — release is idempotent

### ES-6: SHA-256 Hash for Warning Logs
- Never log raw `provider:bucket` in warnings (could leak provider names)
- Use `crypto.createHash('sha256').update('provider:bucket').digest('hex')`
- Allows correlation across log entries without exposing secrets

---

## 6. Integration Touch Points

### Production Sites Instantiating MultiProviderTokenStore (MUST CHANGE)

| File | Current Usage | New Usage |
|---|---|---|
| `packages/cli/src/runtime/runtimeContextFactory.ts` L58,263 | `new MultiProviderTokenStore()` | `new KeyringTokenStore()` |
| `packages/cli/src/ui/commands/authCommand.ts` L40,662 | `new MultiProviderTokenStore()` | `new KeyringTokenStore()` |
| `packages/cli/src/ui/commands/profileCommand.ts` L100,347 | `new MultiProviderTokenStore()` | `new KeyringTokenStore()` |
| `packages/cli/src/providers/providerManagerInstance.ts` L242 | `new MultiProviderTokenStore()` | `new KeyringTokenStore()` |
| `packages/cli/src/providers/oauth-provider-registration.ts` L30 | type reference | Update type |

### Re-export Sites (MUST CHANGE)

| File | Current | New |
|---|---|---|
| `packages/core/index.ts` L16 | `export { MultiProviderTokenStore }` | `export { KeyringTokenStore }` |
| `packages/cli/src/auth/types.ts` L14 | `export { MultiProviderTokenStore }` | `export { KeyringTokenStore }` |

### Test Files (MUST UPDATE)

| File | Change |
|---|---|
| `packages/core/src/auth/token-store.spec.ts` | Update to test KeyringTokenStore |
| `packages/core/src/auth/token-store.refresh-race.spec.ts` | Update to test KeyringTokenStore |
| `packages/cli/src/integration-tests/oauth-timing.integration.test.ts` | Update imports |
| `packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts` | Update imports |
| `packages/cli/src/auth/oauth-manager-initialization.spec.ts` | Update imports |
| `packages/cli/src/auth/oauth-manager.refresh-race.spec.ts` | Update imports |
| `packages/cli/test/auth/gemini-oauth-fallback.test.ts` | Update imports |
| `packages/cli/test/ui/commands/authCommand-logout.test.ts` | Update imports |
| `packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts` | Update imports |
| `packages/cli/src/ui/commands/__tests__/profileCommand.bucket.spec.ts` | Update mock |

### User Access Points (UNCHANGED)

- `/auth login <provider>` — stores token via KeyringTokenStore
- `/auth logout <provider>` — removes token via KeyringTokenStore
- `/auth status` — reads tokens via KeyringTokenStore
- `/auth switch` — switches active bucket
- Normal API calls — transparent token retrieval
- Token refresh — background refresh with lock coordination
