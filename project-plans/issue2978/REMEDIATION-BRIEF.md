# Issue #2978 — remediation brief

The previous implementation run timed out mid-flight. Roughly 70% of the scope
landed and is good; the rest is unstarted. This brief lists exactly what is
done, what regressed, and what remains.

## State of the working tree (verified)

Landed and CORRECT — do not redo:

- `packages/cli/package.json` — all 16 `@oven/bun-*` in `optionalDependencies`
  at `1.3.14`, in upstream table order.
- `packages/cli/src/launcher/oven-bun-variants.ts` — pure, injectable
  selection module. 2026 header. AVX2 filter and musl-first deviation both
  correct.
- `packages/cli/scripts/install-native-launchers.cjs` — `node --check` passes.
- `packages/cli/bin/llxprt` — `@oven` fallback added inside each boundary. No
  CRLF. 644 lines. The magic-byte validation block (lines ~598-631) is intact
  and still correct per platform.
- `scripts/bun-test-manifest.ts` — new suite registered.
- `scripts/tests/issue-2978-oven-fallback.bun.test.ts` — written (see blockers).

## BLOCKER 0 (NEW, CI-RED) — `_llxprt_probe_oven` breaks two #2603 tests

Measured on this machine, `bun test scripts/tests/issue-2603-launcher.bun.test.ts`:

- HEAD baseline: 6 pass / 27 fail
- With the change: 4 pass / 29 fail

The 27 shared failures are the pre-existing Windows limitation (spawning a
POSIX `sh` script; `spawn failed: Executable not found in $PATH`). Those run on
ubuntu in CI and are not our concern. But **two source-structure tests, which
only read the launcher text and therefore run everywhere, newly regressed**:

- `exits 43 when Bun has wrong magic bytes (not ELF/Mach-O/PE)`
- `magic case-statement accepts the correct native format per platform`

Root cause is a textual token collision, not a logic error. The helper is:

```text
function launcherMagicBlockAfter(marker: string): string {
  const source = readFileSync(launcherPath, 'utf8');
  const start = source.indexOf(marker);
  const magicStart = source.indexOf('case "$_llxprt_magic"', start);
  ...
}
```

It takes the FIRST occurrence of the marker. `_llxprt_probe_oven` introduced a
new `case` at line 366 whose labels include `Darwin)` (line 367) and
`Linux)` (368) — earlier in the file than the real magic block at ~615.
`launcherMagicBlockAfter('Darwin')` now returns the **MINGW** block, so the
test sees `4d5a*` where it expects `feedface`.

The markers the test greps are exactly: `'MINGW*|MSYS*|CYGWIN*'`, `'Darwin'`,
and `'Linux and other ELF'`.

### Required fix (in the launcher, NOT the test)

Two independent improvements, both in `_llxprt_probe_oven`:

1. **Reuse `$_llxprt_kernel` instead of re-forking `uname -s`.** Line 241
   already does `_llxprt_kernel=$(uname -s 2>/dev/null || printf '%s' '')`, and
   it is reused at line 324 and line 600. Line 366 forks `uname -s` a second
   time. Since this is the fallback path the fork is not fatal, but it is
   redundant and inconsistent with the file's own idiom.
2. **Use glob labels so the tokens no longer collide**, e.g.

```text
  _llxprt_po_os=""
  case "$_llxprt_kernel" in
    Darwin*)  _llxprt_po_os=darwin ;;
    Linux*)   _llxprt_po_os=linux ;;
    FreeBSD*) _llxprt_po_os=freebsd ;;
    CYGWIN*|MINGW*|MSYS*) _llxprt_po_os=win32 ;;
    *) return 1 ;;
  esac
```

`Darwin*`, `Linux*` and the reordered `CYGWIN*|MINGW*|MSYS*` are all textually
distinct from the three markers above, so the first match for each marker goes
back to the real magic block. The globs are semantically equivalent for the
values `uname -s` actually returns.

After the fix, `issue-2603-launcher.bun.test.ts` must return to **6 pass** on
Windows (27 fail, all pre-existing spawn failures). Verify that exact count.

## BLOCKER 1 (CI-RED) — `makeEntry` is passed a marker, not code

`launcher-test-helpers.ts`:

```text
export function makeEntry(pkgRoot: string, code: string): void {
  writeFileSync(join(pkgRoot, 'index.ts'), `#!/usr/bin/env -S bun\n${code}\n`);
}
```

The second argument is entry SOURCE, written verbatim. The test defines
`BUNDLED_ENTRY_CODE` correctly but has no equivalent for `OVEN_MARKER`, and
passes the bare marker at: `makeNpmV12Layout(tempDir, OVEN_MARKER)` (three
tests) and `makeEntry(pkgRoot, OVEN_MARKER)` (the hoisted-binary test). The
generated `index.ts` is then the bare identifier `OVEN_BUN_RAN_ENTRY`, a
`ReferenceError` — exit 1, empty stdout — so every `expectExitOk` plus
`toContain(OVEN_MARKER)` pair fails.

Fix: add ``const OVEN_ENTRY_CODE = `console.log('${OVEN_MARKER}');`;`` and pass
it wherever the entry must execute. Keep the bare marker only for `toContain`.

## BLOCKER 2 (CI-RED) — root `package.json` coverage

`scripts/tests/publish-integrity.test.ts` ("declares runtime dependencies
needed by shipped workspace source") requires every external dep of a shipped
workspace to be covered by the ROOT manifest.
`scripts/tests/publish-dependency-helpers.ts:214-219` accepts an optional
workspace dep from the root's `dependencies` OR `optionalDependencies`. This is
why the root already mirrors `bun: 1.3.14`.

Verified now: **ROOT `@oven` count is 0** while `packages/cli` has 16 → 16
mismatches. Mirror all 16 at `1.3.14` into the root `optionalDependencies`
(merge into the existing block, do not replace it). No `trustedDependencies`
change is needed — the `@oven` packages declare no install script.

Then extend the manifest-completeness test to assert BOTH manifests so this is
locked in rather than satisfied by accident.

## BLOCKER 3 (CI-RED) — `strictNullChecks` violation

```text
const resolved = installNativeLaunchers._testing.resolveBunExe(pkgRoot);
expect(resolved).not.toBeNull();
expect(existsSync(resolved)).toBe(true);
```

`expect(...).not.toBeNull()` does not narrow for TypeScript. `resolved` is
`string | null` and `existsSync` takes `PathLike`. Narrow explicitly
(`if (resolved === null) throw new Error(...)`), do not cast.

## UNSTARTED SCOPE (verified zero `oven` references in each)

- `packages/cli/src/launcher/bun-path-resolver.ts` — add `@oven` candidates to
  the ancestor scan, AFTER the existing `.bin` and `node_modules/bun/bin`
  candidates at each ancestor and BEFORE the PATH fallback. On Windows classify
  as `direct-native` in `bun-candidate-policy.ts` terms. Preserve the existing
  `bin-native` > `direct-native` > `path-native` > `wrapper` ordering.
- Lockfiles — refresh with plain `bun install`. Never `--frozen-lockfile`
  (structurally unusable here; CI itself runs plain `bun install` then
  `git checkout -- bun.lock`).
- Docs — `README.md`, `README_CN.md` (Chinese), `docs/getting-started.md`,
  `CONTRIBUTING.md`: document the new `@oven/bun-<platform>` candidate in the
  Bun resolution order and why it exists (npm v12 default-deny of install
  scripts, RFC 0054).

## Quality items

- Gate the launcher-behavior and `resolveBunExe`-parity describes on
  `process.platform !== 'win32'`, using the existing idiom
  `const describePosixOnly = process.platform === 'win32' ? describe.skip : describe;`
  (cf. `describeDarwinOnly` in `issue-2962-system-bun-preference.bun.test.ts:46`).
  This is DX only — those suites run on ubuntu in CI — but it stops the suite
  red-failing for every Windows contributor.
- Drop the stale `// eslint-env node` directive (wrong style for flat config).
- Drive the "never lists an avx2 package" test from the parsed upstream table
  rather than package-name string heuristics.
- Add a failure message to `expect(rows.length).toBe(16)` explaining that a
  parse failure means bun's `install.js` shape changed.

## Non-regression invariants

- The #2962 macOS PATH-first block stays FIRST and textually unmoved.
  `issue-2962-system-bun-preference.bun.test.ts` currently passes (1 pass /
  6 skip on Windows) — keep it that way.
- `@oven` is probed only AFTER `bun/bin/bun.exe` within each boundary.
- No host detection (`uname`, `sysctl`, `/proc/cpuinfo`, PowerShell) on the
  healthy path.
- Launcher stays POSIX `sh`, shellcheck-clean, `_llxprt_` prefix, `-- `
  end-of-options, exit 43.
- No new `eslint-disable` / `ts-ignore` / `ts-expect-error` / `ts-nocheck`.
- No new `.js`/`.cjs` files. 2026 headers on new files.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

Plus specifically: `scripts/tests/issue-2603-launcher.bun.test.ts` (must return
to 6 pass on Windows), `issue-2962-system-bun-preference.bun.test.ts`,
`publish-integrity.test.ts`, `bun-workspaces.test.ts`, and the new
`issue-2978-oven-fallback.bun.test.ts`.

Note: `*.bun.test.ts` runs in CI only via `ci.yml:829 bun_native_test_parity`
on ubuntu-latest (`bun scripts/run_bun_tests.ts --timeout 30000`). Vitest skips
`*.bun.test.ts` per issue #2475.
