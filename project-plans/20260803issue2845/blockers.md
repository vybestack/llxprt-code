# Linux CI failures on PR #2989 (issue #2845) — resolved

Five agents test files failed on the Linux CI runner while passing on macOS.
They looked like two unrelated problems. **They were one root cause**, in
`packages/storage`, that pre-dates this migration — the Bun migration is simply
the first thing to exercise it.

Everything below was reproduced and measured, not inferred. A Linux x86_64
container was used so the diagnosis did not depend on 20-minute CI rounds:

```
docker run -d --name llxprt-linux --platform linux/amd64 \
  -v "$PWD":/src:ro -w /work oven/bun:1.3.14 sleep infinity
docker exec llxprt-linux bash -c \
  'cp -r /src/packages /src/package.json /src/bun.lock /src/bunfig.toml \
        /src/test-setup /src/tsconfig.json /work/ && cd /work && \
   rm -rf node_modules packages/*/node_modules && bun install --ignore-scripts'
docker exec -w /work/packages/agents llxprt-linux bun test --timeout 30000 <file>
```

## The symptoms

| File | Symptom on Linux CI |
| --- | --- |
| `capabilityGaps.integration.spec.ts` | process aborted, `SIGILL` |
| `subagentOrchestrator-runtime.test.ts` | process aborted, `SIGILL` |
| `turn.idle-timeout.test.ts` | 3 tests hit the 30s per-test budget |
| `subagent.stream-idle.test.ts` | 2 tests hit the 30s per-test budget |
| `subagent.runNonInteractive-term.test.ts` | 30s per-test budget |

The two crashing files died **mid-file**, at exactly the first test that
resolves a credential:

| File | Declared | Ran | Died on |
| --- | --- | --- | --- |
| `capabilityGaps.integration.spec.ts` | 18 | 10 | test 11, `tool-keys:` → `agent.tools.keys.status('exa')` |
| `subagentOrchestrator-runtime.test.ts` | 15 | 9 | test 10, profile with `'auth-key-name'` |

```
panic(main thread): Segmentation fault at address 0x88
oh no: Bun has crashed. This indicates a bug in Bun, not your code.
```

## Root cause

Both symptoms came from reading the OS credential store on a machine that has
none.

`SecureStore.get()` already implements the right degrade — it swallows
`UNAVAILABLE`, `NOT_FOUND` and `TIMEOUT` and falls through to the encrypted
file. Two things defeated it:

1. **Misclassification.** `classifyError()` matches by substring, and a
   keyring-less machine reports `Couldn't access platform storage:
   PermissionDenied`. That contains "permission" and "denied", so it was
   classified `DENIED` — a hard error — when it means "there is no credential
   backend here", i.e. `UNAVAILABLE`. The `UNAVAILABLE` remediation string
   describes exactly this case: *"install a keyring backend … or allow
   encrypted fallback storage"*.

2. **Unsound probing.** Even classified correctly, the failure cannot always be
   caught. Under Bun on Linux the call can abort the process inside libsecret
   rather than raising an error, so "call it and catch" is not a valid
   availability probe. CI proved this: fix 1 alone left both files still
   `SIGILL`-ing.

The timer-looking failures were the **same cause wearing a different hat** — the
credential-store call was stalling inside those tests, consuming the 30s budget.
It was never a fake-timer problem. An earlier theory that the shared compat shim
(`test-setup/augment-bun-vi.ts`) was too slow at advancing timers was
**disproved**: measured at 3000 timer firings it costs 13 ms on macOS and 228 ms
on Linux, nowhere near 30s, and with the storage fix in place every one of those
tests runs in single-digit milliseconds. No shim change was needed.

## The fix

Both in `packages/storage/src/secure-store/`, no test file modified:

- `secure-store.ts` — classify "access platform storage" as `UNAVAILABLE` ahead
  of the generic denied/permission test, so the intended fallback engages.
  Pinned by three behavioral tests in `secure-store.fallback-behavior.test.ts`,
  each verified failing first.
- `platform-credential-store.ts` (new) — a pre-flight check. macOS and Windows
  ship a credential store; Linux reaches one over a D-Bus Secret Service. With
  no `DBUS_SESSION_BUS_ADDRESS` and no `XDG_RUNTIME_DIR` bus socket there is
  definitively none, so `createDefaultKeyringAdapter()` returns `null` before
  importing `@napi-rs/keyring` and never enters the crashing path. A pure
  predicate over (platform, env, fileExists), so it is covered on every host.

## Evidence

Keyring-less Linux x86_64 container:

| | Before | After |
| --- | --- | --- |
| `capabilityGaps.integration.spec.ts` | 17 pass / 1 fail | 18 pass / 0 fail |
| All 5 previously-failing files | 2 aborted, 5 tests timed out | **53 pass / 0 fail in 13s** |
| `turn.idle-timeout.test.ts` alone | 3 tests × 30s timeout | 5 pass in 4.5s, each < 80 ms |
| `packages/storage` secure-store suite | — | 243 pass / 0 fail |

Local: lint, eslint-guard, typecheck, format and build all clean.

The `SecureStore Backend (keyring)` CI job runs under `dbus-run-session`, which
exports `DBUS_SESSION_BUS_ADDRESS`, so it still exercises the native path.

## Why this mattered beyond CI

This is a **product bug, not a test artifact**. The shipped `bin/llxprt` is a
POSIX launcher that execs Bun, so a Linux user with no Secret Service — headless
server, container, ssh session, WSL — reading a provider key got a thrown
`SecureStoreError` instead of the encrypted-file fallback the design intends,
and on some systems a hard crash.

The repo had already sensed the hazard without pinning it down:
`scripts/bun-native-modules-smoke.ts` deliberately exercises `@napi-rs/keyring`
**construct-only, no credential I/O**. Nothing had made the real call under Bun
in CI until these agents tests did. The tests were right.
