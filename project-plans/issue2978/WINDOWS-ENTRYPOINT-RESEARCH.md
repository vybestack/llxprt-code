# Windows entry-point research (#2978 follow-up)

Status: research complete; design implemented and shipped on this branch (see "What shipped" below).

This is the follow-up problem uncovered while fixing #2978. It is a **separate
change from the `@oven/bun-<platform>` fallback**, which stands alone and is green.

## Problem

npm v12 (RFC 0054) defaults to denying dependency install scripts. That breaks
two separate things:

1. **bun's** postinstall never materializes `node_modules/bun/bin/bun[.exe]` —
   this is what #2978 reports, and the `@oven` optional-dependency fallback fixes it.
2. **our own** postinstall (`packages/cli` -> `node scripts/install-native-launchers.cjs`)
   never runs, so the generated Windows launchers never appear and Windows falls
   back to npm's cmd-shim.

Only (2) is in scope here.

## Confirmed: bin linking is NOT gated

From the v12 arborist:

```
if (key !== 'bin' && !scriptsAllowed) { continue }
```

with the comment "Bin linking is not gated." `scriptsAllowed` is
`dangerouslyAllowAllScripts || node.isLink || node.isWorkspace || isScriptAllowed(...) === true`.

Corroborated by npm/cli bug #9681 (denied scripts wrongly dropped `.bin` links)
and fix PR #9682.

**Consequence:** npm always creates `llxprt`, `llxprt.cmd`, `llxprt.ps1` for us.
We never needed a postinstall to *have* an entry point — only to have an
optimized native one. `isLink`/`isWorkspace` also bypass the gate, so monorepo
dev installs and `npm link` are unaffected; only registry consumers are hit,
which is why this went unnoticed.

## Measured cmd-shim matrix

npm 11.16.0, `C:/Program Files/nodejs/node_modules/npm/node_modules/cmd-shim`.
The probe script was throwaway and has been deleted; this table is the record.

| shebang / target | generated `.cmd` | generated `.ps1` | verdict |
| --- | --- | --- | --- |
| `#!/bin/sh` (what we ship today) | `IF EXIST "%dp0%\/bin/sh.exe"` ... `ELSE SET "_prog=/bin/sh"` | `Test-Path "$basedir//bin/sh$exe"` ... else `& "/bin/sh$exe"` | **BROKEN on Windows** |
| `#!/usr/bin/env node` | `IF EXIST "%dp0%\node.exe"` ... `ELSE SET "_prog=node"` | `$basedir/node$exe` ... else `node$exe` | **WORKS** — node guaranteed present since npm ran |
| `#!/usr/bin/env bun` | `IF EXIST "%dp0%\bun.exe"` ... `ELSE SET "_prog=bun"` | `$basedir/bun$exe` ... else `bun$exe` | only if `bun.exe` is beside the shim or on PATH |
| no shebang | `"%dp0%\..\<pkg>\bin\<file>" %*` (direct exec) | `& "$basedir/../<pkg>/bin/<file>" $args` | fails for an extensionless file |
| native `.exe` target | `"%dp0%\..\<pkg>\bin\prog.exe" %*` | `& "$basedir/../<pkg>/bin/prog.exe" $args` | works on Windows, but a committed `.exe` is not POSIX-executable |

### `#!/usr/bin/env bun` is circular and non-viable

Measured manifests:

- `bun` -> `bin: {"bun":"bin/bun.exe","bunx":"bin/bunx.exe"}`, `scripts: {"postinstall":"node install.js"}`.
  Postinstall blocked => `bin/bun.exe` never exists => dangling bin link.
- `@oven/bun-windows-x64` -> `bin: undefined`, `scripts: {}` (os `["win32"]`)
  => contributes **no** bin link at all.

So bun is absent from both `.bin` and PATH precisely in the scenario being fixed.

## Ecosystem precedent sweep

Checked `bin` / `os` / `scripts` for: `esbuild`, `@esbuild/win32-x64`, `rollup`,
`@rollup/rollup-win32-x64-msvc`, `sharp`, `@img/sharp-win32-x64`, `turbo`, `@swc/core`.

**Result: no platform/optional package declares a `bin`.** The parent package
owns the single bin; platform packages are pure payload.

So there is **zero precedent** for per-OS `optionalDependencies` each declaring
the same bin name. **This observation was not sufficient grounds to refuse the
approach.** Absence of precedent is not evidence of non-viability, and direct
empirical testing on win32 (see "Decisive prototype" and "What shipped" below)
proved the pattern works: `npm install` with two `os`-filtered children each
declaring `bin.llxprt` exits 0 with no collision or warning. The earlier
"refuted for zero ecosystem precedent" conclusion was reversed on that evidence
— the empirical result beat the precedent argument.

## What esbuild actually does

`node_modules/esbuild/bin/esbuild` is a `#!/usr/bin/env node` ~9KB Node
bootstrap that resolves its platform binary out of optionalDependencies and
execs it.

esbuild also still ships a postinstall, but `install.js` contains a
`maybeOptimizePackage()` that hardlinks the native binary to a temp path and
`renameSync`s it **over** `bin/esbuild`, replacing the JS shim with the real
binary.

That yields graceful degradation:

- scripts allowed -> postinstall swaps in the native binary -> **zero overhead**
- scripts denied (npm v12 default) -> the `env node` bootstrap carries it -> correct, ~30-40ms

## Options

1. **Single `#!/usr/bin/env node` bootstrap on all platforms**, optionally plus
   postinstall-as-optimization to recover POSIX speed. Matches esbuild exactly.
   **NOT recommended** — see correction below.
2. Per-OS `optionalDependencies` each declaring their own `bin` so POSIX keeps
   the existing `sh` path. **PROVEN VIABLE — recommended.** See prototype below.
3. Ship as-is and document `allowScripts`. Weak: opt-in, defeats the purpose.

## CORRECTION: POSIX is not broken and must not be changed

`packages/cli/bin/llxprt` is a 649-line, 27KB POSIX shell script that already
performs symlink resolution and bun discovery. It is already a complete
bootstrap, written in `sh`.

Under npm v12 on macOS/Linux: npm symlinks `.bin/llxprt` to it, the OS honours
`#!/bin/sh`, the script locates bun under `node_modules/@oven/...` and execs it.
**This works today with zero scripts and zero node.**

Only **Windows** is broken, because Windows has no OS-level shebang support and
npm's cmd-shim translates `#!/bin/sh` into a `.cmd` that invokes `/bin/sh`.

Option 1 would therefore regress a working, node-free POSIX path in order to fix
Windows. That is the wrong trade for a project migrating to bun.

npm imposes no constraint that a bin be JS. The only real constraint is: **on
Windows, the interpreter named in the shebang must be resolvable at runtime.**
`bun` is not (npm writes shims, not binary copies, into `.bin`, and bun's own
binary is never downloaded under v12), so on Windows `node` is the only
guaranteed interpreter.

## Prototype: option 2 verified end-to-end

Throwaway fixture under `%TEMP%/optprobe`, since deleted. Parent declared two
`optionalDependencies` via `file:` refs, both declaring the **same** bin name
`probecmd`:

- `probe-posix` — `os: ["darwin","linux"]`, bin -> `bin/probecmd` (`#!/bin/sh`)
- `probe-win` — `os: ["win32"]`, bin -> `bin/probecmd.mjs` (`#!/usr/bin/env node`)

Results on win32 / npm 11.16.0:

```
npm install            -> "added 1 package"
node_modules           -> ["probe-win"]          (probe-posix correctly skipped)
node_modules/.bin      -> ["probecmd","probecmd.cmd","probecmd.ps1"]
run probecmd.cmd       -> "win-stub-ran"
```

**No bin-name collision, no error, no warning.** The `os` field performs the
selection, so only one child is ever present on a given machine and only that
child contributes the bin.

## Better: a native `.cmd` on Windows removes node entirely

A node stub is not required on Windows either. npm accepts a `.cmd` file as a
bin target. Verified with a second throwaway fixture (`%TEMP%/cmdprobe`, since
deleted):

- `cmd-win` — `os: ["win32"]`, `bin: { cmdprobe: "bin/llxprt.cmd" }`
- `bin/llxprt.cmd` is a plain batch file, no shebang

```
npm install        -> ok
node_modules/.bin  -> ["cmdprobe","cmdprobe.cmd","cmdprobe.ps1"]
run cmdprobe.cmd hello world
                   -> "CMD-NATIVE-RAN args=hello world"
```

Batch executes natively on Windows and **argument forwarding works**. No
interpreter is involved at all.

This matters because the `sh` script does not need bun on `PATH` — it locates
bun inside `node_modules` itself. A `.cmd` can perform the identical lookup
(including the `@oven` fallback directory). So bun never needs to bootstrap
itself, and node is never needed.

### Decisive prototype: parent owns no bin, children own it

The two prototypes above each isolated one variable. The decisive combination —
a parent declaring **no** `bin`, plus two `os`-filtered `optionalDependencies`
each declaring `bin.llxprt` — was verified end-to-end on win32 (npm 11.16.0;
throwaway fixture under `%TEMP%`, since deleted):

```
npm install                     -> exit 0, "added 1 package", no warnings
node_modules                    -> [win32-child]          (posix child skipped)
node_modules/.bin               -> [llxprt, llxprt.cmd, llxprt.ps1]  (exactly these)
node_modules\.bin\llxprt hello world
                                -> "WIN-CHILD-RAN hello world", exit 0
```

No bin-name collision, no error, no warning. The `os` field selects exactly one
child per host, and only that child contributes the bin. This is the combination
that shipped.

### What shipped

This is the implemented design on this branch, not a proposal:

- `packages/cli/package.json` declares **no** `bin`. Root `package.json` is
  `private: true`, so `packages/cli` is the consumer-facing published manifest
  and the repo-root `bin` is dev-only.
- `@vybestack/llxprt-cli-posix` (`os: [darwin, linux, freebsd]`) ships the
  existing `sh` launcher byte-for-byte unchanged. POSIX was never broken and is
  not modified: the OS honours `#!/bin/sh` directly, with zero scripts and zero
  node.
- `@vybestack/llxprt-cli-win32` (`os: [win32]`) ships a native `bin/llxprt.cmd`
  that resolves bun (bundled → `@oven` fallback → `PATH`) and execs it. No node
  dependency anywhere on the launcher hot path.
- Both packages are exact-pinned `optionalDependencies`, in version lockstep
  with the parent. A skew would leave consumers with **no** `llxprt` command at
  all, so the three versions must move together.
- No companion `.ps1` was added: npm already generates `llxprt.ps1` delegating
  to `llxprt.cmd`.

No postinstall is load-bearing on either platform, and no node is required on
either platform. The `sh`-to-batch resolution port that was previously listed as
"remaining work" is done, and the `.ps1` question was resolved by relying on
npm's generated shim rather than shipping a companion file.

Previously rejected: committing a native `.exe` as the bin target (not
POSIX-executable; `.cmd`/`.ps1` targets fail POSIX with `ENOEXEC`; the bin target
must exist in the packed tarball), and the `#!/usr/bin/env node` bootstrap (see
"Options" and "CORRECTION" above — it reintroduces a node dependency on the
launcher hot path and regresses the working, node-free POSIX path; this project
is migrating to bun, so node on the hot path is the wrong trade).

## Verified mechanics (both former open items now closed)

### The optimization is POSIX-only — by design

`install.js:223-235`:

```js
function maybeOptimizePackage(binPath) {
  const { isWASM } = pkgAndSubpathForCurrentPlatform();
  if (os2.platform() !== "win32" && !isYarn() && !isWASM) {
    const tempPath = path2.join(__dirname, "bin-esbuild");
    try {
      fs2.linkSync(binPath, tempPath);
      fs2.renameSync(tempPath, toPath);
      isToPathJS = false;
      fs2.unlinkSync(tempPath);
    } catch {}
  }
}
```

esbuild **never swaps the binary on Windows.** This confirms the hazard: npm
links bins (and generates the `.cmd`/`.ps1` shims from the shebang) *before*
running postinstall, so replacing the file with a native binary on Windows would
leave a shim doing `node <binary>`. Hence the `!== "win32"` guard. Yarn is also
excluded.

Consequence for us, and it is favourable:

- **Windows** — always the node bootstrap. That is the platform broken today.
- **POSIX** — postinstall swaps in the fast path whenever it is allowed to run,
  so there is **no regression** on the platform that currently has zero overhead.

The ~30-40ms node boot is therefore only paid on POSIX *when scripts are denied*,
which is precisely the case that is otherwise completely broken.

### Resolution and exec order

From `bin/esbuild`:

1. `ESBUILD_BINARY_PATH` env override, validated, with a warning if bad (l.30, 112-116)
2. `require.resolve(`${pkg}/${subpath}`)` — resolves the binary out of the
   platform optionalDependency (l.122)
3. `require("child_process").execFileSync(binPath, process.argv.slice(2), { stdio: "inherit" })` (l.222);
   the WASM path instead execs `node` with the binary as argv (l.220)

**Caveat for llxprt:** `execFileSync` keeps the parent node process resident for
the lifetime of the child. For a bundler that runs and exits this is irrelevant;
for a long-running interactive CLI it means carrying an idle ~30-40MB node
process the whole session. We already have `relaunchUnderBunIfNeeded`, so an
exec-replacement style handoff is likely preferable to copying esbuild here.

## Verified: the `@oven` packages are script-free and self-contained

The obvious objection to the #2978 fix is "won't the `@oven` package just have a
postinstall too?" Measured on the installed packages:

```
--- bun-windows-x64
  scripts: {}          bin: undefined      os/cpu: ["win32"] ["x64"]
--- bun-windows-x64-baseline
  scripts: {}          bin: undefined      os/cpu: ["win32"] ["x64"]
```

`scripts` is **empty**. There is no `preinstall`, `install` or `postinstall`, so
npm v12's default-deny has nothing to block.

And the binary genuinely ships inside the tarball — from the registry:

```
npm view @oven/bun-windows-x64@1.3.14 dist.unpackedSize dist.fileCount
{ "dist.unpackedSize": 98480706, "dist.fileCount": 3 }
```

~98MB across 3 files (`bin/bun.exe`, `package.json`, `README.md`). Contrast with
the `bun` package, which is a stub that *downloads* the binary from its
postinstall.

### Caveat observed locally

In this repo's tree, `node_modules/@oven/bun-windows-x64/bin/` is **empty** —
`bun install` does not extract the platform binary (bun already is that binary).
npm performs no such pruning, so the npm-v12 path this fix targets is unaffected.

The resolver already tolerates this: `@oven` candidates go through
`firstUsableCandidate(...)`, which existence-checks and falls through when the
path is absent, so an empty `bin/` degrades to the next candidate rather than
returning a bogus path.

### Size consideration

Only the one `os`/`cpu`-matching package installs, so the cost is ~98MB once,
not 16x. This is comparable to what bun's postinstall downloads today, but it is
now fetched by npm as ordinary package content instead of by a script.

## Scope note

Repo-root `scripts/postinstall.cjs` is NOT load-bearing for the published
package (packed from `packages/cli`, whose `files` list includes only
`scripts/install-native-launchers.cjs`) but must not be removed, since root
installs use it.
