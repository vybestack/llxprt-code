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
| R15.2 | Both paths have equivalent test coverage (env-var–driven dual-mode) | P05 (test strategy: tests read `LLXPRT_SECURE_STORE_FORCE_FALLBACK` to select keytarLoader), P11 (CI enforcement: add `secure-store-mode` matrix dimension to `.github/workflows/ci.yml`) |
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
| R17.8 | CI exercises keyring + fallback paths | P05 (test env-var support only), P11 (CI enforcement: add `secure-store-mode` matrix dimension to `.github/workflows/ci.yml` + verification) |
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
