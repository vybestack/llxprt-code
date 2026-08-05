# Issue #3011 — Detect native delete failures erased into `false`

## Problem

`packages/storage/src/secure-store/default-keyring-adapter.ts` returns the
result of `@napi-rs/keyring`'s `AsyncEntry.deleteCredential()` straight through:

    deletePassword: async (service, account) => {
      const entry = new kr.AsyncEntry(service, account);
      return entry.deleteCredential();
    },

The native binding computes that boolean as `self.inner.delete_credential().is_ok()`,
so **every** backend error is collapsed into `false` — the same value it returns
when there was simply no credential to delete. A genuinely failed delete is
therefore indistinguishable from a no-op, and `SecureStore.delete()` reports
success while the secret survives in the OS keyring.

Confirmed upstream at `Brooooooklyn/keyring-node` (issue 137, PR 138). The same
erasure affects `getPassword`/`getSecret` via `.ok()`.

### Correction to the issue text (verified)

Issue #3011 says "at least one platform provider discards the result of the
underlying delete entirely". This **is** substantiated — on macOS the delete
status is destroyed below the binding at three layers:

1. `security-framework-3.7.0/src/os/macos/passwords.rs:81` —
   `pub fn delete(self) { unsafe { SecKeychainItemDelete(self.as_concrete_TypeRef()); } }`
   returns `()`, discarding the `OSStatus` entirely.
2. `apple-native-keyring-store-1.0.1/src/keychain.rs:87-93` —
   `fn delete_credential(&self) -> Result<()> { ... item.delete(); Ok(()) }`
   — unconditionally `Ok`.
3. `@napi-rs/keyring` — `.is_ok()` → `true`.

So on macOS `deleteCredential()` resolves **`true`** even when the OS refused
the delete. This is distinct from the generic `.is_ok()` erasure on other
platforms (Linux/Windows), where a failed delete collapses to `false`.

**Consequence:** upstream binding PR `Brooooooklyn/keyring-node#138` cannot fix
macOS delete, because the error is destroyed *below* the binding (in the Rust
`apple-native-keyring-store` and `security-framework` crates). Propagating the
`OSStatus` from the binding would require the intermediate crates to stop
discarding it first.

## Dependency on PR #3010 (READ THIS FIRST)

`SecureStore.deleteLocked()` on `main` still swallows adapter rejections:

    try {
      deletedFromKeyring = await adapter.deletePassword(this.serviceName, key);
    } catch {
      // Keyring delete failed
    }

PR #3010 (branch `issue1985`, CI green, **not yet merged**) replaces that bare
`catch` with classification and a rethrow of any non-`NOT_FOUND` failure.

Consequence: the adapter-level fix in this plan is **correct but not
end-to-end observable until #3010 merges**. Until then a thrown delete failure
is still swallowed one layer up. The two changes are textually disjoint —
#3010 does not touch `default-keyring-adapter.ts` and this plan does not touch
`secure-store.ts` — so they will not conflict.

**Do not "fix" `deleteLocked` as part of this work.** That code is owned by
#3010; duplicating it would create a conflict.

## Scope

In scope, and only this:

- `packages/storage/src/secure-store/default-keyring-adapter.ts` — the
  `deletePassword` implementation.
- A new sibling verification module (see below).
- Tests for both.
- Manifest registration for any new bun test file.

Out of scope: `secure-store.ts`, `classifyError`, the fallback file path,
`getPassword`/`getSecret` erasure (upstream's problem; we cannot detect a read
failure locally because the erased value *is* the answer we would probe with),
and vendoring/patching/replacing the native dependency.

## Design

### New module: `keyring-delete-verification.ts`

Mirror the existing `keyring-write-verification.ts` convention — a small,
dependency-light, directly unit-testable module rather than logic buried in the
adapter factory closure.

    export type KeyringDeleteOutcome = 'absent' | 'still-present';

    export async function verifyKeyringDelete(
      readBack: () => Promise<string | null>,
    ): Promise<KeyringDeleteOutcome>;

Taking a `readBack` thunk rather than a `KeyringAdapter` matters: the adapter is
still being constructed inside the factory when this runs, and a thunk is
trivially testable without any native binding.

### Adapter behaviour

The probe runs after **every** delete, regardless of the native boolean. The
macOS three-layer chain (see above) means a `true` result is no guarantee the
credential is gone, so the `if (deleted) return true` fast path is unsafe and
must not be used.

    const deleted = await entry.deleteCredential();
    const outcome = await verifyKeyringDelete(() => entry.getPassword());
    if (outcome === 'still-present') throw <SecureStoreError>;
    return deleted;

Resulting contract for `deletePassword`:

| Result | Meaning |
| --- | --- |
| `true` | the native delete reported success **and** the read-back confirmed the credential is gone |
| `false` | the native delete reported nothing-to-delete **and** the read-back confirmed the credential is gone |
| throws | the credential is still present after the delete (the read-back found it) |

The native `true`/`false` distinction is preserved (not collapsed): it is
returned unchanged when the probe confirms absence. `true` still means "a
credential was deleted"; `false` still means "there was nothing to delete".
The probe is the safety net layered on top, not a replacement for the native
signal.

### Fail-fast on an unreadable probe

If the read-back itself rejects, **let it propagate** — do not catch and do not
degrade to `false`. We cannot confirm the secret is gone, so claiming it is
would be the exact failure this issue exists to prevent. This also matches the
project's stated preference for failing fast over defensive hedging.

Note this branch is nearly unreachable with `@napi-rs/keyring@1.3.0` (its
`getPassword` erases errors to `null` too) but becomes live once upstream
propagates errors, so it is written now rather than retrofitted.

### Error shape

Throw `SecureStoreError` from `./secure-store-errors.js` (a dependency-leaf
module — importing it creates no cycle).

Code: `UNAVAILABLE`. This is deliberate and needs to be understood:
`SecureStore.classifyError()` re-derives the code from the **message text** and
ignores an existing `SecureStoreError.code`, so the message governs behaviour
downstream. The message is a **fixed, interpolation-free string**:

    Credential remains after keyring deletion

The message must avoid the substrings `not found`, `locked`, `denied`,
`permission`, `timeout`, `timed out`. Under PR #3010 only `NOT_FOUND` is
swallowed by `deleteLocked`, but any specific classification changes caller
behaviour, so all triggers are avoided. The message is deliberately
postcondition-phrased ("remains after") rather than causation-phrased: the
delete and the probe are two separate native calls, so a concurrent writer
between them could also produce this state; the message must not assert this
process definitively caused it.

The message must **never** be interpolated with service/account/key names.
`validateKey()` only rejects `/`, ``, `\0`, `.`, and `..` — so a key legally
named `not found` would be interpolated into the message and re-classified as
`NOT_FOUND`, which `deleteLocked` swallows, silently defeating this throw.
Service and account context are emitted to the module's `_keyringLogger` at
debug level instead, so diagnostics are not lost.

**The message must never include the read-back value or any secret material.**
Service and account/key names only (and only in the debug log), consistent with
existing debug logging.

## Known limitation (document, do not try to solve)

Read-back can only detect a failed delete when the credential remains
*readable*. If the backend is failing such that both the delete and the read
return their erased sentinels — a fully locked store, where `getPassword`
yields `null` — the probe sees `null` and reports `absent`, and the failure goes
undetected.

This mitigation closes the "delete refused but item still readable" case (the
macOS silent-failure case where native `true` is returned but the OS refused,
ACL denials on Linux/Windows, partial backend failure) and not the "store
entirely inaccessible" case. It does **not** reliably detect `Ambiguous`
collisions: the read-back performs the same ambiguous lookup, and the binding
erases that read error to `null`, so the probe can report "absent" for a
credential that still exists. `Ambiguous` is therefore excluded from the list
of detected cases. It is a strict improvement, not a complete fix; completeness
requires the upstream change. State this plainly in the PR — do not overclaim.

### Per-platform erasure matrix

| Platform | Delete succeeded | Delete failed (OS refused) | Nothing to delete |
| --- | --- | --- | --- |
| **macOS** | `true` | **`true`** (three-layer discard: `security-framework` → `apple-native-keyring-store` → binding `is_ok`) | `false` |
| **Linux/Windows** | `true` | `false` (binding `is_ok` → `false`) | `false` |

macOS reports `false` for "nothing to delete" because
`apple-native-keyring-store` calls `find_generic_password(...)?` *before*
deleting, so a missing credential returns `Err(NoEntry)` early and never
reaches the `item.delete(); Ok(())` discard. The discard only applies once the
item has been found — which is precisely the "delete failed" column.

On macOS the native boolean is **meaningless** for a failed delete (it always
reads `true`), so the read-back probe is the only local signal that can catch a
refused delete. On Linux/Windows the boolean at least collapses failures to
`false`, but that is indistinguishable from "nothing to delete", so the probe
adds value there too.

### Dependency decision

- **No good older version to pin to.** The macOS three-layer discard predates
  the current `@napi-rs/keyring` release; older versions exhibit the same or
  worse behaviour.
- **Replacement/vendoring is disproportionate** while upstream PR
  `Brooooooklyn/keyring-node#138` is open. Replacing the native dependency or
  vendoring a patched fork would be a large, maintenance-heavy change for a
  mitigation that the local read-back already provides.
- **The local read-back mitigation is worthwhile now.** It catches the most
  dangerous case (macOS silent failure) and the Linux/Windows ACL-denial case
  without any dependency change.
- **The Apple provider defect needs separate upstream tracking.** Because the
  error is destroyed below the binding (in `apple-native-keyring-store` and
  `security-framework`), even a merged PR #138 cannot fix macOS delete; the
  intermediate Rust crates must stop discarding the `OSStatus` first.

## Test plan (test-first, behavioral, per dev-docs/RULES.md)

No mock theater: assert observable behaviour of the contract above, not call
counts or internal wiring. A fake `readBack` thunk is a legitimate boundary
double, not a mock of the unit under test.

`verifyKeyringDelete`:

1. read-back returns `null` -> `'absent'`
2. read-back returns a value -> `'still-present'`
3. read-back returns empty string -> `'still-present'` (an empty credential is
   still a credential; must not be treated as absent via a falsy check)
4. read-back rejects -> the rejection propagates

Adapter-level, against a fake keyring module injected in place of
`@napi-rs/keyring` (the factory dynamic-imports it, so tests must drive it the
way the existing suite does). The fake **independently controls** the native
return value and whether the entry is actually removed, so the macOS
silent-failure case (native `true` + credential survives) can be staged:

5. native `true` + entry actually removed -> resolves `true`
6. native `false` + entry actually removed -> resolves `false`
7. native `false` + entry survives -> **rejects**, error is a `SecureStoreError`,
   fixed message contains neither the secret value nor a `classifyError` trigger
8. native `true` + entry survives -> **rejects** (the macOS silent-failure case;
   the most important test in the file — the old `if (deleted) return true` fast
   path would let this pass as deleted)
9. read-back probe rejects -> the rejection propagates out of `deletePassword`
10. service/account containing `not found` -> the fixed message is used (no
    interpolation), and the message contains no trigger substring
11. the runtime-replaced guard still fires before any native call (assert error
    identity only — no call-count assertions)

No `getPasswordCallCount` / `deleteCallCount` assertions or counters: those are
mock-interaction assertions forbidden by `dev-docs/RULES.md`. The probe-rejection
case (9) is the behavioural way to prove the probe is part of the contract.
Narrow thrown errors with `instanceof`, never `as` type assertions.

Regression guard: existing `deletePassword` behaviour for the two common
outcomes (`true` on success, `false` on genuine absence) is unchanged.

## Verification

    npm run test
    npm run lint
    npm run lint:eslint-guard
    npm run typecheck
    npm run format
    npm run build
    bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"

New bun test files must be registered in
`scripts/bun-test-manifest-data-storage.ts` or they will not run in CI.

## Constraints

- No new `.js` files and no Vitest/Node tests — TypeScript and `bun:test` only.
- Never add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`,
  severity downgrades, or complexity-threshold increases. Fix the underlying
  issue instead. This is mechanically enforced by
  `scripts/check-eslint-guard.js`.
- Do not touch `.llxprt/`.
