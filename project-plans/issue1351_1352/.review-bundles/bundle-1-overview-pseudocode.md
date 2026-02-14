# BUNDLE 1: Plan Overview + Pseudocode

# Plan: KeyringTokenStore & Wire as Default

Plan ID: `PLAN-20260213-KEYRINGTOKENSTORE`
Generated: 2026-02-13
Total Phases: 11 (plus verification phases)
Issues: #1351 (KeyringTokenStore), #1352 (Wire as Default)
Epic: #1349 — Unified Credential Management, Phase A

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 01)
2. Read the domain model at `analysis/domain-model.md`
3. Read BOTH pseudocode files in `analysis/pseudocode/`
4. Verified all dependencies and types exist as assumed
5. Understood the integration touch points (NOT an isolated feature)

---

## Plan Summary

Replace `MultiProviderTokenStore` (plaintext JSON files) with `KeyringTokenStore` (OS keyring + encrypted fallback via `SecureStore`). This is the last plaintext credential in the system. Clean cut — no migration, no feature flags, no backward compatibility.

## Phase Sequence

| Phase | ID | Title | Requirements |
|---|---|---|---|
| 01 | P01 | Preflight Verification | (all — verify assumptions) |
| 02 | P02 | Domain Analysis | (analysis artifact) |
| 03 | P03 | Pseudocode Development | (pseudocode artifact) |
| 04 | P04 | KeyringTokenStore Stub | R1.1, R1.2, R1.3 |
| 05 | P05 | KeyringTokenStore TDD | R1–R12, R14, R15, R19 |
| 06 | P06 | KeyringTokenStore Implementation | R1–R12, R14, R15, R19 |
| 07 | P07 | Integration Stub | R13.1, R13.3 |
| 08 | P08 | Integration TDD | R13, R17, R18 |
| 09 | P09 | Integration Implementation | R13.1, R13.3, R17, R18 |
| 10 | P10 | Eliminate Legacy | R13.2, R16.2 |
| 11 | P11 | Final Verification | R15.2, R17.1–R17.8, R18.1–R18.9 |

## Traceability Matrix: Requirements → Phases

| Requirement | Description | Phase(s) |
|---|---|---|
| R1.1 | Implements TokenStore interface | P04 (stub), P05 (test), P06 (impl) |
| R1.2 | Delegates to SecureStore('llxprt-code-oauth', allow) | P04 (stub), P05 (test), P06 (impl) |
| R1.3 | Optional SecureStore injection in constructor | P04 (stub), P05 (test), P06 (impl) |
| R2.1 | Account key format {provider}:{bucket} | P05 (test), P06 (impl) |
| R2.2 | Default bucket = 'default' when omitted | P05 (test), P06 (impl) |
| R2.3 | Name validation regex [a-zA-Z0-9_-]+ | P05 (test), P06 (impl) |
| R2.4 | Throw on invalid names before storage ops | P05 (test), P06 (impl) |
| R3.1 | saveToken validates with passthrough().parse() + JSON.stringify | P05 (test), P06 (impl) |
| R3.2 | getToken: JSON.parse + passthrough().parse() on read | P05 (test), P06 (impl) |
| R3.3 | .passthrough() preserves provider-specific fields | P05 (test), P06 (impl) |
| R4.1 | Corrupt JSON → log warning + return null | P05 (test), P06 (impl) |
| R4.2 | Valid JSON, invalid schema → log warning + return null | P05 (test), P06 (impl) |
| R4.3 | Do NOT delete corrupt entries | P05 (test), P06 (impl) |
| R4.4 | SHA-256 hashed identifier in warning logs | P05 (test), P06 (impl) |
| R5.1 | removeToken calls secureStore.delete() | P05 (test), P06 (impl) |
| R5.2 | removeToken swallows SecureStoreError | P05 (test), P06 (impl) |
| R6.1 | listProviders: parse keys, extract unique providers, sorted | P05 (test), P06 (impl) |
| R6.2 | listBuckets: filter by provider, extract buckets, sorted | P05 (test), P06 (impl) |
| R6.3 | List errors → empty array | P05 (test), P06 (impl) |
| R7.1 | getBucketStats with existing token → stats object | P05 (test), P06 (impl) |
| R7.2 | getBucketStats with no token → null | P05 (test), P06 (impl) |
| R8.1 | File-based advisory locks in ~/.llxprt/oauth/locks/ | P05 (test), P06 (impl) |
| R8.2 | Exclusive write (wx flag) with {pid, timestamp} | P05 (test), P06 (impl) |
| R8.3 | Break stale locks (age > 30s) | P05 (test), P06 (impl) |
| R8.4 | Poll at 100ms intervals | P05 (test), P06 (impl) |
| R8.5 | Return false on timeout | P05 (test), P06 (impl) |
| R8.6 | Unreadable lock → break and retry | P05 (test), P06 (impl) |
| R9.1 | releaseRefreshLock deletes lock file | P05 (test), P06 (impl) |
| R9.2 | ENOENT during release → ignore | P05 (test), P06 (impl) |
| R10.1 | Lock file naming convention | P05 (test), P06 (impl) |
| R10.2 | Lock directory created on demand with 0o700 | P05 (test), P06 (impl) |
| R11.1 | saveToken propagates UNAVAILABLE/LOCKED/DENIED/TIMEOUT | P05 (test), P06 (impl) |
| R11.2 | saveToken propagates unexpected SecureStoreError | P05 (test), P06 (impl) |
| R12.1 | getToken returns null when secureStore.get() returns null | P05 (test), P06 (impl) |
| R12.2 | getToken propagates UNAVAILABLE/LOCKED/DENIED/TIMEOUT | P05 (test), P06 (impl) |
| R12.3 | getToken: CORRUPT from SecureStore → log warning + null | P05 (test), P06 (impl) |
| R13.1 | Replace all MultiProviderTokenStore instantiation sites | P07 (stub), P09 (impl) |
| R13.2 | Delete MultiProviderTokenStore class | P10 (eliminate) |
| R13.3 | Replace all exports/re-exports | P07 (stub), P09 (impl) |
| R14.1 | Keyring probe once per process | P05 (test), P06 (impl), P08 (integration test) |
| R15.1 | Works in keyring-available and keyring-unavailable | P05 (test), P06 (impl) |
| R15.2 | Both paths have equivalent test coverage | P05 (test), P11 (final) |
| R16.1 | Host-side only; sandbox is out of scope | P04 (stub), P06 (impl) |
| R16.2 | No code reads/migrates old plaintext files | P10 (eliminate), P11 (final) |
| R16.3 | --key flag unaffected | P11 (final) |
| R17.1 | Equivalent test coverage for all TokenStore behaviors | P05 (test), P11 (final) |
| R17.2 | Multiprocess race condition tests | P05 (test), P08 (integration test) |
| R17.3 | Full lifecycle: login → store → read → refresh → logout | P08 (integration test) |
| R17.4 | Multiple providers simultaneously | P08 (integration test) |
| R17.5 | /auth login stores in keyring | P08 (integration test), P09 (impl) |
| R17.6 | /auth status reads from keyring | P08 (integration test), P09 (impl) |
| R17.7 | Refresh cycle: expire → lock → refresh → save → unlock | P05 (test), P08 (integration test) |
| R17.8 | CI exercises keyring + fallback paths | P11 (final) |
| R18.1 | /auth login stores in keyring/fallback | P08 (integration test), P09 (impl) |
| R18.2 | Session start retrieves from keyring/fallback | P08 (integration test) |
| R18.3 | Token refresh through KeyringTokenStore | P08 (integration test) |
| R18.4 | Proactive renewal through KeyringTokenStore | P08 (integration test) |
| R18.5 | Bucket failover through KeyringTokenStore | P08 (integration test) |
| R18.6 | Multi-bucket as separate keyring entries | P05 (test), P08 (integration test) |
| R18.7 | Multi-process shared keyring + refresh locks | P05 (test), P08 (integration test) |
| R18.8 | /auth logout removes from keyring/fallback | P08 (integration test), P09 (impl) |
| R18.9 | /auth status reads from keyring/fallback | P08 (integration test), P09 (impl) |
| R19.1 | Clear error message for invalid names | P05 (test), P06 (impl) |

## Integration Analysis (MANDATORY)

### 1. What existing code will USE KeyringTokenStore?

- `packages/cli/src/runtime/runtimeContextFactory.ts` — shared instance creation
- `packages/cli/src/ui/commands/authCommand.ts` — /auth login, /auth logout, /auth status
- `packages/cli/src/ui/commands/profileCommand.ts` — profile token operations
- `packages/cli/src/providers/providerManagerInstance.ts` — provider init
- `packages/cli/src/providers/oauth-provider-registration.ts` — registration

### 2. What existing code is REPLACED?

- `MultiProviderTokenStore` class in `packages/core/src/auth/token-store.ts` — DELETED
- `export { MultiProviderTokenStore }` in `packages/core/index.ts` — replaced
- `export { MultiProviderTokenStore }` in `packages/cli/src/auth/types.ts` — replaced

### 3. How do users ACCESS it?

- `/auth login <provider>` → stores token via KeyringTokenStore
- `/auth logout <provider>` → removes token via KeyringTokenStore
- `/auth status` → reads tokens via KeyringTokenStore
- Normal API calls → transparent token retrieval
- Token refresh → background refresh with lock coordination

### 4. What needs MIGRATED?

Nothing. Clean cut. Old plaintext files are inert. Users re-authenticate.

### 5. Integration tests verify end-to-end flow?

Yes — Phase 08 creates integration tests verifying:
- Login → store → read → refresh → logout lifecycle
- Multi-provider simultaneous usage
- Multiprocess race conditions
- Bucket failover
- Both keyring and fallback paths

## Execution Order

```
P01 → Verify → P02 → Verify → P03 → Verify → P04 → Verify → P05 → Verify → P06 → Verify → P07 → Verify → P08 → Verify → P09 → Verify → P10 → Verify → P11 → Verify
```

**NEVER SKIP PHASES. Execute in exact numerical sequence.**

---

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

---

# Pseudocode: KeyringTokenStore

Plan ID: `PLAN-20260213-KEYRINGTOKENSTORE`
Component: `packages/core/src/auth/keyring-token-store.ts`

---

## Interface Contracts

### Inputs this component receives:

```typescript
// Constructor input
interface KeyringTokenStoreOptions {
  secureStore?: SecureStore;  // Optional injection for testing
}

// Method inputs — all from TokenStore interface
// saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void>
// getToken(provider: string, bucket?: string): Promise<OAuthToken | null>
// removeToken(provider: string, bucket?: string): Promise<void>
// listProviders(): Promise<string[]>
// listBuckets(provider: string): Promise<string[]>
// getBucketStats(provider: string, bucket: string): Promise<BucketStats | null>
// acquireRefreshLock(provider: string, options?: { waitMs?: number; staleMs?: number; bucket?: string }): Promise<boolean>
// releaseRefreshLock(provider: string, bucket?: string): Promise<void>
```

### Outputs this component produces:

```typescript
// saveToken → void (or throws SecureStoreError)
// getToken → OAuthToken | null (corrupt → null with warning log)
// removeToken → void (errors swallowed, logged)
// listProviders → string[] (sorted, unique providers; empty on error)
// listBuckets → string[] (sorted buckets for provider; empty on error)
// getBucketStats → BucketStats | null
// acquireRefreshLock → boolean (true = acquired, false = timeout)
// releaseRefreshLock → void (idempotent)
```

### Dependencies this component requires (NEVER stubbed):

```typescript
interface Dependencies {
  secureStore: SecureStore;         // Real dependency, injected or constructed
  OAuthTokenSchema: z.ZodObject;   // From packages/core/src/auth/types.ts
  crypto: NodeCrypto;              // For SHA-256 hashing in warning logs
  fs: NodeFS;                      // For lock file operations
  DebugLogger: DebugLogger;        // For warning/debug logging
}
```

---

## Pseudocode

### Constants and Constructor

```
1:  CONSTANT SERVICE_NAME = 'llxprt-code-oauth'
2:  CONSTANT NAME_REGEX = /^[a-zA-Z0-9_-]+$/
3:  CONSTANT DEFAULT_BUCKET = 'default'
4:  CONSTANT LOCK_DIR = path.join(homedir(), '.llxprt', 'oauth', 'locks')
5:  CONSTANT DEFAULT_LOCK_WAIT_MS = 10000
6:  CONSTANT DEFAULT_STALE_THRESHOLD_MS = 30000
7:  CONSTANT LOCK_POLL_INTERVAL_MS = 100
8:
9:  CLASS KeyringTokenStore IMPLEMENTS TokenStore
10:   FIELD secureStore: SecureStore
11:   FIELD logger: DebugLogger
12:
13:   CONSTRUCTOR(options?: { secureStore?: SecureStore })
14:     IF options?.secureStore IS provided
15:       SET this.secureStore = options.secureStore
16:     ELSE
17:       SET this.secureStore = NEW SecureStore(SERVICE_NAME, {
18:         fallbackDir: path.join(homedir(), '.llxprt', 'secure-store', SERVICE_NAME),
19:         fallbackPolicy: 'allow'
20:       })
21:     END IF
22:     SET this.logger = NEW DebugLogger('llxprt:keyring-token-store')
23:   END CONSTRUCTOR
```

### Name Validation

```
24:   PRIVATE METHOD validateName(name: string, label: string): void
25:     IF NOT NAME_REGEX.test(name)
26:       THROW Error("Invalid {label} name: \"{name}\". Allowed: letters, numbers, dashes, underscores.")
27:     END IF
28:   END METHOD
```

### Account Key Formation

```
29:   PRIVATE METHOD accountKey(provider: string, bucket?: string): string
30:     SET resolvedBucket = bucket ?? DEFAULT_BUCKET
31:     CALL this.validateName(provider, 'provider')
32:     CALL this.validateName(resolvedBucket, 'bucket')
33:     RETURN "{provider}:{resolvedBucket}"
34:   END METHOD
```

### SHA-256 Hashing for Logs

```
35:   PRIVATE METHOD hashIdentifier(accountKey: string): string
36:     RETURN crypto.createHash('sha256').update(accountKey).digest('hex').substring(0, 16)
37:   END METHOD
```

### saveToken

```
38:   ASYNC METHOD saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void>
39:     SET key = CALL this.accountKey(provider, bucket)
40:     SET validatedToken = OAuthTokenSchema.passthrough().parse(token)
41:     SET serialized = JSON.stringify(validatedToken)
42:     AWAIT this.secureStore.set(key, serialized)
43:     // SecureStoreError propagates: UNAVAILABLE, LOCKED, DENIED, TIMEOUT
44:   END METHOD
```

### getToken

```
45:   ASYNC METHOD getToken(provider: string, bucket?: string): Promise<OAuthToken | null>
46:     SET key = CALL this.accountKey(provider, bucket)
47:
48:     TRY
49:       SET raw = AWAIT this.secureStore.get(key)
50:     CATCH error
51:       IF error IS SecureStoreError AND error.code IS 'CORRUPT'
52:         CALL this.logger.warn("Corrupt token envelope for [{hashIdentifier(key)}]: {error.message}")
53:         RETURN null
54:       END IF
55:       // UNAVAILABLE, LOCKED, DENIED, TIMEOUT → propagate
56:       THROW error
57:     END TRY
58:
59:     IF raw IS null
60:       RETURN null
61:     END IF
62:
63:     TRY
64:       SET parsed = JSON.parse(raw)
65:     CATCH parseError
66:       CALL this.logger.warn("Corrupt token JSON for [{hashIdentifier(key)}]: {parseError.message}")
67:       RETURN null
68:     END TRY
69:
70:     TRY
71:       SET validatedToken = OAuthTokenSchema.passthrough().parse(parsed)
72:       RETURN validatedToken
73:     CATCH zodError
74:       CALL this.logger.warn("Invalid token schema for [{hashIdentifier(key)}]: {zodError.message}")
75:       RETURN null
76:     END TRY
77:   END METHOD
```

### removeToken

```
78:   ASYNC METHOD removeToken(provider: string, bucket?: string): Promise<void>
79:     SET key = CALL this.accountKey(provider, bucket)
80:     TRY
81:       AWAIT this.secureStore.delete(key)
82:     CATCH error
83:       CALL this.logger.warn("Failed to remove token for [{hashIdentifier(key)}]: {error.message}")
84:       // Best-effort — do not propagate
85:     END TRY
86:   END METHOD
```

### listProviders

```
87:   ASYNC METHOD listProviders(): Promise<string[]>
88:     TRY
89:       SET allKeys = AWAIT this.secureStore.list()
90:       SET providerSet = NEW Set<string>()
91:       FOR EACH key IN allKeys
92:         IF key.includes(':')
93:           SET provider = key.split(':')[0]
94:           providerSet.add(provider)
95:         END IF
96:       END FOR
97:       RETURN Array.from(providerSet).sort()
98:     CATCH error
99:       CALL this.logger.warn("Failed to list providers: {error.message}")
100:      RETURN []
101:    END TRY
102:  END METHOD
```

### listBuckets

```
103:  ASYNC METHOD listBuckets(provider: string): Promise<string[]>
104:    TRY
105:      SET allKeys = AWAIT this.secureStore.list()
106:      SET prefix = "{provider}:"
107:      SET buckets: string[] = []
108:      FOR EACH key IN allKeys
109:        IF key.startsWith(prefix)
110:          SET bucket = key.substring(prefix.length)
111:          buckets.push(bucket)
112:        END IF
113:      END FOR
114:      RETURN buckets.sort()
115:    CATCH error
116:      CALL this.logger.warn("Failed to list buckets for [{hashIdentifier(provider + ':')}]: {error.message}")
117:      RETURN []
118:    END TRY
119:  END METHOD
```

### getBucketStats

```
120:  ASYNC METHOD getBucketStats(provider: string, bucket: string): Promise<BucketStats | null>
121:    // Validation happens inside getToken via accountKey
122:    SET token = AWAIT this.getToken(provider, bucket)
123:    IF token IS null
124:      RETURN null
125:    END IF
126:    RETURN {
127:      bucket: bucket,
128:      requestCount: 0,
129:      percentage: 0,
130:      lastUsed: undefined
131:    }
132:  END METHOD
```

### Lock File Path

```
133:  PRIVATE METHOD lockFilePath(provider: string, bucket?: string): string
134:    SET resolvedBucket = bucket ?? DEFAULT_BUCKET
135:    IF resolvedBucket IS DEFAULT_BUCKET
136:      RETURN path.join(LOCK_DIR, "{provider}-refresh.lock")
137:    ELSE
138:      RETURN path.join(LOCK_DIR, "{provider}-{resolvedBucket}-refresh.lock")
139:    END IF
140:  END METHOD
```

### Ensure Lock Directory

```
141:  PRIVATE ASYNC METHOD ensureLockDir(): Promise<void>
142:    AWAIT fs.mkdir(LOCK_DIR, { recursive: true, mode: 0o700 })
143:  END METHOD
```

### acquireRefreshLock

```
144:  ASYNC METHOD acquireRefreshLock(provider: string, options?: { waitMs?: number; staleMs?: number; bucket?: string }): Promise<boolean>
145:    IF options?.bucket IS provided
146:      CALL this.validateName(options.bucket, 'bucket')
147:    END IF
148:    CALL this.validateName(provider, 'provider')
149:
150:    SET lockPath = CALL this.lockFilePath(provider, options?.bucket)
151:    SET waitMs = options?.waitMs ?? DEFAULT_LOCK_WAIT_MS
152:    SET staleMs = options?.staleMs ?? DEFAULT_STALE_THRESHOLD_MS
153:    SET startTime = Date.now()
154:
155:    AWAIT this.ensureLockDir()
156:
157:    LOOP WHILE (Date.now() - startTime) < waitMs
158:      TRY
159:        // Attempt exclusive write
160:        SET lockInfo = { pid: process.pid, timestamp: Date.now() }
161:        AWAIT fs.writeFile(lockPath, JSON.stringify(lockInfo), { flag: 'wx', mode: 0o600 })
162:        RETURN true  // Lock acquired
163:      CATCH writeError
164:        IF writeError.code IS NOT 'EEXIST'
165:          THROW writeError  // Unexpected error
166:        END IF
167:      END TRY
168:
169:      // Lock file exists — read it
170:      TRY
171:        SET content = AWAIT fs.readFile(lockPath, 'utf8')
172:        SET existing = JSON.parse(content)
173:        SET lockAge = Date.now() - existing.timestamp
174:
175:        IF lockAge > staleMs
176:          // Stale lock — break it
177:          TRY
178:            AWAIT fs.unlink(lockPath)
179:          CATCH unlinkError
180:            // Ignore ENOENT (another process may have broken it)
181:          END TRY
182:          CONTINUE  // Retry acquisition
183:        END IF
184:      CATCH readError
185:        // Lock file unreadable or corrupt — break it
186:        TRY
187:          AWAIT fs.unlink(lockPath)
188:        CATCH unlinkError
189:          // Ignore ENOENT
190:        END TRY
191:        CONTINUE  // Retry acquisition
192:      END TRY
193:
194:      // Lock is fresh — wait and retry
195:      AWAIT sleep(LOCK_POLL_INTERVAL_MS)
196:    END LOOP
197:
198:    RETURN false  // Timeout
199:  END METHOD
```

### releaseRefreshLock

```
200:  ASYNC METHOD releaseRefreshLock(provider: string, bucket?: string): Promise<void>
201:    CALL this.validateName(provider, 'provider')
202:    IF bucket IS provided
203:      CALL this.validateName(bucket, 'bucket')
204:    END IF
205:    SET lockPath = CALL this.lockFilePath(provider, bucket)
206:    TRY
207:      AWAIT fs.unlink(lockPath)
208:    CATCH error
209:      IF error.code IS NOT 'ENOENT'
210:        THROW error
211:      END IF
212:      // ENOENT is fine — release is idempotent
213:    END TRY
214:  END METHOD
215: END CLASS
```

---

## Integration Points (Line-by-Line)

| Line(s) | Call | Notes |
|---|---|---|
| 17-20 | `new SecureStore(SERVICE_NAME, {...})` | Only when no injected instance. Must match ProviderKeyStorage pattern. |
| 22 | `new DebugLogger('llxprt:keyring-token-store')` | For warning logs. Must use existing DebugLogger from project. |
| 25 | `NAME_REGEX.test(name)` | Validation before any storage operation. |
| 36 | `crypto.createHash('sha256')` | For log-safe identifier hashing. |
| 40 | `OAuthTokenSchema.passthrough().parse(token)` | MUST use `.passthrough()` — preserves Codex fields. Import from `../auth/types.js`. |
| 42 | `this.secureStore.set(key, serialized)` | Delegates to SecureStore. Error propagates. |
| 49 | `this.secureStore.get(key)` | Returns `string | null`. SecureStore handles keyring+fallback internally. |
| 51 | Check `SecureStoreError.code` | Must import `SecureStoreError` from `../storage/secure-store.js`. |
| 71 | `OAuthTokenSchema.passthrough().parse(parsed)` | Second validation on read path. Same `.passthrough()` requirement. |
| 81 | `this.secureStore.delete(key)` | Returns `boolean`, but we ignore it. Errors caught. |
| 89 | `this.secureStore.list()` | Returns `string[]` of all account keys for this service. |
| 142 | `fs.mkdir(LOCK_DIR, { recursive: true, mode: 0o700 })` | Lock dir created on demand. |
| 161 | `fs.writeFile(lockPath, ..., { flag: 'wx' })` | Exclusive create — fails with EEXIST if file exists. |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: OAuthTokenSchema.parse(token)                    // Strips extra fields
[OK]    DO:     OAuthTokenSchema.passthrough().parse(token)       // Preserves Codex account_id, id_token

[ERROR] DO NOT: console.warn(`Corrupt token for ${provider}:${bucket}`)   // Leaks provider name
[OK]    DO:     this.logger.warn(`Corrupt token for [${hashIdentifier(key)}]`)  // SHA-256 hash only

[ERROR] DO NOT: await this.secureStore.delete(key) in getToken    // Don't delete corrupt data
[OK]    DO:     return null after logging warning                  // Preserve for inspection

[ERROR] DO NOT: throw error in removeToken                        // Deletion is best-effort
[OK]    DO:     catch and log, return normally                     // User sees logout succeed

[ERROR] DO NOT: throw error in listProviders/listBuckets          // Lists degrade gracefully
[OK]    DO:     catch and return []                                // UI stays functional

[ERROR] DO NOT: new MultiProviderTokenStore() anywhere             // Legacy class
[OK]    DO:     new KeyringTokenStore() or inject via constructor  // New implementation

[ERROR] DO NOT: use {provider}-{bucket} format for SecureStore keys  // Ambiguous with lock files
[OK]    DO:     use {provider}:{bucket} for SecureStore account keys  // Colon separator

[ERROR] DO NOT: store lock files in ~/.llxprt/oauth/ root           // Mix with inert data
[OK]    DO:     store lock files in ~/.llxprt/oauth/locks/          // Dedicated subdirectory

[ERROR] DO NOT: validate provider/bucket AFTER storage operation    // Side effects before validation
[OK]    DO:     validate in accountKey() BEFORE any storage call    // Fail fast

[ERROR] DO NOT: fire-and-forget lock directory creation             // Race condition
[OK]    DO:     AWAIT ensureLockDir() before lock operations        // Guaranteed exists
```

---

# Pseudocode: Wiring & Legacy Elimination

Plan ID: `PLAN-20260213-KEYRINGTOKENSTORE`
Component: Integration wiring + MultiProviderTokenStore deletion

---

## Interface Contracts

### Inputs this component receives:

```typescript
// No new interfaces — this is a wiring change.
// All call sites already program against TokenStore interface.
// We swap the concrete implementation from MultiProviderTokenStore → KeyringTokenStore.
```

### Outputs this component produces:

```typescript
// Same TokenStore interface behaviors — no functional changes visible to callers.
// The only change is WHERE tokens are stored (keyring/encrypted fallback vs plaintext files).
```

### Dependencies this component requires:

```typescript
interface Dependencies {
  KeyringTokenStore: class;   // From packages/core/src/auth/keyring-token-store.ts (created in earlier phases)
  TokenStore: interface;       // From packages/core/src/auth/token-store.ts (preserved, not modified)
  SecureStore: class;          // From packages/core/src/storage/secure-store.ts (existing)
}
```

---

## Pseudocode: Wiring Changes

### Phase 1: Update Core Exports

```
1:  FILE packages/core/index.ts
2:    REMOVE: export { MultiProviderTokenStore } from './src/auth/token-store.js'
3:    ADD:    export { KeyringTokenStore } from './src/auth/keyring-token-store.js'
4:  END FILE
```

### Phase 2: Update CLI Re-exports

```
5:  FILE packages/cli/src/auth/types.ts
6:    REMOVE: export { MultiProviderTokenStore } from '@vybestack/llxprt-code-core'
7:    ADD:    export { KeyringTokenStore } from '@vybestack/llxprt-code-core'
8:  END FILE
```

### Phase 3: Update runtimeContextFactory (Shared Instance)

```
9:  FILE packages/cli/src/runtime/runtimeContextFactory.ts
10:   REMOVE import: MultiProviderTokenStore from token-store or types
11:   ADD import: KeyringTokenStore from '@vybestack/llxprt-code-core' (or from types re-export)
12:
13:   CHANGE shared instance declaration:
14:     REMOVE: let sharedTokenStore: MultiProviderTokenStore | null = null;
15:     ADD:    let sharedTokenStore: KeyringTokenStore | null = null;
16:
17:   CHANGE instantiation site:
18:     REMOVE: sharedTokenStore ?? (sharedTokenStore = new MultiProviderTokenStore())
19:     ADD:    sharedTokenStore ?? (sharedTokenStore = new KeyringTokenStore())
20:
21:   NOTE: This is the primary shared instance — satisfies probe-once constraint (R14.1)
22: END FILE
```

### Phase 4: Update authCommand

```
23: FILE packages/cli/src/ui/commands/authCommand.ts
24:   REMOVE import: MultiProviderTokenStore
25:   ADD import: KeyringTokenStore
26:
27:   CHANGE line ~40:
28:     REMOVE: const tokenStore = new MultiProviderTokenStore()
29:     ADD:    const tokenStore = new KeyringTokenStore()
30:
31:   CHANGE line ~662:
32:     REMOVE: const tokenStore = new MultiProviderTokenStore()
33:     ADD:    const tokenStore = new KeyringTokenStore()
34: END FILE
```

### Phase 5: Update profileCommand

```
35: FILE packages/cli/src/ui/commands/profileCommand.ts
36:   REMOVE import: MultiProviderTokenStore
37:   ADD import: KeyringTokenStore
38:
39:   CHANGE line ~100:
40:     REMOVE: const tokenStore = new MultiProviderTokenStore()
41:     ADD:    const tokenStore = new KeyringTokenStore()
42:
43:   CHANGE line ~347:
44:     REMOVE: const tokenStore = new MultiProviderTokenStore()
45:     ADD:    const tokenStore = new KeyringTokenStore()
46: END FILE
```

### Phase 6: Update providerManagerInstance

```
47: FILE packages/cli/src/providers/providerManagerInstance.ts
48:   REMOVE import: MultiProviderTokenStore
49:   ADD import: KeyringTokenStore
50:
51:   CHANGE line ~242:
52:     REMOVE: const tokenStore = new MultiProviderTokenStore()
53:     ADD:    const tokenStore = new KeyringTokenStore()
54: END FILE
```

### Phase 7: Update oauth-provider-registration

```
55: FILE packages/cli/src/providers/oauth-provider-registration.ts
56:   REMOVE import: MultiProviderTokenStore from '../auth/types.js'
57:   ADD import: KeyringTokenStore (or TokenStore if only type is used)
58:
59:   CHANGE parameter type if applicable:
60:     REMOVE: tokenStore?: MultiProviderTokenStore
61:     ADD:    tokenStore?: TokenStore
62:   NOTE: Prefer interface type (TokenStore) over concrete class for parameters
63: END FILE
```

---

## Pseudocode: Legacy Elimination

### Phase 8: Delete MultiProviderTokenStore Class

```
64: FILE packages/core/src/auth/token-store.ts
65:   PRESERVE: TokenStore interface (lines 1-85 approximately)
66:   PRESERVE: All imports used by TokenStore interface
67:   DELETE: LockInfo interface
68:   DELETE: MultiProviderTokenStore class (entire class body)
69:   DELETE: Unused imports (fs, join, homedir — if only used by MultiProviderTokenStore)
70:   KEEP: Import of OAuthTokenSchema, BucketStats, OAuthToken (used by interface)
71:
72:   RESULT: token-store.ts contains ONLY the TokenStore interface and necessary type imports
73: END FILE
```

### Phase 9: Clean Up Residual Imports

```
74: FOR EACH file that previously imported MultiProviderTokenStore:
75:   IF file now uses KeyringTokenStore → import already updated in wiring phase
76:   IF file only used MultiProviderTokenStore as a type → switch to TokenStore interface
77:   IF file is a test → update to use KeyringTokenStore (see test update phase)
78: END FOR
```

### Phase 10: Update Existing Tests

```
79: FILE packages/core/src/auth/token-store.spec.ts
80:   CHANGE: import { MultiProviderTokenStore } → import { KeyringTokenStore }
81:   CHANGE: describe('MultiProviderTokenStore') → describe('KeyringTokenStore')
82:   CHANGE: new MultiProviderTokenStore(path) → new KeyringTokenStore({ secureStore: testSecureStore })
83:   NOTE: Tests need rewrite since storage mechanism changed (no longer plaintext files)
84:   NOTE: New tests created in TDD phase; these old tests are updated or replaced
85: END FILE
86:
87: FILE packages/core/src/auth/token-store.refresh-race.spec.ts
88:   CHANGE: Same pattern as above — update class references
89:   NOTE: Lock mechanism is preserved but lock dir changes to ~/.llxprt/oauth/locks/
90: END FILE
91:
92: FILE packages/cli/src/auth/types.ts
93:   Already updated in Phase 2 above
94: END FILE
95:
96: FILE packages/cli/src/integration-tests/oauth-timing.integration.test.ts
97:   CHANGE: import { MultiProviderTokenStore } → import { KeyringTokenStore }
98:   CHANGE: All instantiation sites
99: END FILE
100:
101: FILE packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts
102:   CHANGE: import { MultiProviderTokenStore } → import { KeyringTokenStore }
103:   CHANGE: new MultiProviderTokenStore(oauthDir) → new KeyringTokenStore({ secureStore: testSecureStore })
104: END FILE
105:
106: FILE packages/cli/src/auth/oauth-manager-initialization.spec.ts
107:   CHANGE: import + instantiation
108: END FILE
109:
110: FILE packages/cli/src/auth/oauth-manager.refresh-race.spec.ts
111:   CHANGE: import + instantiation
112: END FILE
113:
114: FILE packages/cli/test/auth/gemini-oauth-fallback.test.ts
115:   CHANGE: import + type references
116: END FILE
117:
118: FILE packages/cli/test/ui/commands/authCommand-logout.test.ts
119:   CHANGE: import + instantiation (multiple sites)
120: END FILE
121:
122: FILE packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts
123:   CHANGE: import + instantiation
124: END FILE
125:
126: FILE packages/cli/src/ui/commands/__tests__/profileCommand.bucket.spec.ts
127:   CHANGE: Mock from MultiProviderTokenStore → KeyringTokenStore
128: END FILE
```

---

## Integration Points (Line-by-Line)

| Line(s) | Change | Risk |
|---|---|---|
| 2-3 | Core export swap | All downstream consumers affected |
| 6-7 | CLI re-export swap | CLI-internal consumers affected |
| 14-19 | Shared instance type+construction | Probe-once constraint depends on this |
| 28-33 | authCommand construction (2 sites) | Login/logout/status functionality |
| 40-45 | profileCommand construction (2 sites) | Profile token operations |
| 52-53 | providerManagerInstance construction | Provider initialization |
| 60-61 | oauth-provider-registration type | Registration parameter |
| 64-72 | Delete MultiProviderTokenStore class | Irreversible — git history only reference |
| 79-128 | Test updates | All existing tests must pass after update |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Keep MultiProviderTokenStore "just in case"         // Clean cut, no dead code
[OK]    DO:     Delete it entirely from token-store.ts               // Git history is the archive

[ERROR] DO NOT: Create KeyringTokenStoreV2 or similar                // No parallel versions
[OK]    DO:     KeyringTokenStore is the ONLY TokenStore impl        // Single implementation

[ERROR] DO NOT: Add feature flag to switch between old and new       // No toggles
[OK]    DO:     Unconditional replacement everywhere                  // Clean swap

[ERROR] DO NOT: Leave MultiProviderTokenStore import in any file     // Dead imports
[OK]    DO:     grep -r "MultiProviderTokenStore" to verify zero hits // Complete elimination

[ERROR] DO NOT: Change the TokenStore interface                      // Interface is stable
[OK]    DO:     Only change the implementation and consumers          // Interface preserved

[ERROR] DO NOT: Create new instantiation sites for KeyringTokenStore  // Avoid instance sprawl
[OK]    DO:     Replace existing sites 1:1, prefer shared instance    // Same pattern as before

[ERROR] DO NOT: Update test assertions to match new error messages    // Tests should test behavior
[OK]    DO:     Tests verify token operations work regardless of backend // Implementation-agnostic tests
```
