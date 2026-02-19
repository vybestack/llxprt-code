# Sandbox Profiles Reference

Sandbox profiles define runtime, network, SSH passthrough, mounts, and resource limits for container sandboxing.

This guide is focused on Linux and macOS. Windows is not tested yet for this workflow. Contributions are welcome.

## Profile location

```text
~/.llxprt/sandboxes/<profile-name>.json
```

Example: `~/.llxprt/sandboxes/dev.json`

Built-in profile files are created automatically when profile loading is used.

## Loading profiles

```bash
# Load profile
llxprt --sandbox-profile-load dev

# Override runtime engine
llxprt --sandbox-engine podman --sandbox-profile-load dev

# Disable sandboxing
llxprt --sandbox-engine none
```

Important behavior: loading a profile implies sandbox intent, even without `--sandbox`.

## Built-in profiles

### `dev`

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:<version>",
  "resources": { "cpus": 2, "memory": "4g", "pids": 256 },
  "network": "on",
  "sshAgent": "auto",
  "mounts": [],
  "env": {}
}
```

Use for normal development.

### `safe`

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:<version>",
  "resources": { "cpus": 2, "memory": "4g", "pids": 128 },
  "network": "off",
  "sshAgent": "off",
  "mounts": [],
  "env": {}
}
```

Use for untrusted code review.

### `tight`

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:<version>",
  "resources": { "cpus": 1, "memory": "2g", "pids": 64 },
  "network": "off",
  "sshAgent": "off",
  "mounts": [],
  "env": {}
}
```

Use for strict isolation.

### `offline`

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:<version>",
  "resources": { "cpus": 2, "memory": "4g", "pids": 128 },
  "network": "off",
  "sshAgent": "off",
  "mounts": [],
  "env": {}
}
```

Use for local/offline workflows.

## Schema

### `engine`

Type: `"auto" | "docker" | "podman" | "sandbox-exec" | "none"`

- `auto`: picks available runtime
- `docker`: force Docker
- `podman`: force Podman
- `sandbox-exec`: macOS Seatbelt
- `none`: disable sandboxing

### `image`

Type: `string`

Defaults to the current release image configured in package metadata (`config.sandboxImageUri`).

You can provide your own image if it includes required utilities (`git`, `bash`, and `socat` for Podman macOS bridge paths).

### `resources`

```json
{
  "resources": {
    "cpus": 4,
    "memory": "8g",
    "pids": 512
  }
}
```

- `cpus`: CPU limit
- `memory`: memory limit
- `pids`: process count limit

### `network`

Type: `"on" | "off" | "proxied"`

- `on`: default networking
- `off`: launches container with network disabled
- `proxied`: accepted by schema, but currently not implemented as a dedicated mode. Runtime logs a warning and falls back to default networking.

### `sshAgent`

Type: `"auto" | "on" | "off"`

- `auto`: enable if `SSH_AUTH_SOCK` exists
- `on`: require/attempt setup and warn if unavailable
- `off`: disable passthrough

### `mounts`

```json
{
  "mounts": [
    { "from": "~/.npmrc", "to": "/home/node/.npmrc", "mode": "ro" },
    { "from": "~/shared", "to": "/shared" }
  ]
}
```

Mount object:

- `from`: host path (`~` expansion supported)
- `to`: container path (defaults to same path as `from`)
- `mode`: `"ro" | "rw"` (defaults to `"ro"`)

### `env`

```json
{
  "env": {
    "NPM_CONFIG_REGISTRY": "https://registry.npmjs.org"
  }
}
```

Adds environment variables to sandbox launch context.

## Engine selection notes

When engine is `auto`, fallback preference is:

1. Docker
2. Podman
3. `sandbox-exec` (macOS)
4. no sandbox (if nothing available)

Notes:

- With `--sandbox-profile-load`, this fallback list is used directly.
- With `--sandbox` on macOS, base command detection checks `sandbox-exec` first, then Docker, then Podman.
- You can always force engine with `--sandbox-engine`.

## Podman macOS notes

Podman runs in a VM on macOS, so there are extra constraints:

- launchd SSH socket paths are often unusable in VM bridge paths
- SSH and credential proxy bridges require `--network=host`
- conflicting `--network` values can disable bridge setup

If SSH forwarding is unreliable, use a dedicated socket path:

```bash
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock
ssh-add ~/.ssh/id_ed25519
```

## Listing and inspecting profiles

```bash
ls ~/.llxprt/sandboxes/
cat ~/.llxprt/sandboxes/dev.json
```

## Common issues

### Profile not found

If `--sandbox-profile-load custom` fails, verify file exists:

```bash
ls ~/.llxprt/sandboxes/custom.json
```

### Invalid JSON

```bash
jq . ~/.llxprt/sandboxes/custom.json
```

### Engine missing

```bash
which docker
which podman
```

## Related docs

- [Sandbox overview](../sandbox.md)
- [Sandbox setup tutorial](../tutorials/sandbox-setup.md)
- [Troubleshooting](../troubleshooting.md)
