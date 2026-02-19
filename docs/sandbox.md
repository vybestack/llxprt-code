# Sandboxing

Sandboxing runs llxprt tool execution in an isolated environment so you can work with less risk when running shell commands, editing files, or reviewing untrusted code.

## Platform support

| Platform | Docker       | Podman                 | Seatbelt      |
| -------- | ------------ | ---------------------- | ------------- |
| macOS    | Full support | Full support (caveats) | Built-in      |
| Linux    | Full support | Full support           | Not available |

Windows is not tested yet for this workflow. Contributions are welcome.

## Quick start

```bash
# Start a sandboxed session with automatic engine selection
llxprt --sandbox "review this repository"

# Load a specific sandbox profile
llxprt --sandbox-profile-load safe "analyze this untrusted code"

# Explicitly disable sandboxing
llxprt --sandbox-engine none
```

## Why developers use sandboxing

Use sandboxing when you want to:

- review code you did not write
- run shell-heavy tasks safely
- keep refresh tokens and key storage on the host
- cap CPU, memory, and process count for noisy workloads

## How sandbox mode is selected

Selection behavior comes from `packages/cli/src/config/sandboxConfig.ts` and works like this:

1. `--sandbox-engine none` disables sandboxing immediately.
2. `LLXPRT_SANDBOX` takes precedence over `--sandbox` and `settings.sandbox` when choosing the base sandbox command.
3. `--sandbox-profile-load <name>` implies sandbox intent, even if `--sandbox` is not set.
4. `--sandbox-engine <engine>` overrides the resolved runtime.

### `LLXPRT_SANDBOX` accepted values

- truthy: `1`, `true` (requests sandbox with automatic command selection)
- falsy: `0`, `false` (disables sandboxing)
- explicit engine: `docker`, `podman`, `sandbox-exec`

`--sandbox-engine none` always disables sandboxing, even when `LLXPRT_SANDBOX` is set.

## Built-in profiles

Profiles are stored at:

```text
~/.llxprt/sandboxes/<name>.json
```

Default profile files are created automatically when profile loading is used.

| Profile   | Network | SSH Agent | Resources            | Typical use case        |
| --------- | ------- | --------- | -------------------- | ----------------------- |
| `dev`     | on      | auto      | 2 CPU, 4GB, 256 pids | normal development      |
| `safe`    | off     | off       | 2 CPU, 4GB, 128 pids | untrusted code review   |
| `tight`   | off     | off       | 1 CPU, 2GB, 64 pids  | maximum restriction     |
| `offline` | off     | off       | 2 CPU, 4GB, 128 pids | local/offline workflows |

See full profile reference: [Sandbox Profiles](./cli/sandbox-profiles.md)

## Profile fields

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:<version>",
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

Field behavior:

- `engine`: `auto`, `docker`, `podman`, `sandbox-exec`, `none`
- `image`: container image. Defaults to the current release `config.sandboxImageUri` value.
- `resources`: `cpus`, `memory`, `pids`
- `network`: `on`, `off`, `proxied`
  - `proxied` is accepted by schema, but runtime proxy mode is not implemented yet. The launcher logs a warning and falls back to default networking.
- `sshAgent`: `auto`, `on`, `off`
- `mounts`: extra mounts; mount mode defaults to `ro` when omitted
- `env`: additional environment variables

## Credential security in container mode

Container mode uses a host-side credential proxy over a Unix socket.

What this means:

- refresh tokens stay on the host
- sandbox receives short-lived access tokens as needed
- `/auth <provider> login` works from inside sandbox (OAuth handling is host-side)
- `/key save` and `/key delete` are blocked in sandbox proxy mode
- `/key load`, `/key list`, and `/key show` can read host-saved keys

The socket path is passed through `LLXPRT_CREDENTIAL_SOCKET` automatically.

## SSH agent passthrough

If `sshAgent` is enabled:

1. `SSH_AUTH_SOCK` is detected on host
2. socket is mounted into container
3. container process gets `SSH_AUTH_SOCK=/ssh-agent`

### macOS Podman caveats

Podman on macOS runs in a VM. llxprt sets up an SSH tunnel bridge, but:

- launchd socket paths under `/private/tmp/com.apple.launchd.*` are often problematic
- `--network=host` is required for the bridge
- if a conflicting `--network` value is already set (for example `none`), SSH forwarding is skipped or fails

Reliable workaround:

```bash
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock
ssh-add ~/.ssh/id_ed25519
llxprt --sandbox-engine podman --sandbox-profile-load dev
```

## Network modes

- `on`: normal networking
- `off`: container runs with `--network none`
- `proxied`: accepted value, but currently falls back to default networking with a warning

## Git config mounts

Container sandbox mounts these read-only when present:

- `~/.gitconfig`
- `~/.config/git/config`
- `~/.gitignore_global`
- `~/.ssh/known_hosts`

`~/.git-credentials` is intentionally not mounted.

## macOS Seatbelt mode

Seatbelt uses `sandbox-exec` and runs directly on host.

Set profile with `SEATBELT_PROFILE`:

- `permissive-open`
- `permissive-closed`
- `permissive-proxied`
- `restrictive-open`
- `restrictive-closed`
- `restrictive-proxied`

Seatbelt is useful for lightweight restrictions, but it does not provide container-level credential isolation.

## Advanced environment controls

```bash
# pass additional runtime flags to docker/podman launch
export SANDBOX_FLAGS="--security-opt label=disable"

# control Linux UID/GID mapping behavior
export SANDBOX_SET_UID_GID=true
# or
export SANDBOX_SET_UID_GID=false
```

## Troubleshooting quick checks

```bash
# Verify sandbox env
llxprt --sandbox "run shell command: env | grep -E 'SANDBOX|LLXPRT'"

# Verify credential proxy variable inside sandbox
llxprt --sandbox 'run shell command: echo $LLXPRT_CREDENTIAL_SOCKET'

# Verify SSH keys inside sandbox
llxprt --sandbox-profile-load dev "run shell command: ssh-add -l"
```

For full troubleshooting guidance, see [Troubleshooting](./troubleshooting.md).

## Related docs

- [Sandbox Profiles](./cli/sandbox-profiles.md)
- [Sandbox Setup Tutorial](./tutorials/sandbox-setup.md)
- [Authentication](./cli/authentication.md)
- [Configuration](./cli/configuration.md)
