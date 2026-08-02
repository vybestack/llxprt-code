# Issue #1456 Verified Preflight and Call-Path Evidence

Plan ID: `PLAN-20260801-ISSUE1456`

Verified: 2026-08-01 on branch `issue1456`

## Verification Gate

- [x] GitHub issue and accepted scope are available.
- [x] Required planning rules were read.
- [x] Existing environment precedence and profile application were verified.
- [x] Seatbelt and container runtime call paths were traced from CLI dispatch through process spawn.
- [x] Existing isolated proxy-container implementation was found.
- [x] Credential-store fallback risk was verified.
- [x] Test seams and infrastructure-mocking conventions were verified.
- [x] Existing targeted tests pass before issue #1456 implementation.
- [x] Documentation contradictions were located.
- [x] No implementation blocker or dependency gap was found.

## Repository and Issue Evidence

`gh issue view 1456 --json number,title,state,url,body,labels,assignees,comments` verified:

- Issue `#1456`, “Sandbox hardening and security”, is open.
- The issue scope explicitly includes runtime/profile defaults, credential proxy exposure/socket handling, SSH/network interactions, verification tests, and documentation.
- The issue is labeled `sandboxing` and assigned to `acoliver`.
- The definition of done requires implemented hardening, passing relevant tests, and security-relevant documentation.

`git status --short --branch` showed branch `issue1456` with no pre-existing working-tree changes before this planning artifact was created.

## Planning-Rule Evidence

| Source | Verified constraint |
| --- | --- |
| `dev-docs/PLAN.md` | Architect-first design, mandatory preflight, analysis/pseudocode before code, integration-first behavioral tests, and semantic verification |
| `dev-docs/PLAN-TEMPLATE.md` | Inline requirements, explicit prerequisites/deliverables, phase verification, and execution tracking |
| `dev-docs/RULES.md` | RED before production GREEN; test behavior rather than implementation; infrastructure mocks only; no speculative abstractions or suppression |
| `dev-docs/COORDINATING.md` | Sequential phases, explicit verification after every phase, no skipped phases, and remediation before proceeding |
| `AGENTS.md` | Repository completion commands and current-year header rule for newly created source files |

## Environment and Type Evidence

| Assumption | Actual evidence | Result |
| --- | --- | --- |
| Sandbox profile network values already exist | `packages/cli/src/config/sandboxProfiles.ts` schema permits `on`, `off`, `proxied`; docs reference the same values | Verified; no schema migration |
| Loaded profiles reach runtime via environment | `packages/cli/src/config/sandboxConfig.ts:386-429` builds profile env; `:432-460` writes primary and legacy network/SSH/resource vars | Verified |
| Primary network variable already wins in containers | `packages/cli/src/utils/sandbox-containers.ts:155-156` uses `LLXPRT_SANDBOX_NETWORK ?? SANDBOX_NETWORK` | Verified; preserve exactly |
| Error type is available | `FatalSandboxError` is already imported in Seatbelt and container modules and used throughout sandbox paths | Verified; no dependency/API change |
| All permissive Seatbelt profile files exist | `packages/cli/src/utils/sandbox-macos-permissive-open.sb`, `-closed.sb`, and `-proxied.sb` | Verified |
| Existing test stack supports infrastructure isolation | CLI uses Vitest; `sandbox-ssh.test.ts:7-15` mocks child process infrastructure and `:842/:862` spies `os.platform`; `sandbox-entrypoint.test.ts:33-46` mocks auth lifecycle only | Verified |

## End-to-End Dispatch

### Top-level engine dispatch

`packages/cli/src/utils/sandbox.ts:91-118`

```text
start_sandbox(config)
  if config.command === sandbox-exec
    -> runSeatbeltSandbox
  else
    -> runContainerSandbox
```

This proves Seatbelt selection tests through `runSeatbeltSandbox` and container tests through existing preparation seams are reachable from the user-facing sandbox flow.

## Seatbelt Call Path and Current Gap

### Call path

`packages/cli/src/utils/sandbox-seatbelt.ts:52-118`

```text
runSeatbeltSandbox
  -> reject BUILD_SANDBOX
  -> select profile / construct profileFile
  -> verify profile file exists
  -> buildSeatbeltArgs(profileFile, ...)
  -> setupSeatbeltProxy
       -> scrub capability/credential markers
       -> optionally spawn proxy command and await readiness
  -> spawnSeatbeltProcess
       -> spawn(config.command, args, child env)
  -> waitForSeatbeltExit
```

### Current behavior

- `sandbox-seatbelt.ts:66` defaults an absent `SEATBELT_PROFILE` directly to `permissive-open`.
- `sandbox-seatbelt.ts:67-75` resolves built-in profiles beside the source module and custom profiles under `.llxprt`.
- `sandbox-seatbelt.ts:87-90` passes the selected file to `buildSeatbeltArgs`, starts proxy setup, and then spawns Seatbelt.
- `sandbox-seatbelt.ts:179-189` puts the actual profile path after `-f` in the spawned args.
- `sandbox-seatbelt.ts:218-249` starts a proxy whenever `LLXPRT_SANDBOX_PROXY_COMMAND` is truthy; whitespace is currently truthy.
- `sandbox-seatbelt.ts:225-233` removes `LLXPRT_CAPABILITY_TOKEN`, `LLXPRT_CAPABILITY_FD`, and `LLXPRT_CREDENTIAL_SOCKET` from the child environment and returns without proxy when no command exists.

### Verified defect mechanism

Network profile environment reaches the process, but `runSeatbeltSandbox` never reads it. Consequently `network: off` and `network: proxied` silently select the open `.sb` profile unless users separately set `SEATBELT_PROFILE`. A whitespace proxy command can also reach `spawn`.

### Existing test seam

- `packages/cli/src/utils/sandbox-seatbelt.test.ts:357-426` already invokes the real `runSeatbeltSandbox` through a PATH-discoverable sandbox executable and inspects its actual child environment.
- `:352-355` identifies the real permissive-open built-in path.
- `:428+` retains platform-gated real `sandbox-exec` coverage.

The issue test should extend the real run seam, not test a newly exported resolver.

## Container Network Call Path and Current Gap

### Preparation and execution path

`packages/cli/src/utils/sandbox-exec.ts:57-106,109-145,147-237,240-280`

```text
runContainerSandbox
  -> prepareContainerSandbox
       -> prepareContainerImageAndArgs
            -> ensure image
            -> buildContainerRunArgs
            -> add volume mounts
       -> prepareContainerNetworkAndEnv
            -> setupSshAgentForwarding
            -> Podman macOS port forwarding
            -> setupContainerNetworking
       -> assign name / add env
       -> setupCredentialProxy
       -> build entrypoint / setup user
  -> executeContainerSandbox
       -> startProxyContainer when proxyCommand exists
       -> spawn sandbox container
```

### Current behavior

- `sandbox-containers.ts:155-163` preserves primary-before-legacy precedence and emits `--network none` for `off`, but `proxied` only warns that it is unimplemented and otherwise retains full default networking.
- `sandbox-containers.ts:336-374` already has a configured proxy setup path: add proxy env, inspect/create internal `llxprt-code-sandbox`, attach sandbox args to it, and inspect/create `llxprt-code-sandbox-proxy`.
- `sandbox-containers.ts:571-629` already starts the proxy container on the proxy network and connects it to the internal sandbox network.
- `sandbox-exec.ts:267-279` consumes the returned command via `startProxyContainer` before spawning the sandbox container.

### Verified defect mechanism

The policy parser and the proxy implementation are disconnected only for invalid proxied input: `buildContainerRunArgs` warns rather than requiring the command. A valid command already follows the desired isolated path. Therefore the minimal design is validation plus removal of the false fallback warning, not a proxy rewrite.

### Existing test seam

No test currently invokes `buildContainerRunArgs` or `setupContainerNetworking`; repository search found only their definitions and calls. A focused `sandbox-containers.test.ts` is therefore required. Both functions are already exported by their owning module, so no test-only production export is needed.

## Credential Proxy Call Path and Current Gap

### Call path

`packages/cli/src/utils/sandbox-containers.ts:447-568`

```text
setupCredentialProxy
  -> createAndStartProxy
  -> getProxySocketPath
  if Darwin
    -> setupMacOSCredProxyBridge
         Docker -> setupCredentialProxyDockerMacOS -> TCP-to-UDS bridge
         Podman -> setupCredentialProxyPodmanMacOS -> SSH reverse tunnel
  -> add LLXPRT_CREDENTIAL_SOCKET
  -> create host-only capability env file
  -> return composed cleanup
```

The caller at `sandbox-exec.ts:186-211` awaits this function before final entrypoint construction and container spawn, preserves a `FatalSandboxError`, and wraps only non-fatal setup failures.

### Platform evidence

- `sandbox-containers.ts:518-537` creates a Darwin bridge and selects its container socket.
- `sandbox-ssh.ts:386-403` implements Docker macOS credential bridging using a loopback TCP server.
- `sandbox-podman.ts:300-315` implements Podman macOS credential bridging using an SSH reverse tunnel and requires host networking.
- Linux takes no Darwin bridge branch and uses the direct proxy socket under the mounted temp directory (`sandbox-containers.ts:529-531`; the temp mount is assembled at `:181-184`).

### Credential-store fallback evidence

`packages/providers/src/auth/proxy/credential-store-factory.ts:259-339` states and implements:

```text
LLXPRT_CREDENTIAL_SOCKET present -> proxy-backed token/key stores
LLXPRT_CREDENTIAL_SOCKET absent  -> direct KeyringTokenStore / ProviderKeyStorage
```

Specifically, `createTokenStore` falls back at `:300-302` and `createProviderKeyStorage` at `:336-338`. Skipping credential setup on Darwin network-off would therefore weaken isolation and is rejected.

### Existing test seam

`packages/cli/src/utils/sandbox-entrypoint.test.ts:488-565` invokes the real `setupCredentialProxy` while replacing only provider auth lifecycle infrastructure. It already asserts fatal invariant behavior and unchanged run args on failure. The same seam can control `os.platform()` and assert issue #1456 resource/argument outcomes.

## Podman macOS SSH Call Path and Current Gap

### Routing

`packages/cli/src/utils/sandbox-ssh.ts:77-149`:

- returns early for `sshAgent=off`;
- validates `SSH_AUTH_SOCK` configuration/existence;
- routes Darwin Podman to `setupSshAgentPodmanMacOS`;
- leaves other engine/platform behavior separate.

### Current conflict order

`packages/cli/src/utils/sandbox-podman.ts:149-196,273-292`:

```text
setupSshAgentPodmanMacOS
  -> startPodmanReverseTunnel
       -> connection lookup
       -> port reservation
       -> child spawn
       -> readiness poll
  -> ensurePodmanHostNetworkForSshAgent
       -> warn on non-host network
       -> kill already-open tunnel
  -> build result
```

The existing guard preserves a conflicting `--network none`; it does not replace it with host. The bounded defect is resource timing: the guard runs only after tunnel creation.

### Existing test seam

`packages/cli/src/utils/sandbox-ssh.test.ts:272-467` directly exercises the real Podman macOS SSH setup with child-process infrastructure isolated. The current conflict test at `:351-368` expects a spawned tunnel to be killed. Issue #1456 must change that behavior to zero spawn while retaining warning, empty result, and unchanged network args. No-flag and host-network behavior is covered by adjacent success tests.

## Documentation Evidence

Direct contradictions located:

- `docs/sandbox.md:44`: says Seatbelt never enforces `network: off`.
- `docs/sandbox.md:110`: omits `proxied` from profile values.
- `docs/cli/sandbox-profiles.md:138-142`: says proxied mode is unimplemented and falls back to default networking.
- `docs/tutorials/sandbox-setup.md:99-113`: says the safe-profile command uniformly reaches a command failure, which is inaccurate for Darwin Docker/Podman after required fail-fast startup.

Relevant existing credential/SSH explanations are in `docs/sandbox.md:129-192` and Podman notes in `docs/cli/sandbox-profiles.md:159-179`; these should be amended, not broadly rewritten.

## Baseline Test Evidence

Command run synchronously from repository root:

```bash
npm test --workspace @vybestack/llxprt-code -- --run \
  src/utils/sandbox-seatbelt.test.ts \
  src/utils/sandbox-ssh.test.ts \
  src/utils/sandbox-entrypoint.test.ts
```

Result:

```text
Test Files  3 passed
Tests       97 passed
Exit code   0
```

This establishes a clean pre-change baseline for the existing Seatbelt, SSH, and credential-proxy seams. The test command generated only ignored JUnit output; `git status --short` remained empty afterward.

## Integration Contracts

| Producer | Consumer | Contract to preserve/harden |
| --- | --- | --- |
| Loaded sandbox profile | Process env | Primary and legacy network values represent profile intent |
| Network env + explicit Seatbelt override | `runSeatbeltSandbox` | Selected real `.sb` path accurately enforces intent |
| `buildContainerRunArgs` | `prepareContainerNetworkAndEnv` | Invalid proxied configuration has already failed; off remains `none` |
| `setupContainerNetworking` | `startProxyContainer` | Valid proxy command returns unchanged and uses existing two-network path |
| `setupCredentialProxy` | Entrypoint/container process | Success always supplies credential socket/capability transport; unsupported Darwin off fails |
| Built container args | Podman macOS SSH setup | Explicit non-host network remains authoritative before resource allocation |

## Blockers and Risks

### Blockers

None found. All required functions, error types, profiles, and test infrastructure exist.

### Implementation risks to verify

1. **Environment leakage between table cases:** snapshot and restore all relevant variables in `afterEach`.
2. **Infrastructure-mock theater:** assert profile path, run args, returned values, errors, and external resource absence/presence; call-count checks alone are insufficient.
3. **Accidental custom Seatbelt regression:** keep custom lookup behavior and exercise an explicit override through `runSeatbeltSandbox`.
4. **Accidental direct credential fallback:** never treat Darwin network-off as a successful no-socket setup.
5. **Accidental SSH policy inversion:** the existing non-host network argument must remain byte-for-byte present.
6. **Resource leaks in success tests:** invoke every returned cleanup and restore process/os/child-process mocks.
7. **Suppression temptation:** no lint/type/complexity/source-size suppression is permitted; simplify implementation instead.

## No-Tmux Determination

No tmux harness is required. The change affects environment-to-runtime policy, process allocation, run arguments, and docs; it has no visual/TUI state or terminal rendering behavior.
