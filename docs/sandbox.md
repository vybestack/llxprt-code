# Sandboxing

You should use sandboxing. LLMs leak PATs and other secrets into shell commands, write files outside your working directory, and love launching dozens of parallel test runs that black-screen your machine. Sandboxing makes all of this nearly impossible.

## Quick Start

```bash
# Sandbox with automatic engine detection (Docker > Podman > Seatbelt)
llxprt --sandbox "fix the tests"

# Load a sandbox profile with resource limits
llxprt --sandbox-profile-load dev "refactor this module"

# Explicitly pick an engine
llxprt --sandbox-engine podman "review this code"
```

## What Sandboxing Does

Container sandboxing (Docker or Podman) runs LLxprt's tool execution inside an isolated container. This gives you:

- **File isolation** — the LLM can only touch your project directory (mounted read-write) and temp files. It can't access `~/.ssh`, `~/.aws`, other repos, or anything else on your system.
- **Credential isolation** — API keys, refresh tokens, and keyring data stay on the host. The container gets short-lived access tokens via a credential proxy over a Unix socket. The LLM never sees your stored secrets.
- **Resource limits** — cap CPU, memory, and process count. No more black-screened laptops from `vitest --run` spawning 200 workers.
- **Network control** — disable networking entirely for untrusted code, or leave it on for normal development.
- **SSH agent forwarding** — git push/pull still works inside the sandbox via agent forwarding (no private keys copied in).

## Choosing an Engine

| Engine       | Best for                   | Notes                                                                                          |
| ------------ | -------------------------- | ---------------------------------------------------------------------------------------------- |
| **Docker**   | Most users on macOS/Linux  | Best tested, auto-detected first                                                               |
| **Podman**   | Rootless containers, Linux | Full support; macOS needs extra setup for SSH/credential tunneling                             |
| **Seatbelt** | Lightweight macOS fallback | Uses `sandbox-exec`. No resource limits, no credential isolation. Discouraged for serious use. |

Engine auto-detection order: Docker → Podman → Seatbelt (macOS only).

### Why Not Seatbelt?

Seatbelt (`sandbox-exec`) runs directly on the host with macOS kernel restrictions. It restricts file system access but:

- **No resource limits** — can't cap CPU, memory, or process count
- **No credential isolation** — runs with your full keyring and token store
- **No network isolation** — `network: off` is not enforced
- **Deprecated by Apple** — `sandbox-exec` has been informally deprecated since macOS 10.15

Use Docker or Podman if at all possible. Seatbelt is a last resort.

## Configuring Sandboxing

### CLI Flags

```bash
llxprt --sandbox                              # Enable with auto-detected engine
llxprt --sandbox-engine docker                # Force Docker
llxprt --sandbox-engine podman                # Force Podman
llxprt --sandbox-engine sandbox-exec          # Force Seatbelt (macOS only)
llxprt --sandbox-engine none                  # Explicitly disable
llxprt --sandbox-profile-load <name>          # Load a profile (implies sandbox)
```

### Environment Variable

```bash
export LLXPRT_SANDBOX=true                    # Enable sandbox
export LLXPRT_SANDBOX=docker                  # Force engine
export LLXPRT_SANDBOX=false                   # Disable
```

`--sandbox-engine none` always wins, even when `LLXPRT_SANDBOX` is set.

## Sandbox Profiles

Profiles are JSON files in `~/.llxprt/sandboxes/`. They control engine, image, resources, networking, SSH agent, and extra mounts. Default profiles are created automatically the first time you use `--sandbox-profile-load`.

### Built-in Profiles

| Profile   | Network | SSH Agent | CPUs | Memory | PIDs | Use case                |
| --------- | ------- | --------- | ---- | ------ | ---- | ----------------------- |
| `dev`     | on      | auto      | 2    | 4 GB   | 256  | Normal development      |
| `safe`    | off     | off       | 2    | 4 GB   | 128  | Untrusted code review   |
| `tight`   | off     | off       | 1    | 2 GB   | 64   | Maximum restriction     |
| `offline` | off     | off       | 2    | 4 GB   | 128  | Local/offline workflows |

### Profile Format

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

| Field              | Values                                             | Description                                                |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------------- |
| `engine`           | `auto`, `docker`, `podman`, `sandbox-exec`, `none` | Container runtime                                          |
| `image`            | string                                             | Container image (defaults to release image)                |
| `resources.cpus`   | number                                             | CPU core limit                                             |
| `resources.memory` | string                                             | Memory limit (e.g., `4g`, `512m`)                          |
| `resources.pids`   | number                                             | Max process count                                          |
| `network`          | `on`, `off`                                        | Container networking (`off` = `--network none`)            |
| `sshAgent`         | `auto`, `on`, `off`                                | SSH agent forwarding into container                        |
| `mounts`           | array                                              | Extra mounts (`{from, to?, mode?}`); mode defaults to `ro` |
| `env`              | object                                             | Additional environment variables                           |

### Creating Custom Profiles

Create a JSON file in `~/.llxprt/sandboxes/`:

```bash
cat > ~/.llxprt/sandboxes/beefy.json << 'EOF'
{
  "engine": "docker",
  "resources": { "cpus": 4, "memory": "8g", "pids": 512 },
  "network": "on",
  "sshAgent": "auto"
}
EOF

llxprt --sandbox-profile-load beefy "run the full test suite"
```

## Credential Proxy (Container Mode)

In Docker/Podman mode, a host-side credential proxy runs over a Unix socket. The container never sees your stored secrets:

- **Refresh tokens stay on the host** — the container only receives short-lived access tokens
- **OAuth works from inside the sandbox** — `/auth <provider> login` opens the browser on the host
- **Key reads work** — `/key load`, `/key list`, and `/key show` read host-saved keys via the proxy
- **Key writes are blocked** — `/key save` and `/key delete` throw an error in container mode (keys must be managed on the host)
- **PATs and API keys never enter the container** — the proxy injects authorization headers without exposing the underlying credential

The socket path is set automatically via `LLXPRT_CREDENTIAL_SOCKET`.

> **Note:** Seatbelt mode runs on the host directly, so there is no credential proxy — it uses your normal keyring and token store.

## SSH Agent Forwarding

When `sshAgent` is `auto` or `on` and `SSH_AUTH_SOCK` is set on the host:

- **Docker on Linux:** the socket is mounted directly into the container
- **Docker on macOS:** the socket is mounted directly (Docker Desktop handles forwarding)
- **Podman on macOS:** LLxprt sets up an SSH tunnel bridge (requires `socat` in the container image and `--network=host`)

### Podman macOS SSH Workaround

Podman on macOS runs in a VM, so direct socket mounting doesn't work. LLxprt creates an SSH reverse tunnel, but the default macOS launchd socket paths can be problematic. For reliable SSH agent forwarding:

```bash
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock
ssh-add ~/.ssh/id_ed25519
llxprt --sandbox-engine podman --sandbox-profile-load dev
```

## Git Config in Containers

These files are mounted read-only when they exist on the host:

- `~/.gitconfig`
- `~/.config/git/config`
- `~/.gitignore_global`
- `~/.ssh/known_hosts`

`~/.git-credentials` is intentionally **not** mounted — credential access goes through the proxy.

## Advanced

### Extra Container Flags

```bash
export SANDBOX_FLAGS="--security-opt label=disable"
```

### UID/GID Mapping (Linux)

```bash
export SANDBOX_SET_UID_GID=true
```

### Override Sandbox Image

```bash
export LLXPRT_SANDBOX_IMAGE=my-registry/my-sandbox:latest
```

## Troubleshooting

**Container not starting** — verify Docker or Podman is running: `docker info` or `podman info`.

**Permission errors on mounted files** — on Linux, try `SANDBOX_SET_UID_GID=true` or `SANDBOX_FLAGS="--security-opt label=disable"` for SELinux systems.

**SSH not working in Podman on macOS** — use a stable socket path (see Podman macOS SSH Workaround above). The default launchd socket paths are unreliable.

**"socat not found" error** — the sandbox container image needs `socat` for SSH agent and credential proxy tunneling. Use the official sandbox image.

**Network access denied** — check your profile's `network` setting. `off` means `--network none`.

## Related

- [Sandbox Profiles](./cli/sandbox-profiles.md) — full profile reference
- [Sandbox Setup Tutorial](./tutorials/sandbox-setup.md) — step-by-step walkthrough
- [Authentication](./cli/authentication.md) — credential setup
- [Profiles](./cli/profiles.md) — model and load balancer profiles (separate from sandbox profiles)
