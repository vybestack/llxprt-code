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
