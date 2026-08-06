# Issue 3082 delivery plan — a missing JSP bootstrap file disables observation

## Scope decision

Deliver one issue-linked pull request closing issue 3082. Scope is exactly the
three things the issue asks for:

1. Split `loadBootstrapFromEnv` failure handling by *why* the load failed. A
   bootstrap file that cannot be read disables observation and lets the CLI
   run. A file that reads but is malformed, insecure, or version-mismatched
   keeps failing fast exactly as today.
2. Make both outcomes diagnosable: every message names
   `LLXPRT_JSP_BOOTSTRAP_FILE` and the offending path.
3. Document `LLXPRT_JSP_BOOTSTRAP_FILE` and its interaction with
   `LLXPRT_JSP_NO_CONTENT`, including the missing-file behavior.

Nothing else in `packages/cli/src/observation` changes. No producer, queue,
publisher, transport, or tap change. No adjacent cleanup.

## Baseline audit

`packages/cli/src/observation/jspWiring.ts` `loadBootstrapFromEnv` treats all
four failure modes identically:

| Input | Today |
| --- | --- |
| Env unset or empty | `null` — observation disabled |
| `readFileSync` throws (any errno) | `FatalConfigError` "could not be read" |
| Body is not JSON | `FatalConfigError` "is malformed JSON" |
| `parseBootstrap` rejects | `FatalConfigError` "was rejected (CODE)" |

Reached from `cliSessionBootstrap.ts` `setupObservation`, so the throw aborts
startup before the TUI mounts.

The current policy was made deliberate by the issue-2921 effort, whose plan
records "explicit misconfiguration keeps failing fast" and pins the unreadable
case in `jspWiring.test.ts` as `throws on unreadable bootstrap file (fail
fast, exit 52)`. Issue 3082 revisits exactly that one row and narrows it: the
security and operator-intent rationale in the 2921 plan covers a file the
supervisor wrote and got wrong, not a stale inherited pointer to a file that
was rotated away. The other three rows of that decision are unchanged, and
their tests stay as-is.

Why the read failure is different in kind:

- `LLXPRT_JSP_BOOTSTRAP_FILE` is inherited by every descendant process
  (subagents, shell-tool commands, test harnesses that spawn the CLI, long-lived
  shells). Those descendants outlive the session that owned the bootstrap file,
  so the pointer goes stale by design, with no operator involved in *this*
  process.
- A file that is not there carries no endpoint, so there is no off-box
  credential exposure to refuse. Not publishing is the safe outcome.
- `jspWiring.ts` already guarantees on its `isolate()` boundary that a failure
  in the observation subsystem "must degrade telemetry only and must never
  disrupt the foreground TUI". Disabling on an absent file puts startup on the
  same side of that guarantee as the runtime path.

`LLXPRT_JSP_BOOTSTRAP_FILE` currently appears nowhere under `docs/`.

## Decision: classify by read outcome, not by "any failure"

- **The file cannot be read at all** (it does not exist, is a directory, is not
  permitted, or any other `readFileSync` throw): return `null`. Observation is
  disabled, startup continues. Emit one warning to **stderr** naming the
  variable, the path, and the errno code so a genuinely misconfigured operator
  is not left guessing. stderr, not stdout, so `-p` output stays pipeable.
- **The file reads but its contents are wrong** (malformed JSON, or
  `parseBootstrap` rejects — which covers non-loopback endpoints and protocol
  version mismatch): keep throwing `FatalConfigError` (exit 52). The operator
  wrote this file for this run; refusing loudly is still correct.

All read failures collapse into one branch on purpose. Enumerating errno codes
would add a classification table whose cross-platform behavior varies (a
directory is `EISDIR` on Linux and macOS but read succeeds differently
elsewhere; a missing parent directory yields `ENOENT` and `ENOTDIR` depending
on where in the path it breaks), and every one of those outcomes means the same
thing operationally: there is no bootstrap here. One branch, no guard ladder.

Messages gain the path. The path is not credential-bearing; the file *body* is,
and the existing rule that the message must never carry the body or the
publisher credential is unchanged and stays pinned by the existing
non-loopback test.

## Acceptance criteria

| ID | Boundary | Inputs / edge cases | Success | Failure / side effects | Evidence |
| --- | --- | --- | --- | --- | --- |
| A1 | Env absent | `LLXPRT_JSP_BOOTSTRAP_FILE` unset; set to the empty string | Returns `null`, throws nothing, warns nothing | Any warning emitted when observation was simply never requested | `jspWiring.test.ts` |
| A2 | Missing file | Env names a path that does not exist | Returns `null`; one warning that contains `LLXPRT_JSP_BOOTSTRAP_FILE`, the offending path, and states observation is disabled | Throwing; exiting; a warning that omits the path or the variable name | `jspWiring.test.ts` |
| A3 | Unreadable, not ENOENT | Env names an existing **directory** | Returns `null` with the same warning shape as A2 | Only `ENOENT` handled, other read failures still fatal | `jspWiring.test.ts` |
| A4 | Warning bypasses patched stdio to physical stderr | Missing file, default sink, with `patchStdio()` active (real `cli.tsx` ordering: patch runs before `setupObservation`) | The warning reaches physical stderr via `writeToStderr` (the pre-patch-bound original), so nothing is forwarded to the patched-stream event bus; nothing on stdout | Warning swallowed/buffered by the pre-`setupObservation` `patchStdio()` redirect, or written to stdout (corrupts `-p` piping) | `jspWiring.test.ts` |
| A5 | Malformed JSON | File exists, body is `{ not json` | `FatalConfigError`, exit code 52, message names the variable, the path, and `malformed JSON` | Degrading silently on a body the operator wrote | `jspWiring.test.ts` |
| A6 | Rejected bootstrap | Non-loopback endpoint (`JSP-E004`); protocol `jsp/2` (`JSP-E003`) | `FatalConfigError`, exit code 52, message names the variable, the path, and the code, and contains neither `publisher_credential` nor `registration_id` values | Failing open on an endpoint aimed off-host; leaking the credential into stderr | `jspWiring.test.ts` |
| A7 | Valid bootstrap | File exists and parses | Returns the parsed bootstrap; no warning | Regression in the working path | `jspWiring.test.ts` |
| A8 | Startup survives a stale pointer | `initializeObservationProducer` invoked with the env naming a missing file | Returns normally; no producer is created; observing a turn afterwards is inert and throws nothing | Startup abort, which is the reported bug | `jspWiring.test.ts` |
| A9 | Documentation | `docs/` search for `LLXPRT_JSP_BOOTSTRAP_FILE` | Documented with the missing-file behavior, the fail-fast cases, and its interaction with `LLXPRT_JSP_NO_CONTENT` | An undocumented variable that can still abort startup | `docs/cli/configuration.md` |
| B1 | Default sink is best-effort | Missing file, default sink, physical stderr writer throws | Returns `null`; the throw is swallowed and never becomes fatal startup | A destroyed/throwing stderr turning a missing-file warning back into a fatal startup abort | `jspWiring.test.ts` |
| B2 | Injected sink stays strict | Missing file, an explicitly injected throwing sink | The injected sink's error propagates (not swallowed) | Silently swallowing an explicitly injected sink's failure | `jspWiring.test.ts` |
| C1 | Warning path sanitization | Env path carries newlines and an ANSI escape; read fails | The warning renders the path via `JSON.stringify`; one logical line; no raw ESC byte | A control-character path injecting additional log lines | `jspWiring.test.ts` |
| C2 | Fatal path sanitization | Filesystem-legal path with a double-quote; body is malformed JSON | `FatalConfigError` message names the escaped path; file body never appears | An unescaped quote/path breaking out of the diagnostic | `jspWiring.test.ts` |

## Implementation notes

- `loadBootstrapFromEnv` gains a second defaulted parameter, a warning sink
  defaulting to a module-local stderr writer. This mirrors the existing `env`
  parameter, which is already injected the same way for the same reason, and
  keeps A2/A3 assertions off a global spy. No new module, no new exported
  class.
- The default sink routes through the core `writeToStderr` helper (which holds
  a pre-patch-bound original `process.stderr.write`) rather than
  `process.stderr.write` directly, so the warning reaches physical stderr even
  after `cli.tsx`'s `patchStdio()` has redirected the stream before
  `setupObservation` runs. The default sink is guarded (best-effort); an
  explicitly injected sink stays strict. This mirrors the guarded-default /
  strict-injected-sink pattern in `launcher/process-memory-hardening.ts`.
- The env-controlled path is rendered in every diagnostic via `JSON.stringify`
  so newlines/ANSI/control characters cannot inject log lines. The
  credential-bearing file body and publisher credential are never included.
- `setupObservation` in `cliSessionBootstrap.ts` carries a comment asserting
  the old policy. Update it to describe the split, since the comment is now
  wrong.
- The existing `jspWiring.test.ts` case `throws on unreadable bootstrap file
  (fail fast, exit 52)` is replaced by A2/A3/A4. That is the single behavior
  this issue reverses; every other pinned throw stays.

## Constraints

- Tests stay Bun-native. `src/observation/jspWiring.test.ts` is already a Bun
  entry in `scripts/bun-test-manifest.ts` and is excluded from the Vitest
  selection; its `vitest` import resolves through the preloaded Bun
  compatibility shim, so changed cases keep that import style.
- No new lint suppressions, no `ts-ignore`/`ts-expect-error`/`ts-nocheck`, no
  complexity or size threshold changes, no severity downgrades, no test-suite
  exclusions.
- Messages must never carry the bootstrap file body or the publisher
  credential. Only the variable name, the path, and a failure category.

## Out of scope

- The observation blocklist in
  `scripts/tests/issue-3062-cli-bundle-aliases.bun.test.ts`. Stripping the
  variable keeps that test hermetic on its own terms and is still correct.
- Any change to the producer, queue, publisher, transport, or tap.
- Any change to how Jefe writes or rotates bootstrap files.
- Revisiting the malformed/insecure/version-mismatch fail-fast policy.
