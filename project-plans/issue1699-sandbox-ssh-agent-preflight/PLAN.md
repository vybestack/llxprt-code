# Issue #1699 — Sandbox SSH agent forwarding: detect empty host agent and guide remediation

## Problem

When sandboxing is enabled and `sshAgent` is `auto`/`on`, LLxprt Code forwards
`SSH_AUTH_SOCK` into the container. If the host agent is running but has **zero
identities loaded**, the forwarding path is wired up correctly yet every git
operation over SSH inside the sandbox fails with the generic
`git@github.com: Permission denied (publickey).` The root cause (empty host
agent) is invisible to the user.

## Scope

In scope:

- A host-side preflight that queries the host SSH agent for loaded identities
  during sandbox SSH agent forwarding setup.
- A targeted, user-visible warning with remediation when the agent is reachable
  but reports no identities.
- Documentation of the new warning in the sandbox troubleshooting docs.

Explicitly out of scope (listed as "optional" in the issue, not implemented):

- An interactive helper/wizard command for loading a key.
- A new CLI flag that runs a preflight and attempts a guided fix.
- Any change to how forwarding itself is configured.

## Design

`setupSshAgentForwarding()` in `packages/cli/src/utils/sandbox-ssh.ts` is the
single entry point for all container sandbox SSH forwarding (docker + podman,
linux + macOS). It already validates, in order: the `off` setting, the
`on`/auto enablement rule, `SSH_AUTH_SOCK` presence, and socket existence on
disk.

The check runs **after** the platform dispatch, gated on the container actually
being configured to use the forwarded agent (an `SSH_AUTH_SOCK=` env argument
was added). A platform helper can still decline — Podman on macOS refuses to
override a non-host `--network` — and a warning claiming "SSH forwarding is
enabled" would be wrong in that case.

Detection: run `ssh-add -l` with `SSH_AUTH_SOCK` pointed at the socket being
forwarded. The child is spawned asynchronously — a diagnostic must not block
the event loop during sandbox startup — and its exit status, output, and spawn
error are collected into one value so no outcome is signalled by an exception.

`ssh-add` exits 1 for **any** identity-listing failure, not only for an empty
agent: OpenSSH prints `The agent has no identities.` on stdout for the empty
case but `error fetching identities: ...` on stderr for a communication
failure, and exits 1 in both. Exit status alone is therefore not a valid
discriminator.

| outcome                                     | action                        |
| ------------------------------------------- | ----------------------------- |
| exit 0 — agent has identities                | silent, proceed               |
| exit 1 + `agent has no identities` in output | user-visible warning, proceed |
| exit 1 + any other output                    | debug-level log only, proceed |
| exit 2 — agent could not be contacted        | debug-level log only, proceed |
| spawn error (`ssh-add` missing, timeout)     | debug-level log only, proceed |

Surfacing: host-side `process.stderr.write`, the established convention in
this package for user-facing messages emitted outside the Ink UI
(`unconfiguredProviderGuard.ts`, `pathMigration.ts`). `debugLogger.warn` is
**not** sufficient — it is suppressed unless debug output is enabled, which is
exactly why the existing SSH warnings are invisible to users. The startup
warnings file (`gemini-cli-warnings.txt`) is **not** usable here: it is written
on the host but read inside the container, whose `os.tmpdir()` is `/tmp` and is
not the mounted host temp directory.

The preflight is strictly non-blocking: an empty agent is a legitimate state
(the user may intend to add a key later, or may not need SSH at all), so
forwarding proceeds unchanged in every case.

Robustness: the agent query is bounded by a short timeout, and the timeout kill
signal is `SIGKILL` so a child that ignores `SIGTERM` cannot hold sandbox
startup open past the deadline.

## Acceptance criteria

- **AC1** When SSH agent forwarding is enabled (`sshAgent` not `off`, or `on`),
  `SSH_AUTH_SOCK` is set, the socket exists on disk, and the container has been
  configured to use the forwarded agent, LLxprt Code queries the host agent for
  loaded identities.
- **AC2** When the agent reports no identities, a warning is written to stderr
  containing all three pieces of information from the issue: that the socket is
  present but no identities are loaded, that git SSH auth will fail until a key
  is loaded, and the remediation `ssh-add ~/.ssh/id_ed25519`.
- **AC3** The check is non-blocking: the forwarding arguments and the returned
  `SshAgentResult` are identical to today regardless of the outcome.
- **AC4** When the agent reports identities, no user-visible warning is emitted.
- **AC5** When the check is inconclusive (agent unreachable, identity listing
  fails for a reason other than an empty agent, `ssh-add` not installed,
  timeout, or any other failure), no empty-agent warning is emitted; a
  debug-level log records the reason.
- **AC6** No `ssh-add` process is spawned when forwarding is `off`, when
  `SSH_AUTH_SOCK` is unset, when the socket path does not exist, or when the
  selected platform helper declined to configure forwarding.
- **AC7** The query runs against the socket that is being forwarded (explicit
  `SSH_AUTH_SOCK` in the child environment) and is bounded by a timeout that is
  enforced with `SIGKILL`.

## Boundary cases

- Exit 1 with `error fetching identities: communication with agent failed` on
  stderr (socket accepts the connection then closes) → AC5, **not** the
  empty-agent message.
- No numeric status (killed by signal after the timeout, or a spawn error such
  as `ENOENT` because `ssh-add` is not installed) → AC5.
- Exit status 2 (agent unreachable) even though the socket file exists (stale
  socket) → AC5.
- Podman on macOS with a pre-existing non-host `--network`: the helper skips
  forwarding, so no warning is emitted even with an empty agent → AC6.
- Warning must not be emitted more than once per setup call.

## Test plan (behavioral, no mock theater)

All tests in `packages/cli/src/utils/sandbox-ssh-agent-preflight.test.ts`,
driving the public `setupSshAgentForwarding` entry point. Tests assert
observable behavior — the exact bytes written to stderr and the arguments and
result produced — and model realistic `ssh-add` outcomes (status, signal,
stdout, stderr, spawn error) rather than a synthetic exit code.

1. **Empty agent warns (AC2)**: exit 1 with `The agent has no identities.` on
   stdout → stderr receives exactly the three-line remediation message.
2. **Empty agent still forwards (AC3)**: same outcome → the container
   `SSH_AUTH_SOCK` argument is still added and the result is unchanged.
3. **Loaded agent is silent (AC4)**: exit 0 with a key listing → no stderr
   output; forwarding configured.
4. **Non-empty listing failure is silent (AC5)**: exit 1 with
   `error fetching identities: communication with agent failed` on stderr → no
   stderr output; forwarding configured.
5. **Agent unreachable is silent (AC5)**: exit 2 → no stderr output.
6. **`ssh-add` not installed is silent (AC5)**: spawn error `ENOENT` → no
   stderr output.
7. **Timeout kill is silent (AC5)**: the child closes with no status after
   `SIGKILL` → no stderr output.
8. **Queries the forwarded socket under a bounded timeout (AC7)**: `ssh-add -l`
   with `SSH_AUTH_SOCK` equal to the socket being forwarded, a finite timeout,
   and `killSignal: 'SIGKILL'`.
9. **Disabled paths do not query (AC6)**: `sshAgent: off`, missing
   `SSH_AUTH_SOCK`, and a non-existent socket path each spawn nothing.
10. **Declined forwarding does not warn (AC6)**: Podman on macOS with
    `--network none` and an empty agent → forwarding is skipped and stderr
    stays empty.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and the CLI smoke test.
