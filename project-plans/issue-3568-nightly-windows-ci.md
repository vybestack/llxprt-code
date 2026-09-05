# Issue #3568: Nightly workflow failed — Windows CI shards

Branch: `issue3568` (off `main` @ `faa1b1844`)
Generated: 2026-09-05

## Evidence

Two failed nightly runs, both on head `faa1b1844` (main):

- Run 33919963090 (2026-09-04 21:12Z, dispatch — the run that opened this
  issue): Windows [core], [cli], [scripts] failed; all macOS shards green.
- Run 33958243188 (2026-09-05 06:00Z, cron): Windows [cli] failed only.

All failing step: `Run shard tests (issue #3153)` (`bun scripts/test.ts
--shard <shard>`). Failure details recovered from the check-run annotations
API (job logs require auth):

Windows [cli] — identical failing set in BOTH runs (deterministic):

1. `packages/cli/src/utils/sandbox-podman-diagnostics.test.ts:147` —
   'surfaces a late OpenSSH forwarding failure after draining chatty output
   and reaping the child' (Expected true / Received false at the
   processExists assertion after the fixture `podman` was never invoked:
   `'podman' is not recognized as an internal or external command`).
2. same file `:180` — 'retains exactly 4096 encoded bytes from an oversized
   OpenSSH diagnostic'.
3. same file `:210` — 'accepts a Darwin socket path of exactly 103 encoded
   bytes and starts Podman and SSH' (Received the podman-not-recognized
   error instead of `accepted-boundary reached OpenSSH`).
4. `packages/cli/src/utils/sandbox-proxy-integration.test.ts:180` — 'uses a
   separate short private credential runtime for Darwin Podman sessions'
   (Expected true / Received false on `runtime.path.startsWith('/tmp/lx-')`).
5. `packages/cli/src/utils/sandbox-launch-release.test.ts:827` — 'keeps the
   normal success path on the wired close handlers' (FatalSandboxError from
   `createCredentialSocketRuntime` at sandbox-credential-runtime.ts:79: the
   darwin+podman branch tried to `mkdtemp` under `/tmp`).
6. `packages/core/... n/a` — `packages/cli/src/utils/sandbox-credential.test.ts:400`
   — '#3534 Podman credential socket runtime' > 'uses a private short socket
   directory…' (Expected 448 / Received 438: `mode & 0o777` is 0o666 on
   win32; POSIX mode bits do not exist there).

Windows [core] (run 1 ONLY; green on the identical head in run 2):

- `packages/core/test/run-bun-tests.test.ts` fixture legs
  (`runner-scan-cleanup-fixture-lgSVGm` / `runner-scan-error-fixture-B0Yr0C`
  / `runner-scan-assert-fixture-JaCKJi`, each `fail.test.ts:3:13`
  Expected 2 / Received 1) and
  `shellJobManagerSurvivors.test.ts:258` via
  `removeWindowsTestDir` (shellJobTestCleanup.ts:242).

Windows [scripts] (run 1 ONLY; green in run 2):

- `scripts/tests/nightly-bun-native-smoke.test.ts:253`
  (`runSmokeHarnessWithTimeoutRetry`: `[HANG] fixture remains alive`,
  attempt 2 no output) and
  `scripts/tests/issue-2603-install-native-launchers-contract.test.ts:491`
  (`abortChildProcess`).

## Root cause (deterministic cli set)

All six cli failures belong to one family: the #3534 Darwin Podman
credential-bridge tests. Production is correctly gated —
`setupMacOSCredProxyBridge` (sandbox-containers.ts:582) is reached only for
`os.platform() === 'darwin'`, and `createCredentialSocketRuntime`
(sandbox-credential-runtime.ts:52) self-gates the same way — so no production
code path runs this bridge on real Windows. The mismatch is entirely
test-side:

- `sandbox-podman-diagnostics.test.ts` installs `#!/bin/sh` fixture scripts
  named `podman`/`ssh` and prepends them to a child PATH. win32 CreateProcess
  cannot exec extensionless POSIX shell scripts, so production's
  `podman system connection list` fell through to the host, which has no
  podman.
- `sandbox-proxy-integration.test.ts:168`, `sandbox-credential.test.ts`
  (#3534 describe), and `sandbox-launch-release.test.ts` mock
  `os.platform() → 'darwin'` and then execute the REAL darwin branch:
  `mkdtemp('/tmp/lx-…')`, `chmod 0o700`, and mode assertions — primitives
  that do not exist on a win32 host.

Decision (confirmed with Andrew): the macOS-Podman credential-bridge tests
should not run on Windows. They test a darwin-only feature against
darwin-only primitives; on win32 they fail or pass vacuously.

## Accepted behavior (ACs)

- AC1: The darwin-Podman credential-bridge test groups are skipped on win32
  hosts, using the repo's established gate style:
  - a. `sandbox-podman-diagnostics.test.ts` — the whole
    `#3534 Podman tunnel startup diagnostics` describe:
    `describe.skipIf(process.platform === 'win32')`.
  - b. `sandbox-proxy-integration.test.ts` — the single R3.4 test 'uses a
    separate short private credential runtime for Darwin Podman sessions':
    `it.skipIf(process.platform === 'win32')`. (The rest of the file is
    source-text assertions that remain running everywhere.)
  - c. `sandbox-credential.test.ts` — the whole `#3534 Podman credential
    socket runtime` describe: `describe.skipIf(...)` (predicate hoisted as
    `const isWindows = process.platform === 'win32'` so the header stays on
    one line and the suite body is not re-indented). Coverage tradeoff,
    accepted with the describe-level gate: of its seven tests, one failed on
    win32; three more execute the real darwin `/tmp` runtime; two are
    portable (the fully-mocked initialization-failure case and the
    docker-compat counterfactual, which pass on win32 today) and lose their
    win32 leg — they still run on Linux/macOS in PR CI and the macOS
    nightly.
  - d. `sandbox-launch-release.test.ts` — the single test 'keeps the normal
    success path on the wired close handlers' (the success-path scenario
    whose real `runContainerSandbox` transit reaches the darwin+podman
    credential runtime): `it.skipIf(process.platform === 'win32')`, joining
    the five existing win32 gates in that file.
- AC2: No behavioral change on macOS/Linux: gated test bodies are untouched;
  the suites still run and pass there.
- AC3: No production-code changes.
- AC4: No new source files (this plan document is the only new file), no new
  dependencies, no workflow changes.

### Boundary cases

- The gate predicate MUST be `process.platform === 'win32'`, never
  `os.platform()` — `sandbox-credential.test.ts` and
  `sandbox-launch-release.test.ts` spy `os.platform` to return `'darwin'`,
  which would defeat an `os.platform()`-read gate.
- Preserve the third-arg timeout where the original test declares one
  (launch-release test uses 30_000).
- Skipping at describe level must also skip its beforeEach/afterEach fixture
  work (bun:test does; verify no module-level fixture writes exist in the
  gated files — podman-diagnostics writes fixtures inside beforeEach only).

## Out of scope (documented, not fixed)

- The run-1-only [core]/[scripts] flakes: non-reproducing on the identical
  head, load-correlated (three shards failed simultaneously in run 1),
  classic Windows file-lock/hang classes (test-runner fixture scan,
  `removeWindowsTestDir`, smoke-harness hang, abortChildProcess). If they
  recur in the post-fix nightly they become their own issue with this
  evidence attached.
- Deferred (review finding, not a nightly failure): three darwin-podman rows
  in the ungated `#1456 credential proxy network policy` describe of
  `sandbox-credential.test.ts` (network-off rejection via primary and legacy
  env vars, and the darwin-podman network-policy success output) also call
  the real `createCredentialSocketRuntime` and would fail on a win32 host
  whose drive-root `	mp` is absent. They are NOT gated because the run
  evidence shows the GitHub Windows runner's drive-root `	mp` exists: the
  run-1 failure at sandbox-credential.test.ts:400 reached a mode assertion
  on a created `/tmp/lx-*` directory (Received 438 = 0o666), proving
  `mkdtemp` under `/tmp` succeeds there — and both failed nightlies show
  these three rows passing. If the nightly image ever loses drive-root
  `	mp`, gate those rows the same way.
- Any change to the nightly workflow itself, shard runner, or production
  sandbox code.

## Tests that prove it

- Local (linux host, this branch): the four touched suites run green with
  the gated tests EXECUTING (gate predicate false on linux), proving the
  bodies are intact: `cd packages/cli && bun test
  src/utils/sandbox-podman-diagnostics.test.ts
  src/utils/sandbox-proxy-integration.test.ts
  src/utils/sandbox-credential.test.ts
  src/utils/sandbox-launch-release.test.ts`.
- Full verification cycle (test/lint/typecheck/format/build + stepfun-37
  smoke) per the issue workflow.
- PR CI (ubuntu shards) green.
- Windows leg: PR CI does not run Windows; the proving gate is the nightly
  Windows [cli] shard on the fixed head — dispatch the Nightly workflow on
  the branch (or first nightly after merge) and confirm [cli] green. The
  gated tests report as skipped there, not failed.

## Verification log

- Targeted command: `cd packages/cli && bun test src/utils/sandbox-podman-diagnostics.test.ts src/utils/sandbox-proxy-integration.test.ts src/utils/sandbox-credential.test.ts src/utils/sandbox-launch-release.test.ts` — passed on Linux with 58 passed, 0 failed, and 0 skipped. The gated tests executed.
- The initial cycle found an incomplete dependency installation (`env-paths`, `cross-env`, `tsc`, Prettier, and workspace links were missing). `npm install` restored dependencies without leaving tracked dependency or notice-file changes.
- `npm run test` — rerun after dependency restoration, but the shell terminated it at its configured 900-second ceiling before completion. The partial log showed passing tests at termination, with no final aggregate result.
- `npm run lint` — rerun after dependency restoration, but the shell terminated it at 600 seconds before completion.
- `npm run typecheck` — initial attempt failed because `tsc` was missing; not rerun after dependency restoration because the 30-minute verification budget was exhausted.
- `npm run format` — initial attempt failed because Prettier was missing. After dependency restoration, the four touched test files were formatted directly with the repository Prettier; the full command was not rerun because the budget was exhausted.
- `npm run build` — initial attempt failed because workspace links were missing; not rerun after dependency restoration because the budget was exhausted.
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` — initial attempt failed because `@vybestack/llxprt-code-tools` was unavailable; not rerun after dependency restoration because the budget was exhausted.
- Diff-shape remediation: each describe-gated file now adds one `isWindows` constant and changes only the original describe header to a one-line `describe.skipIf(isWindows)(...)` call. The suite bodies retain their original indentation. The existing `it.skipIf(process.platform === 'win32')` gates in `sandbox-proxy-integration.test.ts` and `sandbox-launch-release.test.ts` are unchanged.
- `npx prettier --check packages/cli/src/utils/sandbox-podman-diagnostics.test.ts packages/cli/src/utils/sandbox-credential.test.ts` passed: both files use Prettier code style.
- Targeted command rerun after the diff-shape remediation: `cd packages/cli && bun test src/utils/sandbox-podman-diagnostics.test.ts src/utils/sandbox-proxy-integration.test.ts src/utils/sandbox-credential.test.ts src/utils/sandbox-launch-release.test.ts` passed on Linux with 58 passed, 0 failed, and 0 skipped. All four gated areas executed.
- Compliance review (deepthinker subagent, 2026-09-05): four gates verified correct and complete for the six nightly failures; all predicates read `process.platform`; the launch-release 30_000 timeout preserved; scope clean (4 modified test files + this plan only); typecheck passed; 4-file prettier check passed; bun skipIf hook semantics probe passed. Findings triaged: MEDIUM (three ungated #1456 darwin-podman rows depend on drive-root 	mp) — classified Deferred with runner evidence (see Out of scope), no code change; LOW (13 skipped tests vs 6 failures; plan wording) — plan wording corrected above; LOW (AC4 wording) — corrected. No code findings.
- Verification cycle completed (2026-09-05, after the entries above):
  - `npm run test` (full suite, background run, log `tmp/verify3568/test.log`):
    exit 1 with 10 failing files, NONE of them among the four touched files and
    none reachable by the diff (win32-only test gates; per-file isolated
    processes): core leg — `gitService.test.ts`, `editor.test.ts`, SecureStore
    keyring legs, proactive renewal, factory detection P33, runner fixtures;
    cli leg — `cli-args.integration.test.ts`, `docsCommand.test.ts`,
    `Footer.responsive.test.tsx`, `sandbox-node-modules-preflight.test.ts`;
    vscode-ide-companion — 1 file. Attributions verified where cheap:
    `sandbox-node-modules-preflight` fails only because THIS host has
    `/usr/local/bun/bin/bun` (ls-verified), so the "dangling symlink" fixture
    is not dangling; the test's premise holds on CI runners where that path is
    absent. The remaining classes (no keyring daemon, headless display, git
    config, UI timing) are sandbox-environmental; PR CI ubuntu shards are the
    authoritative gate for them and run the same suites.
  - `npm run lint`: full-tree ESLint was SIGKILLed twice (exit 137) by this
    sandbox's 12 GiB cgroup memory cap (`/sys/fs/cgroup/memory.max` =
    12884901888) — the lint runner requests a 12 GB heap by design; this is an
    environment kill, not lint findings. Scoped ESLint on the four changed
    files: exit 0, no findings. Full-tree lint is adjudicated by PR CI.
  - `npm run typecheck`: exit 0.
  - `npm run format`: exit 0 (no diff produced).
  - `npm run build`: exit 0.
  - Smoke `bun scripts/start.ts --profile-load stepfun-37 …`: blocked by this
    sandbox's credentials, not by code — the named key `stepfun` is absent
    from the mounted key store (only `glm52-vast` and `qwen38local` exist),
    and the inherited `LLXPRT_CREDENTIAL_SOCKET` routes child auth to the
    session proxy, which only authenticates sandbox children holding
    FD-delivered capability tokens (proxy-socket-client.ts:410;
    credential-store-factory.ts:150). Positive startup evidence substituted
    with the `glm52-vast` profile (available key): the CLI on this branch
    completes module load, profile application, file-store credential
    resolution, and provider construction, failing only at network transport
    (6 connection attempts — sandbox egress restriction; full report
    `tmp/verify3568/smoke-glm52.log`). The diff touches zero runtime files.
- Open Code Review (2026-09-05): the local `ocr` binary does not exist in this
  sandbox (no `ocr` on PATH, no `~/.opencodereview` config tree; the
  `@opencodereview/cli` npm package is an unrelated product, and
  `@alibaba-group/open-code-review` installs but has no LLM credentials to
  run — the mounted key store holds only llxprt keys, which were not reused
  for a different tool without approval). Local OCR rounds are therefore
  unavailable; OCR coverage is provided by the repository's PR-side
  OpenCodeReview automation, within the two-PR-review cap.
