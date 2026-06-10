# typescriptreviewer Review 01

## Verdict

FAIL

## Must-fix issues

1. Phase files under `project-plans/issue1585/plan/*.md` are mostly generic boilerplate and not executable enough. Add exact files to create/modify/move, adapter names, constructor/interface changes, test files, import rewrites, package metadata changes, and phase-specific verification commands.
2. Missing `packages/settings`, `packages/storage`, and `packages/mcp` are acknowledged but not resolved into an executable decision. Either explicitly block implementation after P00a until prerequisites exist, or approve and define a temporary tools-owned interface/core-adapter path.
3. Contract/interface ownership is underspecified. Define exact interface files in `packages/tools/src/interfaces/**`, exact methods, core source adapters, and which moved tools consume each interface.
4. `plan/03-contracts-stub.md` allows “core-local preparatory interfaces”, which risks smuggling tools-to-core coupling. Contracts consumed by tools must be tools-owned; core may only implement adapters.
5. Phase order is inconsistent: P03 creates tools contracts before P06 scaffolds `packages/tools`. Reorder scaffold before contracts or make P03 create the full package scaffold and remove redundancy.
6. Release coverage is strong in analysis but too vague in P14. Add exact edits for `.github/workflows/release.yml`, `scripts/tests/release-process.test.js`, `scripts/build_sandbox.js`, `Dockerfile`, `package.json`, `package-lock.json`, and `packages/tools/package.json`.
7. Manual npm trusted publishing setup lacks a required artifact/check. Require `project-plans/issue1585/manual-trusted-publishing.md` or equivalent and verify it names `@vybestack/llxprt-code-tools`, repository, workflow, environment/branch rules, and package-name reservation.
8. Consumer inventory is incomplete. Add explicit coverage for policy, hooks, runtime, services, test-utils, utils, lsp tests/integration, package exports, provider test mocks, and dynamic imports in addition to registry/scheduler/config/agents/confirmation-bus/telemetry/prompts/storage/todo/providers.
9. `tool-key-storage.ts` is not mandatory enough despite issue requirements. Add it to formal move/retain requirements with tests for masking/key-storage behavior and an `IToolKeyStorage` or storage-package boundary.
10. MCP ownership remains ambiguous. Decide whether `mcp-tool.ts` moves behind `IMcpToolService`, and whether `mcp-client.ts`/`mcp-client-manager.ts` stay in core or move to `packages/core/src/mcp/**`.
11. Cleanup expectations conflict with retained infrastructure in `packages/core/src/tools`. Add a final directory policy and approved retained-file list; verify no re-export shims.
12. TDD phases do not name actual behavioral regression tests. Define required tests for filesystem, edit/apply-patch/AST, registry/scheduler integration, provider formatting/ID normalization, shell/todo/MCP where in scope, and boundary scans.
13. Individual verification phases mostly check completion marker existence and print the matrix. Replace with phase-specific typecheck/test/grep/build/release commands.
14. Provider extraction pattern is referenced but not concretely applied. Require `packages/tools/package.json` to follow `packages/providers/package.json` conventions and update core/providers dependencies.
15. Package export policy is unclear. Define whether providers import top-level or subpath exports; recommended explicit subpath exports matching current provider-needed modules without core deep-import shims.

## Pedantic issues

1. `00-overview.md` says “Total Phases: 16 plus verification phases” while the tracker contains many lettered phases through `16a`; use an exact executable phase count or list phase IDs.
2. `Phase 0.5` vs `00a` naming is inconsistent. State explicitly that `00a` is the mandatory preflight equivalent.
3. Letter-suffixed phase IDs may need explicit grep examples because dev-doc examples assume numeric phases.
4. Boilerplate line “For code changes, include plan and requirement markers” appears in pure analysis/review phases where no code should change.
5. Many prerequisites say only “previous phase completed” instead of naming the previous phase and expected artifacts.
6. Release order analysis should reconcile current test expectation order versus release.yml order when adding tools.
7. `npm run test --workspaces --if-present` is fine as supplemental, but final canonical verification should be the project-memory commands.
8. “No user configuration or data migration is expected” is correct, but key storage/memory path behavior still needs regression coverage.

## Missing evidence/commands

1. `gh issue view 1585 --comments --json title,body,comments`
2. `find packages/core/src/tools -type f | sort > project-plans/issue1585/analysis/current-tools-files.txt`
3. `grep -RIn "\.\./tools/\|\.\./\.\./tools/\|@vybestack/llxprt-code-core/tools/" packages --include='*.ts' > project-plans/issue1585/analysis/all-tool-consumers.txt`
4. `node -e "const p=require('./packages/core/package.json'); console.log(Object.keys(p.exports||{}).filter(k=>k.startsWith('./tools/')).join('\n'))"`
5. `grep -RIn "@vybestack/llxprt-code-core/tools/" packages/providers/src --include='*.ts'`
6. `grep -RIn "from ['\"]\.\./\(config\|confirmation-bus\|services\|core\|mcp\|ide\|lsp\|storage\|debug\|utils\)/" packages/core/src/tools --include='*.ts'`
7. Post-extraction package checks: `npm ls @vybestack/llxprt-code-tools`, `npm run typecheck --workspace @vybestack/llxprt-code-tools`, `npm run build --workspace @vybestack/llxprt-code-tools`
8. Forbidden dependency checks: `grep -RIn "@vybestack/llxprt-code-core\|packages/core/src\|@vybestack/llxprt-code-providers\|packages/providers/src\|packages/cli/src" packages/tools/src --include='*.ts'`
9. Release checks: `npm run test:scripts`, `node scripts/bind-release-deps.js --dry-run`, `grep -n "@vybestack/llxprt-code-tools" .github/workflows/release.yml scripts/tests/release-process.test.js scripts/build_sandbox.js Dockerfile package.json packages/tools/package.json`
10. Final verification: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, `node scripts/start.js --profile-load waferglm5 "write me a haiku and nothing else"`

## Suggested edits

See review output; implement all exact additions around approved temporary adapter path, exact interface file list, required inventory commands, required behavioral tests, exact release changes, and no-shim verification.
