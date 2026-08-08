# Evidence log — issue #2978

Machine-verified facts gathered on win32/x64 before implementation. Every claim
below was produced by a command against this checkout, not inferred.

## 1. `bun` requires a blocked install script; `@oven` does not

From `package-lock.json`:

| fact | value |
|------|-------|
| `node_modules/bun` `hasInstallScript` | **true** (blocked by npm v12 default-deny) |
| `node_modules/bun` `bin` | `{ bun: "bin/bun.exe", bunx: "bin/bunx.exe" }` |
| `node_modules/bun` optionalDependencies | 16 |
| `@oven/bun-*` packages in lock | 16 |
| `@oven/bun-*` with `hasInstallScript` | **0** |
| `@oven/bun-*` declaring a `bin` field | **0** |
| `@oven/bun-*` with integrity hash + `os`/`cpu` | all 16 |

Consequences:

- `bun/bin/bun.exe` exists ONLY because a postinstall ran.
- `@oven` packages materialize fine under default-deny.
- `@oven` packages get NO `node_modules/.bin` shim, so they must be resolved by
  explicit path — `require.resolve` of a bin name cannot find them.
- Promoting them to our own `optionalDependencies` adds no new download: they
  are already locked at `1.3.14` with integrity hashes.

## 2. bun's postinstall empties the selected platform package

    node_modules/bun/bin/bun.exe                        98,480,216 bytes
    node_modules/@oven/bun-windows-x64/bin/             EMPTY (moved out)
    node_modules/@oven/bun-windows-x64-baseline/bin/    97,757,272 bytes (untouched)

Only host-matching variants are installed (2 here). The emptied directory is the
normal post-`install.js` state and resolution must skip it.

## 3. `@oven` package.json carries the pinned version

    @oven/bun-windows-x64           version=1.3.14  scripts=null
    @oven/bun-windows-x64-baseline  version=1.3.14  scripts=null

This matches the `bun` pin in `packages/cli/package.json`, so the launcher's
existing strict `_llxprt_bun_validates` exact-pin check passes for `@oven`
candidates unmodified: `_llxprt_derive_bun_pkg` maps `.../bin/bun[.exe]` two
directories up, which lands on `@oven/<pkg>/package.json`.

## 4. The upstream platform table extracts cleanly (16/16)

Machine-parsed from `node_modules/bun/install.js`, confirming the drift-proof
manifest test is implementable:

    darwin  arm64  -       -      bun-darwin-aarch64           bin/bun
    darwin  x64    -       avx2   bun-darwin-x64               bin/bun
    darwin  x64    -       -      bun-darwin-x64-baseline      bin/bun
    linux   arm64  -       -      bun-linux-aarch64            bin/bun
    linux   x64    -       avx2   bun-linux-x64                bin/bun
    linux   x64    -       -      bun-linux-x64-baseline       bin/bun
    linux   arm64  musl    -      bun-linux-aarch64-musl       bin/bun
    linux   x64    musl    avx2   bun-linux-x64-musl           bin/bun
    linux   x64    musl    -      bun-linux-x64-musl-baseline  bin/bun
    android arm64  android -      bun-linux-aarch64-android    bin/bun
    android x64    android -      bun-linux-x64-android        bin/bun
    freebsd arm64  -       -      bun-freebsd-aarch64          bin/bun
    freebsd x64    -       -      bun-freebsd-x64              bin/bun
    win32   x64    -       avx2   bun-windows-x64              bin/bun.exe
    win32   x64    -       -      bun-windows-x64-baseline     bin/bun.exe
    win32   arm64  -       -      bun-windows-aarch64          bin/bun.exe

## 5. Windows: npm's cmd-shim bakes the literal shebang path

The npm-generated `node_modules/.bin/llxprt.cmd` on this machine, i.e. what a
user gets when our postinstall does NOT run:

    IF EXIST "%dp0%\/bin/sh.exe" (
      SET "_prog=%dp0%\/bin/sh.exe"
    ) ELSE (
      SET "_prog=/bin/sh"
      SET PATHEXT=%PATHEXT:;.JS;=;%
    )
    ... & "%_prog%"  "%dp0%\..\@vybestack\llxprt-code\bin\llxprt" %*

It uses the literal `/bin/sh` from our shebang, not a bare `sh` PATH lookup.
On stock Windows this cannot launch. Under npm v12 our postinstall no longer
replaces this shim, so the CLI is unlaunchable on Windows.

By contrast, `node_modules/.bin/bun.cmd` — whose bin target is a native `.exe` —
has no interpreter indirection at all:

    "%dp0%\..\bun\bin\bun.exe"   %*

cmd-shim only injects an interpreter when the target has a shebang. That
asymmetry is the only real hook for keeping POSIX on the fast `sh` path while
making Windows work without a lifecycle script.

## 6. Where the end-to-end launcher proof must run

An attempt to drive `packages/cli/bin/llxprt` end-to-end on this win32 host via
Git for Windows `sh` was abandoned as invalid rather than reported as a result.
Two harness defects, neither of them in the code under test:

- bare `C:\Program Files\Git\usr\bin\sh.exe` has no `uname`, `od`, `sed`, `tr`
  etc. on PATH, so the launcher's kernel detection and magic-byte check cannot
  run (`uname: command not found`, exit 127);
- PowerShell `Set-Content` rewrote the extracted script with CRLF endings.

Even with both fixed, MSYS hands `/c/...`-style paths to a native `bun.exe`,
which is a different failure mode than the one under test. This is why the
repo's existing launcher suite is gated to ubuntu-latest (see the
`itNeedsSymlinks` comment in `scripts/tests/issue-2603-launcher.bun.test.ts`).

Exit-code propagation through Git `sh` was confirmed working (`sh -c 'exit 43'`
-> 43), so the abandoned harness is not evidence of anything about exit 43.

The end-to-end RED/GREEN proof therefore belongs in
`scripts/tests/issue-2978-oven-fallback.bun.test.ts` running in Linux CI, not in
a local Windows harness. The facts in sections 1-5 are the novel claims and each
is verified directly.

## 7. Pre-change baseline for `resolveBunExe`

    resolveBunExe(packages/cli) = <repo>/node_modules/bun/bin/bun.exe

Resolved via the ancestor walk to the hoisted Bun. This must stay byte-identical
after the change whenever that file exists; `@oven` may only be reached when it
does not.

## 8. Root manifest must mirror the new optional deps (predicted CI failure)

Verified state of the root manifest before the change:

```text
ROOT dependencies.bun            = 1.3.14
ROOT optionalDependencies.bun    = undefined
ROOT has optionalDependencies    = true
ROOT @oven entries               = 0
ROOT trustedDependencies has bun = true
```

`scripts/tests/publish-integrity.test.ts` (test: "declares runtime dependencies
needed by shipped workspace source") requires every external dependency of a
shipped workspace to be covered by the ROOT manifest with a compatible semver
range. `packages/cli` is a shipped workspace, and `isRootSectionAdequate`
(`scripts/tests/publish-dependency-helpers.ts:214-219`) accepts an optional
workspace dep only from the root's `dependencies` or `optionalDependencies`:

```text
// Optional workspace deps can be in either root section.
return (
  rootSection === 'dependencies' || rootSection === 'optionalDependencies'
);
```

This is precisely why the root already mirrors `bun: 1.3.14`. Therefore adding
the 16 `@oven/bun-*` entries to `packages/cli` `optionalDependencies` WITHOUT
also adding them to the root `optionalDependencies` will fail this test.

**Required:** mirror all 16 `@oven/bun-*` at `1.3.14` into root
`optionalDependencies`.

No trust change is needed: the `@oven` packages declare no install script, so
`bun-workspaces.test.ts` ("classifies every install-script package as trusted or
reviewed-untrusted") is unaffected, and `bun` itself is already in
`trustedDependencies`.
