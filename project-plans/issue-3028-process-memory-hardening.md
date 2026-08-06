# Issue #3028 — Make the capability token unreadable from in-container processes

Follow-up to #2902 / PR #3022.

## Problem

#3022 shipped `--cap-drop=ALL` and `--security-opt no-new-privileges` on every
Docker/Podman sandbox run. Those flags close setuid-root escalation, but they do
**not** stop an in-container process from reading the CLI's heap: reading a
same-UID process's `/proc/<pid>/mem` requires no capability. #3022 therefore
left the property conditional on the host's `kernel.yama.ptrace_scope` and
explicitly did not deliver #2902's third item.

## Measured basis

Real containers, `ghcr.io/vybestack/llxprt-code/sandbox:0.11.0`, a parent process
reads the hardened child's heap (the more permissive direction, so the denial
implies the realistic descendant-reads-ancestor denial):

| Config | Result |
|---|---|
| `--cap-drop=ALL` + nnp (shipped in #3022) | `TOKEN_RECOVERED` |
| the above + `prctl(PR_SET_DUMPABLE, 0)` | **`MAPS_DENIED EACCES`** |
| `prctl(PR_SET_DUMPABLE, 0)` but `CAP_SYS_PTRACE` retained | `TOKEN_RECOVERED` |

Non-dumpable makes `/proc/<pid>/{maps,mem}` root-owned, so `ptrace_may_access`
denies an ordinary same-UID reader. `CAP_SYS_PTRACE` is a privileged override
that bypasses the dumpable check, so row 3 shows the two controls compose:
`PR_SET_DUMPABLE(0)` denies the ordinary reader, and the #3022 capability drop
denies the privileged override. Dropping the capability alone does NOT deny the
ordinary reader.

## Design constraints

1. `PR_SET_DUMPABLE` is reset to 1 on every `execve`, so it cannot be set by the
   container entrypoint or any wrapper. It must be set **in-process by the final
   token-holding process**.
2. That process is always Bun. `packages/cli/index.ts` calls
   `runBunLauncherIfNeeded()` before importing the CLI, and
   `resolveRequiredBunPath` throws `FatalError(..., 43)` rather than falling back
   to Node. Inside the resolved `.then()` the process is post-relaunch and final.
3. `bun:ffi` must not be imported at module scope — the module is typechecked and
   may be loaded in Node contexts (tests, tooling). Use a dynamic import inside
   the guarded branch.
4. The call must land before `import('./src/cli.js')`, i.e. before settings,
   extensions, hooks, MCP, and the credential-store factory.

## Hardening gate

The gate is: **Linux AND (container sandbox OR credential-bearing)**.

- **Container sandbox**: `SANDBOX` env var is set to a non-empty, non-
  `sandbox-exec` value (mirrors `ui/commands/bugCommand.ts`).
- **Credential-bearing**: `LLXPRT_CAPABILITY_FD` or `LLXPRT_CREDENTIAL_SOCKET` is
  set. Both are present at the bootstrap point (before
  `import('./src/cli.js')`): the sandbox entrypoint sets
  `LLXPRT_CAPABILITY_FD=3` before exec'ing the CLI (scrubbed only later by the
  credential-store factory), and `sandbox-containers.ts` injects
  `LLXPRT_CREDENTIAL_SOCKET` for the whole session. The credential-bearing arm
  closes a gap where a custom or direct Linux launch is credential-bearing but
  `SANDBOX` is unset.

## Fail-closed vs. warn-and-continue

The failure policy is **conditional on whether the process is credential-bearing**:

- **Credential-bearing + hardening fails** → **fail closed**: throw `FatalError`
  (exit 44). The CLI refuses to start because it cannot protect the credential
  in memory. This applies when `bun:ffi` is unavailable, libc is missing,
  `prctl` returns non-zero, or the callable throws. The message names the likely
  cause (non-glibc sandbox image) and is actionable. Throwing from inside the
  `runBunLauncherIfNeeded().then()` callback routes to the existing `.catch()`
  and `writeCriticalErrorAndGetExitCode`, producing a clean exit — not an
  unhandled rejection.
- **Not credential-bearing + hardening fails** → **warn and continue**: write a
  visible warning to stderr and return normally. This preserves the
  compatibility path for tokenless custom images.

## Acceptance matrix

| AC | Behavior | Evidence |
|---|---|---|
| AC1 | On Linux inside a sandbox, the CLI process is made non-dumpable before the CLI module is imported. | Real-container test: parent read of the child's `/proc/<pid>/maps` is denied. |
| AC2 | The hardening is a no-op off Linux, a no-op when neither sandboxed nor credential-bearing, and engages when credential-bearing even if `SANDBOX` is unset. | Unit tests over the gate with an injected prctl callable; asserts called/not-called per the gate. |
| AC3 | Credential-bearing + hardening fails → throws `FatalError` (fail closed). Not credential-bearing + hardening fails → warns on stderr and continues. | Unit tests with injected failing/throwing/null callables for both paths. |
| AC4 | The production call site runs after the Bun relaunch decision and before the CLI import. | Lexical ordering test over `packages/cli/index.ts` bootstrap **plus** real-container E2E test (AC4-E2E) that calls the real production `applyProcessMemoryHardening()` (same import path as index.ts) and asserts the process's `/proc/<pid>/maps` is root-owned. A full `bun packages/cli/index.ts` launch is not achievable inside the current sandbox image because `index.ts` statically imports the core barrel → `@vybestack/llxprt-code-tools` → `sharp`, which is not installed. The lexical test catches deletion of the call from index.ts. |
| AC5 | A parent process in a real container cannot read the hardened child process's memory. | Real-container test driving the **production** module (parent-reads-child, Yama-independent); falsifiable — removing the prctl call turns it red. |
| AC6 | `docs/sandbox.md` states the boundary unconditionally, describes the precise composition, and retains the in-process non-goal. | Doc diff. |

Real-container tests reuse the gating and helper conventions already in
`integration-tests/sandboxPrivilege.real.test.ts` (run when a runtime + image
are available, skip only when genuinely absent, honor `LLXPRT_SANDBOX`).

## Test-arm design (Yama independence)

Both test arms invert the relationship so the **TRACER is the PARENT** and the
**TARGET is a CHILD**:

- Child process: calls the real production `applyProcessMemoryHardening()` and
  holds the 64-hex secret resident in its heap.
- Parent process: reads `/proc/<child>/maps` and `/proc/<child>/mem` and scans
  for the secret.
- Hardened (dumpable=0) => DENIED — requires `CAP_SYS_PTRACE` regardless of
  Yama, and #3022 drops it.
- Gate disengaged => RECOVERED under both `ptrace_scope` 0 and 1, because tracing
  a descendant is permitted at scope 1.

This is a strictly stronger test: parent-reads-child is the more permissive
direction, so denying it implies denying the realistic descendant-reads-ancestor
direction. Verified by running with `kernel.yama.ptrace_scope=1` and `=0`.

## Non-goals

- In-process attackers. Code executing **inside** the CLI (a malicious
  dependency, a compromised in-process extension) reads the token from its own
  heap; `PR_SET_DUMPABLE` does not help. Unchanged non-goal from #1954.
- Per-command UID separation.
- Seatbelt / macOS-host path.
- Any change to the credential proxy protocol, token format, or authorization.
- Any workflow, dependency, or quality-tool change.
