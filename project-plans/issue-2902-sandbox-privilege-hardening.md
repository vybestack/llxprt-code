# Issue #2902 — Sandbox container privilege hardening

## Step 1 (required by the issue): empirical result

The issue asks for the ptrace/`/proc/PID/mem` claim to be confirmed or refuted
in a running container rather than reasoned about. It was tested.

### Method

A victim process holds a 64-hex, capability-token-shaped secret in an
unexported shell variable (the same shape and residency as the token the CLI
holds after consuming fd 3). A **descendant** process then reads
`/proc/<victim>/maps` and `/proc/<victim>/mem` and scans readable mappings for
the secret. This models exactly the issue's attacker: a shell command run by
the agent, which is a descendant of the token-holding CLI process.

Probe scripts and raw transcripts: see "Evidence" below.

### Environment

| | |
|---|---|
| Host | macOS (darwin, arm64) |
| Docker | Server 29.1.3, builtin seccomp, cgroupns. Docker Desktop Linux VM kernel has **no Yama LSM** (`kernel.yama.ptrace_scope` is unavailable). |
| Podman | 5.7.1, machine kernel 6.17.7-300.fc43.aarch64, rootless. Machine VM `kernel.yama.ptrace_scope` defaults to **0** (permissive). |
| Image | `ghcr.io/vybestack/llxprt-code/sandbox` (0.11.0 / 0.10.0-nightly) |

> The container shares the host (or VM) kernel, so the host's
> `kernel.yama.ptrace_scope` governs `/proc/<pid>/mem` access **inside** the
> container. Both originally-tested environments are the permissive case
> (scope 0, or no Yama at all), which is why every row A–D recovered the token.
> Row E adds a host with scope 1 (the Ubuntu default) and is DENIED.

### Result matrix

`TOKEN_RECOVERED` means the descendant read the secret out of the ancestor's
heap; `MEM_OPEN_DENIED` means the `open()` of `/proc/<pid>/mem` returned
`EACCES`. `ptrace_scope` is the host/VM `kernel.yama.ptrace_scope` (Podman
machine VM or Docker Desktop VM), not anything the container sets.

| # | Flags | Runtime | uid | CapEff | NoNewPrivs | ptrace_scope | Result |
|---|---|---|---|---|---|---|---|
| A | current llxprt flags | Podman | 1000 | 0 | 0 | 0 | **TOKEN_RECOVERED** |
| A | current llxprt flags | Docker | 1000 | 0 | 0 | (no Yama) | **TOKEN_RECOVERED** |
| B | + `--user root` | Podman | 0 | default subset¹ | 0 | 0 | **TOKEN_RECOVERED** |
| B | + `--user root` | Docker | 0 | default subset¹ | 0 | (no Yama) | **TOKEN_RECOVERED** |
| C | `--cap-drop=ALL --security-opt no-new-privileges` | Podman | 1000 | 0 | 1 | 0 | **TOKEN_RECOVERED** |
| C | `--cap-drop=ALL --security-opt no-new-privileges` | Docker | 1000 | 0 | 1 | (no Yama) | **TOKEN_RECOVERED** |
| D | C + `--user root` | Podman | 0 | 0 | 1 | 0 | **TOKEN_RECOVERED** |
| D | C + `--user root` | Docker | 0 | 0 | 1 | (no Yama) | **TOKEN_RECOVERED** |
| E | C (flags are irrelevant to this vector) | Podman | 1000 | 0 | 1 | **1** | **MEM_OPEN_DENIED EACCES** |

¹ An ordinary root container does **not** hold "full" capabilities: the runtime
grants a default bounding subset that normally excludes `CAP_SYS_PTRACE`. None
of the rows grant `CAP_SYS_PTRACE`, and it would not matter anyway — reading a
same-UID process's `/proc/<pid>/mem` requires no capability.

### Conclusions

1. **The exposure is REAL but CONDITIONAL on the host kernel's Yama setting.**
   A process the agent controls inside the sandbox is a **descendant** of the
   token-holding CLI process, so it is trying to read an **ancestor**. Yama
   evaluates the tracer/tracee ancestry relationship regardless of PID
   namespace, and the container shares the host (or VM) kernel, so the host
   `kernel.yama.ptrace_scope` governs behavior inside the container:
   - `ptrace_scope >= 1` (the Ubuntu default and many distros): reading an
     ancestor's `/proc/<pid>/mem` is **DENIED** (`EACCES`) — row E.
   - `ptrace_scope == 0`, or no Yama LSM at all (Docker Desktop's macOS VM
     kernel reports no `ptrace_scope`): reading succeeds — rows A–D.

2. **The issue text's dependency on Yama is CORRECT.** An earlier draft of this
   conclusion claimed Yama was irrelevant because attacker and victim share the
   container's PID namespace. That was wrong: Yama applies across the shared
   kernel regardless of PID namespace, and the host sysctl is the deciding
   factor. The originally-tested environments happened to be the permissive
   ones (Podman VM scope 0; Docker Desktop VM with no Yama), which is why every
   row recovered the token.

3. **Every *container-invocation* remedy the issue proposes is ineffective
   against this vector.** (These remain empirically supported.)
   - `--cap-drop=ALL`: no effect. Reading `/proc/<pid>/mem` of a same-UID
     process requires no capability.
   - `--security-opt no-new-privileges`: no effect on this vector.
   - `--user root` vs. non-root: no difference (within a given ptrace_scope).
   - A seccomp profile that filters the `ptrace` syscall: ineffective, because
     `/proc/<pid>/mem` is accessed via `open()` plus `pread()`, not the
     `ptrace` syscall. Filtering `open`/`pread` is not viable in practice
     because classic seccomp cannot filter by path. (Row D runs under the
     default seccomp profile with all capabilities dropped and still succeeds
     — but only because the host ptrace_scope is 0; row E shows scope 1 denies
     it regardless of the seccomp profile.)
   - `kernel.yama.ptrace_scope` is not namespaced, so the container cannot set
     it; it is a **host** control, not an llxprt container flag.

4. **UID separation is NOT the only possible control.** Three controls exist:
   - A host with `kernel.yama.ptrace_scope >= 1` (rows A–D succeed only on the
     permissive environments; row E shows scope 1 denies the read). This is
     already the default on Ubuntu and many distributions.
   - Making the CLI process non-dumpable via `prctl(PR_SET_DUMPABLE, 0)`, which
     makes `/proc/<pid>/mem` root-owned so a same-UID reader is denied. Node
     cannot call `prctl` without native code, so this remains future work.
   - Per-command process-credential separation (the agent's commands run under
     a different UID than the CLI). Tested: with `--cap-drop=ALL`, a process
     cannot `setresuid` at all (`Operation not permitted`), so this requires
     the CLI to run as root holding `CAP_SETUID`/`CAP_SETGID` and to drop every
     agent-executed command to a separate unprivileged UID. That is an
     architectural change to tool execution, not a container invocation flag.
     It also inverts the current posture (CLI would have to be root) and
     creates workspace file-ownership problems. Deferred, requires separate
     approval.

5. **The capability token remains a meaningful secret in its own right.** It
   persists for the session and can be used to fetch a credential from the
   proxy endpoint at a time when no credential is yet resident in memory.
   Stealing it is therefore not *strictly* redundant with stealing the
   credential — although, once a credential is resident in the CLI's address
   space, anything that can read the CLI's heap can read the credential
   directly (`ProxyProviderKeyStorage.getKey()` returns the raw key into that
   same address space so the CLI can make provider calls).

### Honest restatement of the security property

> The credential never enters the sandbox's **filesystem, environment, or
> argv** — it is not written to any of them. It does enter the sandbox CLI
> process's address space when a provider call is made (the proxy endpoint
> that returns it requires the capability token).
>
> Whether a same-UID in-container process can read that memory is **conditional
> on the host kernel's Yama setting**, because the container shares the host
> (or VM) kernel:
> - On a host with `kernel.yama.ptrace_scope >= 1` (the Ubuntu default), the
>   descendant agent process is **denied** (`EACCES`) when it tries to read the
>   ancestor CLI process's `/proc/<pid>/mem` — row E.
> - On a host with `ptrace_scope == 0`, or where the Yama LSM is absent
>   (notably Docker Desktop for macOS, whose VM kernel reports no
>   `ptrace_scope`), the read **succeeds** and the capability token and
>   credential are recoverable — rows A–D.
>
> The sandbox defends against a prompt-injected agent that reads files,
> inspects environments, scans argv, or speaks the proxy protocol. On
> permissive Yama configurations it does **not** defend against one that reads
> the CLI process's memory; on a host with Yama `ptrace_scope >= 1` that
> descendant-reads-ancestor vector is blocked by the kernel.

## Evidence

Reproduce with the probe below (host must have Docker or Podman running):

    # victim holds the secret; a DESCENDANT tries to read it back
    TOKEN=deadbeef...4242 ; export VICTIM_PID=$$
    node -e 'read /proc/$VICTIM_PID/maps + /proc/$VICTIM_PID/mem, scan for TOKEN'

Full probe scripts are reproduced in the PR description. Transcripts show
`mem open: SUCCESS` and `RESULT: TOKEN_RECOVERED from <heap range>` for rows
A–D (the permissive environments: Podman VM `ptrace_scope == 0`, Docker
Desktop with no Yama). With the Podman machine VM set to
`kernel.yama.ptrace_scope == 1`, the same probe prints
`### yama.ptrace_scope: 1` and `RESULT: MEM_OPEN_DENIED EACCES` (row E).

## Step 2 — accepted scope

Issue item 3 ("add a behavioral test asserting that an in-container process
cannot obtain the capability token") asserts a property that **cannot be made
true** by the container-invocation changes in issue item 2. Shipping those
flags plus a test that only asserts the flags are present would be precisely
the reasoned-about, non-falsifiable hardening the issue set out to avoid.

Accepted: issue item 2 in full, plus the item-1 disproof recorded on the
issue, plus an honest restatement of the boundary in `docs/sandbox.md`.

**Item 3 is not delivered and is explicitly out of scope**, because it is not
achievable by container invocation flags. The tests written here assert the
properties the flags *do* deliver, and are falsifiable: they run real
containers and check observed kernel state and real escalation attempts, not
the presence of argv strings.

Deferred, requires separate approval: per-command UID separation (conclusion 4
above) is one design that would make item 3 true; the other two — a host with
Yama `ptrace_scope >= 1`, and making the CLI process non-dumpable via
`prctl(PR_SET_DUMPABLE, 0)` (which Node cannot call without native code) — are
host-level or future work, not container invocation flags.

## Acceptance matrix

| AC | Behavior | Evidence |
|---|---|---|
| AC1 | Every docker/podman sandbox run passes `--security-opt no-new-privileges`. | Args test over `buildContainerRunArgs`; real-container test observes `NoNewPrivs: 1`. |
| AC2 | Every docker/podman sandbox run passes `--cap-drop=ALL`. | Args test; real-container test observes `CapBnd: 0000000000000000` on the default path. |
| AC3 | The current-user path adds back exactly `CHOWN,SETUID,SETGID` — the proven minimum for `groupadd`/`useradd`/`su` — and nothing more. | Args test asserts the exact set; real-container test proves the path succeeds with the three and FAILS when any one is removed (leave-one-out negative coverage). |
| AC4 | The `LLXPRT_CODE_INTEGRATION_TEST` → `--user root` branch is removed and has no effect. | Test forces the non-current-user path (`SANDBOX_SET_UID_GID=false`) with the obsolete variable set and asserts no `--user`; `LLXPRT_CODE_INTEGRATION_TEST` is set nowhere in the repo. |
| AC5 | The current-user path still uses `--user root`, and the reason is documented in code. | Existing current-user behavior tests continue to pass; comment present. |
| AC6 | A non-root in-container process holds no capabilities and cannot escalate through the image's setuid-root binaries. | Real-container test attempts escalation via a shipped setuid binary and asserts failure. |
| AC7 | User `SANDBOX_FLAGS` are applied after the default hardening flags and survive into the argv. (The docs no longer promise `--cap-add` alone yields a usable capability in the final process — that depends on runtime and path.) | Args ordering test asserts `--cap-add=NET_ADMIN` follows `--cap-drop=ALL`. |
| AC8 | `docs/sandbox.md` states the boundary honestly, conditioned on the host Yama setting (including that Docker Desktop for macOS has no Yama so the exposure applies there). | Doc diff. |
| AC9 | The proxy sidecar `run` argv receives the same base hardening flags as the main container. | Unit test asserts the sidecar argv contains `--cap-drop=ALL` and `--security-opt no-new-privileges`. |

Real-container tests (AC1/AC2/AC3/AC6) RUN whenever a container runtime and the
sandbox image are available, and SKIP only when they genuinely are not — no CI
opt-in. Runtime selection honors `LLXPRT_SANDBOX=docker|podman` so the nominal
podman suite tests podman. The restructured test obtains its flags from the
production functions (`buildContainerRunArgs`/`setupContainerUser`) and asserts
on observed kernel state; it is falsifiable (removing the production hardening
makes it fail — verified during development).

## Non-goals

- No change to the credential proxy protocol, token format, or authorization.
- No new daemon, sidecar, or public abstraction.
- No workflow, dependency, or quality-tool change.
- No Seatbelt redesign.
- No seccomp profile: proven ineffective for this vector (conclusion 3).
- No change to the proxy container's command, image, or networking — only that
  it now receives the same base hardening flags as the main container (AC9),
  via the shared `BASE_CONTAINER_HARDENING_FLAGS` constant.

## Review triage

### Cycle 1 (design/security review)

| # | Finding | Class | Decision |
|---|---|---|---|
| F1 | Plan claimed host Yama is irrelevant; exposure asserted unconditionally | Blocker | ACCEPTED. Re-verified: at `ptrace_scope=1` the read is `MEM_OPEN_DENIED EACCES`; at `0` it is `TOKEN_RECOVERED`. Plan + docs rewritten to state the condition. The issue text was right and the earlier draft was wrong. |
| F2 | Proxy sidecar argv bypassed the hardening while docs claimed "every run" | Blocker | ACCEPTED. Extracted `BASE_CONTAINER_HARDENING_FLAGS` and applied it to both argv builders (AC9). |
| F3 | Real test silently no-opped in CI; runtime selection ignored `LLXPRT_SANDBOX` | Blocker | ACCEPTED. Gating now runs whenever runtime+image exist; runtime honors `LLXPRT_SANDBOX`. No workflow file was touched. |
| F4 | Real test duplicated flag constants and never called production code | Blocker | ACCEPTED. Test now sources flags from `buildContainerRunArgs`/`setupContainerUser`; expected kernel state remains independent literals. Falsifiability re-verified independently: removing the production hardening turns all 6 tests red. |
| F5 | AC4 unit test was host-dependent and would fail on Debian/Ubuntu CI | Blocker | ACCEPTED. Test forces `SANDBOX_SET_UID_GID=false`; current-user tests force `true`. |
| F6 | Capability set was not minimal | In-scope-Fix | ACCEPTED. Leave-one-out re-verified: `CHOWN,SETUID,SETGID` are each necessary and jointly sufficient; `DAC_OVERRIDE`/`FOWNER` removed. Negative leave-one-out coverage added. |
| F7 | Docs overpromised the `--cap-add` escape hatch | In-scope-Fix | ACCEPTED. Docs now state `--cap-add` widens the bounding set only, and that the final process depends on runtime and the current-user `su` path. |
| F8 | Docs contradicted the implementation on credential flow | In-scope-Fix | ACCEPTED. "Network reach" claim removed; "strictly redundant" softened — the token persists and can fetch a credential when none is resident. |
| F9 | Privileged-port claim wrong on modern Docker | In-scope-Fix | ACCEPTED. Corrected to kernel/sysctl dependent. |
| F10 | Removing the `LLXPRT_CODE_INTEGRATION_TEST` branch is unsafe | Reject | Reviewer's own rejection; the variable is set nowhere in the repo. |
| F11 | Seatbelt path is a bypass | Reject | Seatbelt is not a Docker/Podman invocation; macOS container mode uses the common builder. |
| F12 | `beforeEach` snapshot ordering defect | Reject | False positive; the snapshot is already taken first. |

### Cycle 2 (Open Code Review)

| # | Finding | Class | Decision |
|---|---|---|---|
| O1 | Redundant `runtime !== undefined` in the `skipTests` short-circuit | In-scope-Fix | ACCEPTED. Simplified to `runtime === undefined \|\| !imagePresent(...)`. |
| O2 | `parseUidLine` returned `NaN` silently on malformed input | In-scope-Fix | ACCEPTED. Now throws with the offending line (fail fast, consistent with `statusField`). |

## Known limitation

Empirical coverage is Docker and Podman on a macOS host, plus a Linux VM kernel
at both `ptrace_scope` settings. A native Linux host was not available; the
Yama-conditioned behavior is kernel-level and was measured directly in the
Podman VM's Linux kernel at both settings, which is the property that governs
the container.
