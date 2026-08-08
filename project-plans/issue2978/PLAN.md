# PLAN-20260804-ISSUE2978 — Survive npm v12 default-deny of install scripts

Issue: #2978 — "npm v12 will block bun's postinstall, leaving bin/bun.exe
missing and llxprt unlaunchable"

Supersedes work item 3 (and part of work item 4) of
`project-plans/issue2962/PLAN.md`.

## Problem

`packages/cli/package.json` declares `"bun": "1.3.14"` as an ordinary
dependency. The `bun` npm package does not ship a binary. It ships:

    "scripts": { "postinstall": "node install.js" }
    "optionalDependencies": { "@oven/bun-<platform>": "1.3.14", ... }   # 16 of them

`install.js` selects the matching `@oven/bun-<platform>` package and **moves**
its binary into `bun/bin/bun.exe`. Verified on this machine:

| path | state |
|------|-------|
| `node_modules/bun/bin/bun.exe` | 98,480,216 bytes |
| `node_modules/@oven/bun-windows-x64/bin/` | **empty** (binary was moved out) |
| `node_modules/@oven/bun-windows-x64-baseline/bin/bun.exe` | 97,757,272 bytes (untouched) |

npm v12 flips `allowScripts` to off by default (GitHub changelog 2026-06-09,
npm RFC 0054). When that lands, `bun/bin/bun.exe` never materializes, all three
of our Bun resolvers fail, and `packages/cli/bin/llxprt` exits 43 with
"bundled Bun runtime was not found". The same already happens today under
`--ignore-scripts` and in locked-down CI.

## Fix

Declare the `@oven/bun-<platform>` packages as **our own**
`optionalDependencies` and teach every Bun resolver to fall back to
`@oven/bun-<platform>/bin/bun[.exe]`. Those tarballs contain only
`package/bin/bun`, `package/package.json`, `package/README.md` — **no scripts
at all** — so they materialize under default-deny.

`bun.lock` and `package-lock.json` already resolve all 16 variants
transitively at `1.3.14`, so this adds no new download for existing installs.

### Resolution precedence (unchanged where it already exists)

The macOS PATH-first behaviour from #2962 is **preserved verbatim and stays
first**. Per the project owner: *use the Bun on PATH by default, and only use
the bundle when that is not viable, at least on macOS.*

    0. macOS only: `bun` on PATH, if `bun --version` >= the pinned version   [#2962, unchanged]
    1. package-local   <pkg>/node_modules/bun/bin/bun.exe                     [unchanged]
    1b. package-local  <pkg>/node_modules/@oven/<variant>/bin/bun[.exe]       [NEW]
    2. hoisted         <enclosing-node_modules>/bun/bin/bun.exe               [unchanged]
    2b. hoisted        <enclosing-node_modules>/@oven/<variant>/bin/bun[.exe] [NEW]
    3. workspace root  <verified-root>/node_modules/bun/bin/bun.exe           [unchanged]
    3b. workspace root <verified-root>/node_modules/@oven/<variant>/bin/bun[.exe] [NEW]

`@oven` is probed **after** `bun/bin/bun.exe` within each boundary, so a
working install resolves on exactly the same path it does today and pays zero
additional cost. The boundary rules (never climb into consumer ancestors,
never scan `.bin` symlinks) are unchanged.

### Variant selection

`@oven` packages carry `os`/`cpu` fields, so npm installs every variant
matching the host — on linux/x64 that is four (`bun-linux-x64`,
`bun-linux-x64-baseline`, `bun-linux-x64-musl`, `bun-linux-x64-musl-baseline`).
Picking the wrong one is not a soft failure: an AVX2 build on a baseline CPU
dies with SIGILL, and a glibc build on musl fails to load. Selection must
therefore be deterministic, and it must mirror `node_modules/bun/install.js`.

Authoritative table transcribed from `bun@1.3.14`'s `install.js`:

| os | arch | abi | avx2 | package | exe |
|----|------|-----|------|---------|-----|
| darwin | arm64 | | | `bun-darwin-aarch64` | `bin/bun` |
| darwin | x64 | | yes | `bun-darwin-x64` | `bin/bun` |
| darwin | x64 | | | `bun-darwin-x64-baseline` | `bin/bun` |
| linux | arm64 | | | `bun-linux-aarch64` | `bin/bun` |
| linux | x64 | | yes | `bun-linux-x64` | `bin/bun` |
| linux | x64 | | | `bun-linux-x64-baseline` | `bin/bun` |
| linux | arm64 | musl | | `bun-linux-aarch64-musl` | `bin/bun` |
| linux | x64 | musl | yes | `bun-linux-x64-musl` | `bin/bun` |
| linux | x64 | musl | | `bun-linux-x64-musl-baseline` | `bin/bun` |
| android | arm64 | android | | `bun-linux-aarch64-android` | `bin/bun` |
| android | x64 | android | | `bun-linux-x64-android` | `bin/bun` |
| freebsd | arm64 | | | `bun-freebsd-aarch64` | `bin/bun` |
| freebsd | x64 | | | `bun-freebsd-x64` | `bin/bun` |
| win32 | x64 | | yes | `bun-windows-x64` | `bin/bun.exe` |
| win32 | x64 | | | `bun-windows-x64-baseline` | `bin/bun.exe` |
| win32 | arm64 | | | `bun-windows-aarch64` | `bin/bun.exe` |

Detection, as upstream implements it:

- `arch`: `process.arch`, except darwin+x64 under Rosetta 2
  (`sysctl -n sysctl.proc_translated` == `1`) which is treated as `arm64`.
- `avx2` (x64 only): linux → `/proc/cpuinfo` contains `avx2`;
  darwin → `sysctl -n machdep.cpu` contains `AVX2`;
  win32 → `IsProcessorFeaturePresent(40)`.
- `abi`: `android` on android; `musl` when `/etc/alpine-release` exists.

**One deliberate deviation from upstream.** Upstream filters with
`!platform.abi || abi === platform.abi`, so on a musl host the glibc entries
(which declare no `abi`) also match and, being listed earlier, sort ahead of
the musl builds. We invert that: on a musl host, musl variants are tried
**first**, with glibc variants retained only as a last resort. Upstream gets
away with it because its own postinstall already picked a working binary; we
are resolving from a directory where several variants coexist untouched.

Detection cost is paid **only on the `@oven` fallback path** — i.e. only when
`bun/bin/bun.exe` is absent. A normal install never forks `sysctl` or reads
`/proc/cpuinfo`.

## Scope

| # | Change | File |
|---|--------|------|
| 1 | Add the 16 `@oven/bun-*@1.3.14` `optionalDependencies` | `packages/cli/package.json` |
| 2 | `@oven` fallback in the POSIX launcher, within each existing boundary | `packages/cli/bin/llxprt` |
| 3 | `@oven` fallback in `resolveBunExe` | `packages/cli/scripts/install-native-launchers.cjs` |
| 4 | `@oven` fallback in the TypeScript resolver | `packages/cli/src/launcher/bun-path-resolver.ts` |
| 5 | Lifecycle-script audit against npm v12 default-deny | `scripts/postinstall.cjs`, `packages/cli/scripts/install-native-launchers.cjs` |
| 6 | Document the new candidate in the resolution order | `README.md`, `README_CN.md`, `docs/getting-started.md`, `CONTRIBUTING.md` |

Item 3 matters because npm v12's `allowScripts` is opt-in **per package**:
a user may allow ours while `bun`'s stays blocked, and `--ignore-scripts`
blocks both. The generated `.cmd`/`.ps1` bake a resolved Bun path, so
`resolveBunExe` must be able to produce an `@oven` path.

Item 5 has a known hard sub-problem: if **our** `postinstall` is also denied,
npm's `cmd-shim` generates `llxprt.cmd` from the `#!/bin/sh` shebang of
`bin/llxprt`, which invokes `sh` from `PATH` — absent on stock Windows.
There is only one `bin` field, so pointing it at a Node shim would put Node
startup cost on every POSIX launch too and regress #2999. This is under
analysis (deepthinker); if no option preserves the POSIX fast path, it is
documented here and split into a follow-up issue rather than solved by
regressing launch cost.

## Behavioral tests (dev-docs/RULES.md — no mock theater)

New Bun tests in TypeScript at `scripts/tests/issue-2978-oven-fallback.bun.test.ts`,
reusing `scripts/tests/launcher-test-helpers.ts`. Every test builds a real
directory layout on disk and spawns the real launcher; none mock the resolver.

1. **npm v12 shape starts.** Layout with `node_modules/bun/` present but
   `bun/bin/bun.exe` ABSENT (postinstall blocked) and
   `node_modules/@oven/<host-variant>/bin/bun` present and executable → the
   launcher execs it and the entry runs to exit 0.
2. **Bundled wins when both exist.** Both `bun/bin/bun.exe` and an `@oven`
   binary present → the bundled one is exec'd. Proven by making the two
   binaries observably different (the entry prints `process.execPath`), not by
   asserting on internals.
3. **Boundary is still enforced.** An `@oven` package outside the permitted
   boundaries (a consumer ancestor above the enclosing `node_modules`) is NOT
   accepted; the launcher exits 43.
4. **Pin is still enforced.** An `@oven` package whose `package.json` version
   does not match the pin is rejected → exit 43. Confirms
   `_llxprt_derive_bun_pkg` resolves `@oven/<pkg>/package.json` correctly from
   `.../bin/bun`.
5. **macOS PATH preference is untouched.** Re-assert (darwin-gated) that a
   satisfying PATH Bun is still preferred over both the bundled binary and any
   `@oven` fallback — the #2962 contract must not regress.
6. **Variant ordering is safe.** The candidate list for a given
   (os, arch, abi, avx2) tuple matches the upstream table, and on a musl host
   musl variants precede glibc. Asserted against the real table by driving the
   selection function over each tuple.
7. **Emptied `@oven` bin is skipped.** With the host variant's `bin/`
   emptied (exactly the post-`install.js` state) and a second valid variant
   present, resolution does not select the empty one.
8. **Manifest completeness.** `packages/cli/package.json`'s
   `optionalDependencies` contain every one of the 16 packages in bun's table
   at the pinned version — read from `node_modules/bun/install.js` at test
   time so the two cannot drift.
9. **`resolveBunExe` parity.** `install-native-launchers.cjs` resolves the
   same `@oven` binary from the same npm-v12-shaped layout.

## Constraints

- No new `.js` files; new tests are Bun tests in TypeScript.
- No new `eslint-disable`, `ts-ignore`, `ts-expect-error`, `ts-nocheck`; no
  loosening of complexity or size thresholds.
- The launcher stays POSIX `sh` and must keep passing `shellcheck` clean
  (`scripts/tests/issue-2603-launcher.bun.test.ts`).
- The whole `issue-2603-*` and `issue-2962-*` suites must keep passing
  unchanged — no existing launcher behaviour may regress.
- Copyright headers on new files: **2026**.
- Verification before push: `npm run test`, `npm run lint`, `npm run typecheck`,
  `npm run format`, `npm run build`, and
  `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
