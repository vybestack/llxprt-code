# PLAN-20260805-ISSUE3020 — Sealed Keychain `change_acl` and the discarded "Always Allow" grant

Issue: #3020 — Keychain items are created with the macOS-default ACL (empty
`change_acl` trusted-application list), and no layer of the binding chain can
supply a different one; the "Always Allow" grant fails to persist and the prompt
recurs. This plan documents what the source establishes, stops short of
asserting the unproven securityd discard mechanism, and breaks the silence.

## 1. Root cause, confirmed in source

The issue asked for the empty `change_acl` application list to be confirmed
against source rather than inferred from behaviour. It has been. The write path
is fully traced below; every link was read, not assumed.

### 1.1 The call chain

| Layer | Version | Code |
| --- | --- | --- |
| `packages/storage/src/secure-store/default-keyring-adapter.ts` | — | `new kr.AsyncEntry(service, account).setPassword(value)` |
| `@napi-rs/keyring` | 1.3.0 | binding over `keyring-core` |
| `apple-native-keyring-store` (`keychain` module) | 1.0.1 | `Cred::set_secret` |
| `security-framework` (`os::macos::passwords`) | 3.7.0 | `SecKeychain::set_generic_password` → `add_generic_password` |
| macOS Security.framework | OS | `SecKeychainAddGenericPassword` |

`apple_native_keyring_store::keychain::Cred::set_secret`:

    fn set_secret(&self, secret: &[u8]) -> Result<()> {
        self.get_keychain()?
            .set_generic_password(&self.service, &self.account, secret)
            .map_err(decode_error)?;
        Ok(())
    }

`security_framework::os::macos::passwords`, `SecKeychain::set_generic_password`
and `add_generic_password`:

    pub fn set_generic_password(&self, service: &str, account: &str, password: &[u8]) -> Result<()> {
        match self.find_generic_password(service, account) {
            Ok((_, mut item)) => item.set_password(password),
            _ => self.add_generic_password(service, account, password),
        }
    }

    pub fn add_generic_password(&self, service: &str, account: &str, password: &[u8]) -> Result<()> {
        unsafe {
            cvt(SecKeychainAddGenericPassword(
                self.as_CFTypeRef() as *mut _,
                service.len() as u32, service.as_ptr().cast(),
                account.len() as u32, account.as_ptr().cast(),
                password.len() as u32, password.as_ptr().cast(),
                ptr::null_mut(),
            ))?;
        }
        Ok(())
    }

### 1.2 The finding

`SecKeychainAddGenericPassword` has **no `SecAccess` parameter**. Apple's own
documentation for it states: *"This function sets the initial access rights for
the new keychain item so that the application creating the item is given trusted
access."* The `SecAccess` is synthesised by macOS, and the synthesised access is
the standard default: one ACL entry authorising the data operations
(`decrypt`, `derive`, `export_clear`, `export_wrapped`, `mac`, `sign`) with the
creating application in its trusted-application list, plus the single required
**owner** entry authorising `change_acl` with an **empty** trusted-application
list.

An empty list is not the same as a null list. Apple's
`SecACLCreateWithSimpleContents` documentation is explicit: *"Set this parameter
to `nil` to indicate that any app can use this item. Pass an empty array to
indicate that there are no trusted apps."* The `applications (0)` form observed
in the issue's `security dump-keychain -a` output is therefore the "no trusted
apps" form: no application is trusted to amend the ACL **without user
confirmation** (as distinct from a null list, which means any application may).

**Conclusion for acceptance criterion 1.** The empty `change_acl`
trusted-application list is **not** a hardening decision made by LLxprt,
`@napi-rs/keyring`, `keyring-core`, `apple-native-keyring-store`, or
`security-framework`. It is the macOS default `SecAccess` for every item created
through `SecKeychainAddGenericPassword`, and every LLxprt credential item is
created through exactly that call. The load-bearing, fully-proven finding is
that no layer of the dependency chain exposes any way to supply a different
`SecAccess`, so LLxprt cannot construct or repair the ACL of these items from
TypeScript (see 1.3).

### 1.3 Why we cannot fix it at the ACL layer

The issue's investigation item 2 asked whether items should be created with an
explicit `SecAccess` that keeps `change_acl` amendable. The answer, from the
same source reading, is that **there is no API path from TypeScript to do so**:

- `security-framework`'s macOS module hardcodes `SecKeychainAddGenericPassword`
  in `add_generic_password`. It exposes no variant taking a `SecAccess`, and no
  `kSecAttrAccess` pass-through.
- `apple-native-keyring-store` calls `set_generic_password` with no access
  argument and offers no configuration key for one; its only configuration key
  is `keychain` (which of the four keychain domains to use).
- `@napi-rs/keyring`'s `AsyncEntry` surface is `getPassword` / `setPassword` /
  `deleteCredential`. It has no access-control surface at all.

Constructing a custom `SecAccess` would require a native change in
`security-framework` (or replacing the binding outright). That is a dependency
decision of the same class already deferred in #3011, and it is **out of scope
here**. Investigation item 3 (identity requirement versus cdhash pinning) is
likewise unreachable: the trusted-application entries are appended by
`securityd`, not by us, and we cannot choose the requirement form it stores.

### 1.4 What is established and what is not

The source chain establishes the structural fact above (1.1–1.3): every item is
created with the macOS-default ACL, and that ACL cannot be repaired from
TypeScript. It does **not** establish the exact `securityd` mechanism by which
an observed "Always Allow" grant fails to persist. Apple's `SecAccessCreate`
documentation says the owner ACL's empty application list means the **user is
prompted for permission** when the access instance is changed — not that the
change is impossible — and Apple's Access Control Lists documentation says
"Always Allow" adds the app to the restricted entry's trusted list. Asserting
that the empty list is *the proven cause* of the discarded grant would
over-read those documents. Confirming the mechanism would require a native ACL
inspection of the item immediately before and after a grant; this work does not
perform that inspection and does not assert the mechanism.

### 1.5 What is therefore left, and it is the real defect

The issue's own failure sequence names step 5 as the defect: *"The grant is
silently discarded. Nothing is written, and no error surfaces to the user or to
SecureStore."* This plan does not claim to stop the discard. It **can** stop the
silence, and it can give the user a way out. That is what this plan delivers.

## 2. Accepted behavior

**AB1 — The source-confirmed root cause is documented.**
Section 1 of this plan is the authoritative record. `docs/troubleshooting.md`
carries the user-facing summary.

**AB2 — Repeated interactive Keychain authorization is no longer silent.**
A new dependency-leaf module observes every OS-keyring credential read that the
default adapter performs. A read that *succeeds* but takes longer than the
interactive-authorization threshold is recorded as an authorization event for
that credential. A **second** such event for the **same** credential that
**began after** the first completed is a symptom consistent with a grant that
did not persist. This is a heuristic with a known false-positive envelope (a
pathologically slow but non-interactive keychain), not proof of the discard
mechanism, which this work does not establish (see 1.4).

Rationale for this signal, and why there is no better one: the binding erases
`OSStatus` (#3011), `securityd` handles the ACL append internally and returns
the secret regardless, and the ACL is not readable from the binding. The
monotonic-clock duration of a *successful* read is the only in-process
observable that distinguishes "authorised without interaction" from "a human was
made to authorise this". What narrows the envelope: darwin-only, strictly
greater than the threshold, correlation by the **same** credential,
non-overlapping reads only (the second must begin at or after the first
completed), and two events rather than one. The consequence is bounded — one
stderr notice and a predicate; credential access is never blocked and no data is
changed.

**AB3 — Exactly one actionable diagnostic is emitted, and it never breaks
credential access.**
On the transition to the broken state, one warning block is written to stderr
and never repeated for the lifetime of the process. It describes the
observation and its consequence (the same credential is being re-authorized
after it was already authorized this session, so the grant is not persisting),
names the remedies, and references issue 3020. It does not assert a proven
cause. Nothing throws; `get()` still returns the credential it just read.

**AB4 — A supported recovery path that does not require deleting keychain
items.**
Setting `LLXPRT_DISABLE_OS_KEYRING=1` makes `createDefaultKeyringAdapter()`
return `null` in production. Every credential consumer — `SecureStore`,
`machine-secret`, and MCP `KeychainTokenStorage` — obtains its adapter from that
one factory, so the single check covers all of them, and all credential traffic
routes to the existing encrypted-file fallback. Existing Keychain items are left
untouched: nothing is deleted and nothing is migrated.

**AB5 — The recovery procedure is documented.**
`docs/troubleshooting.md` gains the procedure in the existing macOS Keychain
section, adjacent to the #3021 ad-hoc-Bun guidance, and states plainly that this
is the interim escape hatch pending the full keyring opt-out tracked in #2928.

**AB6 — Behavioral test evidence exists for every accepted behavior above.**

### Explicitly out of scope

- Constructing a custom `SecAccess`, or vendoring/patching/replacing
  `@napi-rs/keyring`, `apple-native-keyring-store`, or `security-framework`.
- The full #2928 work: native `OSStatus` fidelity, the setter-fallthrough fix,
  the session-level "keyring is unusable this session" state transition, and a
  settings-file (non-environment) opt-out. `LLXPRT_DISABLE_OS_KEYRING` here is
  the narrow recovery lever #3020 requires, not #2928's design.
- Migrating existing Keychain credentials into the fallback store.
- Any change to the #3021 launcher warning.
- Any change to `deletePassword` / `verifyKeyringDelete` (#3011) or to
  `verifyKeyringWrite` (#2927).

## 3. Inputs and boundary cases

| Input | Accepted result |
| --- | --- |
| Platform is darwin; one successful keyring read exceeds the threshold | No warning. A single authorization is normal. |
| Platform is darwin; a second slow successful read of the **same** credential that **began after** the first completed | Broken state becomes true; exactly one warning block on stderr. |
| Platform is darwin; two slow successful reads of **different** credentials | No warning. Different credentials never correlate. |
| Platform is darwin; two slow successful reads of the same credential that **overlap** (the second began before the first completed) | No warning. Concurrent first reads prove nothing. |
| Platform is darwin; a third and further slow successful reads | State stays true; **no** further warning. |
| Read duration exactly equals the threshold | Not an authorization event (strictly greater than). |
| Slow read that returns `null` | Not an authorization event. Absence is not a granted authorization. |
| Slow read that throws | Not an authorization event, and the rejection propagates unchanged. |
| Only fast reads, any number | Never warns. |
| Platform is not darwin | Never observes and never warns, whatever the durations. |
| `LLXPRT_DISABLE_OS_KEYRING=1` | `createDefaultKeyringAdapter()` resolves `null`; `SecureStore` round-trips through the encrypted file; no keychain item is deleted. |
| `LLXPRT_DISABLE_OS_KEYRING` unset, empty, `0`, or `true` | Adapter is created normally. Only the exact string `1` opts out, matching the existing `LLXPRT_TEST_DISABLE_OS_KEYRING` convention. |
| `LLXPRT_DISABLE_OS_KEYRING=1` with `fallbackPolicy: 'deny'` | Existing deny semantics are unchanged: `set()` raises `UNAVAILABLE`. The opt-out does not silently defeat a deny policy. |
| Runtime already replaced (#2926) | Unchanged. `RUNTIME_REPLACED` still fires first, before any observation. |

## 4. Design

### 4.1 New leaf module: `packages/storage/src/secure-store/keychain-grant-persistence.ts`

A dependency leaf, mirroring the established `runtime-replaced-errors.ts` and
`runtime-identity.ts` conventions (process-wide state, one-time stderr warning,
injectable seam so the behavior is testable on every CI platform).

    export const INTERACTIVE_AUTH_THRESHOLD_MS = 1500;
    export const GRANT_NOT_PERSISTING_MESSAGE: string;
    export const GRANT_NOT_PERSISTING_REMEDIATION: string;

    export interface KeyringReadObservation {
      /** Opaque correlation key for the credential. Map key only; never logged. */
      readonly credentialKey: string;
      /** Monotonic ms (performance.now) when the native read started. */
      readonly startedAt: number;
      /** Monotonic ms (performance.now) when the native read completed. */
      readonly endedAt: number;
    }

    /** Records a successful keyring read, correlated by credential. */
    export function recordAuthorizedKeyringRead(observation: KeyringReadObservation): void;

    export function isKeychainGrantPersistenceBroken(): boolean;

    // Test seams
    export function resetKeychainGrantPersistenceForTesting(): void;
    export function setKeychainGrantPersistencePlatformForTesting(
      platform: NodeJS.Platform | null,
    ): void;

Behavior:

- Observations are ignored entirely unless the effective platform is `darwin`.
- Once broken, the state is terminal and no further work is done.
- An observation counts only when `endedAt - startedAt > INTERACTIVE_AUTH_THRESHOLD_MS`.
- Observations are correlated by `credentialKey` in a module-private
  `Map<string, number>` holding the `endedAt` of each credential's last
  interactive read. A credential's *first* interactive read is normal and is
  merely recorded. A *second* interactive read of the **same** credential counts
  as the discarded-grant event **only if** it began at or after the first
  completed (`startedAt >= previousEndedAt`); overlapping/concurrent reads prove
  nothing and leave the stored value unchanged.
- On the counted event the state flips to broken **once**, the map is cleared,
  and the warning is emitted **once**, to `process.stderr.write`, wrapped in the
  same defensive `try`/`catch` `runtime-replaced-errors.ts` uses for EPIPE.
  Losing the notice must never break the credential read.
- The map is bounded by `MAX_TRACKED_CREDENTIALS = 256`. Before inserting a
  brand-new key, if the map is full it is cleared first: the tracker only holds
  credentials that had exactly one interactive read, entries are only useful for
  short-range correlation, and clearing at worst loses a first observation
  (biasing toward NOT warning — the safe direction).

Threshold and the cap are module constants, not configuration. No new setting.

### 4.2 `default-keyring-adapter.ts`

`getPassword` times the native call with a monotonic clock and reports it:

    getPassword: async (service, account) => {
      const entry = new kr.AsyncEntry(service, account);
      const startedAt = performance.now();
      const value = await entry.getPassword();
      if (value !== null) {
        recordAuthorizedKeyringRead({
          credentialKey: `${service}\u0000${account}`,
          startedAt,
          endedAt: performance.now(),
        });
      }
      return value;
    },

`performance.now()` is monotonic (unlike `Date.now()`, which NTP steps and
sleep/wake can move). A rejection propagates without being recorded, because
the `await` throws before the record call is reached. This is the only
production timing site, so the observation covers `SecureStore`,
`machine-secret`, and MCP alike. The correlation key is an opaque `Map` key
only — never logged or interpolated into any message.

The production opt-out sits beside the existing test marker:

    const DISABLE_OS_KEYRING_ENV = 'LLXPRT_DISABLE_OS_KEYRING';
    // returns null before the dynamic import, exactly like the test marker

### 4.3 `secure-store.ts`

Minimal: one public accessor so the condition genuinely surfaces at the
`SecureStore` boundary named in the acceptance criteria.

    isKeychainGrantPersistenceBroken(): boolean {
      return isKeychainGrantPersistenceBroken();
    }

No control-flow change. No new error code. No throw. `secure-store.ts` is close
to the 800-line `max-lines` ceiling, so nothing else is added there and the
threshold is **not** to be raised.

### 4.4 Package exports

`packages/storage/src/index.ts` re-exports
`isKeychainGrantPersistenceBroken` and the two message constants. Nothing else
new becomes public.

## 5. Test-first evidence

All new and changed tests use Bun and `bun:test` only. No Vitest, no new `.js`
files. New Bun test files must be registered in
`scripts/bun-test-manifest-data-storage.ts` or CI will not run them.

New file: `packages/storage/test-bun/keychain-grant-persistence.bun.ts`

RED-first, behavioral, no mock-interaction assertions (no call counters, no spy
argument inspection). Assert observable outcomes: the predicate's value and the
stderr text. The deterministic clock uses `performance.now` to match production.

1. One slow successful read → predicate false, stderr silent.
2. Two slow successful reads of the **same** credential that are **sequential**
   → predicate true; stderr carries exactly one warning block describing the
   observation, naming both remedies, and referencing #3020.
3. A third and fourth slow read → predicate still true, stderr unchanged from
   case 2 (once per process).
4. Duration exactly at the threshold, twice → predicate false.
5. Fast reads only, many → predicate false.
6. Non-darwin effective platform, many slow reads → predicate false, stderr
   silent.
7. Two slow successful reads of **different** credential keys → predicate false
   (different credentials never correlate).
8. Two slow successful reads of the same credential key that **overlap** (the
   second's `startedAt` is before the first's `endedAt`) → predicate false.
9. A third credential reaching its first interactive read after the state is
   already broken → predicate stays true, stderr unchanged.
10. Adapter-level, against the fake `@napi-rs/keyring` module: two slow
    sequential successful reads of the SAME service+account through
    `createDefaultKeyringAdapter()` → predicate true and the value is still
    returned to the caller on both reads.
11. Adapter-level: two slow reads of DIFFERENT accounts on the same service →
    predicate false.
12. Adapter-level: a slow `getPassword` resolving `null`, twice → predicate false.
13. Adapter-level: a slow `getPassword` that rejects, twice → the rejection
    propagates unchanged and the predicate stays false.
14. `SecureStore` surface: with the same fake adapter, after the second slow
    `get()` the store's accessor reports broken and `get()` still returned the
    stored value both times.

New file: `packages/storage/test-bun/keyring-opt-out.bun.ts` (the
`LLXPRT_DISABLE_OS_KEYRING` opt-out cases — see FIX 4; moved out of the Vitest
suite):

15. `LLXPRT_DISABLE_OS_KEYRING=1` → `createDefaultKeyringAdapter()` resolves
    `null`.
16. `LLXPRT_DISABLE_OS_KEYRING=1` → `SecureStore` set/get round-trips through
    the encrypted fallback file, and the ciphertext on disk does not contain the
    plaintext.
17. `LLXPRT_DISABLE_OS_KEYRING` set to `0`, empty, and `true` → an adapter is
    still produced (only exactly `1` opts out).
18. `LLXPRT_DISABLE_OS_KEYRING=1` with `fallbackPolicy: 'deny'` → `set()`
    rejects with a `SecureStoreError` whose code is `UNAVAILABLE`.

Regression guard: the existing `LLXPRT_TEST_DISABLE_OS_KEYRING`,
runtime-replaced, write-verification, and delete-verification suites must stay
green and unmodified.

Every new test must be run and observed to FAIL before the implementation lands,
and the RED observation recorded.

## 6. Documentation

`docs/troubleshooting.md`, inside the existing
"macOS: Repeated Keychain Password Prompts" section:

- The source-confirmed root cause from section 1, condensed: the item's ACL is
  the macOS default from `SecKeychainAddGenericPassword`, its `change_acl` entry
  trusts no application, and no layer of the binding chain can supply a
  different one.
- The new runtime diagnostic: what the warning means when it appears.
- The recovery procedure: `export LLXPRT_DISABLE_OS_KEYRING=1`, what it does
  (encrypted-file fallback in the OS data directory), what it costs
  (re-authenticate once; keys already in the Keychain are not migrated), and
  that existing Keychain items are left in place rather than deleted.
- A note that this is the interim escape hatch and that #2928 tracks the full
  opt-out.

## 7. Verification gates

- The focused new Bun suites, RED before and GREEN after.
- `npm run test`
- `npm run lint`
- `npm run lint:eslint-guard`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
- DeepThinker review and Open Code Review, every finding classified
  Blocker-Fix / In-scope-Fix / Reject / Defer.
- PR checks green on the candidate head, threads resolved or explicitly deferred
  for user judgment, branch conflict-free on current `origin/main`.

## 8. Guardrails

- No `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, severity
  downgrade, or complexity/size threshold increase. Fix the cause instead.
  Enforced by `scripts/check-eslint-guard.js`.
- No new `.js` files; no Vitest/Node test suites added or modified.
- No dependency change, workflow change, or `.llxprt/` modification.
- No adjacent refactor of `secure-store.ts`, the fallback envelope, the write or
  delete verification paths, or the launcher.
- Plan documents live under `project-plans/`, never `dev-docs/`.
