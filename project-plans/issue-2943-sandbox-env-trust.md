# Issue #2943 — A pre-existing SANDBOX env var silently disables an explicitly requested sandbox

Branch: `issue2943`. Issue: https://github.com/vybestack/llxprt-code/issues/2943

## Problem summary

`getSandboxCommand` in `packages/cli/src/config/sandboxConfig.ts` returns `''`
unconditionally when `process.env.SANDBOX` is set, before any request
resolution. Because the empty string is also the "no sandbox requested"
value, an explicit request (`--sandbox`, `--sandbox-engine`,
`--sandbox-profile-load`, `LLXPRT_SANDBOX`, `settings.sandbox`) is silently
dropped and the user runs unsandboxed with no indication.

`SANDBOX` is a generic name; a CI system, an unrelated tool, or a leftover
shell export can set it. The guard exists to prevent recursive sandboxing:
LLxprt itself writes `SANDBOX=<containerName>` in
`packages/cli/src/utils/sandbox-containers.ts` (`addContainerEnvVars`) and
`SANDBOX=sandbox-exec` in `packages/cli/src/utils/sandbox-seatbelt.ts`
(`buildSeatbeltArgs`).

Secondary findings from research (verified against source):

- `maybeHopIntoSandbox` (`packages/cli/src/cliSandbox.ts:168`) has a second
  raw `process.env.SANDBOX` early return. Once config resolution is fixed it
  is the remaining silent blocker for the hop; with genuine values the
  `config.getSandbox()` check directly below it already returns, so the raw
  check is redundant and trusts the same generic variable.
- The engine/profile request paths bypass the `getSandboxCommand` early
  return today (`resolveBaseSandboxCommand` picks a command when a profile is
  present; `resolveSandboxEngine` picks one when `--sandbox-engine` is set),
  so the nested guard is currently inconsistent: it suppresses flag/env/
  settings requests but not engine/profile ones. The fix must apply the
  nested guard to every request path uniformly (issue AC: "Genuine nested
  invocation ... still does not recurse", and the issue text states the
  early return "overrides every request path", which is the intended,
  consistent behavior).

Out of scope (verified untouched):

- `cliBootstrap.tsx:113` (`maybeRelaunchForMemory`) and `scripts/start.ts:88`
  read `SANDBOX` for memory-relaunch/debug wiring, not sandbox suppression.
- Display readers (Footer, aboutCommand, bugCommand, docsCommand, prompts,
  mcp-connection, editor, containerSandbox, process-memory-hardening) treat
  `SANDBOX` as "am I inside a sandbox" for cosmetic/behavioral purposes.
  A foreign value continues to influence them as before; changing those is
  not part of this issue.
- The `GEMINI_API_KEY` / `GOOGLE_API_KEY` forwarding note in the issue is
  explicitly deferred to a separate design discussion.

## Accepted behavior (acceptance criteria)

The writers LLxprt itself produces are exactly two shapes:

1. the Seatbelt literal `sandbox-exec`, and
2. the generated container name `<image-name-tag>-<pid>` with an optional
   numeric collision suffix `<image-name-tag>-<pid>-<n>`
   (`assignContainerName` in `sandbox-containers.ts`).

**AC1 — foreign value + explicit request → sandbox starts.** With `SANDBOX`
set to any other value (`1`, `true`, arbitrary text) and an explicit sandbox
request, `loadSandboxConfig` resolves exactly as it would with `SANDBOX`
unset: it returns `{ command, image }` when an engine is available, throws
the usual `FatalSandboxError` when the request is invalid, and emits no
suppression warning.

**AC2 — LLxprt-written value → suppressed, warned, no recursion.** With
`SANDBOX` set to one of the two LLxprt-written shapes, `loadSandboxConfig`
returns `undefined` for every request path (flag, `LLXPRT_SANDBOX`,
`settings.sandbox`, `--sandbox-engine`, `--sandbox-profile-load`) without
probing for engines and without throwing, and writes one warning to stderr
that names the `SANDBOX` value and the request source(s). This keeps genuine
nested invocation (container or Seatbelt launch) from recursing while making
the suppression loud.

**AC3 — no request, `SANDBOX` unset → unchanged.** Returns `undefined`,
emits nothing.

**AC4 — opt-outs unaffected.** `--no-sandbox` / `--sandbox false` /
`LLXPRT_SANDBOX=false` / `--sandbox-engine none` still return `undefined`
with no warning, regardless of `SANDBOX`.

**AC5 — single trust point.** The raw `process.env.SANDBOX` check in
`maybeHopIntoSandbox` is removed; suppression is decided solely in
`loadSandboxConfig`, so a foreign `SANDBOX` no longer blocks the hop and a
genuine one still does (via `config.getSandbox()` being `undefined`).

**AC6 — docs.** The "Do not rely on the SANDBOX environment variable"
paragraph in `docs/sandbox.md` is updated: a pre-existing foreign value no
longer silently skips sandbox startup; only LLxprt-written values skip, with
a warning.

### Boundary cases

- `SANDBOX=''` (empty) is treated as unset everywhere (it already was).
- Container-name false positives (a foreign value that happens to match
  `<something>-<pid>[-<n>]`) are suppressed **with the warning**, so the
  failure is loud, not silent; the user is told why and can unset it.
- Genuine nested invocation with no request at all stays silent (nothing to
  warn about; identical outcome to today).
- Genuine nested + `--sandbox` where no engine exists inside the sandbox:
  must NOT throw (`pickRequestedSandboxCommand`'s FatalSandboxError must not
  fire) — the nested check happens before any engine probing. Today's code
  silently returns `''`; the new code returns `undefined` the same way (plus
  a warning when a request was present).

## Implementation plan (test-first)

1. **Tests first** — new `packages/cli/src/config/sandboxConfig.nested.test.ts`
   modeled on `sandboxConfig.precedence.test.ts` (real `loadSandboxConfig`,
   only `command-exists` substituted; `../sandboxProfiles.js` substituted for
   the profile cases), covering AC1–AC4 as listed in the test matrix below.
2. `packages/cli/src/config/sandboxConfig.ts`:
   - Add exported predicate `isLlxprtWrittenSandboxValue(value)`:
     `value === 'sandbox-exec'` or `/^.+-\d+(?:-\d+)?$/` (container name
     shape).
   - Remove the `process.env.SANDBOX` early return from `getSandboxCommand`.
   - In `loadSandboxConfig`, immediately after `resolveSandboxOption` and
     before any engine probing: if the predicate matches, emit the warning
     when an explicit request source exists (resolved source for enable
     values, `--sandbox-engine` when a concrete engine is set,
     `--sandbox-profile-load` when the profile wants a sandbox) and return
     `undefined`.
3. `packages/cli/src/cliSandbox.ts` — remove the redundant raw
   `process.env.SANDBOX` guard in `maybeHopIntoSandbox` (AC5).
4. Update `AC7` in `packages/cli/src/config/sandboxConfig.precedence.test.ts`
   to pin the new semantics with an LLxprt-written value (the current test
   uses `SANDBOX='1'`, which is now the foreign-value case that must START a
   sandbox).
5. `docs/sandbox.md` — AC6 paragraph update.
6. Full verification cycle (see below).

### Test matrix (behavioral, via real loadSandboxConfig)

| # | SANDBOX            | Request                          | Expected                                     |
|---|--------------------|----------------------------------|----------------------------------------------|
| 1 | `'1'`              | `--sandbox` true, docker avail.  | config `docker`, no warning                  |
| 2 | `'true'`           | `LLXPRT_SANDBOX=true`            | config defined, no warning                   |
| 3 | `'some-ci-value'`  | `--sandbox-engine docker`        | config `docker`, no warning                  |
| 4 | `'sandbox-exec'`   | `--sandbox` true                 | undefined + warning names value & `--sandbox`|
| 5 | `'sandbox-0.7.0-4242'` | `settings.sandbox=true`      | undefined + warning                          |
| 6 | `'sandbox-0.7.0-4242-1'` | `LLXPRT_SANDBOX=true`      | undefined + warning names `LLXPRT_SANDBOX`   |
| 7 | `'sandbox-exec'`   | `--sandbox-engine docker`        | undefined + warning names `--sandbox-engine` |
| 8 | `'sandbox-exec'`   | `--sandbox-profile-load dev`     | undefined + warning names profile flag       |
| 9 | `'sandbox-exec'`   | none                             | undefined, no warning                        |
| 10| unset              | none                             | undefined, no warning                        |
| 11| `'sandbox-exec'`   | `--sandbox false`                | undefined, no warning                        |
| 12| `'1'`              | `--sandbox nosuchcmd`            | throws FatalSandboxError (as with unset SANDBOX) |

Rows 4–8 assert the warning content (value + source) and exactly-once
emission; rows 1–3, 9–11 assert no warning. Row 7 pins the closed engine
recursion hole (engine path previously ignored SANDBOX entirely).

## Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

## Review plan

- deepthinker compliance review (cap 2 rounds).
- Open Code Review (cap 2 local + 2 PR rounds).
- Findings triaged Blocker-Fix / In-scope-Fix / Reject / Defer.

### Post-PR review additions (PR #3304)

Three boundary rows added after CodeRabbit/OCR PR review, pinning accepted
behavior with tests rather than changing it:

| # | SANDBOX value        | Request                          | Expected                                     |
|---|---------------------|----------------------------------|----------------------------------------------|
| 13| `'ci-job-4821'`     | `--sandbox true`                 | undefined + warning (numeric-suffix lookalike; image portion of real names is user-configurable, so no narrower rule distinguishes it — suppression stays loud) |
| 14| `'sandbox-exec'`    | `--sandbox-engine bogus`         | throws FatalSandboxError (input validation precedes the nested check; invalid input is reported even nested, matching unset-SANDBOX behavior) |
| 15| `'sandbox-exec'`    | `--sandbox-profile-load missing` | throws FatalSandboxError (profile load precedes the nested check) |

Dispositions: numeric-suffix narrowing and suppression-before-validation both
Rejected (would restore recursion for custom-image launches and silently
swallow user errors); hop-test mock-theater concern Rejected (the predicate is
exercised via the real `loadSandboxConfig` in rows 1-8; the hop test pins the
removed raw-env guard in `maybeHopIntoSandbox`).
