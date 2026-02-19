# Tutorial: Set up sandboxing for real development work

This tutorial is for developers who want to run llxprt with sandbox protection turned on by default, then validate login and key behavior without guessing.

Focus: Linux and macOS.

Windows is not tested yet for this workflow. Contributions are welcome.

Time: about 15-20 minutes.

## Why this is worth doing

If you use llxprt on external repos, PRs, or shell-heavy tasks, sandboxing gives you practical safety wins:

- commands run in a container instead of directly on your host
- resource limits reduce runaway CPU/memory/process usage
- OAuth refresh tokens stay on host via credential proxy
- key management writes are blocked inside sandbox mode

You keep velocity, but with better guardrails.

## Prerequisites

- Node.js 20+
- `llxprt` installed
- one working runtime:
  - Docker (macOS/Linux), or
  - Podman (macOS/Linux)

## Step 1: verify your runtime

### Docker

```bash
docker --version
docker ps
```

If `docker ps` fails, start Docker daemon/Desktop first.

### Podman (Linux)

```bash
podman --version
podman run --rm hello-world
```

### Podman (macOS)

```bash
podman --version
podman machine start
podman machine ls
```

## Step 2: run your first sandboxed command

```bash
cd your-project
llxprt --sandbox "list the files in this directory"
```

What happened:

1. runtime selected (Docker/Podman/Seatbelt depending on config and platform)
2. sandbox container launched
3. project mounted
4. command executed from sandboxed context

## Step 3: load a profile (this implies sandbox mode)

You do not need `--sandbox` when using `--sandbox-profile-load`.

```bash
llxprt --sandbox-profile-load dev "show sandbox environment"
```

Try strict mode for untrusted code:

```bash
llxprt --sandbox-profile-load safe "analyze this external repository"
```

## Step 4: validate network behavior

`dev` profile has network on:

```bash
llxprt --sandbox-profile-load dev "run shell command: curl -I https://example.com"
```

`safe` profile has network off:

```bash
llxprt --sandbox-profile-load safe "run shell command: curl -I https://example.com"
```

The second command should fail due to disabled network.

## Step 5: validate SSH passthrough for git workflows

Check host agent first:

```bash
echo $SSH_AUTH_SOCK
ssh-add -l
```

If needed:

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

Then test inside sandbox:

```bash
llxprt --sandbox-profile-load dev "run shell command: ssh-add -l"
```

If keys appear, SSH passthrough is working.

### Podman on macOS: reliable socket setup

If forwarding fails with launchd socket paths, switch to a dedicated socket:

```bash
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock
ssh-add ~/.ssh/id_ed25519
llxprt --sandbox-engine podman --sandbox-profile-load dev
```

## Step 6: validate login and credential proxy behavior

Start interactive sandbox session:

```bash
llxprt --sandbox-profile-load dev
```

Then inside session:

```text
/auth anthropic enable
/auth anthropic login
```

(Use another provider if preferred, e.g. `/auth gemini enable` then `/auth gemini login`.)

What to expect:

- login flow is initiated from sandbox session
- host handles secure token exchange and refresh storage
- sandbox receives usable short-lived credentials via proxy

Check socket env inside sandbox:

```text
run shell command: echo $LLXPRT_CREDENTIAL_SOCKET
```

If set, proxy path is active.

## Step 7: validate key command behavior (host vs sandbox)

### On host (non-sandbox session)

```bash
llxprt
```

Then:

```text
/key save workkey sk-your-key-value
/key list
/key load workkey
```

### In sandbox session

- `/key list` and `/key load workkey` should work
- `/key save ...` and `/key delete ...` should be blocked

This is expected and protects host key storage from sandbox writes.

## Step 8: create your own profile

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
    }
  ]
}
```

Use it:

```bash
llxprt --sandbox-profile-load custom "help me with this project"
```

## Step 9: quick troubleshooting

### image pull/load issues

Symptom:

`Sandbox image '<image>' is missing or could not be pulled.`

Check:

```bash
docker images | grep 'vybestack/llxprt-code/sandbox'
# or
podman images | grep 'vybestack/llxprt-code/sandbox'
```

The default image comes from current release config (`ghcr.io/vybestack/llxprt-code/sandbox:<version>`).

### credential proxy startup issue

Symptom:

`Failed to start credential proxy: ...`

Typical fixes:

- Linux: verify keyring service is running/unlocked
- macOS: ensure Keychain access is available
- temporary fallback: run with `--key` for immediate work

### Podman macOS VM issue

Symptom:

`cannot connect to Podman socket`

Fix:

```bash
podman machine start
podman machine ls
```

If stuck:

```bash
podman machine stop
podman machine rm
podman machine init
podman machine start
```

## Recommended daily pattern

- trusted project work: `--sandbox-profile-load dev`
- unknown or external code: `--sandbox-profile-load safe`
- force runtime only when needed: `--sandbox-engine docker|podman`
- disable sandbox only intentionally: `--sandbox-engine none`

## Next docs

- [Sandbox overview](../sandbox.md)
- [Sandbox profiles reference](../cli/sandbox-profiles.md)
- [Authentication](../cli/authentication.md)
- [Troubleshooting](../troubleshooting.md)
