# Issue #3083 — CLI flags must outrank environment variables; add `--jsp-bootstrap`

## Problem

1. `resolveSandboxOption` in `packages/cli/src/config/sandboxConfig.ts` reads
   `LLXPRT_SANDBOX` **first** and lets it win whenever it is non-empty. An
   inherited variable therefore silently overrides an explicit `--sandbox` /
   `--no-sandbox` flag, and there is no way to express "off" that beats a set
   variable.
2. `loadBootstrapFromEnv` in `packages/cli/src/observation/jspWiring.ts` reads
   the JSP bootstrap path only from `LLXPRT_JSP_BOOTSTRAP_FILE`. There is no
   flag, and the variable leaks to every descendant process (subagents, shell
   tools, test runners), which then hold a pointer to a per-session file that
   has been rotated away — and which carries another process's `agentId` /
   `lifecycleGeneration` identity.

## Scope

In scope:

- Sandbox enablement precedence: **flag > environment > settings > default**.
- A `--jsp-bootstrap <path>` flag that is preferred over
  `LLXPRT_JSP_BOOTSTRAP_FILE`, with the variable retained as a deprecated
  fallback.
- Unconditional removal of `LLXPRT_JSP_BOOTSTRAP_FILE` from the CLI's own
  `process.env` at bootstrap-load time.
- Documentation of the precedence and the new flag.

Explicitly out of scope (deferred, with rationale):

- Making `--sandbox` accept an engine name (`--sandbox=docker`). yargs declares
  `sandbox` as `type: 'boolean'`, so `--sandbox=docker` already parses to
  `false` and `--sandbox docker` already sends `docker` to the positional
  prompt. That behaviour is unchanged by this work; turning `--sandbox` into a
  string-or-boolean flag is a separate functional change.
- `--sandbox-image` / `--sandbox-engine` / `--sandbox-profile-load`: these
  already resolve flag-first (`resolveSandboxImage` puts `argvImage` ahead of
  `LLXPRT_SANDBOX_IMAGE`).
- Other flag/env pairs were audited and already resolve flag-first:
  `resolveProviderAndModel` (`LLXPRT_DEFAULT_PROVIDER` / `LLXPRT_DEFAULT_MODEL`
  / `GEMINI_MODEL`), `resolveProxy` (`HTTPS_PROXY` et al), and
  `resolveProfileToLoad` (`LLXPRT_PROFILE`). No change needed.

## Acceptance criteria

### Sandbox precedence

- **AC1** — An explicit `--sandbox` (parsed as `true`) enables the sandbox even
  when `LLXPRT_SANDBOX=false` is set.
- **AC2** — An explicit `--sandbox false` / `--no-sandbox` (parsed as `false`)
  disables the sandbox even when `LLXPRT_SANDBOX=docker` (or `true`, or `1`) is
  set. `loadSandboxConfig` returns `undefined`.
- **AC3** — When the sandbox flag is absent (`argv.sandbox === undefined`),
  `LLXPRT_SANDBOX` is honoured exactly as before: an engine name selects that
  engine, `true`/`1` auto-detects, `false`/`0` disables.
- **AC4** — When both the flag and the variable are absent, `settings.sandbox`
  is honoured (existing behaviour).
- **AC5** — An empty or whitespace-only `LLXPRT_SANDBOX` is treated as absent
  and falls through to `settings.sandbox` (existing behaviour).
- **AC6** — `--sandbox-engine none` still short-circuits to no sandbox
  regardless of flag, variable, or settings (existing behaviour).
- **AC7** — Being already inside a sandbox (`SANDBOX` set) still yields no
  nested sandbox (existing behaviour).
- **AC8** — The "missing sandbox command" diagnostic names the channel that
  actually supplied the value (`--sandbox`, `LLXPRT_SANDBOX`, or
  `settings.sandbox`) rather than always blaming `LLXPRT_SANDBOX`.

### JSP bootstrap flag

- **AC9** — `--jsp-bootstrap <path>` is accepted by the argument parser and
  surfaces on the parsed args as `jspBootstrap`.
- **AC10** — When `--jsp-bootstrap` supplies a path, that file is loaded even if
  `LLXPRT_JSP_BOOTSTRAP_FILE` names a different or non-existent file.
- **AC11** — When the flag is absent, `LLXPRT_JSP_BOOTSTRAP_FILE` is still
  honoured (deprecated fallback), with the same fail-fast `FatalConfigError`
  behaviour for unreadable / malformed / rejected bootstraps.
- **AC12** — When neither channel supplies a path, the loader returns `null`
  and observation stays disabled.
- **AC13** — `LLXPRT_JSP_BOOTSTRAP_FILE` is captured and removed from the
  process environment at the **first executable line of `main()`** — before
  `configureEarlyDebugLogging`, help/version handling, process lifecycle setup,
  settings load, memory relaunch, and yargs parsing — so help/version exits,
  MCP subcommand stdio transports, memory relaunch, parse errors, and every
  later child-capable path see a scrubbed `process.env`. The capture performs
  no file I/O and deletes unconditionally (non-empty, empty, or absent). The
  captured path is held in a local variable and resolved later at
  `preparePostParseStartup`. File validation is deferred to observation setup
  (fail-fast). This holds:
  - when the flag supplied the path and the variable was also set;
  - when the variable supplied the path and the load succeeded;
  - when the load **failed** (unreadable, malformed JSON, or schema-rejected)
    and the loader threw — the variable was scrubbed at process start, long
    before the fail-fast validation at observation setup;
  - when the variable was set to the empty string.
- **AC14** — A bootstrap failure message names the channel that supplied the
  path: `--jsp-bootstrap` for the flag, `LLXPRT_JSP_BOOTSTRAP_FILE` for the
  variable. The message still discloses only the channel and the failure
  category, never file contents.
- **AC15** — The CLI threads the parsed `--jsp-bootstrap` value through
  `setupObservation` → `initializeObservationProducer`, so a real run with the
  flag and no variable initialises the observation producer.

## Test plan (behavioural, no mock theatre)

New Bun-native suites, registered in `scripts/bun-test-manifest.ts` and excluded
from the Vitest selection in `packages/cli/vitest.test-groups.ts` (the
established pattern for Bun-native CLI tests).

1. `packages/cli/src/config/sandboxConfig.precedence.test.ts` — drives the real
   `loadSandboxConfig` with a stubbed `command-exists` probe, real environment
   mutation, and real settings objects. Covers AC1–AC8. Assertions are on the
   returned `SandboxConfig` (or `undefined`) and on thrown
   `FatalSandboxError` messages — the observable outcome, not call counts.
2. `packages/cli/src/observation/jspWiring.test.ts` (existing Bun-native suite)
   gains cases for `captureBootstrapEnvPath`, `resolveBootstrapSelection`, and
   `loadBootstrap` (AC10–AC14): real temp bootstrap files on disk, real
   `process.env` mutation, and assertions on the parsed bootstrap, the thrown
   `FatalConfigError` message, and `process.env.LLXPRT_JSP_BOOTSTRAP_FILE`
   being absent afterwards.
3. `packages/cli/src/config/cliArgParser.jspBootstrap.test.ts` — parses real
   argv through `parseArguments` and asserts `jspBootstrap` and
   `jspBootstrapInternalEnvPath` (AC9), including absence yielding `undefined`.
   Also exercises strict validation (Finding 4): bare/empty and repeated
   `--jsp-bootstrap` and `--jsp-bootstrap-internal-env-path` fail fast with
   clear yargs errors, including a malformed public flag while `LLXPRT_SANDBOX`
   or `LLXPRT_JSP_BOOTSTRAP_FILE` is set.
4. `packages/cli/src/observation/jspBootstrapStartup.test.ts` covers:
   - Process-start capture (`captureBootstrapEnvPath`) — descendant env
     absence via real `spawnSync` child (AC13).
   - Post-parse resolution (`resolveBootstrapSelection`) — AC10–AC12.
   - `--`-terminator-safe argv transport (`augmentArgvWithInternalEnvPath`) —
     Finding 3, with real parser round-trip tests (positional prompt, `--`
     terminator, and stdin-injected argv followed by transport).
   - Real memory relaunch child: exercises the real
     `relaunchAppInChildProcess` path with a deterministic TS/Bun fixture child
     after process-start capture, proving the child does NOT receive
     `LLXPRT_JSP_BOOTSTRAP_FILE` and DOES receive the explicitly transported
     hidden env path in argv.
   - Real MCP/CLI child: a real `spawnSync` child invocation with inherited
     env that proves no inheritance after capture.
   - Ordering test: source-inspects `cli.tsx` to bind capture/delete to the
     first line of `main()`, before `configureEarlyDebugLogging`,
     `handleVersionAndHelpFlags`, `maybeRelaunchForMemory`, and
     `parseArguments`.
   - AC15 wiring via `setupObservation` → `initializeObservationProducer` with
     a real loopback HTTP capture server.

## Implementation outline

- `sandboxConfig.ts`: replace `resolveSandboxOption(sandbox)` with a resolver
  that selects the source in order flag → env → settings, returning both the
  raw value and a source label for diagnostics; `loadSandboxConfig` stops
  pre-collapsing `argv.sandbox ?? settings.sandbox` so "flag absent" stays
  distinguishable from "flag explicitly false".
- `yargsOptions.ts`: add `'jsp-bootstrap'` to `innerCommandOptions`, plus a
  hidden ROOT option `'jsp-bootstrap-internal-env-path'` for env-origin path
  transport across memory/sandbox direct-replacement relaunches (accepted for
  both the launch command and subcommands).
- `cliArgParser.ts`: add `jspBootstrap` and `jspBootstrapInternalEnvPath` to
  `CliArgs` and the mapping. Add strict validation
  (`rejectBareOrRepeatedStringOption`) for both options: bare/empty values and
  repeated occurrences fail fast with clear yargs errors so the public flag
  does not silently fall back to env when malformed.
- `jspWiring.ts`: split bootstrap handling into three phases.
  - `captureBootstrapEnvPath(env = process.env)` captures the env value and
    scrubs `LLXPRT_JSP_BOOTSTRAP_FILE` BEFORE any file I/O or return. Called at
    the FIRST executable line of `main()` (AC13). Returns `string | undefined`.
  - `resolveBootstrapSelection(flagPath, internalEnvPath, capturedEnvPath)` is
    a pure post-parse resolver: public flag > transported internal env path >
    captured env path > disabled. Internal/captured env selections get source
    `LLXPRT_JSP_BOOTSTRAP_FILE`; the public flag gets source `--jsp-bootstrap`.
  - `loadBootstrap(selection)` performs only read/parse/schema validation on
    the already-resolved selection; it never touches `process.env`. Errors name
    the original source from the selection (AC14).
  - `augmentArgvWithInternalEnvPath(argv, envPath)` transports an env-origin
    path across a memory or sandbox direct-replacement relaunch via the hidden
    `--jsp-bootstrap-internal-env-path <path>` option. The option is inserted
    immediately BEFORE the first exact `--` terminator (or appended if absent)
    so yargs treats it as a flag. Transport is not duplicated when already
    present from a prior hop. `undefined` envPath returns argv unchanged.
- `relaunch.ts`: `relaunchAppInChildProcess` accepts an optional `argvTail`
  parameter (defaults to `process.argv.slice(1)`) so callers that augment argv
  (e.g. memory relaunch transporting the bootstrap path) can pass a custom tail.
- `cliBootstrap.tsx`: `maybeRelaunchForMemory` accepts `capturedEnvPath`;
  when set, it augments the argv tail via `augmentArgvWithInternalEnvPath` and
  passes it to `relaunchAppInChildProcess`. Never restores
  `LLXPRT_JSP_BOOTSTRAP_FILE` to the environment.
- `cli.tsx`: call `captureBootstrapEnvPath()` at the FIRST executable line of
  `main()`, before everything else. Thread the captured path to
  `maybeRelaunchForMemory` and `preparePostParseStartup`. The latter calls
  `resolveBootstrapSelection(argv.jspBootstrap, argv.jspBootstrapInternalEnvPath,
  capturedEnvPath)` to produce the final `BootstrapSelection`, threaded through
  to `maybeHopIntoSandbox` (via `SandboxHopOptions`) and through
  `constructForegroundAgentAndDispatch` → `setupSessionRecording` →
  `setupObservation` → `initializeObservationProducer` → `loadBootstrap`.
- `cliSessionBootstrap.ts`: export `setupObservation(config, selection)`; take
  `BootstrapSelection | null` rather than a raw path.
- `cliSandbox.ts`: add `bootstrapSelection` to `SandboxHopOptions`; for an
  env-origin selection, call `augmentArgvWithInternalEnvPath` with the env path
  before `start_sandbox`. Flag-origin selections are already in argv.
- Docs: `docs/sandbox.md` gains an explicit precedence statement;
  `docs/cli/configuration.md` gains a JSP observation bootstrap section
  documenting the flag, precedence, process-start capture, and memory/sandbox
  argv transport.
