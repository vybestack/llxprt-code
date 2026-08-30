# Issue #2754 — Isolate VSCE as release-only VS Code packaging tooling

Date: 2026-08-27

## Problem

`@vscode/vsce` is VSIX packaging/publishing tooling. It is declared as a dev
dependency of the `packages/vscode-ide-companion` workspace, so an ordinary
repository install drags in VSCE and its transitive tree
(`@vscode/vsce` -> `cheerio` -> `encoding-sniffer` -> `whatwg-encoding@3.1.1`
deprecated) into every ordinary npm/Bun workspace install.

## Selected packaging design

VSCE is removed from the companion's devDependencies, so no workspace install
includes it. The two places that invoke the VSCE bin (the companion `package`
script and the release workflow "Publish VS Code extension" step) switch to a
pinned `npm exec --package @vscode/vsce@3.9.2` invocation with an exact VSCE
version. `3.9.2` is the version the committed lockfiles already resolve today, so
behavior of the packaging path is unchanged. Both lockfiles are regenerated so a fresh
install contains no `@vscode/vsce*` package anywhere.

This satisfies the issue's design constraints:

- Not a dev dependency of any workspace -> ordinary root installs (npm and Bun)
  exclude VSCE (A1, A2).
- `optionalDependencies` not used (npm installs optional deps by default).
- The VSCE version is explicitly pinned (`@vscode/vsce@3.9.2`) in both the
  `package` script and the release workflow; no unpinned `npx @vscode/vsce`
  invocation exists (A4).
- The packaging context is `npm exec`/`npx` in the release workflow and the
  `package` script, i.e. "a controlled packaging context", not a workspace
  dependency.
- VSCE stays out of all production/runtime manifests and generated artifacts: it is
  never a dependency of any published package and the VSIX/CLI tarballs contain no
  node_modules (VSIX is `--no-dependencies`; the CLI tarball ships only source +
  bundle) (A6).
- Prepackage checks, `--packagePath`, `--azure-credential`, and
  `--skip-duplicate` are preserved (A5).

## Expected paths

- `packages/vscode-ide-companion/package.json`:
  - remove `"@vscode/vsce": "^3.6.0"` from `devDependencies`;
  - change `"package"` from `"vsce package --no-dependencies"` to
    `"npm exec --package @vscode/vsce@3.9.2 -- vsce package --no-dependencies"`.
- `scripts/build_vscode_companion.ts`: unchanged (it runs
  `npm --workspace=llxprt-code-vscode-ide-companion run package`, which now
  carries the pin).
- `.github/workflows/release.yml` "Publish VS Code extension" step: change the run
  from `npx @vscode/vsce publish --packagePath ...` to
  `npm exec --package @vscode/vsce@3.9.2 -- vsce publish --packagePath "${VSIX_PATH}" --azure-credential --skip-duplicate`.
- `package-lock.json`: regenerate so no `@vscode/vsce`/`@vscode/vsce-sign*`
  entry remains and the companion workspace entry no longer declares the dependency.
- `bun.lock`: regenerate so the companion workspace entry and the package table no longer
  contain `@vscode/vsce`.
- `scripts/tests/issue-2754-vsce-release-only.test.ts`: new behavioral tests.

## Behavioral RED evidence

On `main` the new test file `scripts/tests/issue-2754-vsce-release-only.test.ts`
fails: the companion declares `@vscode/vsce`, package-lock.json and bun.lock both
list `@vscode/vsce`, and the `package` script invokes an unpinned `vsce` binary
from the workspace. After the fix, all assertions pass. This is the RED
(before) -> GREEN (after) evidence for the acceptance matrix.

## Acceptance matrix -> tests (single new test file)

`scripts/tests/issue-2754-vsce-release-only.test.ts` (all in one describe):

| ID | Assertions |
| --- | --- |
| A1 | companion `package.json` does not declare `@vscode/vsce` in any section; root `package.json` declares no `@vscode/vsce`; package-lock.json has no `node_modules/@vscode/vsce` (or `@vscode/vsce-sign`) entry and the companion workspace entry declares no `@vscode/vsce`. |
| A2 | companion `package.json` declares no `@vscode/vsce`; bun.lock has no `@vscode/vsce` package entry and the companion workspace entry in bun.lock declares no `@vscode/vsce`. |
| A3 | companion `build` = `build:dev`; `build:dev` runs check-types + lint + `bun esbuild.ts`; `build:prod` same but `--production`; neither `build:dev`, `build:prod`, `check-types`, `lint`, `prepare`, `generate:notices` references `vsce`. |
| A4 | companion `package` script contains the pinned exact version `@vscode/vsce@3.9.2` and does not equal an unpinned `vsce package` invocation. |
| A5 | release.yml "Publish VS Code extension" step contains the pinned `@vscode/vsce@3.9.2` form, `--skip-duplicate`, `--azure-credential`, and `--packagePath`; no `npx @vscode/vsce` (unpinned) appears anywhere in release.yml or the companion package.json. |

## Boundary cases

- The two VSCE invocation surfaces are `package` (companion script + the
  `build:vscode` root script that runs it) and the release workflow publish step.
  Both must carry the same pinned version `@vscode/vsce@3.9.2` so a
  regression on one surface fails CI.
- Both lockfiles must be updated together; the lockfile-parity guards in
  `bun-workspaces.test.ts` fail if only one is regenerated.
- Removing VSCE from companion devDependencies also removes `cheerio`'s VSCE-only
  transitive subtree from the ordinary install; the VSCE-only `cheerio` dependency
  is still a root CLI dependency, so `cheerio` itself remains in the tree and is out
  of scope (the issue explicitly scopes out Cheerio/VSCE upstream).

## Out of scope (non-goals, from the issue)

- Fixing Cheerio, encoding-sniffer, or VSCE upstream.
- Changing Gemini/Google provider or storage/persistence dependencies.
- Removing or redesigning the VS Code companion or its commands.
- Any dependency cleanup unrelated to VSCE isolation.

## Delivery checkpoints

1. Plan + RED test written and shown failing on the current branch (main baseline).
2. Apply the manifest/lockfile workflow changes.
3. Regenerate lockfiles and prove the shared Test suite (scripts-tests root) passes.
4. Full verification cycle (test / lint / typecheck / format / build / smoke).
5. OCR review (one full review, one remediation max).
6. PR with `closes #2754`, watch CI, triage every review finding.
