# Issue #1036: Technical Overview

## Affected File

All production changes are in a single file:

    packages/cli/src/utils/sandbox.ts  (~1200 lines)

Test files:

    packages/cli/src/utils/sandbox.test.ts
    packages/cli/src/config/__tests__/sandboxConfig.test.ts

## Function Under Modification

All four fixes touch the `start_sandbox()` function (line 221). This is the
sole entry point for launching Docker/Podman containers. It is called from
`packages/cli/src/gemini.tsx` (line 862) and receives a `SandboxConfig` object
with a typed `command` field (`'docker' | 'podman' | 'sandbox-exec'`) and an
`image` string.

The function has two major branches:

- **Lines 254-466**: The `sandbox-exec` (macOS seatbelt) path. Not touched.
- **Lines 469-1065**: The Docker/Podman container path. All four fixes live here.

## Structure of the Docker/Podman Path

The container path builds an `args` array that becomes the arguments to
`spawn(config.command, args)` at line 1012. The sections, in order:

| Lines     | Section                            | Relevant Fix |
|-----------|------------------------------------|-------------|
| 469-517   | Dev sandbox build (BUILD_SANDBOX)  | —           |
| 521-530   | Image presence check + error msg   | **Fix 1**   |
| 532-542   | Base args: run, --rm, --init, --workdir | —      |
| 536-542   | SANDBOX_FLAGS parsing               | —           |
| 544-560   | Resource limits (cpus, memory, pids) | —          |
| 562-594   | TTY detection                       | —           |
| 593-594   | Mount: working directory            | —           |
| 596-614   | Mount: user settings dir (dual-HOME pattern) | Reference for Fix 3 |
| 616-617   | Mount: os.tmpdir()                  | —           |
| 619-626   | Mount: gcloud config dir (:ro)      | Insertion point for **Fix 3** |
| 628-639   | Mount: ADC credentials file         | —           |
| 641-670   | Mount: SANDBOX_MOUNTS env var       | —           |
| 673-703   | SSH agent socket mount              | **Fix 4** (replace) |
| 706-712   | Port exposure                       | —           |
| 714-820   | Environment variables (API keys, model, term, etc.) | Insertion point for **Fix 2** |
| 823-824   | Passthrough env vars                | —           |
| 826-848   | VIRTUAL_ENV mount                   | —           |
| 850-863   | SANDBOX_ENV custom env vars         | —           |
| 866-878   | NODE_OPTIONS, SANDBOX name          | —           |
| 880-885   | Podman authfile workaround          | —           |
| 887-935   | UID/GID mapping + HOME env          | Interaction with Fix 3 |
| 933-937   | Push image and entrypoint           | —           |
| 939-984   | Proxy process (background, cleanup) | Reference pattern for Fix 4 |
| 986-1009  | Stdin TTY handoff                   | —           |
| 1011-1014 | Spawn sandbox process               | —           |
| 1016-1059 | Exit handling, close promise        | —           |

## Fix 1: Stale Error Message

### Touch Point

Line 526, inside the `ensureSandboxImageIsPresent` failure handler:

```
: 'Please check the image name, your network connection, or notify gemini-cli-dev@google.com if the issue persists.';
```

### What Changes

Replace the Google email string with the project discussions URL. Single string
literal replacement.

### Dependencies

None. No behavioral change.

## Fix 2: GIT_DISCOVERY_ACROSS_FILESYSTEM

### Touch Point

Insert after line 821 (after the COLORTERM env push, before the passthrough
env vars block at line 823). This is the env-var section of the args array.

```
// copy TERM and COLORTERM to try to maintain terminal setup
if (process.env.TERM) {
  args.push('--env', `TERM=${process.env.TERM}`);
}
if (process.env.COLORTERM) {
  args.push('--env', `COLORTERM=${process.env.COLORTERM}`);
}

<<<< INSERT HERE >>>>

// Pass through curated CLI environment variables.
args.push(...buildSandboxEnvArgs(process.env));
```

### What Changes

Unconditionally push `--env GIT_DISCOVERY_ACROSS_FILESYSTEM=1` into the args
array. No conditional — this is always correct inside a container.

### Dependencies

None. The variable is read by Git at runtime, not by any of our code.

## Fix 3: Git Configuration Mounts

### Touch Point

Insert after line 626 (after the gcloud config mount block, before the ADC
file mount). This is the read-only config mount section.

The current mount sequence at this location:

```
// mount gcloud config directory if it exists
const gcloudConfigDir = path.join(os.homedir(), '.config', 'gcloud');
if (fs.existsSync(gcloudConfigDir)) {
  args.push(
    '--volume',
    `${gcloudConfigDir}:${getContainerPath(gcloudConfigDir)}:ro`,
  );
}

<<<< INSERT HERE >>>>

// mount ADC file if GOOGLE_APPLICATION_CREDENTIALS is set
```

### Files to Mount

Three host paths, each guarded by `fs.existsSync`, each mounted `:ro`:

1. `path.join(os.homedir(), '.gitconfig')` — traditional Git config location
2. `path.join(os.homedir(), '.config', 'git', 'config')` — XDG standard
3. `path.join(os.homedir(), '.gitignore_global')` — commonly referenced by
   gitconfig `core.excludesFile`

### Dual-HOME Mount Pattern

The container may resolve HOME to a different path than the host. Two scenarios:

**Default (no UID mapping):** Container runs as `node` user with
HOME=`/home/node`. Git inside the container looks for `/home/node/.gitconfig`.

**UID-mapped (Debian/Ubuntu):** The `shouldUseCurrentUserInSandbox()` path
(line 895) creates a user with HOME set to `os.homedir()` and pushes
`--env HOME=${os.homedir()}` (line 930). Git looks at the host home path.

The existing user-settings mount (lines 596-614) solves this by mounting at
both paths:

```
args.push('--volume', `${hostPath}:${sandboxPath}`);
if (sandboxPath !== hostPath) {
  args.push('--volume', `${hostPath}:${getContainerPath(hostPath)}`);
}
```

Git config mounts must follow the same pattern. For each file that exists,
mount at:
- `/home/node/.gitconfig` (or equivalent XDG path) — for the default node user
- `getContainerPath(os.homedir()) + '/.gitconfig'` — for the UID-mapped user

If these resolve to the same path (which they do on Linux when HOME is already
`/home/node`), only one mount is needed (same guard as user settings).

### Interaction with UID Mapping (lines 887-935)

The UID-mapping code runs AFTER the mount section. It sets
`HOME=${os.homedir()}` as an env var. This does not affect mount paths — the
mounts are already established. But it means Git inside the container will
resolve `~` to `os.homedir()`, so the host-path mount is the one that matters
for UID-mapped containers.

### Security: What We Do NOT Mount

- `~/.git-credentials` — contains plaintext tokens. Users who need this can
  use the existing `SANDBOX_MOUNTS` / `LLXPRT_SANDBOX_MOUNTS` mechanism.
- `[include]` target paths from gitconfig — too complex to parse and chase.
  Documented limitation.

## Fix 4: Platform-Aware SSH Agent Forwarding

### Touch Point

Replace lines 673-703 (the entire SSH agent block). The current code:

```
const sshAgentSetting =
  process.env.LLXPRT_SANDBOX_SSH_AGENT ?? process.env.SANDBOX_SSH_AGENT;
const shouldEnableSshAgent =
  sshAgentSetting === 'on' ||
  (sshAgentSetting !== 'off' && !!process.env.SSH_AUTH_SOCK);

if (shouldEnableSshAgent) {
  const sshAuthSock = process.env.SSH_AUTH_SOCK;
  if (!sshAuthSock) {
    console.warn('SSH agent requested but SSH_AUTH_SOCK is not set.');
  } else if (!fs.existsSync(sshAuthSock)) {
    console.warn(`SSH_AUTH_SOCK not found at ${sshAuthSock}.`);
  } else {
    const containerSocket = '/ssh-agent';
    let mountSpec = `${sshAuthSock}:${containerSocket}`;

    if (config.command === 'podman' && os.platform() === 'linux') {
      mountSpec = `${sshAuthSock}:${containerSocket}:z`;
    }

    if (config.command === 'podman' && os.platform() === 'darwin') {
      if (sshAuthSock.includes('/private/tmp/com.apple.launchd')) {
        console.warn(
          'Podman on macOS may not access launchd SSH sockets reliably. ...',
        );
      }
    }

    args.push('--volume', mountSpec);
    args.push('--env', `SSH_AUTH_SOCK=${containerSocket}`);
  }
}
```

### Replacement: Extracted Helper Function

Extract the SSH agent logic into an async function at module level:

```
async function setupSshAgentForwarding(
  config: SandboxConfig,
  args: string[],
): Promise<ChildProcess | undefined>
```

Returns an optional `ChildProcess` representing the SSH tunnel (Podman macOS
only). The caller is responsible for registering cleanup handlers on this
process.

The function preserves the existing `shouldEnableSshAgent` logic (respects
`LLXPRT_SANDBOX_SSH_AGENT` / `SANDBOX_SSH_AGENT` env vars and
`SSH_AUTH_SOCK` presence), then branches by platform:

### Strategy: Linux (any engine)

Condition: `os.platform() === 'linux'`

Same as current behavior. Direct mount of host SSH_AUTH_SOCK into the
container. For Podman on Linux, append `:z` for SELinux relabeling.

```
mountSpec = `${sshAuthSock}:/ssh-agent`       (docker)
mountSpec = `${sshAuthSock}:/ssh-agent:z`     (podman)
```

Returns `undefined` (no background process).

### Strategy: Docker on macOS

Condition: `config.command === 'docker' && os.platform() === 'darwin'`

Docker Desktop (since v2.2.0) provides a built-in bridge socket at
`/run/host-services/ssh-auth.sock` inside the Docker VM. This socket proxies
to the host's SSH agent regardless of whether the host socket is a launchd
path.

The function performs two checks:

1. Run `docker info --format '{{.OperatingSystem}}'` and verify the output
   contains "Docker Desktop".
2. Verify the magic socket exists inside the VM by running
   `docker run --rm -v /run/host-services/ssh-auth.sock:/probe alpine test -S /probe`
   (or equivalent lightweight check).

If both pass, use the magic socket:

```
args.push('--volume', '/run/host-services/ssh-auth.sock:/ssh-agent');
args.push('--env', 'SSH_AUTH_SOCK=/ssh-agent');
```

If either check fails, skip SSH agent forwarding with a warning (not fatal —
the user may not need it, and non-Desktop Docker on macOS is an unusual
configuration).

Returns `undefined` (no background process).

### Strategy: Podman on macOS

Condition: `config.command === 'podman' && os.platform() === 'darwin'`

virtiofs cannot share Unix sockets between macOS and the Podman Linux VM.
The function automates an SSH reverse tunnel:

**Step 1 — Discover Podman machine SSH connection.**
Run `podman system connection list --format json` and parse the JSON output.
Select the connection marked as default. If no default is marked but exactly
one connection exists, use that connection. Extract the URI and identity file
path. The JSON format is stable; the text table format is not.

If this fails (no connections, multiple non-default connections, or command
error): throw `FatalSandboxError` with actionable remediation guidance (e.g.,
"Verify your Podman machine is running with `podman machine start`").

**Step 2 — Clean stale socket.**
Run `podman machine ssh "rm -f /tmp/ssh-agent.sock"` to remove any leftover
socket from a previous session.

**Step 3 — Spawn tunnel.**
Parse the SSH URI to extract user, host, and port. Spawn:

```
ssh -i <identity_file> -p <port> -R /tmp/ssh-agent.sock:<host_SSH_AUTH_SOCK> -o StrictHostKeyChecking=no -N <user>@<host>
```

The process is spawned with `detached: true` and `stdio: 'ignore'`.

If the spawn fails: throw `FatalSandboxError`.

**Step 4 — Poll for readiness.**
Loop calling `podman machine ssh "test -S /tmp/ssh-agent.sock"` with a short
sleep interval, up to a timeout (e.g. 10 seconds). This avoids a fixed
sleep that's too long on fast machines or too short on slow ones.

If the timeout is reached: kill the tunnel process, throw `FatalSandboxError`.

**Step 5 — Mount into container.**

```
args.push('--volume', '/tmp/ssh-agent.sock:/ssh-agent');
args.push('--env', 'SSH_AUTH_SOCK=/ssh-agent');
```

Return the tunnel `ChildProcess`.

### Tunnel Cleanup

Back in `start_sandbox()`, after the extracted function returns, if a tunnel
process was returned:

- Register cleanup handlers on `process.on('exit')`, `process.on('SIGINT')`,
  `process.on('SIGTERM')` — same pattern as the proxy process (lines 951-958).
- Use an idempotent guard (`let sshTunnelCleaned = false`) to prevent
  double-cleanup if multiple signals fire.
- The cleanup kills the tunnel process and removes the stale socket.

The existing proxy cleanup (lines 951-958) does NOT have an idempotent guard.
This is a pre-existing issue but not in scope for this fix.

### Existing Imports Already Available

All needed imports are already present in sandbox.ts:

- `exec`, `execSync`, `spawn`, `ChildProcess` from `node:child_process`
- `os` from `node:os`
- `path` from `node:path`
- `fs` from `node:fs`
- `FatalSandboxError` from `@vybestack/llxprt-code-core`
- `promisify` from `node:util` (used for `execAsync`)

No new dependencies are needed.

### SandboxConfig Type

Defined in `packages/core/src/config/config.ts` (line 302):

```
export interface SandboxConfig {
  command: 'docker' | 'podman' | 'sandbox-exec';
  image: string;
}
```

The `command` field is the discriminant for all platform branching.

## Existing Test Coverage

### sandbox.test.ts

Tests only the exported `getPassthroughEnvVars` and `buildSandboxEnvArgs`
helper functions. Does not test `start_sandbox` (which is not easily
unit-testable due to process spawning). The new SSH helper function, being
extracted, can be tested independently.

### sandboxConfig.test.ts

Tests `loadSandboxConfig` with mocked `command-exists` and package.json.
Uses `vi.mock` for module-level mocks and `process.env` manipulation in
`beforeEach`/`afterEach`.

### Test Pattern for New Code

The extracted `setupSshAgentForwarding` function should be exported and
tested with:

- `vi.mock('node:os')` for `os.platform()` return values
- `vi.mock('node:child_process')` for `execSync`/`spawn` behavior
- `vi.mock('node:fs')` for `fs.existsSync` on socket paths
- `process.env` manipulation for `SSH_AUTH_SOCK`, `LLXPRT_SANDBOX_SSH_AGENT`
- Assertions on `args` array contents and returned ChildProcess

Test cases:
- Linux + docker: direct mount, no tunnel
- Linux + podman: direct mount with :z, no tunnel
- macOS + docker (Desktop detected): magic socket mount
- macOS + docker (Desktop not detected): warning, no mount
- macOS + podman: tunnel spawned, socket polled, mount added
- macOS + podman (tunnel fails): FatalSandboxError thrown
- SSH agent disabled via env var: no mount regardless of platform
- SSH_AUTH_SOCK not set: warning, no mount
