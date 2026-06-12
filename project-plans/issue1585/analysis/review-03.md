# typescriptreviewer Review 03

## Verdict

FAIL

## Must-fix issues

1. `project-plans/issue1585/analysis/interface-contracts-detailed.md`, `plan/00-overview.md`, `plan/11-tool-move-impl.md`: tools-owned interfaces are too narrow for actual `packages/core/src/tools/**` usage. Add an exhaustive Config/core method replacement table mapping every current `this.config.*`, core service, storage, settings, MCP, IDE/LSP, workspace, file filtering, approval, shell runtime, prompt registry, and provider-manager usage to a specific tools-owned interface and core adapter.
2. `analysis/final-architecture.md`, `plan/00-overview.md`: missing `packages/settings`, `packages/storage`, and `packages/mcp` are acknowledged but not fully specified. Add explicit temporary interfaces for settings, prompt registry, memory storage, key storage, and MCP execution, with behavior preserved and future replacement rules. Clarify `mcp-tool.ts` remains core if it cannot move without core coupling.
3. `analysis/consumer-rewrite-map-final.md`, `plan/13-consumer-migration.md`: consumer inventory is incomplete for tests, dynamic imports, `vi.mock`, `new URL(...tools...)`, and retained MCP consumers. Add `analysis/all-tool-consumers-final.md` classifying every static/test/mock/dynamic/reference occurrence exactly once with new path or retention action.
4. `plan/14-release-process.md`, `analysis/release-process.md`: release/sandbox/Docker instructions do not fully match the repo. Add `.github/workflows/build-sandbox.yml`; update Dockerfile instructions using actual `packages/*/dist/*.tgz` -> `/tmp/` paths and `npm install -g /tmp/...` order; add release-process test coverage for build-sandbox workflow.
5. `analysis/dependency-relocation-final.md`: dependency versions are incomplete/inaccurate. Preserve current versions from `packages/core/package.json`/root unless intentionally changed with evidence; handle `zod-to-json-schema`; identify tests such as `ToolFormatter.toResponsesTool.test.ts` that currently import providers and must be rewritten or kept outside tools.
6. `plan/15a-cleanup-no-shims-verification.md`, `analysis/package-metadata-constraints.md`: no-shim scan incorrectly flags allowed core top-level re-exports. Restrict no-shim scan to `packages/core/src/tools/**`; separately allow explicit `packages/core/src/index.ts` re-exports needed for CLI compatibility.
7. `analysis/verification-matrix.md`, `analysis/final-architecture.md`, `plan/15a-cleanup-no-shims-verification.md`: retained core tools policy is contradictory. Normalize allowlist to include `mcp-client.ts`, `mcp-client-manager.ts`, `tool-key-storage.ts`, their tests if applicable, and any explicitly classified `STAY_CORE_INFRASTRUCTURE` files.
8. `plan/10-tool-move-tdd.md`, `plan/10a-tool-move-tdd-verification.md`: some TDD requirements still invite mock theater/delegation tests. Rewrite shell/todo/key-storage bullets to assert observable `ToolResult`, filesystem/storage/state/provider output behavior, with method-call assertions only secondary and justified.
9. `plan/00a-preflight-verification.md`, `specification.md`: missing captured GitHub issue body/comments evidence. Add `gh issue view 1585 --comments > project-plans/issue1585/analysis/issue-body-and-comments.md` and a traceability table from issue body/comment requirements to plan phases/artifacts.
10. `plan/*.md`: many phases do not follow `PLAN-TEMPLATE.md` expanded requirement format. Add full requirement text, GIVEN/WHEN/THEN behavior, and why-it-matters for each phase, adapted to refactoring behavior preservation.

## Pedantic issues

1. `P00a` naming is nonstandard but acceptable because the overview explains it as the Phase 0.5 preflight equivalent; ensure tracker/manifest prevent skipping it.
2. Some verification commands mix grep and ripgrep syntax, e.g. `grep ... -g '*.ts'`; use `rg` for `-g` or remove `-g`.
3. Adapter count expectations like `12-13` are vague. Prefer an exact list with a conditional MCP adapter decision.
4. `npm run format` modifies files. Phase completion should require checking resulting diffs, not merely command success.
5. `npx depcheck packages/tools` is advisory and noisy; do not treat it as the sole cycle/dependency proof.
6. Plan markers in implementation phases should be clarified for large mechanical moves: either require markers or explicitly justify omission.
7. `@vybestack/llxprt-code-test-utils` devDependency-only rule is good, but test fixture generation should avoid coupling tools tests back to core/providers through test utilities.
8. Some release prose uses generic tarball examples that do not match the current Dockerfile layout; keep examples repo-shaped throughout.

## Missing evidence/commands

1. Missing issue evidence: `gh issue view 1585 --comments > project-plans/issue1585/analysis/issue-body-and-comments.md` plus traceability table.
2. Missing full consumer evidence: `rg -n "@vybestack/llxprt-code-core/tools/|['\"]\.\.?/.*tools/|import\(.*tools|vi\.mock\(.*tools|new URL\(.*tools" packages -g "*.ts" > project-plans/issue1585/analysis/all-tool-consumers-final.txt`.
3. Missing actual Config/core usage inventory: `rg -n "this\.config\.|config\.|getConfig\(\)" packages/core/src/tools -g "*.ts" > project-plans/issue1585/analysis/tool-config-usage.txt`.
4. Missing non-relative import/dependency inventory: `rg -n "^import .* from ['\"][^./]" packages/core/src/tools -g "*.ts" > project-plans/issue1585/analysis/tools-non-relative-imports.txt`.
5. Missing dependency version preservation evidence: `node -e "const core=require('./packages/core/package.json'); for (const d of ['@ast-grep/napi','@google/genai','diff','glob','node-fetch','zod']) console.log(d, core.dependencies[d])"`.
6. Missing build-sandbox workflow evidence: `grep -n "@vybestack/llxprt-code" .github/workflows/build-sandbox.yml` and tests proving tools is packed there.
7. Missing Dockerfile actual path/order evidence: `grep -n "packages/tools/dist\|vybestack-llxprt-code-tools\|npm install -g" Dockerfile`.
8. Missing retained core tools allowlist verification: `find packages/core/src/tools -type f -name "*.ts" | sort` compared to move-map-final retained list.
9. Missing no-shim verification that does not flag allowed top-level re-exports: `rg -n "export .* from ['\"]@vybestack/llxprt-code-tools" packages/core/src/tools -g "*.ts"`.
10. Missing behavioral verification commands for key storage/memory path/provider formatting/registry scheduler that prove no no-op stubs can pass.

## Suggested edits

1. Add to `plan/00a-preflight-verification.md`: `gh issue view 1585 --comments > project-plans/issue1585/analysis/issue-body-and-comments.md`, then require a traceability table mapping each issue body/comment requirement to plan phases/artifacts.
2. Add to `analysis/final-architecture.md`: exact retained core tools allowlist: `mcp-client.ts`, `mcp-client-manager.ts`, `tool-key-storage.ts`, tests for retained files if applicable, and any explicit `STAY_CORE_INFRASTRUCTURE` entries. State all other core tools files are moved or removed and no core/tools file may re-export from tools.
3. Add to `analysis/interface-contracts-detailed.md`: `## Exhaustive Config/Core Method Replacement Table`; generate with `rg -n "this\.config\.|config\.|getConfig\(\)" packages/core/src/tools -g "*.ts"`; each production usage must map to replacement interface and adapter.
4. Replace `analysis/release-process.md` Dockerfile sample with actual repo-shaped instructions: copy `packages/tools/dist/vybestack-llxprt-code-tools-*.tgz` to `/tmp/` before core/providers/cli and install with `npm install -g /tmp/vybestack-llxprt-code-tools-*.tgz /tmp/vybestack-llxprt-code-core-*.tgz /tmp/vybestack-llxprt-code-providers-*.tgz /tmp/vybestack-llxprt-code-*.tgz`.
5. Add `.github/workflows/build-sandbox.yml` to `plan/14-release-process.md`: pack tools before core/providers/cli using `npm pack -w @vybestack/llxprt-code-tools --pack-destination ./packages/tools/dist`, and add release-process tests for that workflow.
6. Fix `analysis/dependency-relocation-final.md` dependency versions to current project versions: `@ast-grep/napi ^0.40.5`, `@google/genai 1.30.0`, `cheerio ^1.1.2`, `diff ^8.0.3`, `fast-glob ^3.3.3`, `glob ^12.0.0`, `html-to-text ^9.0.5`, `node-fetch ^3.3.2`, `shell-quote ^1.8.3`, `turndown ^7.2.2`, `zod ^3.25.76`, plus verified `zod-to-json-schema`.
7. Add a section for tests that violate dependency direction, especially `ToolFormatter.toResponsesTool.test.ts` importing `@vybestack/llxprt-code-providers/ITool.js`; require rewriting to local structural fixtures or keeping provider-specific assertions in providers.
8. Replace broad no-shim scan with `rg -n "export \* from ['\"]@vybestack/llxprt-code-tools|export \{.*\} from ['\"]@vybestack/llxprt-code-tools" packages/core/src/tools -g "*.ts"`; separately verify allowed explicit top-level re-exports in `packages/core/src/index.ts`.
9. Rewrite TDD bullets in `plan/10-tool-move-tdd.md`: shell/todo/key-storage tests must assert observable outputs/state, not primary `toHaveBeenCalled` delegation assertions. Update `plan/10a` to review any `toHaveBeenCalled*` usage as secondary evidence only.
10. Add expanded requirement blocks to each `plan/*.md` phase with full text, GIVEN/WHEN/THEN, and why-it-matters, tailored to refactor behavior preservation.
