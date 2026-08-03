# PLAN-20260801-ISSUE2927 — Non-destructive credential write verification + per-item write lock

Issue: https://github.com/vybestack/llxprt-code/issues/2927

## Problem

`SecureStore.set()` treats a read-back mismatch as "stale contamination" and
**deletes the OS keychain item**. Under concurrent writes from two LLxprt
processes this destroys the winner's credential (silent credential loss) and,
because delete+re-add creates a brand-new keychain object with a default ACL,
it also discards every accumulated access grant.

Destructive call chain today (`packages/storage/src/secure-store/`):

- `secure-store.ts::set()` → `verifyKeyringWrite()` → `hasStaleValue: true`
  - `fallbackPolicy: 'allow'` → `writeFallbackAndClearStale()` →
    `clearMismatchedKeyringValue()` → `adapter.deletePassword()`
  - `fallbackPolicy: 'deny'` → `safeClearStaleKeyring()` →
    `clearMismatchedKeyringValue()` → `adapter.deletePassword()`

## Requirements

- **R1** — No code path deletes a keychain item solely because a read-back
  mismatched. `clearMismatchedKeyringValue` is removed outright.
- **R2** — A read-back mismatch is reported to the caller as a single explicit
  conflict. The observed winner is left intact and the fallback file is **not**
  substituted for a value another process owns.
- **R3** — Credential writes and deletes are serialized per keychain item by a
  cross-process advisory lock keyed on `service` + `account`, covering provider
  keys, tool keys, OAuth tokens, extension settings, and the machine secret.
- **R4** — The lock root is derived from stable, version-independent path
  authority so mixed-version fleets serialize against the same files.
- **R5** — A concurrent-write scenario ends with exactly one value present and
  zero deletions.

## Design

### D1 — `keyring-write-verification.ts`

Replace the `{ verified, hasStaleValue }` pair with a discriminated outcome and
delete the destructive helper:

```ts
export type KeyringWriteOutcome =
  | { readonly outcome: 'verified' }
  | { readonly outcome: 'conflict' }
  | { readonly outcome: 'unverified' };

export async function verifyKeyringWrite(
  adapter: KeyringAdapter,
  serviceName: string,
  key: string,
  expected: string,
): Promise<KeyringWriteOutcome>;
```

- read-back equals `expected` → `verified`
- read-back is a different **non-null** value → `conflict`
- read-back is `null`, or the read throws → `unverified`

`clearMismatchedKeyringValue` is **deleted**. The observed foreign value is
never returned or logged (no secret material may escape into logs).

### D2 — `secure-store-errors.ts`

Add a `CONFLICT` code to `SecureStoreErrorCode`, with remediation
`'Retry the operation; another process wrote this credential concurrently'`.
`CONFLICT` is a distinct, explicit identity so callers can distinguish "your
write lost a race" from "the keyring is broken" (`UNAVAILABLE`).

### D3 — `secure-store.ts::set()`

Delete `safeClearStaleKeyring` and `writeFallbackAndClearStale`. New outcome
handling after a successful `setPassword`:

| outcome      | behavior                                                                             |
| ------------ | ------------------------------------------------------------------------------------ |
| `verified`   | record success, delete stale fallback files, return (unchanged)                       |
| `conflict`   | record failure, **throw `CONFLICT`** — no delete, no fallback write, winner untouched |
| `unverified` | record failure, existing behavior: fallback file (`allow`) / `UNAVAILABLE` (`deny`)   |

### D4 — `credential-write-lock.ts` (new)

A cross-process advisory lock in `packages/storage/src/secure-store/`.

**Why a storage-local implementation rather than reusing
`packages/auth/src/lock-owner.ts`:** `packages/auth` is a deliberate
zero-dependency leaf — `packages/auth/src/__tests__/package-boundary.test.ts`
asserts `auth package.json has NO @vybestack/* in dependencies`. `storage`
sits below `auth` in the workspace DAG, so `auth` cannot import it and
`storage` cannot import `auth`. The record format is kept byte-compatible with
the auth lock records so the two lock families remain interchangeable if the
boundary is ever revisited.

Protocol (mirrors the fenced O_EXCL owner protocol already proven in
`keyring-token-store.ts`):

1. Owner record: `{ version, ownerToken, pid, hostname, startTimeMs, startTimeSource }`,
   published via a same-directory temp file + `fs.link()` (atomic, never
   replaces an existing owner).
2. On `EEXIST`: read the incumbent record and probe liveness (hostname match →
   `process.kill(pid, 0)` → canonical start-time comparison via `ps -o lstart=`).
   Only a **provably dead** owner is reclaimed, and only through a fenced
   takeover (`<lock>.fence` O_EXCL winner re-reads the lock, requires exact
   content equality with the inspected dead record, re-probes liveness, then
   unlinks). A successor is never deleted.
3. Bounded randomized/exponential backoff while waiting.
4. Release unlinks only if the on-disk `ownerToken` still matches ours.

Public surface:

```ts
export class CredentialWriteLock {
  constructor(options: { lockDir: string; waitMs?: number; logger?: StorageLogger });
  withLock<T>(service: string, account: string, operation: () => Promise<T>): Promise<T>;
}
```

- **Lock path** — `join(lockDir, 'cred-' + sha256(service + '\0' + account).slice(0, 32) + '.lock')`.
  Deterministic, filesystem-safe, collision-resistant, and identical across
  versions and platforms. It does **not** embed a version, package version, or
  process identity (R4).
- **Lock root** — `Storage.getCredentialLocksDir()` (new) =
  `join(Storage.getGlobalLogDir(), 'secure-store', 'locks')`. Same category as
  `getOAuthLocksDir()`: non-secret ephemeral runtime state, env-override aware
  (`LLXPRT_LOG_HOME` → `LLXPRT_CONFIG_HOME` → platform log dir), stable across
  versions.
- **In-process serialization** — a per-lock-path promise chain, because an
  O_EXCL file lock cannot be re-acquired by the process that already holds it.
  Two concurrent `set()` calls in one process for the same key must serialize
  in memory rather than self-deadlock.
- **Fail-closed on-timeout** — if the lock cannot be acquired within `waitMs`
  (default `5_000`), throw a `SecureStoreError` with code `TIMEOUT`. The
  mutating callback is NEVER invoked without ownership — proceeding unlocked
  would permit overlapping set/set and set/delete on the same keychain item,
  which is exactly the unserialized mutation this lock exists to eliminate.
  This is safe with respect to stuck locks: `probeOwnerLiveness` checks
  `process.kill(pid, 0)` and returns `dead` on ESRCH before consulting
  `startTimeSource`, so a crashed owner's lock is reclaimable via the fenced
  takeover on every platform including Windows. The only non-reclaimable
  cases are a live process legitimately holding the lock, a PID recycled to
  another live process, or an owner on a different hostname — in all of
  those, refusing the write and telling the user is the correct, honest
  outcome.

### D5 — Integration points

- `SecureStore` gains a `lockDir?: string` option (default
  `Storage.getCredentialLocksDir()`), constructs one `CredentialWriteLock`, and
  wraps the **entire body** of `set()` and `delete()` in
  `withLock(this.serviceName, key, ...)`. The verification read-back therefore
  happens under the lock ("re-read under the lock, update in place").
  `assertRuntimeNotReplaced()` and `validateKey()` stay **outside** the lock so
  invalid input and a replaced runtime fail before any lock file is created.
- `machine-secret.ts::persistToKeyring` takes the same lock for
  (`llxprt-code-machine-secret`, `default`). `MachineSecretOptions` gains
  `lockDir?: string` for deterministic tests. No self-deadlock: the machine
  secret's lock path differs from any `SecureStore` item path, and
  `getMachineSecret` never calls back into `SecureStore.set()`.
- The four `new SecureStore(...)` construction sites (tool keys, auth
  factories, extension settings, provider keys) need no change — they inherit
  the default lock dir.

## Test plan (behavioral, written first)

### T1 — `keyring-write-verification.test.ts` (new)

1. read-back equal → `verified`.
2. read-back different non-null → `conflict`, and `deletePassword` is never
   invoked on the adapter.
3. read-back `null` → `unverified`.
4. read-back throws → `unverified`.
5. The module exports no delete/clear helper (regression guard for R1).

### T2 — `secure-store.spec.ts` (rewrite the four stale-value tests)

Replace the existing `allow`/`deny`/`could not be removed`/`deletePassword
throws` tests, which all assert the removed destructive behavior:

1. mismatch + `fallbackPolicy: 'allow'` → rejects with `SecureStoreError` code
   `CONFLICT`; `deletePassword` call count is `0`; the foreign keyring value is
   unchanged; **no** fallback file exists.
2. mismatch + `fallbackPolicy: 'deny'` → same assertions.
3. A subsequent `get()` returns the foreign winner (the winner is readable, not
   destroyed).
4. Read-back `null` still writes the fallback (`allow`) — unchanged behavior
   must not regress.
5. Read-back throws still writes the fallback (`allow`) — unchanged.

### T3 — `credential-write-lock.test.ts` (new)

1. Two `CredentialWriteLock` instances sharing one lock dir: overlapping
   `withLock` calls for the same (service, account) never interleave — the
   second operation observes the first as complete.
2. Different (service, account) pairs run concurrently (no false sharing).
3. Same-process re-entrant/overlapping `withLock` calls on one instance
   serialize instead of deadlocking.
4. The lock file is removed after `withLock` resolves **and** after it rejects.
5. A lock file owned by a still-running child process is not stolen; after that
   child exits, the lock is recovered via the fenced takeover. (Spawn a real
   child with `spawn(process.execPath, ['-e', ...])` that writes a canonical
   owner record for its own pid/hostname/start time — mirrors the existing
   pattern in `packages/auth/src/__tests__/keyring-token-store.lock-behavior.test.ts`.)
6. A lock held by an unreachable owner past `waitMs` causes `withLock` to
   proceed unlocked rather than throw.
7. Lock path derivation is stable: the same (service, account) yields the same
   filename across instances, and the filename contains neither the raw service
   nor the raw account.

### T4 — `secure-store.concurrent-write.test.ts` (new — acceptance, R5)

Two independently constructed `SecureStore` instances (independent
`CredentialWriteLock` instances with distinct owner tokens, shared lock dir)
write **different** values to the **same** key against one shared fake keyring
adapter that records every `setPassword`/`getPassword`/`deletePassword` call
and inserts an artificial delay between write and read-back to force
interleaving.

Assertions:

- `deletePassword` was called **zero** times.
- The fake keychain holds **exactly one** value for the key, and it is one of
  the two written values.
- No process silently believes it wrote a value that is not present: whichever
  instance did not win either resolves after the other (serialized, so its
  value is the one present) or rejects with `CONFLICT`.

### T5 — `machine-secret` concurrency

Two concurrent `getMachineSecret()` resolutions against a shared fake keyring
converge on one persisted secret with zero `deletePassword` calls.

## Constraints

- No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`; no
  lint-severity downgrades; no complexity/size threshold increases; no
  `ignores:` additions. Fix the underlying issue instead.
- Fail fast over defense in depth: no speculative try/catch swallows. The
  documented exceptions here are genuinely external I/O — keyring backend calls
  and filesystem lock races.
- No secret material in log output or error messages.
- Strict TypeScript; no `any`; explicit return types.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, then
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
