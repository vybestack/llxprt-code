# Issue #2958 — Project `.env` must not set sandbox launcher control variables

## Problem statement

A repository checked out by a user can ship a `.env` file. Two CLI env loaders read
that file and write its keys into `process.env`:

1. `packages/cli/src/config/settings.ts::loadEnvironment(settings)` — has a
   project-vs-global distinction and honours `excludedProjectEnvVars`
   (default `['DEBUG', 'DEBUG_MODE']`), and returns early when folder trust is
   enabled and the workspace is untrusted.
2. `packages/cli/src/config/environmentLoader.ts::loadEnvironment()` — called
   unconditionally from `loadCliConfig` (`packages/cli/src/config/config.ts:349`).
   It hands the discovered file straight to `dotenv.config()`: no exclusion list,
   no project/global distinction, no folder-trust gate.

`packages/cli/src/utils/sandbox-containers.ts::buildContainerRunArgs` then
shell-parses `process.env.SANDBOX_FLAGS` (via `shell-quote`'s `parse`, with
`process.env` supplied so `$VAR` references expand) and appends the result
verbatim to the docker/podman argument list. The same module consumes
`SANDBOX_ENV`, `LLXPRT_SANDBOX_MOUNTS`/`SANDBOX_MOUNTS`, and the
network/resource controls.

Result: a repository `.env` containing

    SANDBOX_FLAGS=--env GEMINI_API_KEY=$GEMINI_API_KEY

causes the host's ambient `GEMINI_API_KEY` to be injected into the container,
undoing the #2946 fix, with no user choice involved. `--env-file` and `--volume`
are available by the same route.

Note that loader (2) actively defeats loader (1): even if a launcher variable
were added to `excludedProjectEnvVars`, loader (1) would skip it, leaving the key
unset in `process.env`, and loader (2)'s `dotenv.config()` would then set it
(dotenv does not overwrite already-present keys, but the key is absent at that
point). Both loaders must be fixed.

## Behaviour to deliver

Project-supplied env files may not set sandbox launcher and control variables.
User-supplied values — exported in the shell before launch, or set by a sandbox
profile — continue to work unchanged.

### The guarded variable set

Blocked when they originate from a non-global env file:

| Category | Variables |
| --- | --- |
| Raw engine flags | `SANDBOX_FLAGS` |
| Container env injection | `SANDBOX_ENV` |
| Mounts | `LLXPRT_SANDBOX_MOUNTS`, `SANDBOX_MOUNTS` |
| Engine / image selection | `LLXPRT_SANDBOX`, `SANDBOX`, `LLXPRT_SANDBOX_IMAGE`, `BUILD_SANDBOX`, `SEATBELT_PROFILE` |
| Network | `LLXPRT_SANDBOX_NETWORK`, `SANDBOX_NETWORK`, `LLXPRT_SANDBOX_PROXY_COMMAND` |
| Resources | `LLXPRT_SANDBOX_CPUS`, `SANDBOX_CPUS`, `LLXPRT_SANDBOX_MEMORY`, `SANDBOX_MEMORY`, `LLXPRT_SANDBOX_PIDS`, `SANDBOX_PIDS` |
| Host resource exposure | `SANDBOX_PORTS`, `LLXPRT_SANDBOX_SSH_AGENT`, `SANDBOX_SSH_AGENT`, `SANDBOX_SET_UID_GID` |

This set is derived from every `process.env` read in `packages/cli/src/utils/sandbox*.ts`,
`packages/cli/src/config/sandboxConfig.ts` and `packages/cli/src/cliSandbox.ts`
that controls how the sandbox is launched.

### What counts as "project supplied"

An env file is treated as user-global — and therefore trusted for launcher
controls — only when it lives under the user's global config or data directory
(`Storage.getGlobalConfigDir()` / `Storage.getGlobalDataDir()`) or is `~/.env`.
Every other discovered env file, including `<repo>/.env` **and**
`<repo>/.llxprt/.env`, is repo-controlled and is blocked from setting the guarded
variables.

This is deliberately stricter than the existing `isProjectEnvFile` rule in
`settings.ts`, which treats any path containing an `.llxprt` segment as
non-project. A checked-out repository can contain `.llxprt/.env` just as easily
as `.env`, so for launcher controls the only safe discriminator is "is this file
inside the user's own global config/data area".

### Relationship to `excludedProjectEnvVars`

The guard is independent of `excludedProjectEnvVars`. That setting replaces the
default exclusion list wholesale, so a user who sets it must not thereby re-open
the launcher-control hole. The guard is applied in addition to, not as part of,
`excludedProjectEnvVars`.

### The runtime injection vector

Declining to apply a file is not sufficient. The published `llxprt` bin
(`packages/cli/bin/llxprt.mjs`) is a node shim that execs **Bun**, and Bun reads
`<cwd>/.env` into `process.env` before the first line of application code:

```
$ cd /tmp/repo            # .env contains SANDBOX_FLAGS=--env STOLEN=pwned
$ bun p.ts
SANDBOX_FLAGS= --env STOLEN=pwned     <- Bun injected it
$ node -e '...'
SANDBOX_FLAGS= undefined               <- node does not
```

By the time either loader runs the value is already present, and both loaders'
"never overwrite an existing value" rule reads it as an ambient shell export.
Every entry point is Bun (`bin/llxprt`, `llxprt.mjs`, `bun scripts/start.ts`),
so AC1 fails in production unless the value is taken back out.

`stripRuntimeInjectedLauncherVars(cwd)` does that, and runs first in both
loaders. It drops a launcher control whenever a repo-controlled
runtime-auto-loaded file (`.env`, `.env.local`, and the `NODE_ENV` variants)
NAMES it, without comparing values: Bun performs `$VAR` expansion that
`dotenv.parse` does not, so a value comparison would fail open on exactly the
credential-forwarding case this exists to stop.

The cost is that a user's own export of the same variable is also dropped when
the repository names it. The repository still cannot choose a value, only
decline to have one, and a sandbox profile applies afterwards and is unaffected.

The scrub runs in two passes because the trust decision is otherwise circular: a
repo `.env` setting `LLXPRT_CONFIG_HOME=<repo>` would make that same file
classify as user-global. Pass one drops storage roots named by any working
directory env file other than `~/.env` (`homedir()` is not reachable from any
guarded variable); pass two classifies with authentic roots and drops the rest.

### Not in scope

- Removing either loader or consolidating the two `findEnvFile` implementations.
- The `a2a-server` package's own `loadEnvironment`, which does not reach this
  CLI sandbox launcher.
- Any change to the accepted escape hatches (`SANDBOX_ENV`, mount variables,
  profile `mounts`, exported `SANDBOX_FLAGS`) when they come from the user.

Deliberately left out, each confirmed real but outside the issue's enumerated
list and with effects well beyond the sandbox. Recorded here as follow-up
candidates rather than silently dropped:

| Variable | Launcher effect if a repo `.env` sets it |
| --- | --- |
| `TMPDIR` / `TMP` / `TEMP` | Selects the host directory bind-mounted at `sandbox-containers.ts`; `TMPDIR=/` mounts host root |
| `SSH_AUTH_SOCK` | Selects a host agent socket to mount or bridge into the container |
| `DEBUG_PORT` | Publishes a host port |
| `HTTPS_PROXY` and the five siblings | Redirects sandbox traffic when proxied networking is enabled |

## Design

Add `packages/cli/src/config/sandboxEnvGuard.ts`:

- `SANDBOX_LAUNCHER_ENV_VARS: ReadonlySet<string>` — the table above.
- `isSandboxLauncherEnvVar(key: string): boolean`.
- `isUserGlobalEnvFile(envFilePath: string): boolean` — true for files under the
  global config dir, the global data dir, or `~/.env`.

A dedicated module (rather than a constant in `settings.ts`) keeps
`environmentLoader.ts` from taking a value dependency on `settings.ts`.

Wire it into both loaders:

1. `settings.ts::shouldLoadEnvVar` — reject the key when the env file is not
   user-global and the key is a launcher control, regardless of `excludedVars`.
   The existing `isProjectEnvFile` logic stays as-is for `excludedProjectEnvVars`.
2. `environmentLoader.ts::loadEnvironment` — replace `dotenv.config()` with
   `dotenv.parse()` plus an explicit apply loop that (a) never overwrites a key
   already present in `process.env` (matching `dotenv.config()`'s default
   `override: false`) and (b) skips launcher controls from non-global files.
   Read/parse errors stay silent, matching `dotenv.config({ quiet: true })`.

Also emit a debug log line naming the ignored variable and the file it came
from, so a user who intended the setting can see why it did not apply.

## Tests (behavioural, real files, no mock theatre)

New file `packages/cli/src/config/sandboxEnvGuard.behavior.test.ts` — real temp
directories, real `.env` files, real `process.cwd()` change, real
`buildContainerRunArgs` output. No mocking of `fs`, `dotenv`, or the loaders.

| # | Test | Proves |
| --- | --- | --- |
| T1 | Repo `.env` with `SANDBOX_FLAGS=--env GEMINI_API_KEY=$GEMINI_API_KEY`, ambient `GEMINI_API_KEY=<sentinel>`; run `loadEnvironment()` then `buildContainerRunArgs()`; assert the joined args contain neither the sentinel nor `--env-file`/the injected flag, and that `process.env.SANDBOX_FLAGS` is still unset | AC1, AC4 |
| T2 | Repo `.env` with `SANDBOX_ENV=STOLEN=$GEMINI_API_KEY`; assert `addContainerEnvVars` output has no sentinel | AC2 |
| T3 | Repo `.env` with `LLXPRT_SANDBOX_MOUNTS` and `SANDBOX_MOUNTS` pointing at a real temp dir; assert `addContainerVolumeMounts` adds no `--volume` for it | AC2 |
| T4 | Repo `.llxprt/.env` with `SANDBOX_FLAGS`; assert it is blocked too | stricter project rule |
| T5 | Shell-exported `SANDBOX_FLAGS=--cap-add=NET_ADMIN` present in `process.env` before `loadEnvironment()`, with a repo `.env` also setting `SANDBOX_FLAGS`; assert the exported value survives and reaches the run args | AC3 |
| T6 | Sandbox profile with `mounts` and `resources`; assert profile-applied env still reaches the run args after a repo `.env` load | AC3 |
| T7 | Repo `.env` sets a non-guarded key (e.g. `MY_PROJECT_VAR`); assert it still loads | no regression |
| T8 | Env file under the global config dir sets `SANDBOX_FLAGS`; assert it is honoured | user-global stays trusted |
| T9 | `settings.ts::loadEnvironment` with `excludedProjectEnvVars: []` and a repo `.env` setting `SANDBOX_FLAGS`; assert still blocked | guard is independent of the setting |

## Acceptance criteria

- **AC1** A project `.env` setting `SANDBOX_FLAGS` does not influence the
  generated container run arguments.
- **AC2** The same holds for `SANDBOX_ENV`, `LLXPRT_SANDBOX_MOUNTS` and
  `SANDBOX_MOUNTS`, and for the engine / network / resource controls listed above.
- **AC3** A shell-exported or sandbox-profile-supplied `SANDBOX_FLAGS` (and the
  other controls) continues to work.
- **AC4** A behavioural test uses a real project `.env` plus an ambient sentinel
  API key and proves the sentinel never reaches the generated run arguments.
- **AC5** Both loaders are covered; the guard cannot be disabled through
  `excludedProjectEnvVars`.

## Review dispositions

Design review (deepthinker) and local Open Code Review, triaged:

| Finding | Disposition |
| --- | --- |
| Storage roots (`LLXPRT_*_HOME`) omitted, allowing a repo `.env` to nominate itself as user-global and smuggle `SANDBOX_FLAGS` through the second loader | **Blocker-Fix.** Reproduced end to end; roots added to the guarded set and the scrub made two-pass |
| Case-sensitive key matching lets `sandbox_flags=` through on Windows | **Blocker-Fix.** Matching now upper-cases the key |
| Trust check trusts every descendant of a global root | **In-scope-Fix.** Narrowed to the exact env-file paths `findEnvFile` can return |
| Tests never exercise the real two-loader startup order; no real sandbox profile | **In-scope-Fix.** Added the subprocess startup probe and a real profile file test |
| Symlinked `<global>/.env` pointing at repo content is still trusted | **Reject.** Creating it requires write access to the user's config directory, which is already full compromise |
| Blocked-variable list duplicated in the test file | **Reject.** The duplicate is the spec, deliberately independent of the implementation |
| `TMPDIR`/`TMP`/`TEMP`, `SSH_AUTH_SOCK`, `DEBUG_PORT`, proxy variables | **Defer.** Confirmed real, outside the issue's enumerated list, and blocking them changes behaviour well beyond the sandbox. See the table above |
| Folder trust is bypassable for NON-launcher variables, because Bun pre-loads them too | **Defer.** Real and worth its own issue: it is about arbitrary env vars from an untrusted repo, not sandbox launcher controls, and the fix would change ordinary `.env` behaviour |

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, plus the `stepfun-37` startup smoke.
