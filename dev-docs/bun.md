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
