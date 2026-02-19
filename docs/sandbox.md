# Sandboxing

Sandboxing isolates llxprt-code from your host system, creating a security barrier between AI operations and your files, credentials, and network.

## Platform Support

| Platform | Docker       | Podman                        | Seatbelt      |
| -------- | ------------ | ----------------------------- | ------------- |
| macOS    | Full support | Full support with workarounds | Built-in      |
| Linux    | Full support | Full support                  | Not available |
| Windows  | Not tested   | Not tested                    | Not available |

Windows support is not yet tested. We welcome contributions from Windows users.

## Quick Start

```bash
# Quick sandbox session with default profile
llxprt --sandbox "analyze this codebase"

# Use a specific sandbox profile
llxprt --sandbox-profile-load safe "review this untrusted code"

# Disable sandboxing explicitly
llxprt --sandbox-engine none
```

## Why Use Sandboxing

Sandboxing protects your system when:

- Working with untrusted code from external sources
- Running experimental commands that might modify files unexpectedly
- Analyzing code from pull requests or issues you did not write
- Testing potentially destructive operations

## Sandboxing Methods

### Container-based (Recommended)

Docker and Podman provide complete isolation with their own filesystem, network namespace, and process space. The AI agent inside the container cannot access your host files outside mounted directories.

**How it works:**

1. llxprt-code starts a container from the sandbox image
2. Your project directory is mounted read-write
3. Credentials are accessed via a secure proxy (never stored in container)
4. Shell commands run inside the container, not on your host

### macOS Seatbelt

Seatbelt uses the built-in `sandbox-exec` utility for lightweight process restrictions. It runs directly on your host with filesystem write restrictions.

Seatbelt does not isolate credentials or network. Use container sandboxing when you need credential isolation.

## Credential Security in Containers

When running in a container, llxprt-code uses a **credential proxy** to protect your API keys and OAuth tokens.

### How the Credential Proxy Works

```text
Host System                          Container
-------------                        ----------
OS Keyring                           No credentials stored
    |                                     ^
    v                                     |
Credential Proxy Server ----Unix Socket----+
    |
    +-- OAuth tokens (short-lived only)
    +-- API keys (read-only access)
```

**Key security properties:**

- Your `refresh_token` stays on the host and is never sent to the container
- The container receives only short-lived access tokens through the proxy
- API keys are accessible read-only via the proxy
- This design reduces exposure if the container is compromised

**Important caveat:** Security depends on the integrity of the host system and the Unix socket permissions. This is a defense-in-depth measure, not a guarantee against all attacks.

### What This Means For You

Inside the sandbox:

- `/auth login` works normally (OAuth flows execute on the host)
- Token refresh happens automatically via the proxy
- `/key save` is blocked (keys must be saved on the host first)
- `/key load` and `/key list` work for keys saved on the host

### Environment Variable

The proxy is configured via `LLXPRT_CREDENTIAL_SOCKET`, which is set automatically when the container starts. You should not need to modify this.

## Sandbox Profiles

Profiles configure container behavior. They are stored in `~/.llxprt/sandboxes/<name>.json`.

### Built-in Profiles

| Profile   | Network | SSH Agent | Resources            | Use Case                |
| --------- | ------- | --------- | -------------------- | ----------------------- |
| `dev`     | On      | Auto      | 2 CPU, 4GB, 256 pids | Daily development       |
| `safe`    | Off     | Off       | 2 CPU, 4GB, 128 pids | Untrusted code analysis |
| `tight`   | Off     | Off       | 1 CPU, 2GB, 64 pids  | Maximum restriction     |
| `offline` | Off     | Auto      | 2 CPU, 4GB, 128 pids | No network required     |

### Using Profiles

```bash
# Load a profile by name
llxprt --sandbox-profile-load dev

# Override the engine
llxprt --sandbox-engine podman --sandbox-profile-load dev

# Disable sandboxing
llxprt --sandbox-engine none
```

### Profile Schema

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:latest",
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

**Fields:**

- `engine`: `auto`, `docker`, `podman`, `sandbox-exec`, or `none`
- `image`: Container image to use
- `resources`: CPU, memory, and process limits
- `network`: `on`, `off`, or `proxied`
- `sshAgent`: `auto` (detect), `on` (require), or `off` (disable)
- `mounts`: Additional volume mounts
- `env`: Additional environment variables

### Creating Custom Profiles

Edit or create `~/.llxprt/sandboxes/custom.json`:

```json
{
  "engine": "docker",
  "resources": {
    "cpus": 4,
    "memory": "8g"
  },
  "network": "on",
  "sshAgent": "on",
  "mounts": [{ "from": "~/.npmrc", "to": "/home/node/.npmrc", "mode": "ro" }]
}
```

Then use it:

```bash
llxprt --sandbox-profile-load custom
```

## SSH Agent Passthrough

Enable SSH access inside the container for git operations with private repositories.

### How It Works

When `sshAgent` is enabled, llxprt-code mounts your SSH agent socket into the container:

1. Detects `SSH_AUTH_SOCK` environment variable
2. Mounts the socket to `/ssh-agent` inside the container
3. Sets `SSH_AUTH_SOCK=/ssh-agent` for container processes

### Platform Differences

| Platform | Docker                    | Podman                                      |
| -------- | ------------------------- | ------------------------------------------- |
| Linux    | Direct socket mount works | Direct socket mount with SELinux relabeling |
| macOS    | Works via VirtioFS        | Requires SSH tunnel bridge                  |

### Podman on macOS

Podman runs in a VM on macOS, so your host SSH socket is not directly accessible. llxprt-code sets up an SSH tunnel bridge automatically, but this has limitations:

- Launchd-managed sockets often fail
- Works best with a dedicated SSH agent socket

**Workaround:** Create a dedicated socket:

```bash
# Start a dedicated agent with a normal filesystem path
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock
ssh-add ~/.ssh/id_ed25519

# Now run llxprt with Podman
llxprt --sandbox-engine podman --sandbox-profile-load dev
```

### Testing SSH Access

```bash
llxprt --sandbox "run shell command: ssh-add -l"
```

## Resource Limits

Resource limits prevent runaway processes from affecting your host system.

### Available Limits

- `cpus`: Maximum CPU cores (e.g., `2`)
- `memory`: Maximum memory (e.g., `4g`, `512m`)
- `pids`: Maximum process count (prevents fork bombs)

### Why These Matter

The AI agent can spawn multiple shell commands. Without limits, it could:

- Launch many test runners in parallel, consuming all CPU
- Create fork bombs that exhaust process table entries
- Allocate excessive memory

The built-in profiles include sensible defaults. The `tight` profile is most restrictive.

## Network Configuration

### Network Modes

- `on`: Full network access (default for `dev`)
- `off`: No network access (default for `safe`, `tight`, `offline`)
- `proxied`: Network via HTTP proxy (advanced)

### When to Disable Network

Disable network when:

- Analyzing untrusted code that might phone home
- Working offline
- Reducing attack surface for sensitive operations

### Testing Network Access

```bash
llxprt --sandbox-profile-load safe "run shell command: curl -I https://example.com"
# Should fail: network is off

llxprt --sandbox-profile-load dev "run shell command: curl -I https://example.com"
# Should succeed: network is on
```

## Git Configuration

Git config files are mounted read-only into the container:

- `~/.gitconfig`
- `~/.config/git/config`
- `~/.gitignore_global`
- `~/.ssh/known_hosts`

The `~/.git-credentials` file is intentionally NOT mounted for security.

## Enabling Sandboxing

### Priority Order

1. Command flag: `--sandbox` or `--sandbox-engine <engine>`
2. Environment variable: `LLXPRT_SANDBOX=true|docker|podman|sandbox-exec`
3. Settings file: `"sandbox": "docker"` in `settings.json`

**Note:** The `LLXPRT_SANDBOX` environment variable only accepts engine names (true, docker, podman, sandbox-exec). To disable sandboxing, use the CLI flag `--sandbox-engine none` instead.

### Examples

```bash
# Command flag (highest priority)
llxprt --sandbox "help me refactor this"

# Environment variable
export LLXPRT_SANDBOX=docker
llxprt "analyze the tests"
```

Settings file (`~/.llxprt/settings.json`):

```json
{
  "sandbox": "podman"
}
```

## macOS Seatbelt Profiles

Seatbelt profiles control restrictions when using `sandbox-exec` on macOS.

### Built-in Profiles

Set via `SEATBELT_PROFILE` environment variable:

| Profile              | Writes     | Network   | Use Case              |
| -------------------- | ---------- | --------- | --------------------- |
| `permissive-open`    | Restricted | Allowed   | Development (default) |
| `permissive-closed`  | Restricted | Blocked   | Offline work          |
| `permissive-proxied` | Restricted | Via proxy | Corporate networks    |
| `restrictive-open`   | Strict     | Allowed   | Untrusted code        |
| `restrictive-closed` | Strict     | Blocked   | Maximum security      |

Seatbelt does not provide credential isolation. For credential protection, use container sandboxing.

## Advanced Configuration

### Custom Docker Flags

Inject custom flags via `SANDBOX_FLAGS`:

```bash
export SANDBOX_FLAGS="--security-opt label=disable"
llxprt --sandbox
```

### Linux UID/GID Handling

On Linux, the container runs with your UID/GID to avoid permission issues with mounted volumes.

Force host UID/GID mapping:

```bash
export SANDBOX_SET_UID_GID=true
```

Disable UID/GID mapping:

```bash
export SANDBOX_SET_UID_GID=false
```

### Debug Mode

Enable debug output for more detailed logging:

```bash
DEBUG=1 llxprt --sandbox "debug this"
```

**Important:** Setting `DEBUG=true` in a project's `.env` file will not work because llxprt excludes certain variables from project environment files. Use either:

- Command line: `DEBUG=1 llxprt ...`
- A `.llxprt/.env` file in your project
- A `~/.llxprt/.env` file in your home directory

## Troubleshooting

### Common Errors

#### "Operation not permitted"

The operation requires access outside the sandbox boundaries.

**Solutions:**

- Use a less restrictive profile (`dev` instead of `safe`)
- Add custom mounts to the profile
- Check if the operation truly needs host access

#### "Failed to start credential proxy"

The credential proxy server could not start on the host.

**Causes:**

- Keyring is unavailable or locked
- Insufficient permissions to create socket directory

**Solutions:**

```bash
# Check keyring status (Linux)
gnome-keyring-daemon --check

# Try with explicit key
llxprt --key $YOUR_API_KEY --sandbox
```

#### "Credential proxy connection lost"

The container lost connection to the host credential proxy.

**Cause:** Usually a container or host crash.

**Solution:** Restart the session.

#### "socat not found"

The sandbox image is missing the `socat` utility required for Podman on macOS credential proxying.

**Solution:** Use a newer sandbox image, or switch to Docker on macOS.

#### SSH Agent Not Working

**Check:**

1. `SSH_AUTH_SOCK` is set
2. Socket file exists: `ls -la $SSH_AUTH_SOCK`
3. Keys are loaded: `ssh-add -l`

**Podman on macOS:** See the Podman section above for workarounds.

### Inspecting the Sandbox

```bash
# Check sandbox environment
llxprt --sandbox "run shell command: env | grep -E 'SANDBOX|LLXPRT'"

# List mounts
llxprt --sandbox "run shell command: mount | grep workspace"

# Test credential proxy (use single quotes so variable expands inside sandbox)
llxprt --sandbox 'run shell command: echo $LLXPRT_CREDENTIAL_SOCKET'
```

### Container Logs

For deeper debugging, run the container manually:

```bash
# Find the sandbox image
docker images | grep 'vybestack/llxprt-code/sandbox'

# Run interactively
docker run -it --rm \
  -v $(pwd):/workspace \
  -v ~/.llxprt:/home/node/.llxprt \
  ghcr.io/vybestack/llxprt-code/sandbox:latest \
  bash
```

## Security Considerations

### What Sandboxing Does

- Isolates filesystem writes to mounted directories
- Limits direct credential access through the proxy architecture (container mode)
- Restricts network access based on profile settings
- Constrains resource usage to prevent runaway processes

### What Sandboxing Does Not Do

- Guarantee protection against all attacks
- Protect against kernel exploits or hypervisor escapes
- Isolate GPU access or other hardware
- Protect against physical access to the host

### Trust Boundaries

The security model assumes:

- The host system and your user account are trusted
- The OS keyring is properly secured
- Container runtime (Docker/Podman) is correctly configured
- You review file operations before confirming them

### Best Practices

1. Use the most restrictive profile that allows your work
2. Use container sandboxing when working with untrusted code
3. Keep the sandbox image updated
4. Review file operations before confirming
5. Never mount sensitive directories like `~/.ssh` with write access

## Related Documentation

- [Configuration](./cli/configuration.md): Full configuration options
- [Commands](./cli/commands.md): Available commands
- [Troubleshooting](./troubleshooting.md): General troubleshooting
- [Authentication](./cli/authentication.md): Credential setup
