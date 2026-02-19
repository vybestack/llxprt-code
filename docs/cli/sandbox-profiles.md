# Sandbox Profiles Reference

Sandbox profiles configure the security boundaries and resource limits for container-based sandboxing. This document covers all available options and how to configure them.

## Profile Location

Profiles are stored as JSON files:

```text
~/.llxprt/sandboxes/<profile-name>.json
```

For example, the `dev` profile is at `~/.llxprt/sandboxes/dev.json`.

## Built-in Profiles

LLxprt-code creates these profiles on first run:

### dev

Full-featured profile for daily development.

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:latest",
  "resources": { "cpus": 2, "memory": "4g", "pids": 256 },
  "network": "on",
  "sshAgent": "auto",
  "mounts": [],
  "env": {}
}
```

Use when: Normal development with trusted code.

### safe

Restricted profile for untrusted code analysis.

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:latest",
  "resources": { "cpus": 2, "memory": "4g", "pids": 128 },
  "network": "off",
  "sshAgent": "off",
  "mounts": [],
  "env": {}
}
```

Use when: Analyzing pull requests, external contributions, or any code you did not write.

### tight

Maximum restriction for suspicious code.

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:latest",
  "resources": { "cpus": 1, "memory": "2g", "pids": 64 },
  "network": "off",
  "sshAgent": "off",
  "mounts": [],
  "env": {}
}
```

Use when: Analyzing potentially malicious code or when maximum isolation is required.

### offline

For work that does not require network access but may still need SSH for local repositories.

```json
{
  "engine": "auto",
  "image": "ghcr.io/vybestack/llxprt-code/sandbox:latest",
  "resources": { "cpus": 2, "memory": "4g", "pids": 128 },
  "network": "off",
  "sshAgent": "auto",
  "mounts": [],
  "env": {}
}
```

Use when: Working on airplanes, reading documentation, or any offline task where you still need git access to local repos.

**Note:** With `network: "off"`, SSH agent passthrough only works for local operations like commit signing or accessing local filesystem keys. Git push/pull to remote servers over SSH will not work because TCP connections are blocked.

## Profile Schema

### engine

Which container runtime to use.

**Type:** `"auto"` | `"docker"` | `"podman"` | `"sandbox-exec"` | `"none"`

**Default:** `"auto"`

**Values:**

- `auto`: Automatically detect available runtime (prefers Docker over Podman)
- `docker`: Use Docker explicitly
- `podman`: Use Podman explicitly
- `sandbox-exec`: Use macOS Seatbelt (macOS only)
- `none`: Disable sandboxing

**Example:**

```json
{
  "engine": "podman"
}
```

### image

Container image to use for the sandbox.

**Type:** `string` (Docker image reference)

**Default:** `"ghcr.io/vybestack/llxprt-code/sandbox:latest"`

The default image is pulled automatically. You can specify a custom image if you have built one with additional tools.

**Example:**

```json
{
  "image": "my-registry.example.com/custom-sandbox:v1"
}
```

### resources

CPU, memory, and process limits.

**Type:** `object`

#### resources.cpus

Maximum CPU cores the container can use.

**Type:** `number`

**Example:**

```json
{
  "resources": { "cpus": 4 }
}
```

This prevents the AI from spawning CPU-intensive operations that slow down your host.

#### resources.memory

Maximum memory the container can allocate.

**Type:** `string` (e.g., `"2g"`, `"512m"`)

**Example:**

```json
{
  "resources": { "memory": "8g" }
}
```

#### resources.pids

Maximum number of processes the container can create.

**Type:** `number`

**Example:**

```json
{
  "resources": { "pids": 512 }
}
```

This prevents fork bombs and runaway process spawning.

**Full example:**

```json
{
  "resources": {
    "cpus": 4,
    "memory": "8g",
    "pids": 512
  }
}
```

### network

Network access policy.

**Type:** `"on"` | `"off"` | `"proxied"`

**Default:** `"on"`

**Values:**

- `on`: Full network access
- `off`: No network access
- `proxied`: Network access only through HTTP proxy (advanced)

**When to use `off`:**

- Analyzing untrusted code that might make network calls
- Working in air-gapped environments
- Reducing attack surface for sensitive operations

**Example:**

```json
{
  "network": "off"
}
```

### sshAgent

SSH agent passthrough for git operations.

**Type:** `"auto"` | `"on"` | `"off"`

**Default:** `"auto"`

**Values:**

- `auto`: Enable if `SSH_AUTH_SOCK` is detected
- `on`: Require SSH agent, warn if not available
- `off`: Disable SSH passthrough

**What this does:**

When enabled, your SSH agent socket is mounted into the container at `/ssh-agent`. This allows git operations with private repositories.

**Example:**

```json
{
  "sshAgent": "on"
}
```

**Note for Podman on macOS:** SSH passthrough requires additional setup. See the [Podman macOS](#podman-macos) section below.

### mounts

Additional volume mounts.

**Type:** `array` of mount objects

**Mount object:**

```typescript
{
  from: string;   // Host path (supports ~ expansion)
  to?: string;    // Container path (defaults to same as from)
  mode?: "ro" | "rw";  // Read-only or read-write (default: "rw")
}
```

**Example:**

```json
{
  "mounts": [
    { "from": "~/.npmrc", "to": "/home/node/.npmrc", "mode": "ro" },
    { "from": "~/shared-libs", "to": "/shared", "mode": "ro" }
  ]
}
```

**Security note:** Be careful with write mounts. Only mount directories you trust the AI to modify.

### env

Additional environment variables.

**Type:** `object` (key-value pairs)

**Example:**

```json
{
  "env": {
    "NPM_CONFIG_REGISTRY": "https://registry.npmjs.org",
    "NODE_ENV": "development"
  }
}
```

## Creating Custom Profiles

### Example: High-Resource Development

For large projects with many dependencies:

```json
{
  "engine": "auto",
  "resources": {
    "cpus": 8,
    "memory": "16g",
    "pids": 1024
  },
  "network": "on",
  "sshAgent": "auto",
  "mounts": [
    {
      "from": "~/.m2/repository",
      "to": "/home/node/.m2/repository",
      "mode": "ro"
    }
  ]
}
```

### Example: CI/CD Runner

For automated tasks in CI:

```json
{
  "engine": "docker",
  "resources": {
    "cpus": 2,
    "memory": "4g",
    "pids": 256
  },
  "network": "on",
  "sshAgent": "off",
  "env": {
    "CI": "true"
  }
}
```

### Example: Restricted Analysis

For analyzing untrusted code with strict limits:

```json
{
  "engine": "auto",
  "resources": {
    "cpus": 2,
    "memory": "4g",
    "pids": 128
  },
  "network": "off",
  "sshAgent": "off",
  "mounts": []
}
```

Note: The project directory is always mounted read-write. The `mounts` field controls additional mounts only. For true read-only access, use the `safe` or `tight` built-in profiles which restrict network and SSH access.

## Engine Selection Behavior

When `engine` is `auto`, llxprt-code selects the runtime in this order:

1. Docker (if available)
2. Podman (if available)
3. sandbox-exec (macOS only, if enabled)
4. None (no sandboxing)

### Overriding Engine

You can override the profile's engine via command line:

```bash
# Profile says "auto" but force Podman
llxprt --sandbox-engine podman --sandbox-profile-load dev

# Profile says "podman" but force Docker
llxprt --sandbox-engine docker --sandbox-profile-load dev
```

## Platform-Specific Notes

### Podman macOS

Podman on macOS runs in a virtual machine. This affects:

**SSH Agent:**

- Host sockets in `/private/tmp/com.apple.launchd.*` are not accessible from the VM
- Use a dedicated socket at a normal path:

```bash
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock
ssh-add ~/.ssh/id_ed25519
```

**Credential Proxy:**

- Automatic SSH tunnel bridge is set up for credential proxy
- Requires `socat` in the sandbox image
- May have slight latency compared to Docker

**Recommendation:** For the best macOS experience, use Docker Desktop. Podman works but requires workarounds.

### Linux

Docker and Podman work without special configuration.

**SELinux:** Podman automatically adds `:z` relabeling for SSH socket mounts.

**Rootless Podman:** Fully supported. UID/GID mapping is handled automatically.

## Using Profiles

### From Command Line

Load a profile via CLI flag:

```bash
llxprt --sandbox-profile-load dev

# Combine with engine override
llxprt --sandbox-engine podman --sandbox-profile-load dev

# Combine with other flags
llxprt --sandbox-profile-load safe --key $API_KEY
```

### Listing Available Profiles

```bash
ls ~/.llxprt/sandboxes/
```

Or from within llxprt:

```text
> /help sandbox
```

## Troubleshooting Profiles

### Profile Not Found

**Symptom:** `Profile 'custom' not found`

**Fix:** Ensure the file exists at `~/.llxprt/sandboxes/custom.json`

### Invalid Profile JSON

**Symptom:** `Failed to parse sandbox profile`

**Fix:** Validate your JSON with `jq`:

```bash
jq . ~/.llxprt/sandboxes/custom.json
```

### Engine Not Available

**Symptom:** `Docker not found` or `Podman not found`

**Fix:** Ensure the runtime is installed and in your PATH:

```bash
which docker
which podman
```

## Related Documentation

- [Sandbox Overview](../sandbox.md)
- [Tutorial: Sandbox Setup](../tutorials/sandbox-setup.md)
- [Configuration](./configuration.md)
- [Troubleshooting](../troubleshooting.md)
