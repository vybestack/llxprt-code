# Issue #1985 — Harden secure-store fallback: `delete()` error swallowing and `has()` fallback semantics

Plan ID: `PLAN-20260803-ISSUE1985`

## Context

`packages/storage/src/secure-store/secure-store.ts` was moved verbatim from
`packages/core` in PR #1982. Two pre-existing behaviors were deliberately left
untouched to keep that move diff behavior-identical:

1. `deleteLocked()` catches every error from `adapter.deletePassword()` with an
   empty `catch {}`. The caller is told the delete succeeded (or simply "nothing
   was deleted") even though the keyring entry may still exist. A secret that
   the user asked to remove can silently survive.
2. `has()` throws a `SecureStoreError` for every keyring-read error classification
   other than `NOT_FOUND`, while `get()` treats `UNAVAILABLE`, `NOT_FOUND` and
   `TIMEOUT` as fallbackable and continues to the encrypted fallback file. A
   transient keyring hiccup therefore makes `has()` throw where `get()` would
   have succeeded from the fallback file.

## Scope

In scope — and only this:

- `deleteLocked()` in `packages/storage/src/secure-store/secure-store.ts`.
- `has()` in the same file.
- A single shared classification predicate used by `get()` and `has()` so the
  two cannot drift again.
- Behavioral tests covering the above.

Explicitly out of scope (do not touch):

- `set()`, `list()`, `isKeychainAvailable()`, envelope/KDF code, the write lock,
  the machine secret, the keyring adapter, path resolution.
- Consecutive-failure tracking (`recordKeyringFailure`) for `delete()`/`has()`.
  Those methods do not participate in failure tracking today; wiring them in
  changes probe-cache invalidation behavior, which is a separate concern.
- Callers in `packages/core/src/tools/tool-key-storage.ts` and
  `packages/auth/src/keyring-token-store.ts`. Both already catch
  `SecureStoreError` from `delete()`, so no caller change is required.

## Acceptance criteria

### AC-1 — `delete()` surfaces keyring delete failures

- **AC-1.1** When the keyring adapter's `deletePassword()` throws an error that
  classifies as anything other than `NOT_FOUND`, `delete(key)` rejects with a
  `SecureStoreError` whose `code` is the classified code and whose
  `remediation` is the remediation for that code. It must not return a boolean.
  - Representative inputs: `new Error('Keyring locked')` → `LOCKED`;
    `new Error('Permission denied')` → `DENIED`;
    `new Error('Operation timed out')` → `TIMEOUT`;
    `new Error('dbus connection refused')` → `UNAVAILABLE`.
- **AC-1.2** Before rejecting, `delete()` still removes the encrypted fallback
  file(s) for that key (current and legacy paths). Surfacing the keyring failure
  must not leave a local encrypted copy behind.
- **AC-1.3** When `deletePassword()` throws an error that classifies as
  `NOT_FOUND` (message contains `not found`, or an `ENOENT` `code`), `delete(key)`
  does **not** reject. The keyring simply had nothing to remove; the return value
  is driven by whether a fallback file was deleted.
- **AC-1.4** Unchanged behavior: `deletePassword()` returning `false` without
  throwing is not an error; `delete()` returns
  `deletedFromKeyring || deletedFromFile`.
- **AC-1.5** Unchanged behavior: when no keyring adapter loads (`adapter === null`),
  `delete()` never rejects for keyring reasons and returns the fallback result.
- **AC-1.6** The keyring delete failure is emitted through the injected logger's
  `debug` channel (the current `catch {}` is silent).

### AC-2 — `has()` matches `get()`'s fallback classification

- **AC-2.1** When `getPassword()` throws an error classifying as `TIMEOUT`,
  `has(key)` does not reject; it falls through to the encrypted fallback file
  check and returns `true` when a fallback file exists for the key.
- **AC-2.2** Same as AC-2.1 for `UNAVAILABLE`, and it returns `false` when no
  fallback file exists.
- **AC-2.3** `NOT_FOUND` continues to fall through to the fallback check
  (unchanged).
- **AC-2.4** Classifications outside the fallbackable set — `LOCKED`, `DENIED`,
  `CORRUPT` — continue to reject with a `SecureStoreError` carrying that code.
- **AC-2.5** The legacy (unencoded) fallback path is still consulted when the
  encoded path is absent, including on the fallback-through paths added by
  AC-2.1/AC-2.2.
- **AC-2.6** `get()` and `has()` derive "is this keyring error fallbackable?"
  from one shared predicate, so the two cannot diverge again. `get()`'s
  externally observable behavior is unchanged.

## Test plan (tests first)

New Bun-native behavioral test file:
`packages/storage/test-bun/secure-store.fallback-hardening.bun.ts`,
registered in `scripts/bun-test-manifest-data-storage.ts`.

Tests drive the real `SecureStore` against injected `KeyringAdapter` fakes and a
real temp `fallbackDir` — no mocking of the unit under test, no assertions on
mock invocation counts.

| Test | AC |
| --- | --- |
| `delete()` rejects with `LOCKED` when `deletePassword` throws "Keyring locked" | AC-1.1 |
| `delete()` rejects with `DENIED` / `TIMEOUT` / `UNAVAILABLE` for the matching messages | AC-1.1 |
| Rejected `delete()` leaves no `.enc` fallback file for the key on disk | AC-1.2 |
| Rejected `delete()` also removes the legacy unencoded `.enc` path (non-Windows) | AC-1.2 |
| `delete()` resolves when `deletePassword` throws "credential not found" and reports the fallback result | AC-1.3 |
| `delete()` returns `false` when `deletePassword` resolves `false` and no fallback file exists | AC-1.4 |
| `delete()` returns `true` from the fallback file alone when no keyring adapter loads | AC-1.5 |
| `has()` returns `true` from the fallback file when `getPassword` throws a TIMEOUT-classified error | AC-2.1 |
| `has()` returns `false` when `getPassword` throws an UNAVAILABLE-classified error and no fallback file exists | AC-2.2 |
| `has()` returns `true` from the fallback file when `getPassword` throws an UNAVAILABLE-classified error | AC-2.2 |
| `has()` rejects with `LOCKED` when `getPassword` throws "Keyring locked" | AC-2.4 |
| `has()` rejects with `DENIED` when `getPassword` throws "Permission denied" | AC-2.4 |
| `has()` finds a legacy unencoded fallback file after an UNAVAILABLE keyring error (non-Windows) | AC-2.5 |

Existing test to update (its name encodes the old contract):
`packages/storage/src/secure-store/secure-store.basic.test.ts` —
`has() throws SecureStoreError on non-NOT_FOUND keyring errors`. The assertion
(LOCKED still throws) stays correct; only the description needs to reflect the
new "non-fallbackable" wording.

## Implementation sketch

- Extract a module-level predicate next to `classifyError`:

  ```ts
  function isFallbackableKeyringReadError(code: SecureStoreErrorCode): boolean {
    return code === 'UNAVAILABLE' || code === 'NOT_FOUND' || code === 'TIMEOUT';
  }
  ```

  Use it in `get()` (replacing the inlined triple comparison) and in `has()`.
- In `deleteLocked()`, capture the thrown error instead of swallowing it, log it
  at `debug`, run `deleteFallbackFiles(key)` unconditionally, then rethrow as a
  `SecureStoreError` unless the classification is `NOT_FOUND`.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

---

## Review remediation (accepted findings)

The following review findings were accepted and remediated. They extend — never
contradict — the ACs above. Each is tied to a behavioral test that fails when
the production change is reverted.

### AC-3 — `classifyError()` preserves a structured `SecureStoreError.code`

- **AC-3.1** When an error already thrown by the store is a `SecureStoreError`,
  `classifyError()` returns its own `.code` directly, before applying the
  message heuristics. This is required because the message of a
  `runtimeReplacedError()` contains none of the heuristic keywords
  (`locked`/`denied`/`permission`/`timeout`/`not found`) and would otherwise be
  downgraded to `UNAVAILABLE`.
- **AC-3.2** `has()` rejects with code `RUNTIME_REPLACED` (not `UNAVAILABLE`)
  when the guarded keyring adapter throws `runtimeReplacedError()` from
  `getPassword`, and a valid fallback file on disk is **not** consulted.
- **AC-3.3** `delete()` rejects with code `RUNTIME_REPLACED` (not `UNAVAILABLE`)
  when the guarded keyring adapter throws `runtimeReplacedError()` from
  `deletePassword`, so `isRuntimeReplacedError()` still identifies it in
  callers. `RUNTIME_REPLACED` is a terminal identity that fallback/swallow
  layers must rethrow, never absorb.
- **AC-3.4** `CORRUPT` is likewise preserved: a `SecureStoreError('…','CORRUPT',…)`
  thrown by `getPassword` makes `has()` reject with `CORRUPT` instead of
  falling back to the file, even when a valid fallback file exists.

### AC-4 — `ToolKeyStorage.deleteKey()` still cleans up its own `.key` file

`ToolKeyStorage` owns an encrypted `.key` file that is a **different store**
from SecureStore's fallback `.enc` file. A keyring delete failure
(`LOCKED`/`DENIED`/`TIMEOUT`/`CORRUPT`/`CONFLICT`) must not skip removing it.

- **AC-4.1** When `SecureStore.delete()` rejects with a non-`UNAVAILABLE`,
  non-`RUNTIME_REPLACED` `SecureStoreError`, `ToolKeyStorage.deleteKey()` still
  removes its own encrypted `.key` file from disk **and** the rejection still
  propagates with the original code.
- **AC-4.2** `RUNTIME_REPLACED` still throws immediately without touching files
  (the terminal-runtime invariant is unchanged).
- **AC-4.3** `UNAVAILABLE` is still swallowed and the `.key` file is still
  removed (pre-existing best-effort policy, unchanged).

### Comment correction (AC-1.2 wording)

The `deleteLocked()` comment no longer over-claims that "a local encrypted copy
never survives a delete". `deleteFallbackFiles()` swallows every non-`ENOENT`
unlink failure, so that guarantee is false. The comment now states only what is
true: fallback cleanup is **attempted** regardless of the keyring outcome, so a
failed keyring delete does not *additionally* leave the encrypted local copy
behind. `deleteFallbackFiles()` behavior is unchanged (out of scope).

## Test additions for the accepted findings

`packages/storage/test-bun/secure-store.fallback-hardening.bun.ts` (extended,
shared helpers reused — no setup duplication):

| Test | AC |
| --- | --- |
| AC-1.6: a recording `StorageLogger` captures the failed keyring delete key + classification | AC-1.6 |
| `has()` rejects with `CORRUPT` and does not fall back to a valid fallback file | AC-3.4 (AC-2.4 `CORRUPT`) |
| `has()` rejects with `RUNTIME_REPLACED` and does not consult a valid fallback file | AC-3.2 |
| `delete()` rejects with `RUNTIME_REPLACED`, identifiable by `isRuntimeReplacedError()` | AC-3.3 |

`packages/core/src/tools/tool-key-storage.test.ts` (extended):

| Test | AC |
| --- | --- |
| `deleteKey()` removes its `.key` file **and** propagates `LOCKED` when `SecureStore.delete()` rejects with `LOCKED` | AC-4.1 |

## Rejected / deferred review findings (do NOT implement)

These reviewer suggestions were explicitly rejected or deferred. Rationale is
recorded so they are not re-suggested.

- **Deferred — `@napi-rs/keyring` native error mapping.** The native binding
  maps some errors to `false`/absence rather than throwing, so a failed delete
  can look like "nothing to delete". Patching/pinning/vendoring the native
  dependency is a major scope expansion requiring separate approval. Filed as a
  follow-up issue. `default-keyring-adapter.ts` behavior is unchanged.
- **Rejected — remove the `NOT_FOUND` carve-out in `deleteLocked()`.** `NOT_FOUND`
  = "the keyring had nothing to delete" is the correct idempotent semantic and
  matches `get()`/`has()`. Removing it would make deleting an absent key throw.
- **Rejected — surface `deleteFallbackFiles()` unlink failures.** That is
  pre-existing behavior outside this issue. Only the over-claiming comment was
  corrected (AC-1.2 wording). Changing the swallow would be a separate concern.
- **Deferred — swallowing of `UNAVAILABLE` in `ToolKeyStorage.deleteKey()`,
  `KeyringTokenStore.removeToken()`, and `credential-proxy-server.ts`.**
  Best-effort `UNAVAILABLE` swallowing is pre-existing policy; changing it is a
  separate issue. (Note: `RUNTIME_REPLACED` is *not* swallowed — it rethrows.)
- **Rejected — add `recordKeyringFailure()`/`recordKeyringSuccess()` to
  `delete()`/`has()`.** Those methods do not participate in failure tracking
  today; wiring them in changes probe-cache invalidation behavior (separate
  concern).
- **Out of scope — `set()`, `list()`, `isKeychainAvailable()`, envelope/KDF
  code, the write lock, the machine secret.** Untouched.

## Open Code Review triage (local run 1)

`ocr review --audience agent --timeout 20` — 6 files reviewed, 4 findings
(two of which are duplicates of the same comment). All four are **Rejected**;
no code change resulted.

- **Rejected (2× duplicate, "bug/high") — "`tool-key-storage.test.ts` throws a
  plain `Error('Keyring locked')`, so `expect(error).toBeInstanceOf(SecureStoreError)`
  will fail; make the fake throw a `SecureStoreError`."** Factually incorrect:
  it misreads the layering. The plain `Error` is thrown by the injected
  *keyring adapter*, which `SecureStore.deleteLocked()` catches, classifies as
  `LOCKED`, and rethrows as a genuine `SecureStoreError`. `deleteKey()`
  therefore receives a `SecureStoreError`. Empirically disproven: the test
  passes (56 tests, 55 pass / 1 skip / 0 fail). Making the fake throw a
  `SecureStoreError` directly would *weaken* the test by bypassing the
  classification path that is the subject of this issue.
- **Rejected ("test/medium") — "add a `delete()` RUNTIME_REPLACED variant that
  also seeds a fallback file, to cover AC-1.2."** `deleteLocked()` has no
  per-code branch other than the `NOT_FOUND` carve-out, so a `RUNTIME_REPLACED`
  seed-and-assert variant re-executes exactly the same production statements as
  the existing `LOCKED` (current path) and `DENIED` (legacy path) AC-1.2 tests.
  It is a permutation of an already-covered branch, not new coverage.
- **Rejected ("bug/medium") — "wrap `deleteFallbackFiles()` in try/catch in
  `deleteLocked()` so a throw there cannot lose the keyring failure."**
  Unreachable. `deleteFallbackFiles()` swallows every non-`ENOENT` `unlink`
  error, and its only other throw source is `validateKey()`, which `delete()`
  already ran before acquiring the lock. Adding the guard would be unreachable
  defensive code and speculative hardening explicitly excluded from this issue.

## Verification results (candidate head)

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0, no findings |
| `npm run typecheck` | exit 0 |
| `npx prettier --check .` | "All matched files use Prettier code style!" |
| `npm run test` | exit 0 |
| `npm run build` | exit 0 |
| `packages/storage/test-bun/secure-store.fallback-hardening.bun.ts` | 18 pass / 2 skip (win32 legacy path — `:` is illegal in Windows filenames; runs on Linux/macOS CI) / 0 fail |
| `packages/core/src/tools/tool-key-storage.test.ts` | 55 pass / 1 skip / 0 fail |
| stepfun-37 haiku smoke | not runnable in this environment (profile not configured); fails at profile load before reaching any code under test |

Pre-existing Windows-only failures observed during `npm run test`, all unrelated
to this change and none in a secure-store suite: `credential-write-lock.bun.ts`
(shells out to Unix-only `ps -o lstart=`), the credential-proxy socket suites
(Windows unix-socket timeouts), `resumeSession` property tests, and the
`getPty` backend-loading tests.
