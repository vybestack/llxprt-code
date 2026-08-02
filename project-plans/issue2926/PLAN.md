# PLAN-20260801-ISSUE2926 — Fail fast when the running runtime has been replaced on disk

Issue: https://github.com/vybestack/llxprt-code/issues/2926
Milestone: 0.11.0

## Problem

On macOS, LLxprt execs the Bun binary bundled inside its own package tree
(`packages/cli/bin/llxprt`, final line: `exec "$_llxprt_bun" "$_llxprt_pkg_root/index.ts" "$@"`).
That Mach-O is the Keychain client process.

An in-place reinstall (`npm i -g`, or a package-cache refresh) renames the old tree aside
and then **deletes** it. The running process survives, but its executable vnode becomes
nameless. macOS `securityd` identifies a Keychain client via audit token ->
`proc_pidpath()` -> reconstruct a `SecCode` -> evaluate the item's requirement and
partition list. With no path, that reconstruction fails, so securityd cannot evaluate the
caller at all and falls back to a login-password prompt on **every** protected operation.

Because LLxprt performs at least two uncached credential reads per turn, the result is an
unbounded password-dialog storm. "Always Allow" cannot fix it (the caller has no identity
to grant); it only appends duplicate ACL entries.

### Verified evidence

C harness against the real signed Bun binary, simulating npm's rename-then-delete:

    before           proc_pidpath=31  CS_VALID=1  SecCode create=0       valid=0
    retired-present  proc_pidpath=35  CS_VALID=1  SecCode create=0       valid=0
    retired-removed  proc_pidpath=0   CS_VALID=1  SecCode create=100002  valid=100002

- Rename alone is harmless. Only the final delete breaks identity.
- The process stays alive and stays `CS_VALID`. This is a user-space identity
  reconstruction failure, not a kernel invalidation.
- Restoring byte-identical bytes at the original path does NOT recover it. Only a restart does.

Detection primitive validated separately: after an npm-style rename/delete/replace with a
byte-identical binary, `fs.stat(execPath)` reports a different inode
(`16777234:491441711` -> `16777234:491441716`). So `(dev, ino)` captured at process start,
compared later, is an exact signal for "my executable file was unlinked".

## Scope

IN scope:
- Detect the replaced-runtime condition.
- Guarantee zero OS keyring operations once detected.
- Fail fast with one actionable message.

OUT of scope (explicitly deferred, noted in the issue as an optional larger alternative):
- Immutable/content-addressed runtime staging.
- Keyring error-fidelity work (issue #2928).
- Non-destructive write verification (issue #2927).

## Requirements

- **R1** Given a process whose executable file has been unlinked or replaced since process
  start, on darwin, the runtime is reported as replaced.
- **R2** Given the runtime is reported as replaced, zero OS keyring operations are attempted
  for the remainder of the process lifetime.
- **R3** Given the runtime is reported as replaced, credential operations fail with a
  `SecureStoreError` whose message names the cause and whose remediation says to restart
  LLxprt and states that "Always Allow" cannot take effect.
- **R4** The warning is emitted at most once per process.
- **R5** Given an intact runtime, or a non-darwin platform, behavior is byte-for-byte
  unchanged from today.

## Design

### New module: `packages/storage/src/secure-store/runtime-identity.ts`

Pure and injectable. No mocks needed to test it — it operates on real files.

    export interface ExecutableIdentity { readonly path: string; readonly dev: number; readonly ino: number; }
    export function captureExecutableIdentity(execPath?: string): ExecutableIdentity | null;
    export function isExecutableReplaced(baseline: ExecutableIdentity | null): boolean;
    export function isRuntimeReplaced(): boolean;   // process-wide, memoised terminal state
    export function resetRuntimeIdentityForTesting(): void;

Rules:
- `captureExecutableIdentity` takes the path as a parameter (defaulting to
  `process.execPath`) so tests use real temp files rather than mocking `fs`.
- The baseline is captured eagerly at module initialisation, so it is recorded before any
  reinstall can occur mid-session.
- `isExecutableReplaced` returns true when the path no longer stats (ENOENT) or when
  `(dev, ino)` differs from the baseline.
- Once true, the state is **terminal** — a replaced runtime never becomes healthy again
  (proven: restoring identical bytes does not recover identity). Memoise it.
- `process.platform !== 'darwin'` returns false, always. A null baseline returns false.

### Integration point: `createDefaultKeyringAdapter()` in `packages/storage/src/secure-store/secure-store.ts`

This is the single choke point for **all** keyring access in the repo. Verified consumers:
- `SecureStore` (default `keyringLoaderFn`), secure-store.ts:281
- `getMachineSecret` / `resolveAndPersist`, machine-secret.ts:201
- MCP `defaultKeytarLoader`, packages/mcp/src/auth/token-storage/keychain-token-storage.ts:67

Gating here covers every consumer with one change and guarantees R2.

    export async function createDefaultKeyringAdapter(): Promise<KeyringAdapter | null> {
      if (isRuntimeReplaced()) return null;   // BEFORE importing @napi-rs/keyring
      ...
    }

The check must precede the dynamic `import('@napi-rs/keyring')` so no native call is ever
issued.

### Fail-fast behaviour in `SecureStore`

When the keyring is unavailable **because the runtime was replaced**, SecureStore throws a
`SecureStoreError` with code `UNAVAILABLE`, **regardless of `fallbackPolicy`**.

Rationale for overriding `fallbackPolicy: 'allow'`: silently writing to the encrypted
fallback file would diverge from the Keychain, and on the next healthy start `get()` reads
the keyring first and would return the stale pre-divergence value. That is silent data
loss. Failing is correct and is what the issue asks for.

Message (single source of truth, one constant):

    LLxprt's runtime was replaced on disk while this session was running (usually an npm
    upgrade). macOS can no longer verify this process's identity, so credential access is
    disabled to avoid a password-prompt storm.

Remediation:

    Restart LLxprt to recover. Do not click "Always Allow" — it cannot take effect for this process.

Emit `logger.warn` with the same text exactly once per process (R4).

Implement as ONE explicit state transition at the keyring-loading boundary. Do not scatter
try/catch across call sites — the project prefers fail-fast over layered defensive guards.

## Test plan (TDD — RED first, behavioural, no mock theatre)

### `runtime-identity` tests — real filesystem, real inode churn

1. captures a stable identity for an existing file
2. returns null for a path that does not exist
3. reports NOT replaced when the file is untouched
4. reports replaced after npm-style rename-aside + delete + recreate with identical bytes
   (this is the exact real-world sequence; assert it detects despite identical content)
5. reports replaced when the file is deleted and not recreated
6. is terminal: once replaced, still reports replaced after the original file is restored
7. returns false on a non-darwin platform
8. returns false for a null baseline

Use a real temp dir and real `fs` operations. Use a shared `useTempDir()`-style helper that
registers its own lifecycle hooks (RULES.md: no copy-pasted beforeEach across describes).

### `createDefaultKeyringAdapter` tests

9. returns null without touching the keyring when the runtime is reported replaced
10. behaves exactly as today when the runtime is intact

Assert R2 by construction: inject a keyring loader that records invocation, and assert zero
invocations in the replaced case.

### `SecureStore` tests

11. `get()` throws SecureStoreError UNAVAILABLE with the replaced-runtime remediation
12. `set()` throws likewise, and does NOT create a fallback file (assert the file is absent
    on disk — this is the anti-divergence guarantee)
13. with `fallbackPolicy: 'allow'`, still throws (documents the deliberate override)
14. the warning is logged exactly once across multiple operations
15. intact runtime: all existing behaviour unchanged (existing suites must stay green)

## Non-negotiables

- No `eslint-disable`, no `ts-ignore` / `ts-expect-error` / `ts-nocheck`, no lint-severity
  downgrades, no complexity-threshold increases, no new ignore entries. Fix the underlying
  issue instead. Enforced by `npm run lint:eslint-guard`.
- TypeScript strict; no `any`; no type assertions; explicit return types.
- Immutable data only.
- Tag new code with `@plan PLAN-20260801-ISSUE2926` and the `@requirement` IDs above.
- Do not weaken or delete existing tests to make new ones pass.

## Verification (all must pass before hand-back)

    npm run test
    npm run lint
    npm run typecheck
    npm run format
    npm run build
    node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"

---

# REVISION 2 — SUPERSEDES the Design and Test plan sections above

Review found the Revision 1 detector design to be **wrong**. The sections below replace
the "Design" and "Test plan" sections. The Problem, Scope, Requirements, Non-negotiables
and Verification sections above still stand.

## What Revision 1 got wrong

Revision 1 detected "the pathname `process.execPath` now stats to a different (dev, ino)".
That is not the failure signal. The verified evidence in this very plan says
**rename-only is harmless** — the C harness `retired-present` stage showed
`SecCode create=0 valid=0` while the tree was renamed aside. But a pathname comparator
reports "replaced" the instant the rename happens, and Revision 1 memoised that as
terminal. So an npm rollback (rename aside, then restore) would permanently disable
credentials for a process that is perfectly healthy.

The real signal is: **has my live executable vnode been unlinked?**

## Corrected detector: pin an fd, watch `nlink`

Open a file descriptor on `process.execPath` at startup and pin it. The fd follows the
inode, not the name. `fstat(fd).nlink` is then exact:

- `nlink >= 1` — the inode still has at least one directory entry. Healthy.
- `nlink === 0` — every link is gone; the file has been unlinked. Orphaned, terminal.

Validated empirically against the real npm sequence:

    baseline               nlink=1  => orphaned: false
    after rename-only      nlink=1  => orphaned: false     <- healthy, correctly NOT flagged
    after retired deleted  nlink=0  => orphaned: true      <- orphaned, correctly flagged

This maps one-for-one onto the C harness stages (`before` / `retired-present` /
`retired-removed`), which is exactly the correspondence Revision 1 lacked. Pure Node —
no native module, no `proc_pidpath` binding.

Rules:
- Open the fd once, eagerly, at module initialisation. Keep it open for process lifetime.
- If the fd cannot be opened at startup, there is no baseline: the detector reports
  healthy (never flags), and this must be explicit and tested.
- `nlink === 0` is terminal — memoise it. Never un-flag.
- Non-darwin always reports healthy.
- The detector must be **injectable** so SecureStore behaviour is testable on every CI
  platform, not just macOS. Separate "is the runtime replaced" (injectable predicate)
  from "how we detect it on darwin" (the fd/nlink implementation).

## Corrected gate: guard the adapter, not the factory

Revision 1 gated `createDefaultKeyringAdapter()`. That only prevents *creating* an
adapter — every already-cached adapter keeps working, which review demonstrated with a
probe that made six native calls after the replaced state was set. `SecureStore` caches
its adapter (`keyringInstance`), MCP `KeychainTokenStorage` caches its own module and its
positive availability flag, and `machine-secret` calls the adapter after loading it.

Instead: `createDefaultKeyringAdapter()` must return a **guarded adapter** whose every
method re-checks the terminal state immediately before entering native code and throws
if replaced. One wrapper covers SecureStore (all methods), machine-secret, and MCP,
because they all obtain their adapter from this factory. That is what actually delivers R2.

Keep the factory-level early return too, so no adapter is created after detection.

## Corrected error: make it distinguishable

Revision 1 threw a generic `UNAVAILABLE`. Review verified that `ToolKeyStorage` treats
`UNAVAILABLE` as ordinary "keyring absent" permission to write its own fallback file
(`packages/core/src/tools/tool-key-storage.ts`), so a probe successfully wrote and read
back a fallback after the replaced state was forced — defeating the anti-divergence
guarantee this plan exists to provide.

Add a **distinct, terminal error identity** (a new `SecureStoreErrorCode` member and/or a
`SecureStoreError` subclass) that downstream fallback and swallow layers must rethrow
rather than absorb. Audit and fix every layer that currently degrades on `UNAVAILABLE`:
`ToolKeyStorage`, extension settings persistence, and the token-store remove/list paths.

Check every consumer that switches on `SecureStoreErrorCode` when adding the member.

## Corrected notification: must actually reach the user

The once-per-process flag is consumed by whichever logger runs first, and most production
`SecureStore` instances are constructed with no logger (defaulting to
`NullStorageLoggerImpl`, which discards). So the single warning can be swallowed entirely.

Route the one-time notice through a channel that is guaranteed to be seen (e.g. stderr),
independent of whether a logger was injected. Test the null-logger-first ordering.

## Corrected coherence

Make the `SecureStore` surface coherent. `get`/`set`/`delete`/`list`/`has`/
`isKeychainAvailable` must all behave consistently under the terminal state rather than
some throwing and others silently returning after making native calls.

## Corrected test plan

Replace the Revision 1 test list. Required behavioural coverage:

**Detector (real files, real fd, real unlink):**
1. healthy at baseline
2. **still healthy after rename-only** (the case Revision 1 got wrong — this is the
   regression test for the whole redesign)
3. orphaned after the retired copy is deleted
4. orphaned when the file is deleted outright with no replacement
5. terminal: stays orphaned after a fresh file appears at the original path
6. no baseline (fd could not be opened) reports healthy
7. non-darwin reports healthy
8. terminal memoisation is genuinely exercised (not merely repeated comparison)

**Gate (must prove ZERO native calls):**
9. a recording adapter proves zero invocations after the terminal state is set, for
   every SecureStore method — get, set, delete, list, has, isKeychainAvailable
10. an adapter cached BEFORE the transition still makes zero calls after it
11. the factory returns null after detection without touching the dynamic import

**Error propagation / anti-divergence:**
12. `set()` writes no fallback file
13. `ToolKeyStorage.saveKey` does NOT create a fallback file and rethrows
14. `fallbackPolicy: 'allow'` still fails

**Notification:**
15. exactly one user-visible notice, including when the first store has a null logger

**Portability:**
16. all gate/fail-fast tests run and pass on non-darwin CI (inject the detector; do not
    skip the suite)

No type assertions in any new code, tests included. Use type predicates and `instanceof`.

## Structural cleanup

Extract `SecureStoreError` and `SecureStoreErrorCode` into a dependency-leaf module so the
new error/gate modules do not import back into `secure-store.ts`. Revision 1 introduced a
cycle that currently works only by accident of ESM live bindings.
