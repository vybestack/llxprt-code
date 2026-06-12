# typescriptreviewer Review 08

## Verdict

FAIL

## Must-fix issues

1. `project-plans/issue1585/plan/08-package-scaffold-impl.md` Step 2 contradicts the package boundary: heading says “Add Core As Dependency” while body says no core dependency. Rename to “Declare External Dependencies Only (No Core/Providers/CLI)”, include only external deps, and add a failing package.json anti-cycle check.
2. `project-plans/issue1585/analysis/dependency-relocation-final.md` dependency inventory is incomplete for actual moved tools/utilities. Add a final generated dependency map covering moved `packages/core/src/tools`, moved `packages/core/src/utils`, and moved service/helper files; classify every external import and update `packages/tools/package.json`.
3. `zod-to-json-schema` appears to be asserted without current source evidence. Re-run `rg -n "zod-to-json-schema" packages/core/src packages/cli/src packages/providers/src -g "*.ts"`; remove it from required tools dependencies if no source import exists.
4. `project-plans/issue1585/plan/12-core-adapters-and-registry-integration.md` still says mandatory adapters can be “verify/create if missed”, contradicting its own rule. Mandatory adapters must be verify-only; missing mandatory adapters must fail P12 and return to the assigned P11 group.
5. Release changes are duplicated across `plan/08-package-scaffold-impl.md` and `plan/14-release-process.md`. Restrict P08 to scaffold/build/package metadata and move all release workflow, sandbox, Dockerfile, version, prepare-package, release test, and bind-release-deps changes exclusively to P14.
6. `analysis/release-process.md` contains a stale Dockerfile install snippet that omits tools/core in the “first argument” example. Replace it with full tools → core → providers → cli install ordering.
7. `plan/14-release-process.md` uses a verification command requiring `scripts/version.js` to export `actualWorkspaces`, but current `scripts/version.js` does not export it. Either export it intentionally with tests, or verify order by parsing file text in release-process tests.
8. `plan/14-release-process.md` ESM smoke test duplicates `npm init -y` and should be replaced with the cleaner pack/install/import command sequence used in P16.
9. P06/P08 do not explicitly constrain `packages/tools/tsconfig.json` path mappings. Add a boundary rule allowing only self mappings and forbidding `../core`, `../providers`, and `../cli` paths.
10. `plan/13-consumer-migration.md` should immediately verify providers package metadata and package-lock after adding `@vybestack/llxprt-code-tools`, not defer evidence to final verification.
11. Release/sandbox current-state assumptions need reconciliation: actual `scripts/build_sandbox.js` already packs providers, while build-sandbox workflow currently differs. Add a current-vs-target table for workflow, script, and Dockerfile.
12. `plan/10-tool-move-tdd.md` still includes mock-theater phrasing for todo/key-storage tests. Rewrite bullets to require observable round-trip outcomes as primary assertions.
13. `analysis/interface-contracts-detailed.md` has potentially lossy broad interfaces (`unknown`, anonymous service objects, index signatures). Define exact named tools-owned structural interfaces for required methods and remove service-bag-shaped signatures where possible.
14. MCP ownership should be decided earlier. Require `analysis/mcp-tool-decision.md` before P03/P10/P11, not late in P09/P11.
15. `lsp-diagnostics-helper.ts` conditional ownership is not reflected in the overview/core retained allowlist. Either state it must move in P11 Group 3 or include it as a conditional retained file consumed by P15 allowlist verification.

## Pedantic issues

1. `plan/requirements-appendix.md` duplicates `REQ-FORMAT-DIFF-CHECK` and `REQ-TEST-FIXTURE-COUPLING`; merge or rename the expanded versions.
2. P00’s phase-count language is hard to reason about because execution uses `00a`, `02b`, `02c`, etc. Make `phase_manifest.tsv` the authoritative execution order and link it from all phases.
3. Some verification scans are too narrow, e.g. service-bag scan only against `packages/tools/src/utils/tool-context.ts`; scan all `packages/tools/src` instead.
4. Debug logger ownership is inconsistent: one artifact says package-local no-op, another says conditionally delegates based on `IToolHost.getDebugMode()`. Pick one exact behavior and document it.
5. Manual trusted publishing checklist says dry-run publish is optional. Either make it required for maintainers when credentials/config allow it, or explicitly mark it manual-only and non-automatable.
6. P00a says “MCP ownership is decided” while later phases allow the decision to remain conditional. Reword or move the decision earlier.
7. `ToolContext` destination is inconsistent (`utils/tool-context.ts` vs types). Use one canonical destination.
8. P16 duplicates A2A server verification in two steps; harmless but noisy.
9. P14 and P16 use slightly different tarball smoke test command shapes; standardize on one.

## Missing evidence/commands

1. Complete quoted issue body/comment evidence, not just summarized requirements; `analysis/issue-body-and-comments.raw.txt` should be referenced as mandatory evidence.
2. Final generated external dependency map for every moved production file, including moved non-tools utilities and helpers.
3. Immediate package-lock/root-workspace verification after adding `packages/tools`.
4. Importability smoke tests for every declared subpath export (`IToolFormatter.js`, `ToolFormatter.js`, `ToolIdStrategy.js`, `toolIdNormalization.js`, `doubleEscapeUtils.js`, `toolNameUtils.js`).
5. `packages/tools/tsconfig.json` anti-cycle/path-mapping verification.
6. Exact release-process tests asserting `.github/workflows/build-sandbox.yml` includes tools and orders tools before core/providers/cli.
7. `bind-release-deps.js` tests proving local `file:../tools` dependencies are included and backup/restore/dry-run behavior remains correct.
8. Provider `package-lock.json` evidence after providers adds `@vybestack/llxprt-code-tools`.
9. Earlier MCP and LSP decision artifacts before scaffold/test phases.
10. Current-vs-target release/sandbox table for release workflow, build-sandbox workflow, `scripts/build_sandbox.js`, and Dockerfile.

## Suggested edits

1. In `plan/08-package-scaffold-impl.md`, replace “Step 2: Add Core As Dependency” with “Step 2: Declare External Dependencies Only (No Core/Providers/CLI)” and add a Node anti-cycle verifier over dependencies/devDependencies.
2. In `plan/12-core-adapters-and-registry-integration.md`, replace every mandatory “verify/create if missed” with “verify only — missing means return to assigned P11 group”; only `CoreMcpToolServiceAdapter` may be conditional-created.
3. Add to P06/P08 a tools tsconfig rule: only self path mappings are allowed; no `../core`, `../providers`, or `../cli`. Include a Node JSON verifier.
4. In `analysis/release-process.md`, replace the stale Dockerfile install snippet with the full `/tmp/vybestack-llxprt-code-tools-*.tgz`, core, providers, cli order.
5. Add P09 artifact `analysis/tools-external-dependency-map-final.md` generated from actual imports in all files classified to move, including moved utilities. Require every external import to be declared in `packages/tools/package.json`.
6. Move all release/Docker/sandbox/script edits from P08 to P14; P08 should only scaffold/build the tools package and update workspace/lockfile metadata.
7. Add P13 checks: `npm install`, providers package.json dependency assertion for `file:../tools`, and package-lock assertion for `packages/providers` dependency on tools.
8. Replace P14’s `scripts/version.js` require-based order check with a release-process test that reads/parses the file text, or intentionally export `actualWorkspaces` and test the export.
9. Replace P14 smoke command with the P16-style `/tmp/llxprt-tools-pack` and `/tmp/llxprt-tools-smoke` sequence; remove duplicated `npm init -y`.
10. Rewrite P10 todo/key-storage bullets so primary assertions are observable round trips and ToolResult/storage state, not `toHaveBeenCalled*`.
11. Require `analysis/mcp-tool-decision.md` and `analysis/lsp-diagnostics-helper-decision.md` before P03/P10/P11.
12. Update P15 retained-file allowlist logic to include conditional `lsp-diagnostics-helper.ts` only if its decision artifact classifies it as retained; otherwise require it to move in P11 Group 3.
13. Add subpath export importability smoke tests for all public formatter/name utility exports.
14. Merge duplicate requirement blocks in `requirements-appendix.md` and make `phase_manifest.tsv` authoritative for phase order.
