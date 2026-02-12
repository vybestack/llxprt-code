# Issue #1036: Fix Sandbox Git Support and macOS Compatibility

## Problem Statement

When using Docker or Podman sandboxing on macOS, several fundamental operations
fail — particularly anything involving Git. The sandbox was designed primarily
around file isolation and network control but did not account for the Git
toolchain's requirements around configuration, identity, filesystem boundaries,
or platform-specific SSH agent socket forwarding.

The result is that a macOS user launching `LLXPRT_SANDBOX=podman llxprt` hits a
cascade of failures: SSH agent errors, Git refusing to discover repositories,
missing user identity for commits, and a stale upstream error message referencing
Google instead of the llxprt project.

## Root Causes

### 1. Stale upstream error message

The sandbox image pull failure path still contains `gemini-cli-dev@google.com`
from the original gemini-cli fork. Users hitting sandbox errors are directed to
a Google team that has nothing to do with this project.

**Location**: `packages/cli/src/utils/sandbox.ts` line 526

### 2. Git filesystem boundary

Docker and Podman mount the project directory into the container, which creates a
filesystem boundary at the mount point. Git's default behavior is to refuse to
look beyond filesystem boundaries for `.git` directories (a security feature).
The sandbox does not set `GIT_DISCOVERY_ACROSS_FILESYSTEM=1`, so any Git
operation that relies on discovering a repository in a parent directory fails
with "not a git repository."

This is always the correct behavior inside a container — the mount boundary is an
artifact of containerization, not a meaningful security signal.

**Location**: container environment setup in `start_sandbox()`

### 3. Missing Git configuration

The sandbox mounts the working directory, user settings, tmpdir, gcloud config,
and ADC credentials — but not the user's Git configuration. This means:

- `~/.gitconfig` — user.name, user.email, aliases, includes, core settings
- `~/.config/git/config` — XDG-standard alternative location
- `~/.gitignore_global` — referenced by gitconfig's `core.excludesFile`

None of these are available inside the container. Git commits fail because
there's no configured identity. The macOS seatbelt profiles already grant read
access to `~/.gitconfig`, but the Docker/Podman code path was never updated to
match.

**Location**: volume mount section of `start_sandbox()`

### 4. SSH agent forwarding broken on macOS

The current SSH agent code has a single path: mount the host's `SSH_AUTH_SOCK`
directly into the container. This works on Linux where containers share the
host kernel and can access Unix sockets natively. On macOS it fails because
both Docker and Podman run containers inside a Linux VM, and Unix sockets
cannot be shared across the hypervisor boundary via virtiofs.

The specifics differ by engine:

- **Docker Desktop** has solved this since v2.2.0 with a built-in "magic socket"
  at `/run/host-services/ssh-auth.sock` inside the VM that bridges to the host's
  SSH agent. The sandbox code does not use it.

- **Podman** has no built-in equivalent. The standard workaround is to establish
  an SSH reverse tunnel (`ssh -R`) from the macOS host into the Podman machine
  VM, creating a socket inside the VM that containers can then mount. The sandbox
  code does not do this — it warns about launchd sockets but still attempts the
  direct mount, which fails with `statfs: operation not supported`.

Resource limits (`--cpus`, `--memory`, `--pids-limit`) are only available via
Docker/Podman containers, not macOS seatbelt sandboxing. This means telling
macOS users to "just use sandbox-exec" is not viable when they need resource
isolation. The Docker/Podman path must work properly on macOS.

## Architecture

All changes are in `packages/cli/src/utils/sandbox.ts`.

### Fix 1: Error message correction

Replace the stale Google email reference with a link to the project's
discussions page. One line, no behavioral change.

### Fix 2: Git filesystem boundary

Unconditionally set `GIT_DISCOVERY_ACROSS_FILESYSTEM=1` in the container
environment. This is always appropriate inside a container mount and has no
security implications — the sandbox already controls what the container can
access.

### Fix 3: Git configuration mounts

Mount the user's Git configuration files read-only into the container:

- `~/.gitconfig` (traditional path)
- `~/.config/git/config` (XDG path)
- `~/.gitignore_global` (commonly referenced by gitconfig)

Each is guarded by an existence check and mounted `:ro`. The mounts must be
placed at both the host home path and the container home path to handle the
dual-HOME scenario — the container may run as the host user (HOME =
`/Users/foo`) or as the default `node` user (HOME = `/home/node`). This
dual-mount pattern is already established in the codebase for the user settings
directory.

`.git-credentials` is intentionally excluded. It contains plaintext tokens and
is a security-sensitive file. Users who need credential helpers inside the
sandbox can use the existing `SANDBOX_MOUNTS` mechanism to opt in explicitly.

### Fix 4: Platform-aware SSH agent forwarding

The current single-path SSH mount is replaced with three engine-specific
strategies, extracted into a dedicated helper function for testability:

**Linux (any engine)**: Direct mount of `SSH_AUTH_SOCK` into the container.
This is the current behavior and works because Linux containers share the host
kernel. For Podman on Linux, the `:z` SELinux flag is applied (existing
behavior preserved).

**Docker on macOS**: Detect Docker Desktop via `docker info` AND verify the
magic socket (`/run/host-services/ssh-auth.sock`) exists inside the VM. When
both checks pass, mount the socket into the container. If either check fails
(e.g., running Docker Engine via Colima), SSH agent forwarding is skipped with
a warning.

**Podman on macOS**: Automate the SSH reverse tunnel into the Podman machine VM:

1. Obtain Podman machine SSH connection details via
   `podman system connection list --format json` (JSON for reliable parsing —
   the text format is not stable across versions).
2. Clean up any stale forwarded socket inside the VM.
3. Spawn a background `ssh -R` process that forwards the host's
   `SSH_AUTH_SOCK` to a known socket path inside the VM.
4. Poll for the socket's existence inside the VM (not a fixed sleep) with a
   timeout.
5. Mount the forwarded socket into the container.

The tunnel process is managed using the same lifecycle pattern as the existing
proxy process: registered for cleanup on `exit`, `SIGINT`, and `SIGTERM`, with
an idempotent guard to prevent double-cleanup if multiple signals fire.

If any step of the tunnel setup fails, the sandbox launch fails fast with a
`FatalSandboxError` explaining the failure and suggesting the user verify their
Podman machine is running.
