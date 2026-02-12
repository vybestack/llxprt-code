# Issue #1036: Requirements (EARS Format)

Requirements follow the Easy Approach to Requirements Syntax (EARS) format.
The system under specification is the sandbox launcher
(`packages/cli/src/utils/sandbox.ts`).

---

## R1: Error Message Branding

### R1.1 — Event-Driven

When the sandbox image is missing or cannot be pulled, the sandbox launcher
shall display `https://github.com/vybestack/llxprt-code/discussions` as the
support destination in the error message.

### R1.2 — Unwanted Behavior

If the sandbox image cannot be pulled, the sandbox launcher shall not display
any reference to `gemini-cli-dev@google.com` or any other upstream project
contact information.

---

## R2: Git Repository Discovery

### R2.1 — Ubiquitous

The sandbox launcher shall set the environment variable
`GIT_DISCOVERY_ACROSS_FILESYSTEM=1` inside every Docker and Podman container
it launches, regardless of host platform or engine.

---

## R3: Git Configuration

### R3.1 — Event-Driven

When `~/.gitconfig` exists on the host, the sandbox launcher shall mount it
read-only into the container. The mount targets shall follow the dual-HOME
pattern specified in R3.4.

### R3.2 — Event-Driven

When `~/.config/git/config` exists on the host, the sandbox launcher shall
mount it read-only into the container. The mount targets shall follow the
dual-HOME pattern specified in R3.4.

### R3.3 — Event-Driven

When `~/.gitignore_global` exists on the host, the sandbox launcher shall
mount it read-only into the container. The mount targets shall follow the
dual-HOME pattern specified in R3.4.

### R3.4 — State-Driven

While the container runs as a user whose HOME differs from the host user's
HOME, the sandbox launcher shall mount each Git configuration file at both the
host home path and the container home path, so that Git resolves the file
regardless of which HOME is active.

### R3.5 — Ubiquitous

The sandbox launcher shall mount all Git configuration files (R3.1, R3.2,
R3.3) as read-only (`:ro`).

### R3.6 — Unwanted Behavior

If any of the optional Git configuration files (`~/.gitconfig`,
`~/.config/git/config`, `~/.gitignore_global`) do not exist on the host, the
sandbox launcher shall continue launching the container without failure.

### R3.7 — Unwanted Behavior

If `~/.git-credentials` exists on the host, the sandbox launcher shall not
mount it into the container automatically. Users shall opt in to credential
file access via the existing `SANDBOX_MOUNTS` / `LLXPRT_SANDBOX_MOUNTS`
mechanism.

---

## R4: SSH Agent Forwarding — General

### R4.1 — State-Driven

While `LLXPRT_SANDBOX_SSH_AGENT` or `SANDBOX_SSH_AGENT` is set to `off`, the
sandbox launcher shall not attempt SSH agent forwarding regardless of platform
or engine.

### R4.2 — Event-Driven

When `SSH_AUTH_SOCK` is not set and SSH agent forwarding has not been
explicitly disabled via `LLXPRT_SANDBOX_SSH_AGENT=off` or
`SANDBOX_SSH_AGENT=off`, the sandbox launcher shall emit a warning and skip
SSH agent forwarding.

### R4.3 — Ubiquitous

The sandbox launcher shall set `SSH_AUTH_SOCK=/ssh-agent` inside the container
whenever SSH agent forwarding is successfully established, regardless of
platform or engine.

### R4.4 — Ubiquitous

The sandbox launcher shall preserve the existing SSH agent opt-in/opt-out
semantics: `LLXPRT_SANDBOX_SSH_AGENT=on` forces SSH forwarding,
`LLXPRT_SANDBOX_SSH_AGENT=off` disables it, and when unset the launcher
enables forwarding if `SSH_AUTH_SOCK` is present in the environment.

---

## R5: SSH Agent Forwarding — Linux

### R5.1 — State-Driven

While the host platform is Linux and the engine is Docker, the sandbox launcher
shall mount the host's `SSH_AUTH_SOCK` directly into the container at
`/ssh-agent`.

### R5.2 — State-Driven

While the host platform is Linux and the engine is Podman, the sandbox launcher
shall mount the host's `SSH_AUTH_SOCK` into the container at `/ssh-agent` with
the `:z` SELinux relabeling flag.

---

## R6: SSH Agent Forwarding — Docker on macOS

### R6.1 — Event-Driven

When the host platform is macOS and the engine is Docker, the sandbox launcher
shall check for Docker Desktop by inspecting `docker info` output AND
verifying that the socket path `/run/host-services/ssh-auth.sock` exists
inside the VM. When both checks pass, the sandbox launcher shall mount that
socket into the container at `/ssh-agent`.

### R6.2 — Event-Driven

When the host platform is macOS and the engine is Docker and either the Docker
Desktop check or the socket existence check fails, the sandbox launcher shall
emit a warning that SSH agent forwarding is unavailable and skip the SSH agent
mount without failing the sandbox launch.

---

## R7: SSH Agent Forwarding — Podman on macOS

### R7.1 — Event-Driven

When the host platform is macOS and the engine is Podman, the sandbox launcher
shall establish an SSH reverse tunnel from the host's `SSH_AUTH_SOCK` to a
socket inside the Podman machine VM.

### R7.2 — Event-Driven

When establishing the Podman SSH tunnel, the sandbox launcher shall obtain
connection details by parsing the JSON output of
`podman system connection list --format json`. The sandbox launcher shall
select the connection marked as default. If no default is marked but exactly
one connection exists, the sandbox launcher shall use that connection. If no
connections exist or multiple non-default connections exist, the sandbox
launcher shall throw a `FatalSandboxError` with remediation guidance (e.g.,
verify `podman machine` is running).

### R7.3 — Event-Driven

When establishing the Podman SSH tunnel, the sandbox launcher shall remove any
stale forwarded socket inside the VM before spawning the tunnel process.

### R7.4 — Event-Driven

When the Podman SSH tunnel process is spawned, the sandbox launcher shall poll
for the forwarded socket's existence inside the VM with a timeout, rather than
using a fixed delay.

### R7.5 — Event-Driven

When the Podman SSH tunnel is successfully established, the sandbox launcher
shall mount the forwarded socket from the VM into the container at `/ssh-agent`.

### R7.6 — Unwanted Behavior

If the Podman machine connection details cannot be obtained or the JSON output
is malformed or unparseable, the sandbox launcher shall throw a
`FatalSandboxError` with actionable remediation guidance and shall not launch
the container.

### R7.7 — Unwanted Behavior

If the SSH reverse tunnel process fails to start, the sandbox launcher shall
throw a `FatalSandboxError` with actionable remediation guidance and shall not
launch the container.

### R7.8 — Unwanted Behavior

If the forwarded socket does not appear within the polling timeout, the sandbox
launcher shall kill the tunnel process, throw a `FatalSandboxError` with
actionable remediation guidance, and shall not launch the container.

### R7.9 — Event-Driven

When the sandbox launcher receives an exit event, SIGINT, or SIGTERM, or when
the sandbox container process terminates, the sandbox launcher shall terminate
the SSH tunnel process if one was started.

### R7.10 — Unwanted Behavior

If multiple exit signals fire in rapid succession, the sandbox launcher shall
ensure the tunnel cleanup runs exactly once (idempotent cleanup).

### R7.11 — Event-Driven

When the sandbox process exits and an SSH tunnel was started, the sandbox
launcher shall attempt to remove the forwarded socket from inside the Podman
machine VM as part of cleanup. Failure to remove the socket (e.g., the VM is
already stopped) shall not cause the launcher to throw or block exit.

---

## Known Limitations (Out of Scope)

The following are explicitly not addressed by this change:

- **Git `[include]` paths**: If `~/.gitconfig` references additional config
  files via `[include]`, those referenced files are not automatically mounted.
  Users can mount them via `SANDBOX_MOUNTS`.

- **`~/.git-credentials`**: Not mounted automatically due to security
  sensitivity (plaintext tokens). Available via `SANDBOX_MOUNTS` opt-in.

- **Non-Docker-Desktop Docker on macOS** (e.g., Colima, Lima): SSH agent
  forwarding is not supported for these configurations. The
  `/run/host-services/ssh-auth.sock` magic socket is specific to Docker
  Desktop. A warning is emitted and SSH agent forwarding is skipped.

- **Concurrent sandbox sessions with Podman on macOS**: The forwarded socket
  uses a fixed path (`/tmp/ssh-agent.sock`) inside the VM. Concurrent sandbox
  launches may conflict. This is a pre-existing limitation of the single-VM
  Podman architecture on macOS.
