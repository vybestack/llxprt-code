# PLAN-20260805-ISSUE2928 — Distinguish Keychain denial from absence; degrade once; allow keyring opt-out

Issue: https://github.com/vybestack/llxprt-code/issues/2928

## Problem

`SecureStore` cannot tell "this credential does not exist" from "macOS refused / the user
cancelled". Every failure collapses into "not found", so the existing `classifyError`
(LOCKED / DENIED / TIMEOUT / NOT_FOUND / UNAVAILABLE) never fires on the read path, users
see a misleading "not authenticated" state, and nothing tells LLxprt to stop hammering a
Keychain that will prompt on every call.

## Verified evidence

Read of `Brooooooklyn/keyring-node` `main` (the source of `@napi-rs/keyring`):

- `src/async_entry.rs`, `PasswordTask::compute` -> `Ok(self.inner.get_password().ok())`
  The `.ok()` discards the `OSStatus`.
- `src/async_entry.rs`, `EntryTask::compute`, `TaskKind::DeleteCredential` ->
  `Ok(Some(self.inner.delete_credential().is_ok()))` — same collapse.
- `src/entry.rs` (sync `Entry`) — identical `.ok()` / `.is_ok()`.
- `set_password` / `set_secret` DO propagate: `map_err(anyhow::Error::from)?`.

Empirically confirmed on darwin against the installed binding:

    AsyncEntry('llxprt-nonexistent-test-svc-zzz','nobody').getPassword() -> null
    .deleteCredential() -> false

`@napi-rs/keyring@1.3.0` is installed **and is the latest published version**
(`npm view @napi-rs/keyring versions` ends at 1.3.0). **Upgrading cannot fix the read
path.**

`findCredentials` is not a usable disambiguator: on macOS its `filter_map` calls
`get_generic_password` for *every* account under the service and drops failures with
`if let Ok(...)`, so using it to disambiguate one read would multiply prompts — the exact
storm this issue exists to stop.

## Scope

IN scope:

- Error fidelity everywhere the binding actually surfaces an error (write path, delete
  verification, and cancellation message classification).
- One process-wide state transition that latches the OS keyring unusable after the first
  authorization failure, with exactly one user-visible warning, enforced at the adapter
  boundary (`createGuardedAdapter`) so no consumer can bypass it.
- `LLXPRT_DISABLE_OS_KEYRING=1` plus a settings equivalent, honored at adapter
  construction (and propagated before profile/auth application), with a fail-closed read
  path (R3.5) that keeps v:2 envelopes readable when a file-resident machine secret
  exists and fails with an actionable error otherwise. (The automatic on-disk machine-
  secret mirror originally proposed as a migration invariant — R3.4 — was rejected; see
  "Security trade-off".)

OUT of scope (deferred, requires a dependency/toolchain decision — see "Deferred"):

- Forking, vendoring, or replacing `@napi-rs/keyring` to recover the read-path `OSStatus`.
- The `set_generic_password` find-error fallthrough (issue body item 2) — that code lives
  in the Apple backend inside the Rust dependency and is not reachable from TypeScript.

## Requirements

### R1 — Preserve error fidelity where the binding permits

- **R1.1** Given a keyring operation fails with a genuine user-cancellation error,
  `classifyError` returns `DENIED`, not `UNAVAILABLE`. Today such a message matches no
  heuristic and falls through to `UNAVAILABLE`, which `isFallbackableKeyringReadError`
  treats as degradable — so a cancelled prompt is silently swallowed. The match is
  narrowly targeted (`errsecusercanceled` / `errseccanceled`, and word-boundary
  "user cancel(l)ed" / "cancel(l)ed by the user") rather than a bare "cancel"
  substring: `@napi-rs/keyring` accepts an `AbortSignal` on every method, so
  abort/timeout text such as "request cancelled due to timeout" must NOT latch.
  Additionally, `noteKeyringError` never latches on a Node syscall/errno error
  (`EACCES`, `EPERM`, …), whose message can read as "permission denied" without the
  OS keyring having refused anything.
- **R1.2** Given a keyring **write** fails with `DENIED` or `LOCKED`, the failure is not
  silently converted into an encrypted-fallback write; the R2 transition fires first.
- **R1.3** The read-path limitation is documented in code and in a follow-up issue: a
  denial on `getPassword` is indistinguishable from absence at the binding boundary.

### R2 — One explicit session-level state transition, enforced at the adapter boundary

The latch is enforced at the ONE real chokepoint — `createGuardedAdapter()` in
`default-keyring-adapter.ts`. Every consumer's adapter comes from that factory
(SecureStore, machine-secret, and MCP token storage), and the wrapper checks the
session state before each native call and routes every thrown native error
through the shared `noteKeyringError` (classify + latch) before rethrowing it
unchanged. This closes the gap left by SecureStore-only catch sites: consumers
that hold an adapter directly (machine-secret's `readFromKeyring`/
`persistToKeyringLocked`, MCP's cached module, and SecureStore's own `list()` /
write-verification) can no longer bypass the latch.

- **R2.1** The first `DENIED` or `LOCKED` classification observed from any keyring
  operation latches the OS keyring unusable for the remainder of the process.
  Because the guarded adapter routes every native error through `noteKeyringError`,
  this holds even when the immediate caller swallows the error (machine-secret
  style). `TIMEOUT` does not latch (transient). `UNAVAILABLE` does not latch (no
  backend present means no prompts, and the adapter is already `null`).
- **R2.2** Exactly one user-visible warning is emitted per process, on stderr, so it
  reaches the user regardless of the injected logger (same rationale as
  `emitRuntimeReplacedWarning`).
- **R2.3** After the latch, zero further keyring operations are attempted. Two layers
  enforce this: `SecureStore.getKeyring()` returns `null` before invoking the loader,
  and — for adapters already cached/held by a consumer — `createGuardedAdapter()`
  throws `UNAVAILABLE` before entering native code on every method.
- **R2.4** After the latch, `fallbackPolicy: 'allow'` routes to the encrypted-file
  fallback; `fallbackPolicy: 'deny'` fails with actionable remediation.
- **R2.5** The transition is implemented as a single shared `noteKeyringError`/
  `isOsKeyringSessionDisabled` pair invoked at the adapter boundary — not try/catch
  sprinkled through call sites. `classifyError` was extracted to a dependency-leaf
  module (`classify-error.ts`) so the adapter can import it without a cycle.
  Fail-fast over layered defensive guards, per project convention.
- **R2.6** The latch is distinct from `RUNTIME_REPLACED`, which remains terminal, does
  NOT latch, and must still be rethrown by fallback layers (it is never converted to
  the session `UNAVAILABLE` error).

### R3 — Explicit opt-out

- **R3.1** `LLXPRT_DISABLE_OS_KEYRING=1` makes `createDefaultKeyringAdapter()` return
  `null` **before** importing `@napi-rs/keyring`, so zero Keychain operations occur —
  including for `llxprt-code-machine-secret`.
- **R3.2** A settings equivalent, `security.disableOsKeyring`, is propagated into
  `@vybestack/llxprt-code-storage` via an explicit setter invoked during CLI
  configuration finalization **before any profile/auth application** (storage is a
  low-level package and must not read CLI settings directly). Moving it ahead of the
  profile auth wiring avoids a startup Keychain prompt for a user who sets the flag.
  The env var stays independent (read directly in storage, zero CLI involvement).
- **R3.3** Every consumer honors it. All three obtain their adapter from the same factory:
  `SecureStore` (`keyringLoaderFn`), `machine-secret.ts` (`loadKeyring`), and MCP
  `keychain-token-storage.ts` (`defaultKeytarLoader`). The factory is the single chokepoint;
  no per-consumer plumbing is required beyond verifying it.
- **R3.4** **REMOVED (machine-secret mirror rejected).** The original plan proposed
  mirroring the resolved machine secret to a 0600 on-disk file whenever a v:2 fallback
  envelope was written, so a later switch into disabled mode would not orphan the
  envelope. That mirror is **not delivered**: it placed the keychain-resident root of
  trust on disk, was fail-open on persistence failure, could install a mismatched/stale
  secret, and raced other writers. Migration safety now rests on R3.6 and R3.5: users who
  need to read a v:2 envelope in disabled mode must keep a file-resident machine secret
  (e.g. written explicitly), and a missing secret fails closed with an actionable error.
- **R3.6** While the OS keyring is disabled (latched or opted out), the fallback WRITE
  path MUST NOT mint a replacement machine secret when a v:2 envelope already exists.
  A keychain-resident secret may be present but unreachable; generating a replacement
  would permanently orphan every envelope sealed under the real one, and the newly
  written envelopes would themselves become unreadable on the next healthy start.
  `loadMachineSecretForWrite` therefore resolves read-only while disabled and refuses
  with an actionable `UNAVAILABLE` error if any v:2 envelope would be orphaned. Minting
  is still permitted when there is nothing to orphan, so a first-time opt-out user gets
  a normal v:2 file-backed store rather than a silent v:1 downgrade.
- **R3.5** In disabled mode, a v:2 envelope that cannot be decrypted because no file
  secret exists MUST NOT cause a new secret to be minted. It fails with an actionable
  typed error naming the cause and the concrete remedy (re-enable the OS keyring, re-save
  the key, or restore the machine-secret file). The read path already passes
  `generateIfMissing: false`; this requirement is about the message being actionable.

## Security trade-off: the machine-secret mirror was rejected (not delivered)

The original R3.4 proposed mirroring the machine secret to a 0600 on-disk file whenever
a v:2 fallback envelope was written. That approach was **rejected and removed**:

- It placed the keychain-resident root of trust on disk, eroding the offline-theft
  property (a stolen data directory should yield no decryptable v:2 files).
- Persistence failure was fail-open: the envelope write still succeeded, silently
  leaving a later disabled-mode read unable to decrypt.
- It could install a mismatched/stale secret (an in-memory secret from one source
  written to a shared default path), and it raced other writers.

As delivered, no machine secret is ever written to disk as a side effect of a fallback
write. Users retain today's offline-theft property: a healthy keyring writes nothing
machine-secret-related to disk, and a stolen data directory yields no decryptable v:2
files. The cost is that a v:2 envelope written under a healthy keyring cannot be
decrypted in disabled mode unless the same machine secret is independently available
on disk — and that case fails closed with an actionable error (R3.5) rather than
silently or by minting a new root of trust.

## Test plan (behavioral, bun:test, no mock theater)

All new/changed tests are `bun:test` under `packages/storage/test-bun/`
(`secure-store.keyring-session.bun.ts`). Tests drive the public API (`SecureStore`,
`createDefaultKeyringAdapter`, `getMachineSecret`, `createGuardedAdapter`) with an
injected `KeyringAdapter` that throws realistic native error messages. A counting
adapter is used where "zero keyring operations" is itself the specification
(R2.3, R3.1) — there, a counting adapter is the only way to observe the behavior. Each
strengthened case is written so it would FAIL if the corresponding production logic were
deleted (e.g. the post-latch second-op cases use a FRESH counting adapter and assert zero
calls, so they cannot pass merely by hitting the same denied adapter again).

### R1 — error fidelity

1. `classifyError` via observable behavior: a `get()` whose adapter throws
   `User canceled the operation.` throws a `SecureStoreError` with code `DENIED` instead
   of returning `null`.
2. Same for `errSecUserCanceled`-worded and `Cancelled` (British) variants.
3. A `NOT_FOUND`-worded error still degrades to the fallback file (no regression).
4. `UNAVAILABLE` ("access platform storage") still degrades (no regression).
5. **R1.1:** `"The request was cancelled due to timeout."` classifies as `TIMEOUT`
   (NOT `DENIED`), does NOT latch, and a subsequent op still reaches the adapter.
6. **R1.1:** `"User canceled the operation."` DOES latch (genuine user cancellation).

### R2 — process-wide latch

7. First `DENIED` from a write latches: a second `get()` on a NEW `SecureStore` instance
   sharing the process performs zero adapter calls (counting adapter asserts 0).
8. Exactly one stderr warning across three failing operations.
9. After latch with `fallbackPolicy:'allow'`, a SECOND op on a fresh counting adapter
   performs ZERO adapter calls, and a `set()`/`get()` round-trips through the fallback.
10. After latch with `fallbackPolicy:'deny'`, a SECOND op on a fresh counting adapter
    performs ZERO adapter calls AND throws `UNAVAILABLE` (the post-latch code) with a
    concrete remediation — not the original `DENIED`.
11. `TIMEOUT` does NOT latch: a subsequent operation still calls the adapter.
12. `UNAVAILABLE` does NOT latch.
13. `RUNTIME_REPLACED` still propagates as `RUNTIME_REPLACED` (not absorbed, not
    converted to the session `UNAVAILABLE` error), does NOT latch, and a subsequent op on
    a counting adapter still reaches native code.

### R2 — latch at the adapter boundary

14. A guarded adapter obtained from `createGuardedAdapter` and held across a latch throws
    `UNAVAILABLE` BEFORE native entry on its second call (zero further native calls), with
    a remediation naming the concrete remedy (restart).
15. An error raised through the guarded adapter latches the session even when the caller
    swallows it (machine-secret style) — proving the chokepoint closes the SecureStore-only
    gap.

### R3 — explicit opt-out

16. With `LLXPRT_DISABLE_OS_KEYRING=1`, `createDefaultKeyringAdapter()` resolves `null`.
17. With the flag set, a full `SecureStore` set/get/delete round-trip uses the fallback
    file and the injected counting keyring loader is never invoked.
18. With the flag set, `getMachineSecret()` resolves from the file only; an injected
    counting keyring loader (delegating to the real factory) records zero native/adapter
    calls on both the generating and read-only paths.
19. The env var and the setting are independent opt-out paths ORed together: either one
    alone disables the keyring, and with neither set the session is enabled.
20. **Migration (post-R3.4-removal):** a v:2 envelope written while a file-resident
    machine secret exists is still readable in disabled mode — a genuine round-trip
    through the opt-out, not a file-existence check.
21. **R3.5:** in disabled mode with a v:2 envelope and no file secret, `get()` throws a
    `CORRUPT` error whose remediation names a concrete remedy (re-enable/re-save/restore),
    and the machine-secret file is NOT created.

## Deferred

Read-path `OSStatus` fidelity requires forking/vendoring/replacing `@napi-rs/keyring`
(Rust toolchain plus prebuilt binaries for darwin-arm64/x64, linux-x64/arm64 gnu+musl,
win32-x64/arm64). That is a dependency + build + CI change and is tracked in issue #3067.
Once such a binding exists it plugs in behind `createDefaultKeyringAdapter()` without
touching any call site, because every consumer already routes through that factory.
