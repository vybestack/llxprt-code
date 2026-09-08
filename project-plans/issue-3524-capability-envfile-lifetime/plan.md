# Issue #3524 — Delete the capability env file once the sandbox is fully started

## Base branch

This targets `dev/0.12.0` (milestone 0.12.0), and the branch is cut from
`origin/dev/0.12.0` rather than `main`.

Note a divergence found during setup: `dev/0.12.0` does NOT contain the #3440 fix
(commit `e4d0999b76`, merged to `main`). On this base `createHostOnlyDir()` still creates
`~/.llxprt-code-cap-<pid>-<uuid>` directly in `$HOME`, with no platform runtime root, no
`mkdtemp`, and no `reclaimOrphanCapabilityDirs`. That gap is out of scope here and is
flagged separately; this change does not touch `createHostOnlyDir`, so it stays
merge-compatible with the `main` version of that function.

## Problem

The capability env file carries the credential-proxy token into the container via
`--env-file`. It is created per sandbox launch and its cleanup is folded into the
session-long bridge cleanup:

```ts
credentialProxyBridgeCleanup: composeCleanups(
  credentialProxyBridgeCleanup,
  envFileCleanup,
),
```

`wireCleanupHandlers` attaches that to `process.on('exit')`, `SIGINT`, `SIGTERM` and
`sandboxProcess.on('close')`. The file therefore lives for the whole session and is
removed only on a graceful exit, which is precisely the path that does not run under
`SIGKILL`, `tmux kill-session`, an OOM kill or a crash. Every such exit leaks one
directory holding a live capability token at 0600.

## Intended behavior

The file exists only until the token has demonstrably reached the CLI inside the
container. After that it is dead weight holding a live secret, and it is deleted.

## Why not a timer

The container runtime reads `--env-file` at container creation, so in principle the file
could be unlinked right after the runtime call returns. A fixed delay is not safe enough
to rely on: the runtime may still be pulling an image, the container may be slow to
start, and `docker`/`podman` may be remote or VM-backed, which on macOS adds the podman
machine hop. Deletion is therefore driven by a positive signal, not elapsed time.

## Design

**The signal already exists.** The sandboxed CLI connects back to the credential proxy
and completes a handshake presenting the capability token. `CredentialProxyServer`
validates it, sets `state.isSandboxConnection = true` and audit-logs `handshake_ok`
(around line 426). A successful sandbox handshake proves the token was delivered to and
consumed by the process inside the container.

1. `packages/providers/src/auth/proxy/credential-proxy-server.ts`
   - Add `onSandboxHandshake?: () => void` to `CredentialProxyServerOptions`.
   - Invoke it at the point `state.isSandboxConnection = true` is set, on EVERY handshake
     that authenticates as a sandbox. Delivery is at-least-once and the consumer must be
     idempotent, which the env-file cleanup already is.
   - It must NOT fire for an unauthorized handshake or for a non-sandbox connection.
   - Invoke it directly, no try/catch. A throwing callback is a programming error and
     this repo prefers fail-fast; the perf-observer precedent in `AttemptRecorder` does
     the same.
   - No latch, and no mutation of the caller's options object. An exactly-once latch was
     tried first and rejected: it was implemented by clearing the callback out of
     `this.options`, which meant two servers constructed from one options object would
     silently share the consumption. Since the consumer's action is an idempotent unlink,
     at-least-once is the simpler and safer contract.

2. `packages/providers/src/auth/proxy/sandbox-proxy-lifecycle.ts`
   - Thread the callback from `createAndStartProxy` into the `CredentialProxyServer`
     construction (around line 188).

3. `packages/cli/src/utils/sandbox-containers.ts`
   - The proxy is started before the env file is created, so the callback is registered
     before there is anything to delete. Use a holder the callback reads at fire time
     rather than capturing the cleanup eagerly.
   - On first sandbox handshake, run the env-file cleanup and clear the holder.
   - Keep `envFileCleanup` in the composed exit cleanup as a backstop. Early deletion
     must not remove that safety net, only make it usually a no-op.

4. Bounded fallback
   - A sandbox that never requests credentials never hand shakes. Arm a generous,
     `unref`-ed timer once the sandbox process has spawned; on expiry, run the same
     cleanup. The bound is deliberately loose: deleting late costs only a longer
     exposure window, deleting early breaks a launch.

5. Idempotency
   - `removePath` and `runCapabilityCleanupStep` already swallow `ENOENT`/`EBADF` via
     `isIdempotentCleanupError`, so a second removal is a no-op. Verify the composed
     cleanup and the `catch` branch around `createHostOnlyCapabilityEnvFile` still behave
     when the directory is already gone.

## Acceptance criteria

**AC-1.** A successful sandbox handshake fires `onSandboxHandshake`, and the capability
env file and its directory are removed at that point.

**AC-2.** The callback does not fire for an unauthorized handshake, nor for a non-sandbox
connection. It fires again on subsequent sandbox connections (at-least-once), and repeated
delivery is harmless because the consumer's unlink is idempotent. Two servers constructed
from the same options object each fire their own callback.

**AC-3.** With no handshake, the file is still removed within the bounded fallback after
the sandbox process starts.

**AC-4.** Exit-time cleanup and the failure branches still work when the directory has
already been removed; no path throws on a second removal.

**AC-5.** Transport is unchanged: still `--env-file`, still a host-only directory, still
scrubbed by the entrypoint capture stanza before any prefix or bridge runs.

## Test plan (behavioral, written first)

Extend `packages/providers/src/auth/proxy/__tests__/credential-proxy-server.test.ts`
using its existing real-server-over-a-real-socket harness:

- a real client completing a valid sandbox handshake fires the callback once;
- a second sandbox connection does not fire it again;
- an unauthorized handshake (wrong or missing token) does not fire it;
- a server constructed without the option still handshakes normally.

Add coverage for the launch-path wiring in the CLI package:

- when the registered callback fires, the env file and its directory are gone;
- running the composed exit cleanup afterwards is a no-op and does not throw;
- the fallback path removes the file when no handshake arrives.

No sleeps as synchronization. Drive the real handshake and await it.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`,
plus the `stepfun-37` startup smoke.

## Out of scope

Where the host-only directory lives (the #3440 runtime-root change absent from this
base), `reclaimOrphanCapabilityDirs`, the capability transport mechanism itself, and any
change to what a sandbox connection is permitted to do once authenticated.
