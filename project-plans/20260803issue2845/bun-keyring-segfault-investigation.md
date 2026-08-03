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

## Native backtrace (the key artifact)

Obtained on a **native arm64** Linux container, where the crash reproduces in
**1.7 seconds** instead of minutes — x86_64 on Apple Silicon runs under
emulation, which is both slow and breaks `ptrace`, so gdb only works on arm64.
Bun's GC suspends threads with `SIGPWR`, which must be passed through or gdb
halts on normal runtime activity:

```
gdb -q -batch \
  -ex "handle SIGPWR nostop noprint pass" \
  -ex "handle SIGSEGV stop print nopass" \
  -ex run -ex "bt 30" -ex "info sharedlibrary" \
  --args "$(command -v bun)" test --timeout 30000 <file>
```

Result:

```
Thread 1 "bun" received signal SIGSEGV, Segmentation fault.
0x0000ffff5c62885c in ?? () from .../@napi-rs/keyring-linux-arm64-gnu/keyring.linux-arm64-gnu.node
#0  0x0000ffff5c62885c in ?? () from .../keyring.linux-arm64-gnu.node
#1  0x0000ffff5c61e51c in ?? () from .../keyring.linux-arm64-gnu.node
#2  0x0000fffffffdb7b0 in ?? ()
Backtrace stopped: previous frame inner to this frame (corrupt stack?)
```

**The fault is inside `keyring.node` itself**, on the main thread, with a
corrupted unwind. On x86_64 the faulting address is `0x88` — a small struct
offset, i.e. a null/garbage pointer dereference.

`info sharedlibrary` identifies the three native addons behind
`process_dlopen(3)`:

- `@ast-grep/napi`
- `@img/sharp` + `libvips-cpp.so.8.18.3`
- `@napi-rs/keyring`

## Additional hypotheses ruled out (arm64, live Secret Service)

| Hypothesis | Result |
| --- | --- |
| `sharp`/libvips interferes with keyring |  — sharp imported **and exercised** (real `metadata()` call so libvips initialises), then keyring: survives. Also survives keyring-before-sharp |
| Concurrent credential access (thread-safety) |  — 5 rounds × 16 concurrent `AsyncEntry.getPassword()` all succeed |

Every pairwise combination of the three addons has now been cleared. The crash
still requires the **full** agents import graph.

## Is there a newer library, or an existing report?

Checked — **no** on all counts, so there is no upgrade path out of this:

| | Pinned / installed | Latest available | Verdict |
| --- | --- | --- | --- |
| `@napi-rs/keyring` | 1.3.0 | **1.3.0** (published 2026-04-30) | already newest |
| Bun (stable) | 1.3.14 | **1.3.14** | already newest |
| Bun (canary) | — | 1.4.0-canary.1+1f447a73e | **still crashes** |

The canary run reproduces identically:

```
1.4.0-canary.1+1f447a73e
panic(main thread): Segmentation fault at address 0x4003B794520
```

Existing upstream reports searched, none matching:

- `Brooooooklyn/keyring-node` — 8 issues total, none mentioning Bun. The one
  Linux-native-binding issue (#93) is about binding resolution on 1.1.9 and is
  closed.
- `oven-sh/bun` — no open issue matches "napi segfault", "napi crash",
  "Segmentation fault addon" or keyring. The only near neighbour is #15197
  (nfc-pcsc native module segfault), closed.

So this is unreported and unfixed upstream on both sides. Filing it is worth
doing, and the material above (1.7s repro recipe, native backtrace, and the
ruled-out matrix) is what such a report needs.

## Still unmeasured

`@vybestack/llxprt-code-core` (barrel) does not finish importing within 120s
even on native arm64, so it remains untested. That slowness is itself worth a
look and is the main obstacle to finishing the bisect.

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
