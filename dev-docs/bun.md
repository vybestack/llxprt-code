# Bun (Package Manager)

This document describes how [Bun](https://bun.sh/) is used as a package and
workspace manager for this monorepo. It is the companion to
[npm.md](./npm.md), which describes the npm release process.

## Purpose

Bun is being adopted incrementally as part of a staged runtime migration. This
step (S1) introduces Bun **only** as the package/workspace manager: it is used
to install dependencies, resolve the 16 workspaces, and materialize the
`node_modules` tree. The runtime and build path are intentionally **not**
changed by S1 — they continue to run on Node and npm until later subissues
(S3–S7). npm must keep working during the transition so no consumer is broken.

## bunfig.toml

The repository root contains a [`bunfig.toml`](../bunfig.toml) file that
configures Bun's install behavior:

```toml
[install]
linker = "hoisted"
```

### Why `linker = "hoisted"`

By default Bun uses an isolated dependency layout. npm, by contrast, hoists
shared dependencies to the top of `node_modules`. A great deal of tooling in
this repository (and in transitive dependencies) walks `node_modules` directly
and assumes a hoisted topology — for example `scripts/tests/vitest.config.ts`
aliases into the root `node_modules`. Setting `linker = "hoisted"` makes Bun use
the same hoisted `node_modules` topology class as npm (rather than Bun's
isolated linker) during S1. Bun's hoisting is not byte-for-byte identical to
npm's algorithm, but using the hoisted layout removes the large class of
"works under npm but not bun" (or vice-versa) surprises caused by an isolated
layout.

## .bun-version

The file [`.bun-version`](../.bun-version) pins the concrete Bun version to
`1.3.14`. This is the version that has been empirically verified to install all
workspaces and native binaries correctly from a clean checkout. For S1,
`.bun-version` is the **authoritative** local Bun pin for package-manager work.

Later subissues that switch the runtime or build to Bun should consume this same
version rather than introducing a second, divergent pin, and should reconcile
the CI/release pin (below) against it.

> **Known divergence, reconciliation deferred:**
> `.github/workflows/release.yml` currently pins a **different** Bun version
> (`bun-version: '1.3.3'`) via `oven-sh/setup-bun`. This is a pre-existing pin
> that S1 does **not** touch: aligning the CI/release toolchain with
> `.bun-version` is explicitly **deferred** to the CI/release subissues (S6/S7),
> which own the GitHub Actions workflows. Until then `.bun-version` (1.3.14)
> governs local installs while `release.yml` (1.3.3) governs the release runner;
> the two are intentionally allowed to differ during the transition. Do not
> change `release.yml` as part of S1.

## trustedDependencies

Bun, by default, blocks lifecycle scripts (`install`, `postinstall`) for any
package that is not explicitly listed in the root `package.json`
`trustedDependencies` array. This is a security measure to prevent arbitrary
code execution from transitive dependencies during install.

Only packages whose lifecycle scripts produce **required native binaries** are
trusted. These are the 15 entries in `trustedDependencies`:

- **`@lvce-editor/ripgrep`** — its postinstall fetches and places the `rg`
  binary used for project search. Declared in the root and in `packages/tools`.
- **`@ast-grep/lang-*`** (13 packages) — each ships a `postinstall.js` that
  downloads/extracts the platform-specific parser prebuild (`*.node`/`*.so`)
  for that language. Declared across `packages/core` and `packages/tools`.
- **`tree-sitter-bash`** — ships prebuilt native bindings under
  `prebuilds/<platform>/`. Declared in `packages/core`.

### Why other lifecycle-script packages are NOT trusted

- **`esbuild`** — does not need trust. Its platform binary is delivered by the
  separate `@esbuild/<platform>` package, which Bun installs directly without
  running a script.
- **`node-pty`** — not trusted because the runtime prefers `@lydell/node-pty`
  (see `packages/core/src/utils/getPty.ts`), whose native binary is supplied by
  the prebuilt `@lydell/node-pty-*` platform packages. `node-pty` is the
  legacy/fallback module, so its own build scripts are not required for a usable
  install. This is an intentional trade-off: if `@lydell/node-pty` were ever
  unavailable on a platform, the `node-pty` fallback would not have a freshly
  built binary under Bun.
- **`keytar`** — not trusted because it is transitive release/VSCE tooling, not
  a package the CLI runtime depends on; its credential-store binary is not
  required for installing or running this repository.
- **`msw`, `vscode-ide-companion` prepare** — build/dev-only lifecycle scripts
  that do not produce a runtime-required artifact, so they do not need to run
  during install.

### Native runtime modules that need no trust at all

A reader scanning `trustedDependencies` may be surprised that the repository's
two most prominent native modules are **absent**:

- **`@ast-grep/napi`** — the native engine behind AST-aware code search.
- **`@napi-rs/keyring`** — the native OS credential store used by auth.

Both are used by the runtime and both ship native `*.node` binaries, yet
neither belongs in `trustedDependencies` because **neither defines an `install`
or `postinstall` lifecycle script**. Like `esbuild`, their platform binaries are
delivered by separate optional packages (`@ast-grep/napi-<platform>`,
`@napi-rs/keyring-<platform>`) that Bun installs directly. There is no script to
gate, so trusting them would be meaningless — and because the test below asserts
the trust list matches the allowlist **exactly**, adding them would actually
fail CI. This was verified empirically: after a clean `bun install` with neither
package trusted, the `*.node` binaries for both were present in `node_modules`.

This list is enforced by a behavioral test
([`scripts/tests/bun-workspaces.test.ts`](../scripts/tests/bun-workspaces.test.ts))
in two complementary ways:

1. It asserts `trustedDependencies` equals the intended allowlist **exactly**,
   so neither an unreviewed extra entry (over-trust / supply-chain risk) nor a
   dropped entry (a required native binary that silently fails to build) can slip
   in.
2. It asserts that every workspace-declared package in the known native-binary
   families (`@lvce-editor/ripgrep`, `tree-sitter-bash`, and the
   `@ast-grep/lang-*` family) is present in the trust list — so adding a new
   `@ast-grep/lang-*` package automatically requires it to be trusted.

The test does not attempt to discover arbitrary native dependencies of other
names; introducing a native package outside those known families is a deliberate
decision that must also update the allowlist (which the exact-match assertion
forces).

## Dual Lockfile Policy

During the migration, **two lockfiles coexist side-by-side** at the repository
root:

- **`bun.lock`** — produced and maintained by `bun install`.
- **`package-lock.json`** — produced and maintained by `npm install`.

Both are committed. npm ignores `bun.lock`/`bunfig.toml`/`.bun-version`, and
Bun migrates from `package-lock.json` without modifying it. This lets either
tool install the project without churn, and keeps the cutover reversible. The
full cutover to a single lockfile (and dropping npm support) is deferred to a
later subissue.

> Several repository scripts still read `package-lock.json` (for example the
> lockfile/peer checks wired into the build pipeline). Do not remove
> `package-lock.json` until those scripts are migrated — that work belongs to a
> later subissue, not S1.

### Lockfile drift guard

Two committed lockfiles can silently diverge: a contributor who adds or removes
a dependency and regenerates only one of them would leave the other stale, so
`npm install` and `bun install` would build different trees. To catch this,
[`scripts/tests/bun-workspaces.test.ts`](../scripts/tests/bun-workspaces.test.ts)
asserts structural parity between `package.json` and **both** committed
lockfiles. The checks run symmetrically against `bun.lock` and
`package-lock.json` so neither lockfile can drift unnoticed:

1. **Workspace membership** — the set of workspace paths the lockfile records
   (each keys members by path and the root as `""`) equals the set the root
   `package.json` `workspaces` array declares.
2. **Root dependency graph** — for the root workspace (`""`), both the union of
   dependency _names_ and each dependency's _declared range_ (across
   `dependencies`, `devDependencies`, `optionalDependencies`, and
   `peerDependencies`) in `package.json` equal what the lockfile mirrored.
3. **Per-workspace dependency graph** — the same name-set and declared-range
   comparison for every non-root workspace, so a dependency (or a version-range
   bump) applied to e.g. `packages/core` without regenerating the lockfiles
   fails loudly.

The comparison covers dependency **names** and their **declared ranges** (the
`^x.y.z` specifiers written in `package.json`), but deliberately **not** the
resolved/pinned versions. The declared graph is authored input that both
lockfiles copy verbatim, so it must not diverge; resolved version selection is
each lockfile's own concern and the two can legitimately differ, because each
resolver independently picks a concrete version from the same range (the
TypeScript override section covers a case where that divergence was undesirable
and had to be actively pinned away). Validating the declared range — not just
the name — means a range bump applied to only one lockfile is caught, while
still allowing the resolvers to disagree on the concrete resolved version.

`bun.lock` is parsed as JSONC (Bun emits trailing commas) via the `jsonc-parser`
dependency; `package-lock.json` is strict JSON. Parse errors and a missing
lockfile are both surfaced as thrown failures, so a corrupted or absent lockfile
fails the suite loudly rather than passing vacuously. The workspace list driving
every axis comes from a single `readDeclaredWorkspaceManifests()` helper that
hard-fails if a declared workspace is missing its `package.json` (rather than
silently skipping it), so the guard cannot be quietly hollowed out.

## Root Lifecycle Scripts (`preinstall` / `postinstall`)

The root `package.json` registers two lifecycle scripts that run on **every**
install of the repository root: [`scripts/preinstall.cjs`](../scripts/preinstall.cjs)
and [`scripts/postinstall.cjs`](../scripts/postinstall.cjs). Unlike the
_dependency_ lifecycle scripts gated by `trustedDependencies` above, a package
manager always runs the scripts of the package being installed, so these run
under Bun too. Both were written for npm and had to be made package-manager
aware for S1.

Lifecycle scripts execute under `node`, so `process.versions.bun` is **not**
set even when Bun drives the install. The reliable signal is the
`npm_config_user_agent` environment variable, which Bun sets to `bun/<version>
…` and npm sets to `npm/<version> …`. Both scripts share a small
`detectInstaller()` helper that reads this variable and returns `'bun'` or
`'npm'` (defaulting to `'npm'` for any unknown manager so existing behavior is
preserved).

That helper lives in a single shared module,
[`scripts/detect-installer.cjs`](../scripts/detect-installer.cjs), which both
lifecycle scripts `require()`. It was extracted from a byte-identical copy that
previously lived in each script so the detection logic has exactly one
definition (and one set of tests). The function accepts an injectable `env`
parameter (defaulting to `process.env`) so its behavior can be unit-tested
without mutating the real process environment; its dedicated behavioral test is
[`scripts/tests/detect-installer.test.ts`](../scripts/tests/detect-installer.test.ts),
which pins the `bun/`-prefix contract (including that a stray `bun` substring
elsewhere in the user agent is **not** misclassified) and the npm default for
pnpm/Yarn/unknown managers.

Because `detect-installer.cjs` is a runtime dependency of the published
package's `postinstall` script, it must be included in the npm tarball. It is
listed in the root `package.json` `files` allowlist alongside
`preinstall.cjs`/`postinstall.cjs`; omitting it would make the published
package's `postinstall` fail at install time with `MODULE_NOT_FOUND`. This is
guarded by
[`scripts/tests/publish-integrity.test.ts`](../scripts/tests/publish-integrity.test.ts),
which runs `npm pack --dry-run`, walks the transitive closure of **static,
string-literal relative `require()`** calls starting from the lifecycle entry
scripts, and asserts every locally-required `.cjs` file in that closure is
actually packed. The walk deliberately resolves only literal relative
specifiers (e.g. `require('./detect-installer.cjs')`); it does not follow
computed/dynamic requires or bare package specifiers, which matches how the
simple, dependency-free lifecycle scripts are written and keeps the guard from
silently passing on an unresolvable dynamic path.

- **`postinstall.cjs`** normally does two npm-specific things: it strips
  unsupported `"peer": true` flags from `package-lock.json`, and — on a
  bundle-less GitHub-source checkout — it bootstraps a build by shelling out to
  `npm install --workspaces`, `npm run build`, and `npm run bundle`. **Under
  Bun both must be skipped:** Bun does not consume `package-lock.json` (so
  mutating it would be wrong), and the bootstrap shells out to npm, which would
  defeat the `bun install` the user just ran. The script therefore exits early
  (`process.exit(0)`) when `detectInstaller()` returns `'bun'`, before either
  action. Under npm the behavior is byte-for-byte unchanged.
- **`preinstall.cjs`** cleans stale OS temp directories from previous runs.
  Under Bun it is a guarded no-op, both because the cleanup targets npm's
  install temp layout and to keep the Bun install path side-effect-free.

This behavior is locked down by a deterministic, fixture-based behavioral test
([`scripts/tests/postinstall-manager-aware.test.ts`](../scripts/tests/postinstall-manager-aware.test.ts)).
It builds a throwaway clean-checkout fixture (the real `postinstall.cjs`, a
peer-flagged lockfile, a `packages/` source dir, and no bundle) and shadows
`npm` on `PATH` with a stub, then asserts that a **Bun** invocation neither
shells out to npm nor mutates the lockfile, while an **npm** invocation still
bootstraps and still strips the peer flags. (The test is skipped on Windows,
where the shell stub is not portable; `test:scripts` runs on macOS in CI.)

## TypeScript Version Parity (`overrides`)

The root `package.json` `overrides` block pins `typescript` to `5.8.3`:

```jsonc
"overrides": {
  // ...
  "typescript": "5.8.3"
}
```

This pin exists to keep Bun and npm resolving the **same** TypeScript version.
Most workspaces declare `typescript: "^5.3.3"`; `packages/vscode-ide-companion`
declares `typescript: "^5.8.3"`. The pinned `5.8.3` satisfies every workspace
range. `package-lock.json` happens to resolve those ranges to `5.8.3`, but Bun,
resolving them freshly, floats to the newest matching release (`5.9.3` at time
of writing). That divergence is not cosmetic: TypeScript `5.9.x` tightened the
type-aware `@typescript-eslint/await-thenable` analysis, so a Bun-installed tree
produced hundreds of `for await...of` lint errors that the npm-installed tree
did not.

Because `package-lock.json` already resolves `typescript` to `5.8.3`, this
override is a **no-op for npm** (it does not change `package-lock.json`) while
it **forces Bun to match** the npm-locked version. This removes the known
Bun/npm TypeScript divergence that was observed during S1 validation, so the
type-aware lint results are identical under both package managers.

> **Maintenance trap — upgrade these together.** This is an exact pin. When a
> later subissue advances the repository to a newer TypeScript, you must update
> **all four** in the same change: the workspace `typescript` ranges, this
> `overrides.typescript` pin, `package-lock.json` (via `npm install`), and
> `bun.lock` (via `bun install`). If only some are updated, npm and Bun can
> silently diverge again. The behavioral test asserts the pin equals the
> npm-locked version and is compatible with every workspace range, so a partial
> update will fail CI.

## Known Cosmetic Warning

Running `bun install` prints a warning:

```text
warn: Bun currently does not support nested "overrides"
```

This comes from the single nested override in the root `package.json`
(`jsonwebtoken` → `jws`). It is a proven **no-op**: both npm and Bun resolve
`jws@4.0.1` under `jsonwebtoken` regardless of this warning. It is safe to
ignore and is explicitly **not** fixed during S1 (removing the override could
change resolution and is out of scope).

## CI: Bun Install Smoke

A dedicated CI job, `bun_install_smoke` in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml), guards the core S1
acceptance criterion: that a clean checkout installs and links every workspace
under Bun. It pins the toolchain via `.bun-version` (`bun-version-file`), runs
`bun install`, then verifies with a small Node script that every declared
workspace package resolves to its **in-repo** directory (using `realpathSync` to
prove the `node_modules/<name>` entry is a link to the local workspace, not some
other resolution).

> **Why the check uses `realpathSync`, not bare existence.** The root package
> and `packages/cli` are **both** named `@vybestack/llxprt-code`. A bare
> `existsSync(node_modules/@vybestack/llxprt-code)` could therefore be satisfied
> by a registry copy rather than the local `packages/cli` link, giving a false
> pass. The smoke job instead resolves the real path of every workspace entry
> and requires it to point inside the repository, so it cannot false-pass on a
> shadowed package. This strict check now applies to **all 16** workspaces,
> including `packages/cli`, with no exemptions.
>
> This is only sound because S1 also removed a latent trap: the root
> `package.json` previously listed its own published name
> (`"@vybestack/llxprt-code": "^0.8.0"`) in `dependencies`. npm masked it (the
> local workspace always wins), but Bun honored the registry range and installed
> a **stale published 0.8.x** copy instead of linking the local `packages/cli`,
> silently shadowing in-repo source and pulling in its entire transitive tree.
> Nothing imports the bare root name at runtime, so the self-dependency was
> purely harmful; it has been deleted, and the
> `does not declare a self-dependency on the root package name` parity test
> guards against any automated version bump reintroducing it.

### Why plain `bun install` and not `--frozen-lockfile`

CI runs a plain `bun install`, **not** `bun install --frozen-lockfile`. The
behavior below was observed under Bun **1.3.14** (the version pinned in
`.bun-version`); re-verify it after a Bun upgrade rather than assuming it still
holds. Two scenarios must be kept distinct:

- **From-scratch regeneration** (`rm bun.lock && bun install`) **is**
  deterministic: repeated clean runs produce a byte-identical `bun.lock`. The
  committed `bun.lock` is exactly this regenerate-from-scratch artifact.
- **Incremental install against the already-committed `bun.lock`** is **not**
  stable. Bun re-normalizes the existing lockfile on essentially every pass: a
  first `bun install` rewrites a few hundred lines of transitive resolution,
  and a second consecutive `bun install` drifts further still — i.e. it does not
  even converge against its _own_ previous output, let alone the committed file.

That second point is why the lockfile is **not** guarded by a post-install diff.
Neither `bun install --frozen-lockfile` (perpetually red against the committed
file) nor a softer `bun install && git diff --exit-code -- bun.lock` gate is
usable, because both assume an incremental install is a fixed point — which it
is not here. The root cause is structural to this monorepo: the root package and
`packages/cli` share the name `@vybestack/llxprt-code`, combined with `file:../`
workspace links and a large `overrides` block. A plain `bun install` against the
committed lockfile still installs all 16 workspaces correctly; it is only the
re-normalized lockfile _text_ that is unstable, so we regenerate-and-commit
`bun.lock` deliberately rather than diff-gating it in CI.

To reproduce the non-determinism locally (expect a non-empty diff on the second
run despite no dependency change):

```bash
bun install && git checkout -- bun.lock   # normalize working tree
bun install && git --no-pager diff --stat -- bun.lock   # drift on pass 1
bun install && git --no-pager diff --stat -- bun.lock   # further drift on pass 2
```

Note the scope of what replaces the frozen check here. The parity tests above
catch **declared dependency-graph drift** between `package.json`, `bun.lock`,
and `package-lock.json` — workspace membership plus each workspace's declared
dependency names and ranges. They deliberately do **not** compare the
_resolved_ (transitive) versions each lockfile pins, because Bun's
re-normalization makes that comparison unstable for the structural reasons
above. So this guards against the high-value failure mode — a dependency added,
removed, or re-ranged in `package.json` without regenerating both lockfiles —
but it is not a byte-for-byte frozen-install equivalent for the fully resolved
tree.

## Quick Start

Install all dependencies and link the workspaces with Bun:

```bash
bun install
```

npm still works during the transition:

```bash
npm install
```

Both commands produce a working, hoisted `node_modules` tree for all 16
workspaces.
