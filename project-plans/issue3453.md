# Plan for #3453 — github tool: intermittent `failed to run git: not a git repository` on parallel calls despite explicit repo

## Investigation findings (concurrency audit, issue ask 1)

Audited every hop params take from the model's tool_use block to the final
gh argv, on the current head. The host chain and the sandbox socket chain
share `executeGitHubOp`, so one audit covers both.

1. **Provider layer: fresh object per call.** Each tool_use block's
   parameters are parsed into a fresh object
   (`processToolParameters` → `JSON.parse`, or the double-escape repair path
   which also builds fresh objects; `convertStringNumbersToNumbers` copies).
   `turn.ts handlePendingFunctionCall` stores that reference as
   `request.args` and never mutates it.
2. **Scheduler: new invocation per call.** `ToolDispatcher.resolveAndValidate`
   calls `tool.build(args)` on the shared `GithubTool` instance, but `build`
   → `createInvocation` constructs a NEW `GithubToolInvocation` per call,
   each holding its own params reference. `setToolContext` mutates the tool
   instance, never params. The `BeforeToolHook` `modifiedInput` path
   (`ToolExecutor`) builds a new invocation with new args objects — and only
   when hooks are configured (none in the incident session).
3. **Tool invocation: fresh shallow copy.** `GithubToolInvocation.execute`
   does `const { op, ...rest } = this.params`; `repo` rides in `rest` to
   `runOperation`.
4. **Transports: stateless.** `HostGitHubBrokerClient` and
   `ProxyGitHubBrokerClient` (`packages/cli/src/config/githubBrokerClient.ts`)
   hold no state; the sandbox path serializes `{op, ...params}` per request
   over the socket.
5. **Broker dispatch: read-only or copying.** `validateParams` is read-only.
   `withBodyFiles` copies (`{...params}`) before replacing body values with
   temp-file paths; the original params object is untouched. `buildArgv` is
   pure; `appendRepo` appends `--repo` iff `params.repo` is a non-empty
   string. `shape` receives the original params.
6. **`runGh`: no shared state, but no repo pin either.** Fresh
   `buildMinimalEnv()` per call; argv is copied per exec; NO `cwd` option, so
   gh inherits the CLI process cwd. This is the one confirmed weakness: if
   `--repo` is ever absent from argv for any reason, gh falls back to
   git-remote resolution against the process cwd. In a non-git workspace root
   that dies with exactly the reported message; in a git tree it would
   silently target that repo instead.

**Conclusion: no shared, mutable, or cross-call state exists anywhere in the
github chain where `params.repo` could be dropped or crossed.** The one-time
incident (2026-08-31) is not reproducible in code as read; the reporter's own
five follow-up reproduction attempts were also clean. Per the issue's framing,
the deliverable is the defense that makes this failure class structurally
impossible (ask 2) plus failure-path observability (ask 3) — not a speculative
fix of an unreproducible race.

**gh env fact (verified locally, gh 2.83.2):** `gh help environment`
documents `GH_REPO`: "specify the GitHub repository in the `[HOST/]OWNER/REPO`
format for commands that otherwise operate on a local repository." An explicit
`--repo` argv flag takes precedence over `GH_REPO` (gh flag > env), so pinning
via env cannot alter any invocation that already carries `--repo`; it only
replaces the git fallback that would otherwise fire.

## Accepted behavior (scope)

- **Repo pinning (defense, ask 2).** When an op's validated params carry
  `repo` as a non-empty string, every gh invocation issued for that operation
  — single-call ops and multi-step `execute` ops, host transport and sandbox
  socket (both funnel through `executeGitHubOp`) — runs with
  `GH_REPO=<owner/name>` in the child environment, in addition to the
  existing `--repo` argv from `appendRepo`.
- **Current-repo fallback preserved.** When `repo` is absent or an empty
  string, `GH_REPO` is NOT set: gh's current-repository/git-remote resolution
  is a documented tool feature ("omit it to use the current repository") and
  is load-bearing for `resolveOwnerName`'s repo-less `gh repo view` step. An
  ambient `GH_REPO` from the user's shell is not inherited
  (`buildMinimalEnv` excludes it, unchanged).
- **Failure observability (ask 3).** When a gh invocation fails and is
  classified into a broker error, the broker emits one debug-level log line
  carrying the final gh argv and the `GH_REPO` value that was in effect,
  token-redacted, via the standard `DebugLogger`
  (`'llxprt:github:broker'` namespace). Successful invocations are not
  logged.
- **Non-goals.** No scheduler/tool-layer changes (the audit found no race to
  fix there). No change to `appendRepo`, `GhRunner`, or `OpDescriptor`
  public shapes. No new exported abstraction. No `cwd` handling: `GH_REPO` is
  chosen over cwd because a cwd can at best change which git fallback fires,
  while `GH_REPO` pins the target repo itself. No OCR runs (disabled until
  re-enabled).

## Acceptance criteria

1. **AC-1 (single-call pin):** `executeGitHubOp('issue.comment', {number,
   body, repo: 'owner/name'})` executes gh with `GH_REPO=owner/name` in the
   child env AND `--repo owner/name` in argv (buildArgv path).
2. **AC-2 (execute + body-file pin):** `issue.create` with `{title, body,
   repo}` sets `GH_REPO` the same way; argv carries `--body-file <temp path>`
   and never the body text (existing invariant, must survive).
3. **AC-3 (multi-step pin):** `issue.edit` with `{number, type, repo}` (the
   multi-step `execute` path incl. GraphQL steps) — EVERY gh invocation in
   the sequence runs with `GH_REPO=owner/name`.
4. **AC-4 (fallback preserved):** the same ops with `repo` absent, or
   `repo: ''`, run with NO `GH_REPO` in the child env and no `--repo` in
   argv.
5. **AC-5 (no ambient leak):** with `process.env.GH_REPO` set in the parent
   and `repo` absent from params, the child env still has no `GH_REPO`.
6. **AC-6 (failure argv log):** a gh failure (non-zero exit) produces exactly
   the structured broker error as today, plus one debug log line containing
   the final argv (JSON) and the repo target in effect (present or explicitly
   absent); argv text is token-redacted.

## Test plan (bun, fake gh on PATH; no network, no real writes)

New file `packages/providers/src/auth/proxy/__tests__/github-broker-issue3453.test.ts`
(bun:test, colocated; follows `github-broker-write-ops.test.ts` conventions).

Harness: a temp dir prepended to `PATH` containing an executable `gh` shim
(POSIX shell script) that appends one record per invocation —
`GH_REPO=<value|__unset__>` plus the argv — to a capture file, and prints a
canned reply selected by argv fragment (URL text for rawOutput steps, JSON
otherwise), matching the recording-stub style of the write-ops tests. PATH is
saved/restored around each test. The suite skips on Windows (POSIX script
shim; align with existing platform-skip precedent in the proxy tests).

- T1 → AC-1; T2 → AC-2; T3 → AC-3 (shim replies: issue edit ack, issue-type
  id query, updateIssue mutation; assert every capture record carries
  `GH_REPO=`).
- T4a/T4b → AC-4 (repo absent; repo `''`).
- T5 → AC-5 (parent env poisoned, child still unset).
- T6 → AC-6: shim exits 1 with stderr; `DebugLogger.prototype.debug` patched
  to capture calls; assert `executeGitHubOp` rejects with the structured
  broker error AND one captured line contains the JSON argv and repo target;
  with repo absent the line records the absent marker. Restore the prototype.

## Implementation steps

1. `packages/providers/src/auth/proxy/github-broker.ts`:
   - module logger: `const logger = new DebugLogger('llxprt:github:broker')`
     (import from `@vybestack/llxprt-code-core/utils/debugLogger.js`, the
     precedent used by `proactive-scheduler.ts` in the same directory).
   - `runGh` internal options gain `repoTarget?: string`; when set,
     `env.GH_REPO = repoTarget` in the child env.
   - In `runGh`'s catch path (before classification returns), emit
     `logger.debug(() => ...)` with the final argv (JSON), the repo target in
     effect, and the failure message — the whole composed log line (argv
     JSON + repo target + message) run through `redactTokenShaped`, since
     argv inlines caller free text (titles, search queries) that may carry a
     token-shaped value.
   - `executeGitHubOp`: derive
     `repoTarget = typeof opParams.repo === 'string' && opParams.repo.length > 0 ? opParams.repo : undefined`
     and thread it into both the `run` closure's `runGh` options and the
     non-execute `runGh` call. `shape` keeps receiving the ORIGINAL params.
2. Tests per the plan above. No other files change.

## Verification

- `bun test packages/providers/src/auth/proxy/__tests__/github-broker-issue3453.test.ts`
  plus the existing broker suites (write-ops, multistep, p10/p10b, security,
  catalog-drift) to prove no regression.
- Full cycle: `npm run test`, `npm run lint`, `npm run typecheck`,
  `npm run format`, `npm run build`, then the
  `bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"`
  smoke.

## Verification results (2026-09-16/17, branch issue3453)

| Step | Result |
| --- | --- |
| targeted issue3453 tests | 9 pass / 0 fail |
| standalone proxy suite | 707 pass / 1 fail — pre-existing flake, see below |
| npm run format | PASS |
| npm run lint | PASS |
| npm run typecheck | PASS |
| npm run test (full monorepo) | PASS |
| npm run build | PASS |
| zai-glm-flash smoke | PASS |

**Out-of-scope finding (not fixed here, filed as #3709):** the single
standalone-proxy-suite failure is
`github-broker-issue3592-boundary.test.ts` "dispatches each project title
and performs the verification read". Proven pre-existing on main
(8db0031ed, issue3453 changes stashed: 686 pass / 1 fail, identical case;
log: `tmp/verify3453/main-baseline.log`). Mechanism: that test's
`mock.module('node:util')` isolation only works when its file is the first
importer of `github-broker.js` in the process; `bun test` enumerates files
in readdir order, and on this volume `github-broker-catalog-drift.test.ts`
(eager importer) precedes it, so the stub never applies and the test runs
real gh. Our new test file runs after it in this enumeration and is not the
cause; the full `npm run test` run (different enumeration) passes. Deferred
per the no-scope-expansion rule; fix belongs to #3709.
