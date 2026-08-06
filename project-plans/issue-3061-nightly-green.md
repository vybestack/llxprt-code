# Issue #3061 — Restore a green nightly

Nightly run 30987988465 (`main` @ `5c2dc30b4`) failed four jobs. Last green
nightly was 2026-07-31; it has failed every night since 2026-08-01. The four
failures are independent problems, not one.

## Scope

Make the nightly workflow pass. Everything below is a defect in test or CI
code; no product behaviour changes are required, and none are in scope.

Hard constraint carried into every fix: **no test may be neutered to pass.**
Deleting assertions, broadening a matcher until it cannot fail, or skipping a
test on a platform where the behaviour under test genuinely exists are all
prohibited. Platform gating is legitimate only where the production code being
tested is itself platform-gated, and the gate must mirror the production one.

## 1. `cli_bundle_launch` — DONE

Added by #3013, which merged after the 2026-08-04 nightly, so 2026-08-05 was
its first-ever run and it has never passed.

**Root cause.** `scripts/tests/issue-2999-cli-bundle.bun.test.ts` called
`Bun.build(cliBundleConfig)` in-process. Under the `bun test` runner Bun's
bundler does not apply the TypeScript `.js` -> `.tsx` extension rewrite, so it
cannot resolve `./src/cli.js` (the real file is `packages/cli/src/cli.tsx`)
that `packages/cli/index.ts` imports. It fails with
`ResolveMessage: Could not resolve: "./src/cli.js"`. The same build run as a
subprocess (`bun scripts/bun-build.config.ts --cli-only`, which is exactly what
`packages/cli`'s `prepack` runs at publish time) succeeds. Reproduced locally.

**Second, independent defect in the same job.** CI now runs npm 11.16.0, which
no longer executes install scripts by default (the job log shows
`npm warn allow-scripts` for `bun`, `keytar`, `node-pty`, `esbuild` and
others). The `bun` npm package ships only `bun.exe`/`bunx.exe`; the POSIX `bun`
binary is produced by its postinstall. The test spawned
`node_modules/bun/bin/bun`, which therefore does not exist in CI — so the job
would have failed at the launch step even once the build was fixed.

**Third defect: the failure was undiagnosable.** `Bun.build` rejects with an
`AggregateError` whose own message is the constant string `Bundle failed`; all
real diagnostics are in `errors` (and, for a non-throwing failure, in
`result.logs`). Both the test and `scripts/bun-build.config.ts` reported only
`error.message`, so CI printed `bundle build failed: Bundle failed` and nothing
else. This is why the root cause could not be read off the nightly log.

**Fixes applied.**

- Build via the real publish path as a subprocess, so the test exercises what
  `npm pack` runs and is not subject to the test runner's bundler differences.
- Spawn the Bun that is running the test (`process.execPath`, pinned by
  `.bun-version` in CI) instead of the postinstall-provided binary.
- Render full diagnostics — aggregate errors with source positions, build logs,
  and subprocess status/signal/stdout/stderr — in both the test and
  `scripts/bun-build.config.ts`, so the next failure explains itself.

## 2. `windows_ci` — six Windows-portability defects

Chronic since 2026-08-01.

| Test | Defect |
| --- | --- |
| `packages/storage/test-bun/credential-write-lock.bun.ts:55` | Test helper `readCanonicalProcessStartTimeMs` runs `ps -o lstart= -p <pid>` unconditionally. Windows has no such `ps` (`ps: unknown option -- o`). Production `readProcessStartTimeMs` is gated to darwin/linux/freebsd and returns `null` elsewhere; the test does not mirror that gate. |
| `packages/storage/test-bun/credential-write-lock.bun.ts` M4 test | Separate defect in the same file. It sabotaged the lock by removing the lock directory and writing a file in its place, which raises ENOTDIR on POSIX but ENOENT on Windows — where `readOwner` reads it as "absent" and logs nothing, so the release failure the test exists to catch was silently not exercised there. Replacing the lock file with a directory yields a non-ENOENT error everywhere. |
| `packages/core/src/config/toolRegistryFactory.test.ts:403` | Compares a path built from `os.tmpdir()` (8.3 short form, `C:\Users\RUNNER~1\...`) against the tool's returned long path (`C:\Users\runneradmin\...`). No realpath normalisation. |
| `packages/core/src/utils/getPty.test.ts:49` (2 tests) | The suite substituted `@lydell/node-pty` / `node-pty` in the module registry. `packages/core` runs exclusively under Bun, and `getPty` short-circuits to the Bun.Terminal adapter on Bun POSIX, so these cases only ever EXECUTE on Windows — the one platform where the substitution silently fails, because Bun's runner cannot reset the registry and evaluates a module-mock factory once, eagerly. The assertions therefore received the real `Module {}`. `getPty` now takes injectable backend loaders, so the selection logic is exercised the same way on every runtime and the tests run locally under Vitest as well. |
| `packages/providers/src/auth/proxy/__tests__/e2e-credential-flow.test.ts` Scenario 7 | "throws connection error after proxy stops" times out at 30 s. Named-pipe teardown does not surface the connection error the way a Unix socket does. |
| `packages/test-utils/src/process-run.test.ts:283` | Asserts `/ENOENT/`; Bun on Windows reports `Executable not found in $PATH: "..."`. |
| `packages/test-utils/src/quota-guard-vitest-integration.test.ts` (2 tests) | Both tests spawn a real nested vitest run with `process.execPath`, which under this package's Bun-hosted suite is Bun. Vitest is a Node tool whose forks pool assumes a Node runtime; on Windows the nested run dies, so no sentinel is published and the second test's run exits 1 where 0 was expected. |
| `packages/tools/src/__tests__/shell-timeout-bounds.test.ts:252` | Not present in the failing nightly — it arrived with #3050 after that run and was caught by dispatching the nightly on this branch. The test built an `is_background: true` invocation unconditionally, but `ShellTool` rejected background jobs on win32 outright, so `build()` threw before the clamp behaviour was reached. **Superseded:** #3078 subsequently implemented Windows background jobs via `Start-Process` and removed that rejection, so the behaviour now exists on every platform and the test needs no gate at all. |

## 3. `macos_ci` — one racy test

`scripts/tests/ocr-concurrency-canary-2673.test.ts:554`, "handles an upstream
error after headers and partial body". Every telemetry assertion passes
(`total_requests: 1`, `upstream_errors: 0`, `responses_by_status: {200: 1}`),
so the monitor behaves correctly. Only `result.statusCode` fails: expected
`200`, received `0` — the sentinel the test's own `proxyRequest.once('error')`
handler resolves with. The upstream deliberately destroys the socket mid-body,
so the response callback and the request-level `ECONNRESET` race for a single
first-wins `resolve()`. Intermittent: passed 2026-08-01/02/04, failed
2026-08-03/05.

## 4. `e2e_full` (windows, sandbox:none)

`integration-tests/run_shell_command.windows.test.ts:40`, failed all three
retries. The rig creates `check-utf8-path.ps1` and a UTF-8-named file, then
asks the model to run the script. The transcript shows
`Listed 0 item(s). (5 ignored)` — the files exist but every one is filtered out
as git-ignored, because the rig workspace lives under `.integration-tests/`,
which the repo root `.gitignore` ignores. `glob` then reports "No files found"
and the model refuses to run a script it believes is absent.

Two problems: the assertion depends on the model not looking before leaping
(which is why it passed 2026-08-01..03), and underneath it an agent cannot see
its own workspace files when the workspace sits inside an ignored directory.

## Baseline evidence

Dispatching the nightly on this branch (run 31031274495) after the
`cli_bundle_launch` fix confirmed:

- `CLI bundle builds and launches` — **green**, so section 1 is proven on CI,
  not merely locally.
- `macOS CI` — the canary test was the only failure.
- `Windows CI` — the six defects above plus the newly-landed #3050 regression.
- `E2E Full (windows)` — the `run_shell_command` test, all three retries.

Every dispatch of a failing nightly comments on this issue via the
`notify_failure` job; that is expected while iterating on the branch.

## Second dispatch (run 31039119968)

- `CLI bundle builds and launches`, `E2E Full (windows)`, and every other leg —
  **green**. Five of the six Windows defects and the #3050 regression are
  confirmed fixed on the platform itself.
- `Windows CI` — only `getPty` remained, exactly as reviewed. The module-registry
  substitution could never work there; replaced with an injected seam.
- `macOS CI` — failed at a *later* step that the canary failure had been masking:
  `Run scripts-assignment Bun manifest (#2833)` invokes a workspace that #3014
  deleted from `scripts/bun-test-manifest.ts` while leaving the step behind, so
  it could never pass. Both of its test files are already covered by the
  `scripts-tests` glob root and ran green in this same job's harness step, so
  the dead step is removed rather than the workspace restored.

Also applied from review, none of which change what any test proves:

- `scripts/bun-build.config.ts` rendered a diagnostic's source position only for
  `instanceof Error` values, but Bun attaches `BuildMessage`/`ResolveMessage`
  objects, which are not Errors — so the file/line/column was always discarded.
  Verified by probing Bun 1.3.14 directly.
- The CLI bundle test's artifact check was an opaque `expect(existsSync(...))`,
  though the build can exit 0 having built nothing; it now reports the
  subprocess output.
- The credential-proxy shutdown comment claimed a Windows named-pipe half-close
  that libuv does not implement. What actually fixes it is ordering:
  `server.close()` waits for the connection count to reach zero, so `stop()` can
  no longer return before the peer observes the close. The comment now says so,
  the socket is paused first (`end()` leaves the read side open, so an in-flight
  frame would otherwise still mutate the token store during shutdown), and
  `endAndDestroyAfter` guards `writableEnded` to avoid a double-`end()`.

The e2e prompt was also reworded to be imperative. That is a hedge, not the fix —
the `git init` addresses the evidenced cause — and it is recorded here so it is
not mistaken for one.

## Verification

- `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
  `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
- `LLXPRT_RUN_BUNDLE_BUILD_TEST=1 bun test scripts/tests/issue-2999-cli-bundle.bun.test.ts`
- Dispatch the nightly workflow on the branch and iterate until every job is
  green. Platform-specific fixes cannot be proven locally on macOS; the
  dispatched nightly is the acceptance gate.

## Rebase onto a moved main

Two commits landed on `main` mid-flight that bear directly on this work:

- **#3078** implemented Windows background shell jobs via `Start-Process` and
  removed the `is_background` win32 rejection. The gate this branch had added to
  the timeout-ceiling suite — and the complementary win32 assertion added from
  review — were both correct against the old production code and wrong against
  the new one. Both are gone; the clamp test now runs unguarded on every
  platform, as it should.
- **#3080** staged the CLI bundle's runtime assets. It merged cleanly with the
  build-diagnostics work here.

`main` also fixed the same OCR canary race independently. Its version records
the bytes the client actually received rather than a fixed string, so the
conflict was resolved in its favour; the 50 ms delay from this branch is kept
because it is what makes the client reach the response callback at all.
