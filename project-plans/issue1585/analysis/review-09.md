# typescriptreviewer Review 09

## Verdict

FAIL

## Must-fix issues

1. P08 and P14 conflict on release ownership (`phase_manifest.tsv`, `plan/08-package-scaffold-impl.md`, `plan/14-release-process.md`). Make P08 scaffold/package metadata only or move release TDD/implementation entirely to P14.
2. Dependency relocation is inconsistent/incomplete (`analysis/dependency-relocation-final.md`, `plan/08-package-scaffold-impl.md`). P08 omits `zod-to-json-schema`; moved utility dependencies are not conclusively captured.
3. npm/package-lock process needs stronger guards despite honest pnpm note. Add checks for `package-lock.json`, absence of `pnpm-lock.yaml`, and `packages/tools` lockfile entry.
4. `bind-release-deps.js` order is not fully handled. Current script derives order from root workspaces, so P14 must require root workspace order or topological sorting and tests.
5. P14 mixes Dockerfile and `scripts/build_sandbox.js` concerns. Move `toolsPackageDir` and `chmodSync` requirements to build_sandbox only.
6. `phase_manifest.tsv` P12a row has an extra tab that shifts columns.
7. Interface/adapter counts are inconsistent: manifest says 13, overview lists 15 interface files and P12 says 14 mandatory + 1 conditional adapters.
8. P08 export policy is too narrow for full moved public API. Require a complete public export manifest and manifest-based top-level export checks.
9. Consumer old-path exclusions are too broad for `tool-key-storage`; they can hide imports of moved pure functions from retained core storage file.
10. P10 RED-state wording risks reverse testing around `NotYetImplemented`; explicitly forbid tests asserting NotYetImplemented.
11. P11/P16 format diff checks are wrong for uncommitted intentional edits; compare pre/post-format diff or use `format:check`.
12. Manual trusted publishing checklist is too generic for exact workflow/environment/OIDC setup; add required exact fields and comparison to existing packages.

## Pedantic issues

1. `plan/00-overview.md` phase count is understandable but confusing; clarify that 36 entries include non-executable P00 and verification/review entries.
2. P12 title says “Verify And Complete” while the body says mandatory missed adapters must return to P11; rename or clarify.
3. A2A verification is mostly deferred to P16; consider adding a P13a check for earlier feedback.
4. `STAY_UNTIL_FUTURE_PKG` classification is risky and needs strict criteria so it is not used to avoid extraction.
5. Provider package extraction pattern is referenced but should be summarized concretely for exports/files/build/version/release-test conventions.
6. Normalize any stray `npm run test:s` references to `npm run test:scripts`.
7. Add a core dependency cleanup/classification note after moving dependencies out of core.

## Missing evidence

1. Issue body/comments traceability table mapping each issue requirement to phases and artifacts.
2. Current package graph evidence proving tools has no core/providers/cli dependency, core depends on tools, providers depends on tools+core, and CLI does not directly depend on tools unless explicitly changed.
3. Top-level export compatibility evidence proving `packages/core/src/index.ts` re-exports all tool symbols needed by CLI/A2A while package deep exports for moved tools are removed.
4. Release/sandbox baseline evidence from `.github/workflows/build-sandbox.yml`, `scripts/build_sandbox.js`, `Dockerfile`, `scripts/version.js`, and `scripts/prepare-package.js` before edits.
5. Package-lock checks for all dependents, including core/providers tools dependencies and CLI no-direct-tools dependency.
6. Moved utility external dependency scan output covering non-tools utilities, not only `packages/core/src/tools/**`.
7. No copied isolated package evidence: no duplicate production files in both core/tools and packages/tools after P15 except retained allowlist, and no packages/tools import from core source.

## Suggested edits

1. In `phase_manifest.tsv`, change P08 to scaffold/package metadata only and leave release workflow/sandbox/Docker/version/prepare-package to P14.
2. Replace all “13 interfaces/adapters” text with “15 tools-owned interface files; 14 mandatory adapters plus 1 conditional MCP adapter” or equivalent exact wording.
3. Add `"zod-to-json-schema": "^3.25.1"` to P08’s `packages/tools/package.json` dependency block.
4. Add P14 requirement: because `bind-release-deps.js` derives order from root workspaces, either reorder root workspaces to tools/core/lsp/providers/cli or update `bind-release-deps.js` to topologically sort; test `deriveNpmReleasePackages()` returns canonical order.
5. Replace P11 format diff check with pre/post-format diff comparison or `npm run format:check`; keep final zero-diff only where appropriate.
6. Add symbol-aware key-storage scan: fail if `maskKeyForDisplay`, `getSupportedToolNames`, `isValidToolKeyName`, or `IToolKeyStorage` are imported from core `tool-key-storage` after migration.
7. Add P10/P10a scan forbidding tests that assert on `NotYetImplemented`.
8. Fix the malformed P12a TSV row by removing the extra tab before “for moved modules”.
9. Move `toolsPackageDir`/`chmodSync` text out of Dockerfile Step 4 and keep it in `scripts/build_sandbox.js` Step 3.
10. Add npm/package-lock guard commands: `test -f package-lock.json`, `test ! -f pnpm-lock.yaml`, and lockfile `packages/tools` assertions.
11. Add a complete public export manifest artifact before P08/P10 and require dynamic import checks for all manifest symbols.
12. Expand `manual-trusted-publishing.md` with exact trusted publisher fields: package, owner, repo, workflow filename, environment, branch/tag rules, and comparison to existing core/providers/cli npm trusted publisher setup.
