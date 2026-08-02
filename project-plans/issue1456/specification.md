# Feature Specification: Issue #1456 Sandbox Network Hardening

Plan ID: `PLAN-20260801-ISSUE1456`

Issue: [#1456 — Sandbox hardening and security](https://github.com/vybestack/llxprt-code/issues/1456)

Status: Architect specification; production and test implementation are intentionally not part of this artifact.

## Purpose

Issue #1456 requires sandbox security posture to be enforced by observable behavior rather than warnings or accidental fallback. This scoped change closes four connected network-control gaps:

1. macOS Seatbelt currently defaults to `permissive-open` without consulting the sandbox profile's network setting.
2. Docker/Podman `proxied` mode currently warns and silently retains default networking when no proxy command exists, despite an existing isolated network and proxy-container path.
3. Docker/Podman on macOS cannot carry the mandatory credential socket through the host bridge when container networking is disabled.
4. Podman macOS SSH setup discovers a conflicting network mode only after opening an SSH reverse tunnel.

The implementation must fail before allocating affected resources whenever the requested secure posture cannot be honored. It must not launch a sandbox with weaker networking or credential isolation than requested.

## Architectural Decisions

### AD-1456-01: Resolve policy at existing execution seams

No new public service, API, schema, or proxy subsystem is introduced. Policy is enforced where the values become executable behavior:

- `runSeatbeltSandbox` selects the actual `.sb` profile before proxy or Seatbelt spawn.
- `buildContainerRunArgs` validates proxied container configuration while run arguments are being built, before `setupContainerNetworking` or process spawn.
- `setupCredentialProxy` rejects the unsupported Darwin/container/network-off combination before starting the credential proxy or bridge.
- `setupSshAgentPodmanMacOS` checks existing network arguments before opening its reverse tunnel.

Small private resolvers may be used inside their owning module to avoid repeated precedence logic, but they must not be exported solely for testing.

### AD-1456-02: Preserve environment precedence

Where both network variables are present, effective container and Seatbelt profile-derived network mode is:

```text
LLXPRT_SANDBOX_NETWORK ?? SANDBOX_NETWORK
```

This preserves the current primary-variable precedence in `sandbox-containers.ts`. A defined empty primary value remains authoritative under nullish precedence; it does not fall through to the legacy value.

### AD-1456-03: Trim only to validate proxy command presence

`LLXPRT_SANDBOX_PROXY_COMMAND` is valid only when `value.trim().length > 0`. The existing command string is then passed unchanged to the existing process path; validation does not rewrite shell command semantics.

### AD-1456-04: No security fallback

Invalid proxied configuration and unsupported Darwin network-off credential bridging throw `FatalSandboxError`. They do not:

- warn and continue with default networking;
- suppress credential proxy setup;
- omit `LLXPRT_CREDENTIAL_SOCKET`;
- catch and downgrade the error;
- create an alternate direct credential path.

### AD-1456-05: Reuse existing proxy architecture

Configured proxied containers continue through the current components:

```text
buildContainerRunArgs
  -> setupContainerNetworking
       -> internal llxprt-code-sandbox network
       -> external llxprt-code-sandbox-proxy network
  -> startProxyContainer
       -> connect proxy container to internal sandbox network
  -> spawn sandbox container
```

No new broker, sidecar design, proxy protocol, or network subsystem is in scope.

### AD-1456-06: Credential isolation is mandatory

On Darwin, Docker and Podman credential bridges depend on container networking. Network-off therefore rejects sandbox preparation. Launching without `LLXPRT_CREDENTIAL_SOCKET` is prohibited because `credential-store-factory.ts` selects direct host-backed token/key stores when that environment variable is absent.

Linux network-off remains valid: the host credential proxy Unix socket resides under the already-mounted temp directory, so no TCP bridge or Podman VM tunnel is needed.

### AD-1456-07: Network policy outranks optional SSH forwarding

For Podman on macOS, an existing non-host `--network` value is authoritative. SSH-agent setup warns and returns an empty forwarding result before connection discovery, tunnel-port reservation, `child_process.spawn`, readiness polling, or argument mutation. Existing no-network-flag and host-network behavior remains unchanged.

## Technical Environment

- Runtime: Node.js 24+ / Bun 1.3.14 project runtime
- Language: strict TypeScript
- Test framework: Vitest 3.2.7 as resolved by the current test run
- Existing dependencies only: `node:child_process`, `node:fs`, `node:os`, project core/telemetry/provider packages, and `shell-quote`
- No dependency, workflow, schema, or public API change

## Integration Points

### Existing code that uses this behavior

- `packages/cli/src/utils/sandbox.ts::start_sandbox` dispatches Seatbelt requests to `runSeatbeltSandbox` and container requests to `runContainerSandbox`.
- `packages/cli/src/utils/sandbox-exec.ts::prepareContainerImageAndArgs` calls `buildContainerRunArgs` before any container network setup or spawn.
- `packages/cli/src/utils/sandbox-exec.ts::prepareContainerNetworkAndEnv` passes built args through SSH setup and `setupContainerNetworking`.
- `packages/cli/src/utils/sandbox-exec.ts::prepareContainerSandbox` calls `setupCredentialProxy` before preparing the final entrypoint or spawning the container.
- `packages/cli/src/utils/sandbox-exec.ts::executeContainerSandbox` starts the existing proxy container, then the sandbox container.
- `packages/cli/src/config/sandboxConfig.ts::applySandboxProfileEnv` writes both primary and legacy network variables from loaded profiles.

### Existing behavior to replace

- Replace Seatbelt's unconditional absent-profile default with accepted profile/network mapping.
- Replace the container `proxied` warning/default-network fallback with required-command validation.
- Add an early Darwin Docker/Podman network-off rejection to `setupCredentialProxy`.
- Replace Podman macOS SSH's spawn-then-kill conflict handling with check-before-spawn behavior.

### User access points

The behavior is reached through existing sandbox CLI/profile flows; there is no new command:

- `llxprt --sandbox`
- `llxprt --sandbox-engine docker|podman|sandbox-exec`
- `llxprt --sandbox-profile-load <profile>`
- environment configuration using the network, Seatbelt profile, proxy command, and SSH-agent variables

### Migration and compatibility

No persisted data or profile schema migration is required. Existing profile values are already `on | off | proxied` and are applied to process environment. Behavioral compatibility is preserved for:

- explicit non-empty `SEATBELT_PROFILE` overrides;
- custom Seatbelt profile lookup;
- Seatbelt child capability/credential environment scrubbing;
- container network `on`, unset, and `off` outside the explicit macOS credential-bridge limitation;
- configured use of the existing proxy network/container path;
- Linux network-off credential sockets;
- SSH-agent `off`, non-Podman/non-Darwin engines, Podman macOS with no network flag, and Podman macOS with host network.

## Formal Requirements

### REQ-1456-001: Seatbelt network mapping and explicit override

**Full requirement:** When `SEATBELT_PROFILE` is defined and non-empty, `runSeatbeltSandbox` must use it as the advanced explicit override. Otherwise, it must resolve effective network mode with `LLXPRT_SANDBOX_NETWORK` before `SANDBOX_NETWORK`, and select `permissive-closed` for `off`, `permissive-proxied` for `proxied`, and `permissive-open` for `on` or unset.

**Behavior:**

- GIVEN a non-empty explicit Seatbelt profile, WHEN Seatbelt runs, THEN its existing built-in/custom path selection uses that exact profile independent of automatic network mapping.
- GIVEN no non-empty explicit profile and effective mode `off`, WHEN Seatbelt runs, THEN the `-f` argument identifies the existing `sandbox-macos-permissive-closed.sb` file.
- GIVEN no non-empty explicit profile and effective mode `proxied`, WHEN Seatbelt runs, THEN the `-f` argument identifies the existing `sandbox-macos-permissive-proxied.sb` file.
- GIVEN no non-empty explicit profile and effective mode `on` or unset, WHEN Seatbelt runs, THEN the `-f` argument identifies the existing `sandbox-macos-permissive-open.sb` file.
- GIVEN primary network mode is absent and legacy mode is set, WHEN Seatbelt runs, THEN the legacy mode is mapped.

**Why this matters:** A loaded network-restricted profile must not become open merely because Seatbelt was selected.

### REQ-1456-002: Seatbelt proxied command fail-fast

**Full requirement:** If automatic Seatbelt network resolution selects `permissive-proxied`, `LLXPRT_SANDBOX_PROXY_COMMAND` must contain a non-whitespace command. Missing, empty, or whitespace-only values must throw `FatalSandboxError` before proxy or Seatbelt process spawn.

**Behavior:** The error names the required variable and proxied mode. No process is spawned and no sandbox child environment is created. A valid command continues through the existing Seatbelt proxy lifecycle. Existing child environment removal of `LLXPRT_CAPABILITY_TOKEN`, `LLXPRT_CAPABILITY_FD`, and `LLXPRT_CREDENTIAL_SOCKET` is preserved.

**Why this matters:** A proxied policy without a proxy must never become open networking.

### REQ-1456-003: Container proxied command fail-fast and existing proxy path

**Full requirement:** Effective container network mode uses primary-before-legacy precedence. In `proxied`, missing, empty, or whitespace-only `LLXPRT_SANDBOX_PROXY_COMMAND` throws `FatalSandboxError` before network setup or container/proxy spawn. A non-whitespace command proceeds through the current isolated sandbox network, proxy network, proxy container, and network-connect path. The old warning and full-network fallback are removed.

**Behavior:**

- `off` still emits `--network none`.
- `on` and unset still add no policy network flag.
- A configured proxy continues to add proxy environment variables and `--network llxprt-code-sandbox`, creates/inspects the existing networks, and returns the command consumed by `startProxyContainer`.
- Primary network env remains authoritative over a conflicting legacy value.

**Why this matters:** The schema's `proxied` value must have enforceable meaning instead of weakening requested isolation.

### REQ-1456-004: Darwin network-off credential bridge rejection

**Full requirement:** `setupCredentialProxy` must reject Docker and Podman configurations on Darwin when effective network mode is `off`. It throws an actionable `FatalSandboxError` before `createAndStartProxy`, TCP bridge creation, SSH tunnel creation, capability-env-file creation, entrypoint mutation, run-argument mutation, or container spawn.

**Behavior:** The message explains that the macOS credential bridge requires container networking and tells the user to enable container networking or use Linux for network-off sandboxing. The function must not return success without `LLXPRT_CREDENTIAL_SOCKET`.

**Compatibility:** Linux Docker/Podman network-off continues to add the direct Unix credential socket. Darwin Docker/Podman `on` or unset continues through the existing bridge behavior.

**Why this matters:** Omitting the socket would activate direct host credential storage inside the sandbox process and would be a security regression.

### REQ-1456-005: Podman macOS SSH network conflict before tunnel spawn

**Full requirement:** `setupSshAgentPodmanMacOS` must inspect existing network arguments before starting a reverse tunnel. If a non-host value such as `none` exists, it warns, returns `{}`, preserves the existing network arguments, and performs no connection lookup, tunnel-port reservation, child spawn, readiness poll, SSH env insertion, or cleanup allocation.

**Compatibility:** With no network flag, it still adds host networking and establishes forwarding. With host networking, it reuses that mode. SSH-agent `off` is still handled by `setupSshAgentForwarding`, and other engines/platforms remain unchanged.

**Why this matters:** Optional credential convenience must not override explicit network isolation or allocate an unusable tunnel.

### REQ-1456-006: Security behavior documentation

**Full requirement:** `docs/sandbox.md` and `docs/cli/sandbox-profiles.md` must accurately explain Seatbelt mapping and override, proxy-command validation and existing proxy path, Darwin container network-off limitation, Linux direct-socket support, and Podman macOS SSH conflict behavior. Only the directly contradicted sentence in `docs/tutorials/sandbox-setup.md` may be adjusted as needed; no broad rewrite.

**Why this matters:** Operators must be able to predict fail-fast behavior and choose a supported secure configuration.

### REQ-1456-007: Behavioral verification

**Full requirement:** Tests must exercise existing behavior seams and assert outputs, errors, exact selected profile paths, argument state, and resource side effects. Tests may mock process/network infrastructure, but must not mock the component under test, inspect source text, or rely only on call counts. No helper may be exported solely for testing.

## Behavior Matrices

### Seatbelt profile selection

| Explicit `SEATBELT_PROFILE` | Effective network | Proxy command | Result |
| --- | --- | --- | --- |
| non-empty non-proxied built-in or custom | any | existing behavior | Exact explicit built-in/custom profile is preserved |
| non-empty built-in `permissive-proxied` or `restrictive-proxied` | any | non-whitespace | Exact explicit proxied profile is preserved; existing proxy lifecycle runs |
| non-empty built-in `permissive-proxied` or `restrictive-proxied` | any | missing/empty/whitespace | `FatalSandboxError`; no process spawn |
| absent or empty | `off` | any | `permissive-closed` |
| absent or empty | `proxied` | non-whitespace | `permissive-proxied`; existing proxy lifecycle runs |
| absent or empty | `proxied` | missing/empty/whitespace | `FatalSandboxError`; no process spawn |
| absent or empty | `on` | any | `permissive-open` |
| absent or empty | unset | any | `permissive-open` |

The validation applies whenever the selected known built-in Seatbelt profile is proxied. An explicit custom profile remains an advanced override because its network intent cannot be inferred safely from an arbitrary profile name.

### Container networking

| Effective network | Proxy command | Result |
| --- | --- | --- |
| `proxied` | missing/empty/whitespace | `FatalSandboxError` before network setup/spawn |
| `proxied` | non-whitespace | Existing internal sandbox network plus proxy-container path |
| `off` | existing behavior | `--network none` remains |
| `on` | existing behavior | No policy network flag added |
| unset | existing behavior | No policy network flag added |

### Credential proxy

| Platform | Engine | Effective network | Result |
| --- | --- | --- | --- |
| Darwin | Docker | `off` | Actionable `FatalSandboxError` before proxy/bridge |
| Darwin | Podman | `off` | Actionable `FatalSandboxError` before proxy/tunnel |
| Darwin | Docker/Podman | `on` or unset | Existing bridge setup |
| Linux | Docker/Podman | `off` | Existing direct mounted Unix socket setup |

### Podman macOS SSH

| Existing network args | Result |
| --- | --- |
| none | Existing reverse tunnel setup; add `--network host` |
| `--network host` | Existing reverse tunnel setup; retain host mode |
| `--network none` or any non-host value | Warn and return empty before spawn; retain args |

## Error Contracts

Errors must be `FatalSandboxError` and actionable. Exact wording can follow local style, but tests should assert stable semantic fragments rather than a full sentence:

- Seatbelt/container proxied: include `proxied` and `LLXPRT_SANDBOX_PROXY_COMMAND`.
- Darwin network-off credential bridge: include `macOS`, `credential bridge`, and `network`/`networking`; include the supported action of enabling networking or using Linux.

Errors propagate through existing callers. No new catch block may convert them to warnings or successful return values.

## Test Architecture

### Seatbelt behavior

Modify `packages/cli/src/utils/sandbox-seatbelt.test.ts` and invoke the real `runSeatbeltSandbox`. Use controlled child-process infrastructure or the established PATH-discoverable executable fixture to observe the actual `-f` argument. Assert the path names an existing built-in `.sb` file for automatic modes, preserve explicit/custom profile lookup, retain the existing scrubbed child env assertion, and assert zero proxy/sandbox spawns for invalid proxied input.

### Container network behavior

Create the missing focused behavioral suite `packages/cli/src/utils/sandbox-containers.test.ts`. Invoke real `buildContainerRunArgs` and `setupContainerNetworking`; infrastructure command execution may be isolated. Assert thrown errors and unchanged resource state for invalid proxied input, concrete run args and returned command for configured proxy setup, unchanged off/on/unset behavior, and primary env precedence.

### Credential proxy behavior

Extend `packages/cli/src/utils/sandbox-entrypoint.test.ts`, which already exercises real `setupCredentialProxy` with only the auth lifecycle mocked as infrastructure. Control `os.platform()` using the existing Vitest pattern. Assert fatal errors, unchanged args/prefixes/reserved ports, and no proxy/bridge resource creation for Darwin off. Assert the resulting credential socket behavior for Linux off and successful Darwin on/unset setup, cleaning up resources returned by successful tests.

### SSH behavior

Modify the existing conflict case in `packages/cli/src/utils/sandbox-ssh.test.ts`. For `--network none`, assert warning, `{}`, preserved args, and zero `child_process.spawn` calls. Existing no-flag/host-network success tests remain regression coverage.

### Integration evidence

These are component-integration tests because they cross the actual policy-to-runtime seams used by `runSeatbeltSandbox` and container preparation. They avoid live Docker/Podman dependencies while proving the real argument/resource decisions that occur before external process execution. Existing platform-gated real Seatbelt tests continue to cover `.sb` enforcement on macOS.

No tmux harness is required because issue #1456 changes no visual or TUI behavior.

## Documentation Contract

### `docs/sandbox.md`

- Replace the false claim that Seatbelt cannot enforce network off with the actual mapping and limitations.
- Include `proxied` in profile network values.
- Explain explicit non-empty `SEATBELT_PROFILE` precedence.
- Explain required proxy command and current existing proxy network/container path.
- Explain macOS Docker/Podman network-off fail-fast versus Linux direct Unix socket support.
- Explain that conflicting Podman macOS network mode skips SSH forwarding before tunnel creation.

### `docs/cli/sandbox-profiles.md`

- Replace the false `proxied` fallback statement.
- Document the same engine-specific behavior and variable requirements at reference level.
- Clarify the Podman macOS credential and SSH network constraints.

### `docs/tutorials/sandbox-setup.md`

- Update only the directly contradicted statement that the network-off command uniformly reaches `curl` and fails there. Distinguish Linux/direct-socket or Seatbelt-closed execution from Darwin Docker/Podman fail-fast startup.

## Constraints and Non-Goals

- Defer privilege/capability/seccomp/no-new-privileges work to #2902.
- Defer empty SSH-agent identity diagnostics to #1699.
- Defer `gh` removal/broker work to #2903/#1663.
- Do not redesign capability transport/socket hardening already delivered for #1954.
- Do not add Seatbelt credential proxying, Windows sandbox work, credential protocol changes, a proxy subsystem, a public API, a dependency, workflow edits, quality-tool edits, memory edits, or unrelated refactoring.
- Do not loosen lint, complexity, source-size, or type rules. Do not add suppression directives, ignores, threshold changes, or warning/off downgrades.
- Do not modify files outside the paths named by this plan unless a directly failing required check proves a bounded issue-#1456 correction is necessary; unrelated plan documents remain untouched.

## Acceptance Traceability

| Accepted criterion | Requirements | Primary production seam | Behavioral evidence |
| --- | --- | --- | --- |
| AC1 | REQ-1456-001, REQ-1456-002, REQ-1456-007 | `runSeatbeltSandbox` | Real `-f` path, error, and child spawn/env observations |
| AC2 | REQ-1456-003, REQ-1456-007 | `buildContainerRunArgs`, `setupContainerNetworking`, existing `startProxyContainer` path | Fatal invalid input; exact network/proxy args and network setup side effects |
| AC3 | REQ-1456-004, REQ-1456-007 | `setupCredentialProxy` | Error before mutation/resource allocation; Linux/Darwin success behavior |
| AC4 | REQ-1456-005, REQ-1456-007 | `setupSshAgentPodmanMacOS` | Warning, preserved `--network none`, zero spawn; success regressions |
| AC5 | REQ-1456-006 | Named docs | Cross-doc semantic review and doc link/lint checks |

## Completion Definition

Issue #1456's accepted scope is complete only when:

1. Behavioral tests are written first and observed failing for the intended missing behaviors.
2. Minimal production changes make those tests pass without weakening existing safeguards.
3. Existing proxy, credential, Seatbelt, and SSH regression tests pass.
4. Documentation matches runtime behavior.
5. Targeted, full test, lint, typecheck, format, build, and smoke verification all pass.
6. Review findings are classified only as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`, and every non-rejected in-scope finding is resolved before completion.
