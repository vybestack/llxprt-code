# Issue #2978 — review findings on the in-flight implementation

Reviewed while `typescriptexpert` was still running, against the working-tree
state of `packages/cli/src/launcher/oven-bun-variants.ts`,
`scripts/tests/issue-2978-oven-fallback.bun.test.ts`, and
`scripts/bun-test-manifest.ts`. These are remediation items to feed back.

## BLOCKER 1 — `makeEntry` is passed a marker, not code

`launcher-test-helpers.ts` defines:

```text
export function makeEntry(pkgRoot: string, code: string): void {
  writeFileSync(join(pkgRoot, 'index.ts'), `#!/usr/bin/env -S bun\n${code}\n`);
}
```

The second argument is **entry source code**, written verbatim. The test file
defines `BUNDLED_ENTRY_CODE = "console.log('BUNDLED_BUN_RAN_ENTRY');"`
correctly, but there is **no equivalent for `OVEN_MARKER`**, and these call
sites pass the bare marker string:

- `makeNpmV12Layout(tempDir, OVEN_MARKER)` — used by
  "launches from an npm-v12 layout", "rejects an @oven package whose version
  mismatches the pin", "skips an emptied @oven bin and falls through".
- `makeEntry(pkgRoot, OVEN_MARKER)` in
  "accepts a hoisted @oven binary within enclosing node_modules".

The generated `index.ts` becomes the bare identifier `OVEN_BUN_RAN_ENTRY`,
which is a `ReferenceError` at runtime. The process exits non-zero and prints
nothing, so every `expectExitOk(result)` + `expect(result.stdout).toContain(
OVEN_MARKER)` assertion fails.

Confirmed by execution, not inference. Writing exactly what `makeEntry` would
produce and running it under the repo's own Bun:

```text
$ bun project-plans/issue2978/tmp-entry-check.ts
1 | OVEN_BUN_RAN_ENTRY
    ^
ReferenceError: OVEN_BUN_RAN_ENTRY is not defined
      at ...	mp-entry-check.ts:1:1

Bun v1.3.14 (Windows x64)
EXITCODE=1
```

Exit 1, nothing on stdout. So `expectExitOk(result)` fails first, and
`expect(result.stdout).toContain(OVEN_MARKER)` would fail too.

Fix: add `const OVEN_ENTRY_CODE = "console.log('" + OVEN_MARKER + "');"` and
pass that everywhere the entry is expected to run. Keep the bare marker only
for the string-containment assertions.

Note the three tests that assert FAILURE
("rejects an @oven package placed in a consumer ancestor", "rejects an @oven
package whose version mismatches the pin") are unaffected in outcome — they
expect exit 43 and never reach the entry — but the ancestor test would pass for
the wrong reason if resolution ever succeeded, so fix them all for honesty.

## Where the new suite actually runs in CI (severity calibration)

Traced before assigning severities, so each finding is ranked by real impact
rather than assumption:

```text
ci.yml:829  bun_native_test_parity   runs-on: ubuntu-latest   <-- ONLY place
ci.yml:863    bun scripts/run_bun_tests.ts --timeout 30000        *.bun.test.ts
                                                                  runs in CI
```

- `npm run test:scripts` = `vitest run --config scripts/tests/vitest.config.ts`,
  which SKIPS `*.bun.test.ts` by design (issue #2475). Runs on ubuntu shards and
  macOS nightly (`nightly.yml:117-121`).
- `nightly.yml:451 windows_bun_native_smoke` is windows-latest but runs
  `bun scripts/bun-native-modules-smoke.ts` (line 484), not the manifest.
- `ci.yml:895 test_shard` is ubuntu-only (issue #2876).

Consequences:
- BLOCKER 1 (`makeEntry`) executes on ubuntu → **genuinely turns CI red**.
- BLOCKER 3 (root manifest) is enforced by `publish-integrity.test.ts`, a vitest
  test reached via `test:scripts` on ubuntu → **genuinely turns CI red**.
- The Windows-gating item below never executes on Windows in CI → **downgraded
  to a quality/DX item**, not a gate.

Also noted for the lockfile step: `ci.yml:857-859` runs plain `bun install`
followed by `git checkout -- bun.lock`, i.e. that job tolerates lockfile churn
and never uses `--frozen-lockfile`, consistent with the project rule.

## BLOCKER 2 (DOWNGRADED to quality/DX) — POSIX-only launcher tests are not gated off Windows

The whole `issue #2978 @oven fallback — launcher behavior` describe spawns
`packages/cli/bin/llxprt` (a POSIX `sh` script) directly and hardcodes
`env.PATH = '/usr/bin:/bin'`. This cannot run on Windows. Only the hoisted-
binary case carries `itNeedsSymlinks`.

Per `EVIDENCE.md` section 6 and the `itNeedsSymlinks` precedent in
`issue-2603-launcher.bun.test.ts`, the repo deliberately gates the launcher
suites. Gate the entire launcher-behavior describe (and the `resolveBunExe`
parity describe, which builds the same layouts) on
`process.platform !== 'win32'`, or the suite red-fails for every Windows
contributor.

The sibling suite already establishes the exact idiom to copy —
`scripts/tests/issue-2962-system-bun-preference.bun.test.ts:46`:

```text
const describeDarwinOnly =
  process.platform === 'darwin' ? describe : describe.skip;
```

Use a `describePosixOnly` in the same shape rather than sprinkling per-test
guards. Note that suite's ungated `describe` at line 108
("POSIX launcher system-Bun preference source gating") only reads the launcher
SOURCE text and never spawns it, which is why it needs no platform gate — the
same distinction applies here: the pure/manifest/detection describes in the new
file are correctly ungated; only the spawning ones need it.

The same file at line 44 also shows the correct entry-code idiom that BLOCKER 1
is missing:

```text
const BUNDLED_ENTRY_CODE = `console.log('${BUNDLED_MARKER}');`;
```

The new suite copied this for `BUNDLED_ENTRY_CODE` but not for `OVEN_MARKER`.

## WITHDRAWN (was BLOCKER 3) → now MINOR: `strictNullChecks` in the parity test

I initially flagged this as a typecheck blocker:

```text
const resolved = installNativeLaunchers._testing.resolveBunExe(pkgRoot);
expect(resolved).not.toBeNull();
expect(existsSync(resolved)).toBe(true);
```

`expect(...).not.toBeNull()` does not narrow, so `resolved` stays
`string | null` where `existsSync` wants a `PathLike`.

**But it will NOT fail `npm run typecheck`.** `tsconfig.scripts.json` uses an
explicit `include` allowlist, and the launcher Bun suites are deliberately
absent from it:

```text
launcher-test-helpers.ts                       false
issue-2603-launcher.bun.test.ts                false
issue-2962-system-bun-preference.bun.test.ts   false
issue-2978-oven-fallback.bun.test.ts           false
ocr-canary-metrics.bun.test.ts                 true
```

So the new suite follows the established precedent for its siblings and is not
type-checked. (Note some `.bun.test.ts` files ARE included, so the exclusion is
specific to the launcher suites, not to `.bun.test.ts` as a class.)

Still worth fixing for correctness — Bun strips types at runtime, so a genuine
`null` would reach `existsSync` and throw an opaque `TypeError` instead of a
readable assertion failure. Narrow explicitly
(`if (resolved === null) throw new Error(...)`) rather than casting.

Also decide deliberately whether the new suite SHOULD be added to the
`tsconfig.scripts.json` include list. Following the sibling precedent (omit) is
defensible and is what the implementer did; adding it would require fixing the
narrowing first.

## BLOCKER 3 — root `package.json` coverage is unmet (CONFIRMED LIVE, not predicted)

Current working-tree state:

```text
CLI  @oven count: 16
ROOT @oven count: 0
CLI  versions unique: ["1.3.14"]
```

The implementer has already added all 16 entries to
`packages/cli/package.json` at the correct pin, but the root manifest still has
none. I confirmed the failure by executing the real
`checkWorkspaceDependencies` helper from
`scripts/tests/publish-dependency-helpers.ts` against the actual manifests:

```text
=== root WITHOUT @oven (current) ===
total mismatches: 26
@oven mismatches: 16
  - packages/cli: @oven/bun-darwin-aarch64 (optional) is not declared in root
    dependencies, optionalDependencies, or peerDependencies
  ... (all 16)

=== root WITH @oven at 1.3.14 (proposed, 2 entries added) ===
total mismatches: 24
@oven mismatches: 14
```

Adding exactly two entries to the root removed exactly those two mismatches
(`@oven/bun-windows-x64`, `@oven/bun-linux-x64`), so the fix is confirmed
linear and complete: **mirror all 16 into the root `optionalDependencies` at
`1.3.14`.**

Note the scan is MANIFEST-driven, not import-driven — despite the test name
("needed by shipped workspace source"), `checkWorkspaceDependencies` walks the
workspace manifest via `iterateWorkspaceDependencies`, which yields
`dependencies`, `optionalDependencies` AND `peerDependencies`. So the fact that
`@oven/*` is never `import`ed (it is resolved by filesystem path) does NOT
exempt it. I specifically checked this because the test name suggested it might.

Also extend the manifest-completeness test to assert BOTH manifests, so the
requirement is locked in rather than satisfied by accident.

(The 10 residual non-`@oven` mismatches in both runs are artifacts of the stub
`protocolResolver` I passed for the experiment — they appear identically in
both runs and are not a real regression.)

## MINOR

- `// eslint-env node` is a stale directive style for flat config; drop it.
- The "never lists an avx2 package for a non-avx2 host" test re-derives which
  packages are AVX2-only from package-name string heuristics
  (`name.endsWith('-x64')`, plus redundant `-darwin-x64` / `-windows-x64`
  clauses that the first clause already covers). Drive it from the parsed
  upstream table instead so it cannot silently pass on a renamed package.
- `parseUpstreamTable()` depends on the minified shape
  `platforms = [ ... ], supportedPlatforms = platforms.filter` inside
  `node_modules/bun/install.js`. That is intentional drift detection, but the
  `expect(rows.length).toBe(16)` assertion should carry a message explaining
  that a parse failure means bun's `install.js` shape changed, not that the
  table is wrong.

## Guard sweep — cleared (no action needed)

Every script/test that inspects `optionalDependencies` was checked against a
new external `@oven/*` block:

- `scripts/bind-release-deps.ts` includes `optionalDependencies` in
  `DEP_FIELDS`, but `rewriteDeps(...)` only rewrites names present in
  `npmReleasePackageSet` (the workspace packages). `@oven/*` is external, so
  release binding leaves it alone.
- `scripts/genai-enclave/manifest-enforcement.ts` and
  `scripts/check-genai-enclave.ts` scan all four dependency sections but only
  police `@google/genai`.
- `scripts/check-storage-package-cycle.ts` unions `optionalDependencies` into
  the graph; `@oven/*` has no workspace edges so it adds no cycle.
- `scripts/tests/bun-workspaces.test.ts`:
  - "keeps prebuilt-binary native deps declared but untrusted" iterates a fixed
    `PREBUILT_NATIVE_UNTRUSTED` list, so it does not pick up `@oven/*`.
  - "classifies every install-script package as trusted or reviewed-untrusted"
    reads `hasInstallScript: true` entries from `package-lock.json`. The
    `@oven/*` packages declare no install script (verified: 0 scripts, 0 `bin`
    fields), so they never enter the partition. `bun` itself is already in
    `trustedDependencies`. Re-verify after the lockfiles are regenerated.
  - "does not trust packages that are not real dependencies" only constrains
    the trust list, which we are not changing.

The only manifest guard that actually bites is the `publish-integrity.test.ts`
root-coverage rule (BLOCKER 4 above).

## Verified by independent execution — the table parser and selection rules

The riskiest part of the new suite is `parseUpstreamTable()`, which scrapes the
platform table out of minified `node_modules/bun/install.js`. I re-implemented
the parser and the reference selection standalone and ran it against the real
file (throwaway script, deleted after use):

```text
ROWS: 16
darwin   arm64  -        -    bun-darwin-aarch64           bin/bun
darwin   x64    -        avx2 bun-darwin-x64               bin/bun
darwin   x64    -        -    bun-darwin-x64-baseline      bin/bun
linux    arm64  -        -    bun-linux-aarch64            bin/bun
linux    x64    -        avx2 bun-linux-x64                bin/bun
linux    x64    -        -    bun-linux-x64-baseline       bin/bun
linux    arm64  musl     -    bun-linux-aarch64-musl       bin/bun
linux    x64    musl     avx2 bun-linux-x64-musl           bin/bun
linux    x64    musl     -    bun-linux-x64-musl-baseline  bin/bun
android  arm64  android  -    bun-linux-aarch64-android    bin/bun
android  x64    android  -    bun-linux-x64-android        bin/bun
freebsd  arm64  -        -    bun-freebsd-aarch64          bin/bun
freebsd  x64    -        -    bun-freebsd-x64              bin/bun
win32    x64    -        avx2 bun-windows-x64              bin/bun.exe
win32    x64    -        -    bun-windows-x64-baseline     bin/bun.exe
win32    arm64  -        -    bun-windows-aarch64          bin/bun.exe
```

Results, all 16 realistic host tuples:

```text
darwin/arm64/glibc/baseline  -> bun-darwin-aarch64
darwin/x64/glibc/avx2        -> bun-darwin-x64, bun-darwin-x64-baseline
darwin/x64/glibc/baseline    -> bun-darwin-x64-baseline
linux/arm64/glibc/baseline   -> bun-linux-aarch64
linux/arm64/musl/baseline    -> bun-linux-aarch64-musl, bun-linux-aarch64
linux/x64/glibc/avx2         -> bun-linux-x64, bun-linux-x64-baseline
linux/x64/glibc/baseline     -> bun-linux-x64-baseline
linux/x64/musl/avx2          -> bun-linux-x64-musl, bun-linux-x64-musl-baseline,
                                bun-linux-x64, bun-linux-x64-baseline
linux/x64/musl/baseline      -> bun-linux-x64-musl-baseline, bun-linux-x64-baseline
android/arm64/android        -> bun-linux-aarch64-android
android/x64/android          -> bun-linux-x64-android
freebsd/arm64/glibc          -> bun-freebsd-aarch64
freebsd/x64/glibc            -> bun-freebsd-x64
win32/x64/glibc/avx2         -> bun-windows-x64, bun-windows-x64-baseline
win32/x64/glibc/baseline     -> bun-windows-x64-baseline
win32/arm64/glibc/baseline   -> bun-windows-aarch64
```

Conclusions:

- The parser markers resolve (`platforms = [` at offset 9163, the
  `], supportedPlatforms = platforms.filter` terminator at 11155) and yield
  exactly 16 rows, so `expect(rows.length).toBe(16)` holds today.
- **No host tuple produces an empty candidate list**, so the fallback is
  reachable on every supported platform.
- The hardcoded expectation in the "orders musl variants before glibc" test
  (`musl, musl-baseline, x64, x64-baseline`) matches the derived order exactly.
- Every non-AVX2 host receives only `-baseline` packages, so the SIGILL guard
  holds and the string heuristic in the avx2 test — while ugly — does return
  `false` for all of them.

This retires the drift/parse risk. BLOCKERS 1 through 4 remain.

## Cheap CI gates pre-checked against the in-flight tree

Run locally while the implementer was still working, to catch gate failures
early rather than in CI:

```text
scripts/check-copyright-year.ts   EXIT=0
  "copyright-year guard passed: 2 added file(s) checked, all using 2026."
scripts/check-no-new-js-files.ts  EXIT=0
  "no-new-js guard PASSED: 11 JS/MJS files allowlisted, 11 tracked."
scripts/check-doc-placement.ts    EXIT=0
  "doc-placement guard PASSED"
```

So the two new `.ts` files carry correct 2026 headers, no stray `.js`/`.cjs`
slipped in (my throwaway `parser-check.cjs` was deleted before this ran), and
the `project-plans/issue2978/` docs are in the sanctioned location.

`bun test scripts/tests/bun-test-manifest.bun.test.ts` → **13 pass, 1 fail**.
The single failure is PRE-EXISTING and unrelated:

```text
(fail) preserves path, code, and cause for non-ENOENT stat failures
Expected: "/fixture/packages/core/src/utils/errors.test.ts"
Received: "\fixture\packages\core\src\utils\errors.test.ts"
```

It uses a synthetic `/fixture` root and `join()`, which yields backslashes on
Windows; it does not touch the `@oven` work and CI runs this on Linux. The
manifest-validation tests (which DO check that every registered path exists)
passed, confirming the new
`scripts/tests/issue-2978-oven-fallback.bun.test.ts` entry resolves correctly.

## Methodological caution — do NOT run the new suite until the agent finishes

I attempted `bun test scripts/tests/issue-2978-oven-fallback.bun.test.ts` and got:

```text
error: Unexpected }
    at packages/cli/scripts/install-native-launchers.cjs:515:1
 0 pass, 1 fail, 1 error
```

This is NOT a defect. `install-native-launchers.cjs` was being rewritten at
that instant (now 864 lines, 43 `oven` references, and it appeared as modified
in `git status` only on the re-check). A half-written file is a transient
snapshot, not a result.

Lesson for the rest of this task: while a subagent holds the working tree,
restrict verification to (a) read-only inspection, (b) guards that only read
files the agent is not touching, and (c) polling. Any test run spanning
in-flight files must be repeated after the agent returns before its output
means anything. The BLOCKER 1/2/3 findings above are unaffected because each
was established either by reading a finished file, by executing an isolated
snippet, or by running a helper against manifests rather than the agent's
in-flight source.

## Confirmed good

- `oven-bun-variants.ts` carries a 2026 copyright header.
- Selection is pure and injectable; host detection is isolated in
  `detectHostPlatform`, so the no-fork guarantee on the healthy path is
  structurally enforceable.
- The musl-first deviation is implemented in `abiSortKey` and documented at the
  point of deviation.
- The AVX2 filter (`row.avx2 !== true || host.avx2`) correctly makes it
  impossible for a baseline host to receive an AVX2 build (SIGILL guard).
- `scripts/bun-test-manifest.ts` registers the new suite as a Bun-native entry
  with its own workspace, matching the `issue-2962` precedent.
