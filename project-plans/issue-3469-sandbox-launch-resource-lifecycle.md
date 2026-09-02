# Issue #3469: Explicit lifecycle ownership for sandbox preparation/launch resources

## Problem

Container-sandbox preparation acquires resources incrementally, but failure
handling is scattered: each step's `catch` block knows only about the
resources earlier steps remembered to release. Several windows leak:

| Failure point | Released today | Leaked today |
| --- | --- | --- |
| after `setupSshAgentForwarding` (tunnel / TCP bridge) | session tmpdir, dependency volumes | SSH tunnel/bridge, port-forward tunnels |
| after `setupPortForwardingPodmanMacOS` | session tmpdir, dependency volumes | SSH + port-forward tunnels |
| after `setupCredentialProxy` (server + bridge) | session tmpdir, dependency volumes, bridge | SSH + port-forward tunnels; the credential proxy **server** is never stopped (its exit wiring is only installed after the container spawns) |
| after `startProxyContainer` (sidecar up), `spawn` throws | dependency volumes | sidecar container, credential proxy server + bridge, tunnels, session tmpdir |

The launch-window leak (sidecar up, main engine spawn throws) is called out in
the issue: the proxy sidecar stays running because its close handler is wired
only after the main process exists.

## Design

One explicit ownership mechanism: `SandboxLaunchLifecycle`
(`packages/cli/src/utils/sandbox-lifecycle.ts`), a registry created once per
container-sandbox launch in `runContainerSandbox`. Every acquisition registers
its release at the acquisition boundary with:

- a **stage** that fixes cross-resource release ordering, and
- a **description** used for diagnostics.

Two terminal transitions, exactly one of which always runs:

- **Failure**: `releaseForFailedLaunch()`, called from a single `catch` in
  `runContainerSandbox`. Releases every owned resource in stage order, each
  exactly once, and writes any secondary release failure to stderr
  (`Warning: failed to release …`) without replacing the original error.
- **Success**: `transferToProcessHandlers()`, called from
  `executeContainerSandbox` after `wireCleanupHandlers` installs the normal
  process/sandbox-close wiring. Ownership explicitly moves to those handlers;
  the registry is spent and `own()` after that is a programming error.

### Release stages (order is the container-before-volume guarantee)

1. `main-container`: the spawned engine container (killed on a failed launch;
   `--rm` cleans the engine record).
2. `proxy-sidecar`: `docker/podman rm -f llxprt-code-sandbox-proxy` through an
   idempotent stop closure that detaches its own `exit`/`SIGINT`/`SIGTERM`
   listeners when it fires.
3. `credential-proxy`: bridge cleanup first (bridge tunnel/server, host-only
   capability env file, session tmpdir via the composed cleanup), then the
   credential proxy server stop, matching today's ordering.
4. `tunnel`: SSH agent forwarding cleanup, then port-forward tunnel cleanup.
5. `session-tmpdir`: removes the per-session tmpdir for paths where the
   credential proxy never ran.
6. `dependency-volume`: `DependencyVolumeLifecycle.release()` (itself removes
   dependency containers before volumes, then restores absent mountpoints).

Within a stage, releases run in acquisition order.

### Scattered catch blocks removed

`prepareContainerImageAndArgs`, `prepareContainerSandbox`,
`prepareContainerEntrypoint`, `rethrowCredentialProxySetupError`, and
`executeContainerSandbox` each drop their bespoke failure cleanups; the
registry is the single owner. `setupCredentialProxy` and
`addPrivateDependencyMounts` keep their internal pre-return failure handling
(they own resources until they return them); after return, the registry owns
the composed releases.

Normal-success behavior is unchanged: wired close/exit handlers still do the
releasing, `dependencyVolumeLifecycle.release()` still runs after close-listener
I/O settles, and `start_sandbox`'s `runSandboxCleanup` still re-invokes the
idempotent cleanups it receives.

## Acceptance criteria → tests

All state-based; no mock call-count assertions; each test owns isolated
processes/sockets/dirs (fake engine state resets per test via the harness).

Registry contract (`sandbox-lifecycle.test.ts`), real resources only:

- stage ordering observable through the release manifest (`releasedResources()`),
  including container-before-volume;
- each resource released exactly once (a stateful release function whose second
  invocation throws proves single invocation by not throwing);
- a real failing release (real subprocess exit failure) leaves a stderr
  warning and does not replace the rethrown original error;
- `own()` after drain fails fast;
- `transferToProcessHandlers()` spends the registry without releasing.

Launch boundaries (`sandbox-launch-release.test.ts`), production
`runContainerSandbox` path, fake engine for real container semantics, real
child processes as tunnels, real sockets/listeners:

1. **SSH tunnel** (podman/macOS): failure injected after the reverse tunnel is
   up (real child) → tunnel process is dead (`ESRCH`), volumes + tmpdir
   released, original error rethrown.
2. **Forwarded port** (podman/macOS, `SANDBOX_PORTS`): failure after the `-L`
   tunnel is up → tunnel dead, tmpdir + volumes released.
3. **Credential proxy** (docker/macOS): failure after proxy + bridge
   acquisition → proxy stopped (fake keeps a real marker file the stop
   removes), session tmpdir removed, original error rethrown.
4. **Launch window / sidecar** (docker/macOS, `LLXPRT_SANDBOX_PROXY_COMMAND`):
   sidecar container really started through the fake engine, main `spawn`
   throws → sidecar container removed from engine state (AC2), container
   removal ordered before volume removal in the engine invocation log
   (container-before-volume), proxy stopped, tmpdir + volumes released.
5. **Normal success + idempotence** (podman/macOS with a live tunnel): launch
   completes → the normal close wiring releases the tunnel (dead), volumes
   released, no stderr cleanup warnings; the unchanged `#3450` suite keeps
   covering plain success/failure launches.

Fake engine gains additive support: `network inspect|create|connect`, `-p/-v/
--env` value flags on `run`, and `sh -lc` scripts, needed so the sidecar path
runs against real engine semantics.

## Out of scope

- Generalizing the dependency-storage cleanup from #3450 (bounded there by
  design); the registry wraps its lifecycle, it does not change it.
- Seatbelt path (acquires none of these resources).
- Normal-path sidecar teardown timing (process-exit today), preserved as-is.
