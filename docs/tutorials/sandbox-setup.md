# Tutorial: Setting Up Sandbox Security

This tutorial walks you through setting up and using llxprt-code's sandbox features. By the end, you will understand when and how to use sandboxing for secure AI-assisted development.

**Time required:** 15-20 minutes

## What You Will Learn

- How sandboxing protects your system
- Setting up Docker or Podman
- Running your first sandboxed session
- Understanding sandbox profiles
- Configuring SSH for git operations
- Troubleshooting common issues

## Prerequisites

- Node.js 20 or later
- llxprt-code installed globally
- Docker Desktop (macOS/Windows) or Docker/Podman (Linux)

## Step 1: Verify Your Container Engine

First, check that your container runtime is installed and running.

### Docker

```bash
# Check Docker is installed
docker --version

# Check Docker daemon is running
docker ps
```

If `docker ps` fails with "Cannot connect to the Docker daemon", start Docker Desktop or the Docker daemon.

### Podman (Linux)

```bash
# Check Podman is installed
podman --version

# Test basic operation
podman run --rm hello-world
```

### Podman (macOS)

```bash
# Check Podman is installed
podman --version

# Ensure Podman machine is running
podman machine start
podman machine ls
```

## Step 2: Your First Sandbox Session

Start a simple sandboxed session:

```bash
cd your-project
llxprt --sandbox "list the files in this directory"
```

What happens:

1. llxprt-code detects `--sandbox` flag
2. It starts a container from the sandbox image
3. Your project directory is mounted
4. The AI responds from inside the container

### Verify You Are in a Sandbox

Ask the AI to check:

```
> run shell command: hostname
```

You should see a container hostname, not your actual machine name.

```
> run shell command: cat /etc/os-release
```

You should see the container OS, not your host OS.

## Step 3: Understanding the Default Profile

The `dev` profile is used by default. Let's examine what it allows:

```bash
llxprt --sandbox-profile-load dev "show me the sandbox environment"
```

The `dev` profile provides:

- Network access (for package installation, API calls)
- SSH agent passthrough (for git operations)
- Moderate resource limits (2 CPU, 4GB RAM, 256 processes)

### Test Network Access

```
> fetch the title of https://example.com
```

This should work because `dev` has `network: on`.

## Step 4: Using the Safe Profile

The `safe` profile is more restrictive. Use it for untrusted code:

```bash
llxprt --sandbox-profile-load safe "analyze this code from an untrusted source"
```

### Test Network Restriction

With `safe`, network is disabled:

```
> run shell command: curl -I https://example.com
```

You should see a connection error because `safe` has `network: off`.

### When to Use Each Profile

| Profile   | Use When                                |
| --------- | --------------------------------------- |
| `dev`     | Normal development, trusted code        |
| `safe`    | Analyzing pull requests, external code  |
| `tight`   | Maximum restriction for suspicious code |
| `offline` | Working without network, reading docs   |

## Step 5: Git Operations with SSH Passthrough

If you use SSH for git (private repositories), you need SSH agent passthrough.

### Check Your SSH Setup

```bash
# Verify SSH agent is running
echo $SSH_AUTH_SOCK

# List loaded keys
ssh-add -l
```

If `SSH_AUTH_SOCK` is empty, start the agent:

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

### Test SSH in Sandbox

```bash
llxprt --sandbox-profile-load dev "run shell command: ssh-add -l"
```

You should see your loaded keys.

### Clone a Private Repository

```
> clone git@github.com:your-org/private-repo.git
```

The clone should succeed because the SSH agent socket is mounted into the container.

### Podman on macOS Caveat

Podman on macOS runs in a VM. Host SSH sockets may not be accessible. If you see errors:

```bash
# Create a dedicated socket at a normal path
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock
ssh-add ~/.ssh/id_ed25519

# Now use Podman
llxprt --sandbox-engine podman --sandbox-profile-load dev
```

## Step 6: Understanding Credential Security

One of the most important features of container sandboxing is credential isolation.

### How Credentials Work

When you use `/auth login` inside a sandbox:

1. The login URL is displayed in the sandbox
2. You open it in your host browser
3. You authenticate with the provider
4. The OAuth code is sent back
5. The **host** exchanges the code for tokens
6. The sandbox receives only a short-lived access token

Your `refresh_token` never enters the container. This means:

- A compromised container cannot steal your credentials
- Token refresh happens automatically via the credential proxy
- You can safely analyze untrusted code

### Verifying the Credential Proxy

```
> run shell command: echo $LLXPRT_CREDENTIAL_SOCKET
```

If this shows a path like `/tmp/llxprt-credential-xxx.sock`, the proxy is active.

### What You Cannot Do in Sandbox

Some operations are blocked for security:

```
> /key save mykey sk-xxx
```

This will fail. Keys must be saved on the host first:

```bash
# Exit the sandbox and run on host
llxprt "/key save mykey sk-xxx"

# Now use the key in sandbox
llxprt --sandbox "/key load mykey"
```

## Step 7: Creating a Custom Profile

For specific workflows, create a custom profile.

### Example: Profile with Extra Mounts

Create `~/.llxprt/sandboxes/custom.json`:

```json
{
  "engine": "docker",
  "resources": {
    "cpus": 4,
    "memory": "8g",
    "pids": 512
  },
  "network": "on",
  "sshAgent": "auto",
  "mounts": [
    {
      "from": "~/.npmrc",
      "to": "/home/node/.npmrc",
      "mode": "ro"
    },
    {
      "from": "~/projects/shared",
      "to": "/shared",
      "mode": "ro"
    }
  ],
  "env": {
    "CUSTOM_VAR": "value"
  }
}
```

### Use Your Custom Profile

```bash
llxprt --sandbox-profile-load custom "help me with this project"
```

## Step 8: Troubleshooting Common Issues

### Docker Daemon Not Running

**Symptom:** `Cannot connect to the Docker daemon`

**Fix:** Start Docker Desktop or run `sudo systemctl start docker`

### Image Not Found

**Symptom:** `Unable to find image 'llxprt-code-sandbox:latest' locally`

**Fix:** The image should pull automatically. If it fails, check your network and Docker registry access.

### SSH Agent Not Working

**Symptom:** `SSH_AUTH_SOCK not set` or `Permission denied (publickey)`

**Fix:**

```bash
# Start agent
eval "$(ssh-agent -s)"

# Add your key
ssh-add ~/.ssh/id_ed25519

# Verify
ssh-add -l
```

### Credential Proxy Errors

**Symptom:** `Failed to start credential proxy`

**Fix:** This usually means the OS keyring is unavailable.

- **Linux:** Ensure `gnome-keyring-daemon` is running
- **macOS:** Keychain should always be available
- **Fallback:** Use `--key` flag with an API key

### Podman VM Issues (macOS)

**Symptom:** `Error: cannot connect to Podman socket`

**Fix:**

```bash
# Start the VM
podman machine start

# Check status
podman machine ls

# If stuck, recreate
podman machine stop
podman machine rm
podman machine init
podman machine start
```

## Step 9: Best Practices Summary

1. **Default to sandboxed** when working with code you did not write
2. **Use `safe` profile** for pull requests and external contributions
3. **Keep SSH agent running** if you use git with SSH
4. **Save keys on the host** before using them in sandbox
5. **Check profiles** with `cat ~/.llxprt/sandboxes/dev.json`

## Next Steps

- Read the full [Sandbox Documentation](../sandbox.md)
- Learn about [Authentication](../cli/authentication.md)
- Explore [Profile Configuration](../cli/profiles.md)
- Review [Security Best Practices](../sandbox.md#security-considerations)

## Getting Help

If you encounter issues not covered here:

1. Check the [Troubleshooting](../sandbox.md#troubleshooting) section
2. Search existing GitHub issues
3. Ask in the community Discord
4. Open a new issue with debug output: `DEBUG=1 llxprt --sandbox ...`
