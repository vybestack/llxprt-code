# Issue #4001: GitHub tool inherits an unusable working directory

Also fixes the duplicate reports #4002, #4003, #4005, #4006, #4007, #4008,
#4011, #4012, #4013 and #4016.

## Problem

`github` tool operations that make `gh` run `git` (mainly `pr.create`) fail with

```
GitHub operation failed: failed to run git: fatal: Unable to read current working directory: No such file or directory
```

even when `repo`, `base` and `head` are all supplied and the workspace exists.
Shell commands run with an explicit directory succeed in the same session.

## Root cause

`runGh` in `packages/providers/src/auth/proxy/github-broker.ts` calls
`execFile('gh', argv, { shell: false, signal, maxBuffer, env })` with no `cwd`.
The child inherits the LLxprt process working directory. When that directory
has been removed (a deleted worktree, a lane directory cleaned up, a transient
volume error), every `git` call `gh` makes dies with the message above.
Operations that never run `git` (issue.view, pr.view, comments) keep working,
which matches the reports.

Reproduced on Linux: from a deleted directory, `git rev-parse --show-toplevel`
prints `fatal: Unable to read current working directory: No such file or
directory`, and Node's `process.cwd()` throws `ENOENT`.

## Required behavior

1. Every `gh` child process runs in an explicit, existing directory. The broker
   never relies on an inherited cwd.
2. Working-directory resolution, in order:
   1. The session workspace directory, when the caller provides one and it is
      an existing directory. The host transport passes it; the model cannot
      set it (it is not a tool parameter).
   2. The process working directory, when `process.cwd()` succeeds and the
      path is an existing directory.
   3. When the operation names an explicit `repo`, a neutral existing
      directory outside any repository (`os.tmpdir()`), so `gh` relies on
      `GH_REPO`/`--repo` instead of local git state.
   4. Otherwise a structured broker error that says the working directory is
      unavailable and that passing `repo` avoids the dependency.
3. Behavior is unchanged when the process cwd is a valid repository and no
   workspace directory is supplied (repo-less ops still resolve the current
   repository).
4. The debug log line for a failed invocation includes the cwd that was used.

## Tests (bun:test, behavioral, real executeGitHubOp, recording gh shim on PATH)

Follow `packages/providers/src/auth/proxy/__tests__/github-broker-issue3453.test.ts`.
The shim records its working directory (`pwd -P` or `$PWD`) and runs a real
`git rev-parse` so a deleted cwd fails the same way real `gh` does.

1. Process cwd deleted, explicit repo, no workspace dir: pr.create succeeds and
   runs in a neutral existing directory. Run this in a child process (fixture
   script) that chdirs into a temp dir and removes it, so the test runner's own
   cwd stays valid.
2. Process cwd deleted, workspace dir supplied: runs in the workspace dir.
3. Process cwd deleted, no repo, no workspace: structured error naming the
   unavailable working directory; gh is never spawned.
4. Valid process cwd, no workspace: runs in the process cwd (regression guard).
5. Workspace dir supplied but missing: falls through to the next rule.
6. Host transport (`HostGitHubBrokerClient` / the tool path) forwards the
   session workspace directory; the socket (sandbox) path is unchanged.

## Out of scope (follow-ups)

- #4021 pr.edit reports success but leaves the body unchanged.
- #4004, #4014, #3607 pr.checks watch behavior after an hour.
- `pr.checks` with `watch: true` failing with `unknown flag: --json`
  (observed 2026-11-08 in the #4015 session).
- LLxprt's footer polls `git status --porcelain` every 3 s
  (`packages/cli/src/ui/hooks/useGitBranchInfo.ts`), which briefly takes
  `.git/index.lock` and can collide with the user's or agent's git commands.

## Implementation notes

### Design

- New module `packages/providers/src/auth/proxy/github-broker-cwd.ts` owns
  `resolveGhWorkingDirectory(options, hasExplicitRepo)` and the
  `GitHubExecOptions` type (`{ workingDirectory?: string }`). Resolution order
  is exactly the one above: existing workspace dir, existing `process.cwd()`
  (`process.cwd()` throws ENOENT once deleted, which is treated as unusable),
  `os.tmpdir()` when the op has a non-empty `repo`, else a structured
  `HOST_GH_UNAVAILABLE` broker error raised before gh is spawned. The message
  says the working directory is unavailable and that passing `repo` avoids the
  dependency. No new error code was added; `HOST_GH_UNAVAILABLE` ("the host
  cannot run gh") is the closest existing code and keeps the code union
  unchanged.
- `executeGitHubOp(op, params, signal, options?)` resolves the directory once,
  after validation, next to the `repoTarget` derivation. `runGh` now requires
  `cwd` and passes it to `execFile`; the dispatcher merges `cwd` on top of op
  options exactly like `repoTarget`, so single-call ops and every step of
  multi-step `execute` ops (including the watch loop) share one directory.
  The failure debug line gains `cwd=<resolved>` (still fully token-redacted).
  `shell: false`, the minimal env, and the absence of GH_TOKEN/GITHUB_TOKEN are
  untouched.
- Threading of the workspace directory (host side only):
  `registerStandardTools` (core `toolRegistryFactory.ts`) gives `GithubTool` a
  `() => config.getTargetDir()` provider; `GithubToolInvocation.execute` reads
  it at call time and passes `{ workingDirectory }` as a new optional trailing
  argument of the `GitHubReportOperation` port (`GitHubOperationOptions`).
  `HostGitHubBrokerOwner` forwards it to `GitHubBrokerClient.runOperation`'s new
  optional trailing `options` argument, and `HostGitHubBrokerClient` forwards
  it to `executeGitHubOp`. It is not a tool parameter, so the model cannot set
  it (the strict schema still rejects a `workingDirectory` param).
- `ProxyGitHubBrokerClient` ignores the option: the socket payload and protocol
  are unchanged, and the host-side broker handler calls `executeGitHubOp`
  without options, so a sandboxed call resolves its directory by rules 2-4.

### Decisions

- Error code `HOST_GH_UNAVAILABLE` (see above).
- Test fixture runs a child bun process (`github-broker-issue4001-child.ts`)
  that deletes its own cwd, so the runner's cwd stays valid. The shared
  `github-broker-cwd-recorder.ts` helper is reused by the CLI host-client test.
- The shim ignores a non-zero `git` exit unless it is the "Unable to read
  current working directory" failure, which is what `gh pr create --repo ...`
  needs from git in a neutral directory.

### Tests

- `packages/providers/src/auth/proxy/__tests__/github-broker-issue4001.test.ts`
  (13 tests): deleted cwd with repo (neutral dir), with workspace dir, without
  either (structured error, gh never spawned), missing workspace dir falling
  through (both with and without repo), multi-step `issue.edit` using one cwd
  (deleted-cwd and workspace variants), valid cwd regression guards, a
  workspace path that is a file, and the `cwd=` debug line.
- `packages/cli/src/config/githubBrokerClient.test.ts`: host client runs gh in
  the supplied workspace dir; proxy client sends nothing extra over the socket.
- `packages/agents/src/api/__tests__/host-github-broker-owner.behavior.test.ts`:
  an Agent's github tool hands the session workspace dir to the broker client
  for both read and submit ports.
- `packages/tools/src/tools/github.test.ts`: the dir travels as an option, is
  read at call time, and is not a model-settable parameter.

### Not changed

The out-of-scope follow-ups listed above remain open.

## Review round 1

### M1: pr.create without `head` in the neutral directory (fixed)

With an explicit `repo`, `gh pr create` still infers the head branch from the
current checkout when `--head` is omitted (gh 2.46 `create.go` calls
`opts.Branch()`), even with `--repo`/`GH_REPO`. In the `os.tmpdir()` fallback
that inference fails, and when `TMPDIR` lies inside a checkout it can pick an
unrelated branch.

- `resolveGhWorkingDirectory` now returns `{ cwd, neutral }`; `neutral` is true
  only for the temp-directory fallback.
- New `assertNoCheckoutNeeded(op, params, directory)` (same module) runs right
  after resolution in `executeGitHubOp`. For `pr.create` with `neutral` and no
  non-empty `head` it throws `INVALID_PARAM` ("The working directory is
  unavailable, so the head branch cannot be inferred ... Pass "head" ...")
  before gh is spawned. A usable workspace or process cwd never requires
  `head`.
- Other ops: every op whose spec accepts `number` (issue.view/edit/comment/
  close, pr.view/diff/checks/reviews/comment/edit/ready) lists it in
  `required`, so none infers a PR from the current branch. List/search/create
  ops use the explicit repo or fail without one (rule 4), so no further rule
  was needed. A catalog test pins this: if an op ever makes `number` optional,
  it fails and forces the same rule to be applied.
- Tests (`github-broker-issue4001-review.test.ts`): deleted cwd + repo +
  pr.create without head and with empty head, rejected with gh never invoked
  (red before the fix); with head still succeeds in the neutral dir (existing
  test plus a review-suite copy); usable workspace or process cwd without
  head unchanged; catalog guard.

### M2: directories the process cannot enter (fixed)

`stat().isDirectory()` accepted a mode-0o000 directory, so an inaccessible
workspace beat a usable process cwd or tmpdir.

- A candidate (workspace, `process.cwd()`, `os.tmpdir()`) is now accepted only
  after `realpath` plus `fs.access(R_OK | X_OK)`; any failure falls through to
  the next rule, and the canonical path is what gh runs in.
- Tests: 0o000 workspace falls through to the process cwd and (deleted cwd) to
  the neutral dir; 0o000 process cwd falls through to the neutral dir or to the
  structured error without a repo; 0o000 `TMPDIR` gives the structured error
  (before: an unstructured mkdtemp failure); a symlinked workspace runs in the
  realpath (observed through the `cwd=` debug line, since `pwd -P` hides it);
  a symlink to a deleted dir falls through. Permission cases skip as root and
  restore modes in `finally`. The child fixture gained `cwdState` and
  `tmpdirState` for the locked cases. All of these except the dangling symlink
  were red before the fix.

### L1: recording gh shim hid git failures (fixed)

The shim now runs `git rev-parse --is-inside-work-tree` and treats any failure
as fatal (exit 1 with `failed to run git: <git stderr>`), including a missing
git binary and the deleted-cwd message. The one accepted outcome is "not a git
repository" when `GH_REPO` is set and, for `pr create`, `--head` is present,
the only case where real gh needs no checkout. `github-broker-cwd-recorder.test.ts`
covers the accept case and the three failing cases (3 red before the change).
Tests that previously relied on repository inference in a non-repository temp
workspace now use a real `git init` directory or name `repo` explicitly.

### L2: forwarding tests only checked fake ports (addressed)

- Agents: added a test that drives the agent's `github` tool through the real
  `executeGitHubOp` (the function the CLI host client calls) with the recording
  gh on PATH and asserts the cwd gh actually started in is the session target
  directory and differs from the process cwd. Dropping the options in
  `HostGitHubBrokerOwner` turns it red. The old fake-port test now compares
  with `getTargetDir()` (it compared `getWorkingDir()`).
- Distinct target and working dirs cannot be produced through `createAgent`
  (`workingDir` sets both). The `getTargetDir()` source is proven in
  `toolRegistryFactory.test.ts` with a `Config` whose `targetDir` and `cwd`
  differ; switching the registration to `getWorkingDir()` turns it red.
- CLI: the existing `createGitHubBrokerClient` test already asserts the
  recorded child cwd (kept, now with an explicit repo).
- `packages/tools/src/tools/github.test.ts`: kept as is. `tools` has no
  dependency on `providers` (providers depends on tools), so the real broker
  cannot be driven from there; the fake-port tests there assert the port
  contract (option, not parameter; read at call time) and the real path is
  covered by the agents and core tests above.

### L3: child process without timeout or cancellation (fixed)

The fixtures helper (`github-broker-issue4001-fixtures.ts`) spawns the child
with a 60 s timeout (SIGKILL) and an AbortSignal that the suite's `afterEach`
aborts, then awaits the child's `close` before removing any directory.
Test-infrastructure only, so there is no red phase.

### Decisions

- `INVALID_PARAM` for the missing-head rejection (the request is invalid for
  the environment); `HOST_GH_UNAVAILABLE` stays for no usable directory.
- Shared setup moved to the fixtures helper instead of being copied into the
  review suite.
