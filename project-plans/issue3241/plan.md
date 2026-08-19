# Issue #3241 — Nightly release fails: sandbox image build dies on transient npm ECONNRESET

## Summary

The nightly release for `v0.11.0-nightly.260818.57578c985` (run
[32085249582](https://github.com/vybestack/llxprt-code/actions/runs/32085249582))
failed in the **Build and push sandbox image** step roughly 59 minutes into
the job — after all npm publishes had already succeeded — so the release
also lost the GitHub release/tag, Homebrew update, and VS Code marketplace
publishing that follow the image build.

## Root cause (from the failed run log)

The release workflow builds the sandbox image for two platforms
(`linux/amd64,linux/arm64`). The arm64 leg is executed under QEMU
emulation (`/dev/.buildkit_qemu_emulator`), which is slow — the tarball
install alone ran ~4 minutes. `Dockerfile` line 77 runs a single
transactional install of all 12 local tarballs:

```dockerfile
RUN npm install -g \
      /tmp/vybestack-llxprt-code-tools-*.tgz \
      ... (11 more tarballs) ... && \
    npm cache clean --force && \
    rm -f /tmp/*.tgz
```

The local tarballs satisfy the workspace-internal dependencies, but all
transitive dependencies still stream from the npm registry over the
network. At t≈238.8s the arm64 leg hit a transient connection reset:

```
#43 238.8 npm error code ECONNRESET
#43 238.8 npm error syscall read
#43 238.8 npm error errno -104
#43 238.8 npm error network read ECONNRESET
```

npm exited, buildkit reported the RUN as `exit code: 152`, and nothing at
any layer retried — one reset TCP connection aborted the entire release.
npm's built-in fetch retries (default 2) either were exhausted or could
not apply (make-fetch-happen cannot retry once the response body has
started streaming; a mid-read reset is terminal for that fetch).

The same un-retried network exposure exists in the later
`RUN npm install -g @vybestack/llxprt-ui && npm cache clean --force`
step, which installs straight from the registry.

Prior nightly failures (Aug 6/11/12) were in *different* steps
(preflight checks, release tag creation); this Dockerfile failure mode is
new but the class of failure — transient network error, zero retries,
whole nightly lost — is what this fix removes.

## Fix design

Scope: the root `Dockerfile` only (it is consumed solely by the
`release.yml` "Build and push sandbox image" step; `build_sandbox.ts`
passes it to `docker build` unchanged). No workflow restructuring, no new
actions — the retry lives at the layer where the transient failure
occurs, so local sandbox builds benefit identically.

1. **Bounded retry loop around the tarball install** — keep the single
   transactional `npm install -g` (all 12 tarballs in one command), wrap
   it in an `until` loop with a maximum of 3 attempts and a 15s sleep
   between attempts, `exit 1` when attempts are exhausted. `npm cache
   clean --force` and `rm -f /tmp/*.tgz` still run only after a
   successful install. Retries inside the same RUN layer reuse npm's
   local cache, so repeat attempts are much cheaper than the first.

2. **Bounded retry loop around the `@vybestack/llxprt-ui` install** —
   same pattern (3 attempts, 15s backoff), preserving `npm cache clean
   --force` after success.

3. **Harden npm's own fetch retries** for both install commands via
   inline `npm_config_fetch_retries=5`,
   `npm_config_fetch_retry_mintimeout=1000`,
   `npm_config_fetch_retry_maxtimeout=60000` exported at the top of each
   RUN (scoped to the RUN; does not alter runtime npm behavior for
   sandbox users). This covers fetch-level retryable errors; the outer
   loop covers mid-body resets and hard registry outages.

## Tests (test-first; bun + bun:test only)

New file `scripts/tests/issue-3241-dockerfile-npm-retry.bun.test.ts`
(follows the established `issue-2903-dockerfile-apt-packages.bun.test.ts`
pattern: read the real root `Dockerfile`, no fixtures/mocks of the thing
under test):

- **Behavioral execution**: extract the actual RUN script text from the
  Dockerfile, remap `/tmp/` to a test-owned temp directory (assert the
  remap actually matched, so the test fails loudly if the Dockerfile
  drifts), shim `npm` and `sleep` via `PATH` (network and timing are
  infrastructure), and execute the script with `/bin/sh`:
  - npm fails twice (simulated ECONNRESET exit 1) then succeeds → script
    exits 0, `npm install` invoked exactly 3 times, cache-clean runs
    exactly once, tgz files removed only on the success path.
  - npm always fails → script exits nonzero after exactly 3 install
    attempts; cache-clean never runs.
  - Same behavioral coverage for the `@vybestack/llxprt-ui` RUN script.
- **Static invariants**: retry bound (`3` attempts) and backoff sleep are
  present in both RUN scripts; all 12 tarballs remain inside the single
  `until npm install -g` transaction.

Update the existing invariant test in
`scripts/tests/release-process-b.test.ts` ("installs local tarballs in
one npm transaction") — its slice anchors on the literal `RUN npm
install -g`, which becomes `RUN export ...; until npm install -g ...`.
Preserve every existing assertion intent (single transaction, all 12
tarballs, no second tarball install).

Also add the new test file to the `tsconfig.scripts.json` include list
so it is covered by `npm run typecheck` (that project enumerates test
files explicitly; the issue-2903 sibling predates the enumeration and
is itself missing, which is out of scope here).

## Verification cycle

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and the smoke test
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

## Out of scope

- Workflow-level retries of the build-push step (Dockerfile retry covers
  the observed failure at the correct layer).
- Pre-existing failures in other steps (Aug 6/11/12 runs).
- Vendoring transitive deps to make the image build fully offline.

## Implementation deviations

- The behavioral tests' `/tmp/` remap guard (`replacement count > 0`) is
  asserted only for the tarball-install RUN. The `@vybestack/llxprt-ui` RUN
  script contains no `/tmp/` references at all (per the exact Dockerfile
  shape above), so a `> 0` assertion there could never pass; the remap is
  still applied defensively, and the install-count assertions (exactly 3)
  are what keep the ui scenarios from testing nothing.

## Review remediations (deepthinker, post-implementation)

- **Windows safety**: the two behavioral `/bin/sh` suites in
  `issue-3241-dockerfile-npm-retry.bun.test.ts` now run under a
  `describePosixOnly` guard (`process.platform === 'win32' ? describe.skip
  : describe`, mirroring `issue-2978-oven-fallback.bun.test.ts`) because the
  nightly scripts shard executes on windows-latest and stock Windows has no
  `/bin/sh` or colon-PATH shims. The static invariant suites still run on
  every platform.
- **Temp-dir cleanup**: `executeRunScript` now removes its work directory in
  a `finally` block so a spawn/read throw cannot leak it.
- **Clean full-suite result**: the four extra agents full-suite timeouts
  observed under load (mutationCoverage.behavior, core-history,
  createAgent.harness, hooks) all passed in isolation for the reviewer;
  authoritative CI on the PR is the clearing evidence.

## Review remediations (ocr, post-deepthinker)

- **Exhaustion exit-code precision**: both behavioral exhaustion tests now
  assert `expect(result.exitCode).toBe(1)` instead of `not.toBe(0)`; a
  signal-killed child (`exitCode === null`) can no longer masquerade as the
  expected controlled `exit 1` failure.
- **Structural invariants de-literalized**: the static retry-structure suite
  now uses whitespace/backslash-tolerant regexes for the attempt increment,
  the `-ge 3` bound, and `sleep <n>` (keeping `exit 1` as a containment
  check), so semantically equivalent refactors of the Dockerfile retry loop
  no longer red-fail the suite. The suite is retained (not deleted) because
  the behavioral suites skip on Windows; on the windows-latest nightly
  scripts shard the static suite is the only structural guard.
