# Issue #3491 — implementation brief

Read `project-plans/issue3491-sandbox-background-job-exit.md` first (established
root cause and accepted behaviour). Then `dev-docs/RULES.md` and
`.llxprt/skills/typescript-test-writing/SKILL.md` before writing any test.

## Background (proven; do not re-investigate)

A sandboxed llxprt session exited status 0 mid-task seconds after backgrounding
`npm run test`. Chain:

1. The sandbox container runs with `--init` (see the `run` arg list in
   `packages/cli/src/utils/sandbox-containers.ts`). Under `--init`,
   `/run/podman-init` is PID 1 and the container's main process is its DIRECT
   CHILD, so the CLI has PPID 1.
2. The container's main process is the published `llxprt` bin shim; its `ps`
   argv begins with `node`. Verbatim capture from
   `ghcr.io/vybestack/llxprt-code/sandbox:0.11.0-nightly.260831.393a0080f`:

```
      1       0 /run/podman-init -- bash --noprofile --norc -c exec llxprt --prompt "please run the test suite"
      2       1 node /usr/local/share/npm-global/bin/llxprt --provider openai --key xx --prompt please run the test suite
      9       2 /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/node_modules/bun/bin/bun.exe /usr/local/share/npm-global/lib/node_modules/@vybestack/llxprt-code/bundle/llxprt.js -- --prompt please run the test suite
```

3. `scripts/run_bun_tests.ts` → `isOrphanedTestProcess` matches ANY process with
   PPID 1 whose argv contains `bun` OR `node` AND contains `test` OR `spec`.
   PID 2 above matches on all counts. Verified: feeding that exact `ps` text to
   the real exported `reapStaleBunTestProcesses` reaps exactly PID 2 with
   SIGTERM and prints the exact log line quoted in the issue.
4. `packages/cli/bin/llxprt.mjs` forwards SIGTERM to the Bun child and
   propagates its exit code.
5. The interactive CLI's SIGTERM handler in
   `packages/cli/src/cliTerminalSession.ts` (`enableInteractiveRawModeIfNeeded`)
   does `await runExitCleanup(); process.exit(0)` and prints NOTHING. That is
   the silent status-0 exit.

## Change 1 (AC1) — narrow the reaper in `scripts/run_bun_tests.ts`

`buildSpawnArgs` in that same file shows the ONLY shape this runner ever spawns:
`<bun-executable> test [flags...] <file>`. Rewrite `isOrphanedTestProcess` so it
only matches that shape:

- keep `if (ppid !== 1 || pid === ownPid) return false;`
- require the FIRST whitespace-separated argv token's basename to be exactly
  `bun` or `bun.exe`, so `/usr/local/.../node_modules/bun/bin/bun.exe` and a
  bare `bun` both match while
  `node /usr/local/share/npm-global/bin/llxprt ...` does not
- require the SECOND whitespace-separated argv token to be exactly `test`
- DELETE the `comm.includes('bun') || comm.includes('node')` and
  `comm.includes('test') || comm.includes('spec')` substring heuristics entirely

Keep the export surface and the `reapStaleBunTestProcesses` signature unchanged.
Update the doc comment to state the shape it matches and why the substring
heuristic was wrong (it matched the sandboxed CLI, issue #3491). Do NOT add a
`SANDBOX` env check or any other extra guard: narrowing the predicate is the
whole fix for AC1.

## Change 2 (AC2) — announce shutdown while managed background jobs run

Behaviour: when the CLI process exits while `ShellJobManager` has one or more
jobs in state `running`, it writes a message to stderr saying it is shutting
down with N managed background job(s) still running, identifying each by job id
and command. When no job is running it writes nothing.

Guidance, not constraint:

- `ShellJobManager` (`packages/core/src/services/shellJobManager.ts`) already
  exposes `list()` and a running-jobs accessor. Use the existing API; do not add
  a new one unless nothing suitable exists.
- `Config.getShellJobManager()` (`packages/core/src/config/configBase.ts`) is
  the reachable accessor from the CLI.
- The paths that produced the reported silence are the SIGTERM and SIGINT
  handlers in `packages/cli/src/cliTerminalSession.ts` and the quit path in
  `packages/cli/src/ui/containers/AppContainer/hooks/useExitHandling.ts`. A
  single synchronous `process.on('exit')` writer registered once covers all of
  them, because every one of those paths reaches `process.exit()`. Prefer that
  over sprinkling the same call into three handlers. Whatever you choose must be
  synchronous at exit time; async work does not run during `exit`.
- Message goes to stderr. Do NOT change any exit code.
- Fail-fast architecture: no defensive try/catch pyramids, no fallbacks hedging
  against hypothetical upstream bugs.

## Change 3 (AC3) — behavioural tests

Behavioural per `dev-docs/RULES.md`: assert observable behaviour, no mock
theater. Bun/TypeScript only; no new `.js` files, no vitest/node runners, new
tests are `bun:test`.

1. In `scripts/tests/run_bun_tests.test.ts`, inside the existing
   `describe('reapStaleBunTestProcesses')`:
   - a test using the VERBATIM three-line sandbox `ps` capture above asserting
     NOTHING is reaped (result 0, no pids killed, no stderr line), with a
     comment naming the image the capture came from
   - a test that a genuine orphan in this runner's own spawn shape is still
     reaped with SIGTERM, e.g.
     `  100  1  /usr/local/bun/bin/bun test --max-concurrency 1 --timeout 60000 src/foo.test.ts`
     and a bare `  101  1  bun test src/bar.test.ts`
   - keep "does not kill the current process", "returns 0 when ps fails", and
     "logs a warning when processes are reaped" passing, adjusting their fixture
     argv to the new shape where needed
   - the existing expectation near line 184 that `node src/bar.spec.ts` with
     PPID 1 IS killed must be inverted: it is now not killed, and the assertion
     should say why (this runner never spawns that shape; matching it is the
     #3491 defect). Adjust the surrounding counts accordingly.

2. A behavioural test for AC2: with a `ShellJobManager` holding a running
   managed job, the shutdown announcement is written to stderr and names the job
   id and command; with no running job, nothing is written. Put it next to the
   code you add, following neighbouring test conventions.

3. A behavioural test that a managed background job launched during one turn
   stays registered and `running` across several subsequent turns and is not
   terminated by the turn loop. Look for an existing home such as
   `packages/core/src/services/shellBackgroundIntegration.test.ts` before
   creating a new file.

Write the failing tests FIRST, confirm they fail for the right reason, then
implement.

## Scope discipline

Implement ONLY the above. Do not touch `shellJobSpawn.ts`, `shellJobManager.ts`
internals, the sandbox entrypoint, `bin/llxprt.mjs`, the `--init` flag, or exit
codes. No speculative hardening, no neighbouring refactors. If something else
must change to make the accepted behaviour work or CI green, do it only if
strictly required and say so explicitly in the report.

## Verification (mandatory, full cycle, fix everything)

From the repo root. Write long-running output to unique paths under
`tmp/issue3491/` — NEVER bare `/tmp` paths, sibling sessions share `/tmp` and
corrupt each other's logs.

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

`npm run test` is long: run it as a background job writing to
`tmp/issue3491/npm-test.log` and poll, or give it a generous explicit timeout.
Fix every failure including lint, type, and format. Re-run the whole cycle after
any fix. Not done until all six pass.

Do NOT commit, push, or open a PR. Leave the working tree with the changes.

## Report

Files changed with a one-line reason each; the final `isOrphanedTestProcess`
source; how AC2's announcement is wired and which exit paths it fires on; tests
added or changed and the behaviour each pins; pass/fail for all six verification
commands; anything beyond scope with justification.
