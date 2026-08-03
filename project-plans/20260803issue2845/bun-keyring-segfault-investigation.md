# Bun segfault on the native keyring — investigation notes

Status: **root cause not yet isolated, but substantially narrowed and locally
reproducible.** Recorded so the next person does not repeat the dead ends.

Two agents test files abort the Bun process on Linux CI:

```
panic(main thread): Segmentation fault at address 0x88
oh no: Bun has crashed. This indicates a bug in Bun, not your code.
```

- `packages/agents/src/api/__tests__/capabilityGaps.integration.spec.ts`
- `packages/agents/src/core/__tests__/subagentOrchestrator-runtime.test.ts`

## Local reproduction

The crash needs a **live Secret Service**, which is why a bare container does
not show it. This recipe reproduces it in minutes:

```bash
docker run -d --name llxprt-linux --platform linux/amd64 \
  -v "$PWD":/src:ro -w /work oven/bun:1.3.14 sleep infinity

docker exec llxprt-linux bash -c \
  'cp -r /src/packages /src/package.json /src/bun.lock /src/bunfig.toml \
        /src/test-setup /src/tsconfig.json /work/ && cd /work && \
   rm -rf node_modules packages/*/node_modules && bun install --ignore-scripts'

docker exec llxprt-linux bash -c \
  'DEBIAN_FRONTEND=noninteractive apt-get update -qq && \
   apt-get install -y -qq dbus-x11 gnome-keyring libsecret-1-0 nodejs'

docker exec -w /work/packages/agents llxprt-linux bash -c '
  dbus-run-session -- bash -c "
    eval \$(printf %s probe-password | gnome-keyring-daemon --unlock --components=secrets 2>/dev/null)
    bun test --timeout 30000 src/api/__tests__/capabilityGaps.integration.spec.ts
  "'
```

## What it is NOT

Every one of these was tested against a live Secret Service and **survived**, so
none of them is the cause. Do not re-investigate them:

| Hypothesis | Result |
| --- | --- |
| Bun cannot call `@napi-rs/keyring` at all | ✗ — sync `Entry`, `AsyncEntry`, `findCredentials` and `findCredentialsAsync` all work under Bun, including inside `bun test` |
| The async NAPI path is the weak spot | ✗ — sync and async both work |
| `SecureStore` machinery is at fault | ✗ — construct, `isKeychainAvailable`, `get`, `set`, `get`, `delete` all survive |
| Wrong platform binary (musl vs gnu) | ✗ — both are installed, but `/proc/self/maps` confirms the **gnu** build loads in both the passing and crashing runs |
| Double `dlopen` via `import()` + `createRequire()` | ✗ — same object, single load |
| Stale cached NAPI adapter across work + `Bun.gc(true)` | ✗ — survives |
| Interaction with `@ast-grep/napi` | ✗ — load ast-grep, parse, then keyring: survives |
| No Secret Service on the runner | ✗ — `secure-store.native-keyring.test.ts` exercises the real keyring with `fallbackPolicy: 'deny'` and no skip guard, and passes on the same CI image under Node |

## What it IS

The crash needs **two things together**: the agents module graph imported, and
then *any* real keyring call. Either alone is fine.

The decisive probe: a file that merely `import`s the agent harness segfaults on
a **fresh** `new SecureStore('probe').get('exa')` *before* `buildAgent` is even
called. The identical call in a file that does not import that graph passes.

Bisecting the import (probe: import module X, then do a keyring round-trip):

| Imported first | Keyring call |
| --- | --- |
| nothing | survives |
| `@vybestack/llxprt-code-tools` | survives |
| `@vybestack/llxprt-code-providers` | survives |
| `@vybestack/llxprt-code-settings` | survives |
| `@vybestack/llxprt-code-storage` (barrel and `secure-store.js`) | survives |
| `@vybestack/llxprt-code-mcp` | survives |
| `@vybestack/llxprt-code-core/tools/tool-key-storage.js` | survives |
| `@vybestack/llxprt-code-tools/types/tool-confirmation-types.js` | survives |
| `packages/agents/src/api/agent.js` | survives |
| **`@vybestack/llxprt-code-agents`** (barrel) | **crash** |
| **`packages/agents/src/index.js`** | **crash** |
| **`packages/agents/src/api/index.js`** | **crash** |
| **`src/api/createAgent.js`** | **crash** |
| **`src/api/fromConfig.js`** | **crash** |
| **`src/api/discovery.js`** | **crash** |
| **`src/api/runtimeFactories.js`** | **crash** |
| **`src/api/providerActivationExecutor.js`** | **crash** |
| `@vybestack/llxprt-code-core` (barrel) | inconclusive — import is pathologically slow in the container and never completed |
| `@vybestack/llxprt-code-core/config/config.js` | inconclusive — same |

All five crashing api modules share dependencies, so the culprit is a common
transitive import. `core/config/config.js` and the core barrel are the obvious
remaining suspects and are exactly the two that could not be measured because
importing them takes minutes in the container.

The crash report shows `process_dlopen(3)` — three native libraries were loaded
in the crashing process — so a third native module beyond keyring and ast-grep
is likely involved.

## Suggested next steps

1. Resolve the core-import slowness (or run the probe on a machine with more
   memory) and finish the bisect through `core/config/config.js` and the core
   barrel.
2. Get a native backtrace. `gdb` needs `--cap-add=SYS_PTRACE --security-opt
   seccomp=unconfined` at **container creation** time; `docker exec` alone
   cannot grant it, which is why the attempt here failed.
3. Once the culprit module is known, decide between a targeted fix and an
   upstream Bun report (the crash is in Bun, by its own message).

## Why this matters beyond CI

The shipped `bin/llxprt` is a POSIX launcher that execs Bun, so whatever this
is, it is reachable by real Linux users with a working keyring — not only by
tests.

## Related fix already landed

`classifyError` used to route `Couldn't access platform storage:
PermissionDenied` to `DENIED` (a hard error) instead of `UNAVAILABLE`, which
defeated the encrypted-file fallback on machines that genuinely have no
credential store. Fixed and pinned by behavioral tests. That is a separate,
real bug found on the way here; it does not fix this segfault.
