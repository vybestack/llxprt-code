# PLAN-20260803-ISSUE2999 — Ship a prebuilt CLI bundle

Issue: #2999 — "raw-TS distribution costs 5.2s of startup per launch"

## Symptom

Agent launchers spawning `llxprt` regularly exceed a 20-second timeout on
Windows. Headless startup measures 5,244 ms before any application work runs.

## Root cause (measured, not inferred)

The published package ships raw TypeScript. Bun resolves, transpiles, and
evaluates **4,274 modules on every launch**.

| Path | Time |
| --- | --- |
| `bun -e "1"` (runtime baseline) | 73 ms |
| `import('<pkg>/src/cli.js')` alone | 5,185 ms |
| headless `--profile-load X --prompt` | 5,244 ms |
| same code, bundled, same `bun.exe` | **449 ms** |

97% of startup is module-graph cost. Bundling removes it (11.7x).

Ruled out by measurement:

- The Windows `llxprt.cmd` shim is native and execs `bun.exe` directly. No
  MSYS/`sh` overhead. The heavy POSIX `bin/llxprt` script is not used on Windows.
- Bun's runtime transpiler cache caches only 36 of 4,274 files (size threshold).
  No improvement.

Amplifiers: Defender scans all 4,274 reads; concurrent agent launches each run
their own I/O storm. Raw-TS launches vary 3,239–5,250 ms; bundled runs are flat.

## Design

Build the bundle **at publish time**, ship it prebuilt.

This preserves what #2305 ("No-compile npm runtime") actually wanted — the user
compiles nothing at install time, `npm install` runs no `tsc`, Bun still runs
the CLI — while removing 4,274 per-launch resolutions. "No compile on the
user's machine" and "no build artifact anywhere" are different requirements;
only the first was the objective.

TypeScript stays the source of truth. `packages/*/src/` is unchanged. The
bundle is a gitignored publish artifact (`bundle` and `dist` are already in
`.gitignore`), not checked-in JavaScript, so the no-new-`.js`-source rule holds.

### Entry precedence

Every launch path resolves in this order:

1. `LLXPRT_FORCE_SOURCE_ENTRY=1` set → source `index.ts` (debugging escape hatch)
2. prebuilt bundle, if present → bundle
3. otherwise → source `index.ts`

Fallback is mandatory: source checkouts and dev runs have no bundle and must
keep working unchanged.

### Surfaces to change

| Surface | Change |
| --- | --- |
| `scripts/bun-build.config.ts` | add a CLI bundle target beside the existing a2a-server one, reusing its `EXTERNALS` list |
| `packages/cli/src/launcher/bun-entry-resolver.ts` | add bundle candidate ahead of the existing source→dist chain |
| `packages/cli/bin/llxprt` | resolve bundle before `_llxprt_entry="$_llxprt_pkg_root/index.ts"` (lines 243, 316, 460) |
| `packages/cli/scripts/install-native-launchers.cjs` | generated `.cmd`/`.ps1` prefer the bundle (entry at line 395) |
| root `package.json` | `files` ships the bundle; `prepack` builds it; stop shipping `*.test.*`/`*.spec.*` |

### Externals

Reuse the established `EXTERNALS` in `scripts/bun-build.config.ts`. Verified
working: native `.node` addons, `@ast-grep/*`, `@lydell/node-pty*`, `node-pty`,
`@napi-rs/keyring`, `chokidar`, `@vybestack/llxprt-ui`,
`@vybestack/opentui-core`, `@vybestack/opentui-react`, `node:module`.

Proven command:

```
bun build packages/cli/index.ts --target=bun --outfile bundle/llxprt.js \
  --external @lydell/node-pty --external node-pty --external @napi-rs/keyring \
  --external "@ast-grep/*" --external chokidar \
  --external @vybestack/llxprt-ui --external @vybestack/opentui-core \
  --external @vybestack/opentui-react
```

Result: `Bundled 4274 modules in 21311ms`, 20.15 MB, clean.

## Test-first sequence

Per `dev-docs/RULES.md`: every change lands behind a failing behavioral test.
Bun tests, TypeScript only. No mock theater — assert observable behavior
(resolved paths, process output, tarball contents), never call counts.

### T1 — entry resolver prefers the bundle

RED: `bun-entry-resolver` returns the bundle path when a bundle file exists.
Drive via the existing injectable `pathChecker`/`moduleDir` options; no mocking
framework needed.

Cases:
- bundle present → bundle path
- bundle absent → source `index.ts` (existing behavior preserved)
- bundle present but `LLXPRT_FORCE_SOURCE_ENTRY=1` → source
- neither present → `null`

### T2 — the bundle actually runs (the real proof)

RED: build the CLI bundle, execute it with the repo's Bun, assert it prints the
version from `package.json` and exits 0.

This is the anti-mock-theater test: it proves externals resolve, no
top-level-await breakage, and the artifact is genuinely launchable. Gate on an
env flag if the ~21s build makes it unsuitable for the default shard, but it
must run somewhere in CI.

### T3 — launcher scripts prefer the bundle with fallback

RED: extend the existing launcher harness
(`scripts/tests/launcher-test-helpers.ts`, `issue-2603-launcher.bun.test.ts`)
with fixtures where the bundle is present vs absent, asserting which entry the
launcher execs. Cover the POSIX script and the generated `.cmd`/`.ps1`.

### T4 — publish integrity

RED: extend `scripts/tests/publish-integrity.test.ts`:
- the bundle is present in `npm pack --dry-run --json` output
- no `*.test.*` / `*.spec.*` file appears in the tarball (currently 198 do)

### T5 — startup does not regress

RED: a smoke assertion that the bundled entry starts materially faster than the
raw-TS entry. Keep the threshold loose (order-of-magnitude, not 449 ms) so it
is not flaky on shared runners. Record real before/after numbers on Windows,
macOS, and Linux in the issue.

## Risks

- **`prepack` cost.** `npm pack` currently runs only `generate-git-commit-info`.
  Adding a ~21s bundle makes every pack slower, including any CI test that packs.
  Measure; if it lands on the PR path, move bundle generation to the release
  workflow and have `prepack` verify presence rather than build.
- **Externals drift.** A new native dependency not in `EXTERNALS` will bundle
  incorrectly and fail only at runtime. T2 is the guard.
- **`import.meta`/`__dirname` in a bundle.** The a2a-server config needs a
  `createRequire` banner. The CLI may need equivalent handling; T2 surfaces it.
- **Prompt/asset loading by path.** Anything resolving files relative to source
  layout can break when the entry moves. T2 surfaces the common cases.
- **Stale bundle shadowing source in dev.** Mitigated by precedence order plus
  `LLXPRT_FORCE_SOURCE_ENTRY`; `bundle` is gitignored so it never gets committed.

## Coordination

- **#2983** — keep the publish bundle strictly separate from the declaration
  build. Do not touch `build_package.ts` / `copy_files.ts`. `emitDeclarationOnly`
  stays valid: distribution consumes a bundle, still not `dist/`.
- **#2978** — same launcher files. That issue changes *which bun* is resolved;
  this changes *which entry* it execs. Sequence to avoid conflict.
- **#2358** — the Rust launcher should target the bundle.
- **#2702** — bundle generation must stay off the PR path.

## Acceptance criteria

- [ ] Published tarball contains a prebuilt CLI bundle
- [ ] `npm install` performs zero compilation on the user's machine
- [ ] Windows headless startup at or under ~1s (from 5,244 ms), recorded in #2999
- [ ] macOS and Linux before/after recorded; no regression
- [ ] Raw-TS fallback works when the bundle is absent
- [ ] `bun packages/cli/index.ts` dev workflow unchanged
- [ ] Test/spec files no longer shipped
- [ ] Publish-integrity test asserts bundle presence and launchability
- [ ] Native externals load: node-pty, keyring, `@ast-grep/*`, opentui/UI
- [ ] No PR-path CI time added
- [ ] No new lint suppressions or rule relaxations
- [ ] Full verification passes: test, lint, typecheck, format, build
