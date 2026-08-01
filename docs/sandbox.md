# Sandboxing

Sandboxing runs LLxprt Code's tool execution inside an isolated boundary so
that commands an LLM generates cannot freely read or modify the rest of your
system. This page covers what the sandbox protects against, what it does **not**
protect against, the per-engine boundaries, and how to verify the boundary is
where you expect.

For a step-by-step walkthrough, see the
[Sandbox Setup Tutorial](./tutorials/sandbox-setup.md). For the full profile
reference, see [Sandbox Profiles](./cli/sandbox-profiles.md).

## Quick Start

```bash
# Sandbox with automatic engine detection
llxprt --sandbox "fix the tests"

# Load a sandbox profile with resource limits
llxprt --sandbox-profile-load dev "refactor this module"

# Explicitly pick an engine
llxprt --sandbox-engine podman "review this code"
```

## Threat model

**What sandboxing is intended to protect against:**

- Accidental or unintended writes outside your project directory and temp
  directory (for example, an LLM-generated `rm -rf` or a test runner writing
  to your home directory).
- Unbounded resource consumption — a process spawning hundreds of workers or
  exhausting memory can be capped via profile resource limits
  (`cpus`, `memory`, `pids`).
- Exposure of stored long-lived secrets to tool execution. In container mode
  (Docker or Podman), the host keyring and token store are not mounted; the
  container receives short-lived access tokens through a credential proxy.

**What sandboxing is NOT intended to protect against:**

- A malicious, determined adversary who targets your specific machine.
- Data already inside the project directory. The project directory is mounted
  read-write and is fully accessible to tool execution by design.
- Secrets that are explicitly forwarded into the sandbox by design (see
  [Deliberate boundary crossings](#deliberate-boundary-crossings)).
- Network exfiltration of data that networking is left enabled for. If
  `network` is `on`, outbound network access is available to tool execution.

The sandbox raises the bar for accidental damage and limits the blast radius of
LLM-generated commands. It is a containment control, not a full security
isolation boundary.

## What is isolated, and what is not

The boundary differs by engine. The table summarizes what each engine isolates
by default. Detailed limitations follow.

| Boundary          | Docker / Podman (container)                 | Seatbelt (macOS `sandbox-exec`)                            |
| ----------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Filesystem writes | Restricted to mounted paths (project, temp) | Restricted to allow-listed paths (project, temp, config)   |
| Filesystem reads  | Restricted to mounted paths                 | Broader read access; writes are the primary restriction    |
| Network           | Configurable (`on` / `off` / `proxied`)     | Configurable; selects a matching built-in Seatbelt profile |
| Resource limits   | Enforced (`cpus`, `memory`, `pids`)         | Not available                                              |
| Process isolation | Separate container process namespace        | Runs directly on your host                                 |
| Stored secrets    | Not mounted; accessed via credential proxy  | Host keyring and token store are fully available           |

### Filesystem

In container mode, only these paths are mounted into the container:

- Your project working directory (read-write)
- The system temp directory (read-write)
- The LLxprt Code settings directory (read-write)
- Git configuration files, mounted read-only (see
  [Git config passthrough](#git-config-passthrough))

Everything else on your host (`~/.ssh` private keys, `~/.aws`, other projects)
is not accessible from inside the container.

Seatbelt restricts **writes** to an allow-list of paths (project directory, temp
directory, and canonical config/data/cache/log roots). It grants broader read
access, including a read-only grant for the legacy `~/.llxprt` directory for
migration.

### Network

Network access is controlled by the profile `network` setting, which takes
`on`, `off`, or `proxied`. Both container mode and Seatbelt honour it, by
different mechanisms.

In container mode:

- `on` (default for the `dev` profile) — outbound network is available.
- `off` — the container is started with `--network none`.
- `proxied` — container traffic is routed through a proxy you supply. This
  requires `LLXPRT_SANDBOX_PROXY_COMMAND` to be set to a non-empty value.
  If it is missing or blank, LLxprt Code **fails before the container starts**
  rather than falling back to open networking.

Under Seatbelt, the setting selects a built-in macOS profile: `off` uses
`permissive-closed`, `proxied` uses `permissive-proxied`, and `on` (or an unset
value) uses `permissive-open`. The proxied profiles also require
`LLXPRT_SANDBOX_PROXY_COMMAND`, and fail without it.

> **Note:** Setting `SEATBELT_PROFILE` explicitly overrides this selection and
> is an advanced escape hatch. Custom profile names keep their own lookup
> behavior.

> **Warning:** On macOS, the Docker and Podman credential bridge needs container
> networking, so `network: off` in container mode fails before the proxy or
> container starts. Use `on`, or run on Linux, when you need network-off
> containers with credential isolation.

### Resource limits

Container mode enforces resource limits via the profile `resources` fields:

- `cpus` — CPU core limit (`--cpus`)
- `memory` — memory limit (`--memory`)
- `pids` — maximum process count (`--pids-limit`)

Seatbelt does not support resource limits. A runaway process under Seatbelt can
consume your machine's resources.

### Process

Container mode runs in a separate process namespace. Seatbelt runs directly on
your host with macOS kernel restrictions applied via `sandbox-exec`.

## Per-engine limitations

### Docker

Best tested and the default for most users. Auto-detected when `docker` is on
your `PATH`. Resource limits, networking control, and the credential proxy are
all supported.

### Podman

Supported with full resource limits and credential proxy. On macOS, Podman runs
containers inside a Linux VM, which introduces two platform-specific
limitations:

1. **SSH agent forwarding and credential proxy tunneling** require `socat` in
   the container image and use an SSH reverse tunnel because the host socket
   cannot be mounted directly into the VM.
2. **Memory** has a hard ceiling set by the Podman machine VM, separate from the
   container memory limit. See
   [Podman macOS: OOM-killed with exit code 137](#podman-macos-oom-killed-with-exit-code-137).

### Seatbelt (macOS `sandbox-exec`)

Seatbelt is a macOS-only fallback that uses Apple's `sandbox-exec` command. It
runs directly on your host — there is no container and no separate process
namespace.

Limitations:

- **No resource limits** — CPU, memory, and process count cannot be capped.
- **No credential isolation** — the sandboxed process runs with your full host
  keyring and token store. The credential proxy is not used (the
  `LLXPRT_CREDENTIAL_SOCKET` variable is explicitly removed from the Seatbelt
  child environment).
- **Network rules come from the profile file** — the `network` setting selects a
  built-in macOS profile (`permissive-closed`, `permissive-proxied`, or
  `permissive-open`) rather than isolating a network namespace. The process
  still runs directly on your host.
- **`sandbox-exec` is undocumented** — Apple has shipped `sandbox-exec` without
  public documentation for many releases. Its profile format and future
  availability are not guaranteed.

Seatbelt is auto-detected only on macOS when `sandbox-exec` is on your `PATH`.
Use Docker or Podman when available.

## Deliberate boundary crossings

The sandbox intentionally forwards certain credentials and configuration into
the boundary so that development workflows (authentication, git operations)
continue to work. These are deliberate holes in the boundary, and each carries
a risk you should understand before enabling.

### Credential proxy (container mode only)

In Docker or Podman mode, a host-side credential proxy runs over a Unix socket
(the path is set via the `LLXPRT_CREDENTIAL_SOCKET` environment variable). This
is a deliberate boundary crossing: it lets the container authenticate with your
providers without receiving your stored secrets directly.

What the proxy provides:

- **Short-lived access tokens** — the container receives short-lived tokens, not
  your stored refresh tokens. Refresh tokens stay on the host.
- **Key reads** — `/key list`, `/key show`, and key resolution for providers
  read host-saved keys through the proxy.
- **OAuth flows** — OAuth login opens the browser on the host; the container
  authenticates through the proxy.

What the proxy blocks:

- **Key writes are blocked** — `/key save` and `/key delete` throw an error in
  container mode ("API key management is not available in sandbox mode"). Keys
  must be managed on the host.
- **Your stored secrets are not mounted** — `~/.git-credentials` is
  intentionally not mounted into the container.

How the container proves it is authorised: a per-session capability token is
passed to LLxprt Code through an inherited file descriptor, never through
process arguments, the container environment, or a file mounted where the
sandbox can read it. Processes that run before the CLI — relays, launchers,
your `sandbox.bashrc` — never see it. Reaching the socket is therefore not
sufficient by itself; a client without the consumed capability is rejected as
`UNAUTHORIZED`.

> **Risk:** A compromised process inside the container that obtains the
> capability token can authenticate as you for the lifetime of the session.
> The transport above narrows how it could be obtained; it does not change the
> fact that the boundary is deliberately crossed to enable authentication.

On Linux, `network: off` containers still reach the proxy over the mounted
temp-directory socket. On macOS, the Docker and Podman credential bridges need
container networking, so `network: off` fails before the proxy, bridge, or
container starts — see [Network](#network).

> **Note:** Seatbelt mode does not use the credential proxy. It runs on your
> host with full access to your keyring and token store.

### SSH agent forwarding

When `sshAgent` is `auto` or `on` and `SSH_AUTH_SOCK` is set on the host, the
SSH agent socket is forwarded into the container so that `git push`, `git pull`,
and other SSH operations work.

- **Docker on Linux:** the socket is mounted directly into the container.
- **Docker on macOS:** a TCP-to-Unix-socket bridge is used (Docker Desktop's
  socket is inaccessible to the non-root container user).
- **Podman on macOS:** an SSH reverse tunnel is set up (requires `socat` in the
  container image).

> **Risk:** A compromised process inside the container can use the forwarded
> SSH agent to authenticate SSH connections as you for the duration of the
> session. Private keys are not copied into the container, but agent forwarding
> grants the ability to sign SSH challenges.

For Podman on macOS, an existing non-host `--network` setting stays
authoritative. LLxprt Code warns and skips SSH agent forwarding rather than
overriding your network policy to make forwarding work.

### Git config passthrough

These files are mounted read-only into the container when they exist on the
host, so that git identity and known-host configuration work:

- `~/.gitconfig`
- `~/.config/git/config`
- `~/.gitignore_global`
- `~/.ssh/known_hosts`

`~/.git-credentials` is intentionally **not** mounted — credential access goes
through the proxy, not through a plaintext credentials file.

> **Risk:** The mounted files are read-only, but their contents (git identity,
> known hosts) are visible to any process in the container.

## Verifying the sandbox is active

Run these commands from **inside** a sandboxed session to confirm the boundary
is where you expect.

### Confirm you are inside a container

The `SANDBOX` environment variable is set to the container name when running
under Docker or Podman, and to `sandbox-exec` under Seatbelt:

```bash
echo "$SANDBOX"
```

A non-empty value confirms the sandbox is active.

### Confirm the engine

```bash
# Inside the container, check which runtime is in use
# (container mode only)
cat /proc/1/cgroup 2>/dev/null | head -5
```

Or verify from outside, before starting the session, that the engine binary
exists:

```bash
which docker || which podman || which sandbox-exec
```

### Confirm filesystem isolation

```bash
# This should succeed (project directory is read-write)
touch ./sandbox-test-file && rm ./sandbox-test-file && echo "project: writable"

# This should fail inside a container (home directory is not mounted)
# Replace ~ with an absolute path to a file outside your project
test -r ~/.ssh/id_ed25519 && echo "WARNING: private key readable" || echo "private key not accessible"
```

### Confirm network isolation (container mode)

With a `network: off` profile, outbound connections should fail:

```bash
# Inside a network-off container, this should fail or hang
curl --connect-timeout 5 https://example.com || echo "network is blocked"
```

### Confirm credential socket (container mode)

```bash
# The credential socket path should be set in the environment
echo "$LLXPRT_CREDENTIAL_SOCKET"
```

## Choosing an engine

| Engine       | Platform     | Resource limits | Credential proxy | Network control              |
| ------------ | ------------ | --------------- | ---------------- | ---------------------------- |
| **Docker**   | macOS, Linux | Yes             | Yes              | Yes (network namespace)      |
| **Podman**   | macOS, Linux | Yes             | Yes              | Yes (network namespace)      |
| **Seatbelt** | macOS only   | No              | No               | Yes (via macOS profile file) |

When `--sandbox` is used without an explicit engine, LLxprt Code auto-detects an
available runtime. When `LLXPRT_SANDBOX=true` is set in the environment and no
engine is specified, the detection order on macOS is Seatbelt, then Docker, then
Podman; on Linux it is Docker, then Podman.

## Configuring sandboxing

### CLI flags

```bash
llxprt --sandbox                              # Enable with auto-detected engine
llxprt --sandbox-engine docker                # Force Docker
llxprt --sandbox-engine podman                # Force Podman
llxprt --sandbox-engine sandbox-exec          # Force Seatbelt (macOS only)
llxprt --sandbox-engine none                  # Explicitly disable
llxprt --sandbox-profile-load <name>          # Load a profile
```

`--sandbox-engine` accepts: `auto`, `docker`, `podman`, `sandbox-exec`, `none`.

### Environment variable

```bash
export LLXPRT_SANDBOX=true                    # Enable sandbox (auto-detect engine)
export LLXPRT_SANDBOX=docker                  # Enable and force a specific engine
export LLXPRT_SANDBOX=false                   # Disable
```

`LLXPRT_SANDBOX` accepts a boolean (`true`/`false`/`1`/`0`) or an engine name
(`docker`, `podman`, `sandbox-exec`). When set to `true`, LLxprt Code
auto-detects an available engine.

`--sandbox-engine none` always wins, even when `LLXPRT_SANDBOX` is set.

### Sandbox profiles

Profiles are JSON files in your config directory under `sandboxes/` (see
[Application Directories](./reference/application-directories.md)). They control
engine, image, resources, networking, SSH agent, and extra mounts. Default
profiles are created automatically the first time you use
`--sandbox-profile-load`.

#### Built-in profiles

| Profile   | Network | SSH Agent | CPUs | Memory | PIDs | Use case                |
| --------- | ------- | --------- | ---- | ------ | ---- | ----------------------- |
| `dev`     | on      | auto      | 2    | 4 GB   | 256  | Normal development      |
| `safe`    | off     | off       | 2    | 4 GB   | 128  | Untrusted code review   |
| `tight`   | off     | off       | 1    | 2 GB   | 64   | Maximum restriction     |
| `offline` | off     | off       | 2    | 4 GB   | 128  | Local/offline workflows |

#### Profile format

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:0.9.0",
  "resources": {
    "cpus": 2,
    "memory": "4g",
    "pids": 256
  },
  "network": "on",
  "sshAgent": "auto",
  "mounts": [],
  "env": {}
}
```

| Field              | Valid values                                       | Description                                                |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------------- |
| `engine`           | `auto`, `docker`, `podman`, `sandbox-exec`, `none` | Container runtime                                          |
| `image`            | string                                             | Container image (defaults to the release image)            |
| `resources.cpus`   | number                                             | CPU core limit                                             |
| `resources.memory` | string                                             | Memory limit (e.g., `4g`, `512m`)                          |
| `resources.pids`   | number                                             | Max process count                                          |
| `network`          | `on`, `off`, `proxied`                             | Sandbox network policy (see [Network](#network))           |
| `sshAgent`         | `auto`, `on`, `off`                                | SSH agent forwarding into container                        |
| `mounts`           | array                                              | Extra mounts (`{from, to?, mode?}`); mode defaults to `ro` |
| `env`              | object                                             | Additional environment variables                           |

> **Note:** `network: proxied` requires `LLXPRT_SANDBOX_PROXY_COMMAND`. Without
> it, startup fails rather than silently using open networking.

#### Creating a custom profile

Create a JSON file in your `sandboxes/` directory (see
[Application Directories](./reference/application-directories.md)):

```bash
cat > "<config>/sandboxes/beefy.json" << 'EOF'
{
  "engine": "docker",
  "resources": { "cpus": 4, "memory": "8g", "pids": 512 },
  "network": "on",
  "sshAgent": "auto"
}
EOF

llxprt --sandbox-profile-load beefy "run the full test suite"
```

Replace `<config>` with your config directory path (see
[Application Directories](./reference/application-directories.md)).

## Advanced

### Extra container flags

Pass additional flags to the container runtime:

```bash
export SANDBOX_FLAGS="--security-opt label=disable"
```

### UID/GID mapping (Linux)

By default on Debian and Ubuntu-based Linux, the container runs as your current
user UID/GID. To force this behavior on other distributions:

```bash
export SANDBOX_SET_UID_GID=true
```

### Override the sandbox image

```bash
export LLXPRT_SANDBOX_IMAGE=my-registry/my-sandbox:latest
```

## Troubleshooting

**Container not starting** — verify Docker or Podman is running: `docker info`
or `podman info`.

**Permission errors on mounted files** — on Linux, try `SANDBOX_SET_UID_GID=true`
or `SANDBOX_FLAGS="--security-opt label=disable"` for SELinux systems.

**SSH not working in Podman on macOS** — use a stable socket path. The default
launchd socket paths are unreliable. Set up a dedicated socket:

```bash
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock
ssh-add ~/.ssh/id_ed25519
llxprt --sandbox-engine podman --sandbox-profile-load dev
```

**"socat not found" error** — the sandbox container image needs `socat` for SSH
agent and credential proxy tunneling. Use the official sandbox image.

**Network access denied** — check your profile's `network` setting. In container
mode `off` means `--network none`; under Seatbelt it selects the closed macOS
profile.

**"requires a non-empty LLXPRT_SANDBOX_PROXY_COMMAND"** — you set
`network: proxied` without supplying a proxy command. Set
`LLXPRT_SANDBOX_PROXY_COMMAND`, or change the profile to `on` or `off`.

**"macOS credential bridge requires container networking"** — you combined
`network: off` with Docker or Podman on macOS. The credential bridge needs
networking there. Use `network: on`, switch to Seatbelt, or run on Linux.

### Podman macOS: OOM-killed with exit code 137

On macOS, Podman runs containers inside a Linux VM. There are three separate
memory limits, and all three must be sized correctly:

1. **Podman machine VM memory** — the total memory allocated to the Podman VM.
   This is the hard ceiling for everything running inside the VM.
2. **Container memory limit** (`resources.memory` in a sandbox profile) — the
   per-container limit passed to the container runtime. You can set this higher
   than the VM memory, but the process will be OOM-killed when the VM runs out
   of memory first.
3. **Node.js heap limit** (`--max-old-space-size`) — automatically derived from
   the container memory limit when `ui.autoConfigureMaxOldSpaceSize` is enabled
   (the default).

If you set the container memory higher than the Podman VM memory, the container
starts but the process gets OOM-killed (exit code 137) as soon as it tries to
use more memory than the VM has available. LLxprt Code does not resize the
Podman machine VM.

**Check current VM memory** (output is in MiB, e.g., 8192 = 8 GiB):

```bash
podman machine inspect --format '{{.Resources.Memory}}'
```

**Resize VM memory** (use `podman machine ls` to find your machine name):

```bash
podman machine ls
podman machine stop <machine-name>
podman machine set --memory 16384 <machine-name>
podman machine start <machine-name>
```

**Sizing guidance:** Set VM memory higher than your container memory limit to
leave headroom for Podman VM overhead and any other processes running inside the
VM. For example, if your sandbox profile uses `"memory": "8g"`, set VM memory to
at least 10–12 GB.

## Related

- [Sandbox Profiles](./cli/sandbox-profiles.md) — full profile reference
- [Sandbox Setup Tutorial](./tutorials/sandbox-setup.md) — step-by-step walkthrough
- [Authentication](./cli/authentication.md) — credential setup
- [Profiles](./cli/profiles.md) — model and load balancer profiles (separate from sandbox profiles)
- [Provider Models and Limits](./providers/models-and-limits.md) — mutable model and pricing reference
