# typescriptreviewer Review 04

## Verdict

FAIL

## Must-fix issues

1. Package dependency direction is internally inconsistent for CLI across `project-plans/issue1585/specification.md`, `analysis/final-architecture.md`, `analysis/package-metadata-constraints.md`, and `plan/13-consumer-migration.md`. Make all artifacts agree that CLI does not depend directly on tools unless direct imports are introduced.
2. `ISettingsService`, `IPromptRegistryService`, `IToolHost`, `IStorageService`, and related interfaces in `analysis/interface-contracts-detailed.md` are not concrete enough compared to current `Config` usage. Add exact TypeScript signatures, return types, adapter delegates, and test coverage for every config/core method used by moved tools.
3. `analysis/dependency-relocation-final.md` dependency inventory is not sufficient for a publishable package. Add a transitive post-move external import scan, classify every moved production import, and include package tarball install smoke tests.
4. MCP ownership remains too conditional in `analysis/final-architecture.md` and `plan/11-tool-move-impl.md`. Add a pre-P11 decision artifact that inspects current `mcp-tool.ts` and records a final `MOVE_AFTER_INTERFACE` or `STAY_CORE_INFRASTRUCTURE` decision.
5. Tool key storage requirement is contradictory: `specification.md` says `tool-key-storage.ts` must be moved, but architecture correctly says SecureStore-backed `ToolKeyStorage` stays in core. Rewrite REQ-MOVE-001.5 to explicitly split pure functions/interfaces into tools and SecureStore implementation into core.
6. Release publish command for tools in `analysis/release-process.md` and `plan/14-release-process.md` omits existing release `--tag=${{ steps.version.outputs.NPM_TAG }}` and dry-run expression. Match current release.yml publish semantics.
7. Sandbox pack order is inconsistent in P14/release-process: target snippet packs CLI before core and omits providers while Dockerfile includes providers. Use one consistent order in build-sandbox workflow, build_sandbox.js, Dockerfile, and release tests: tools, core, providers, cli.
8. `scripts/build_sandbox.js` chmod behavior is specified inconsistently: plan says tools tarball chmod 644 while current script uses 755 for existing tarballs. Specify one consistent mode.
9. A2A server consumers are missing from explicit classification despite `packages/a2a-server` using ToolRegistry through Config. Add A2A classification and typecheck/test verification.
10. P10 creates tests in `packages/tools` before making explicit that P06-P08 created a resolvable stub package. Add prerequisite and module-resolution verification.
11. P11 tells agents to add TODO/progress comments for mechanical moves, conflicting with no-TODO/no-comment rules and cleanup scans. Track progress in completion artifacts instead of production code.

## Pedantic issues

1. `plan/14-release-process.md` duplicates the Step 7 assertion that tools appears before core in the build-sandbox pack sequence.
2. `plan/12-core-adapters-and-registry-integration.md` has a malformed/nested markdown code fence in Verification Commands.
3. Several plan commands mix `grep` and `rg`; prefer consistent `rg -n ... -g "*.ts"` for portability.
4. `plan/00a-preflight-verification.md` still has wording that sounds like implementation must stop unless the plan is updated, even though the temporary interface-adapter path has been approved.
5. `analysis/final-architecture.md` contains review-cycle metadata (`Revised`, review notes) that is not harmful but should be cleaned for a final execution plan.
6. P10 fixture examples contain placeholder comments; clarify that real concrete golden values must be captured before migration.
7. `npm run format && git diff --quiet` checks may fail because completion artifacts are intentionally new/changed unless the plan specifies when to run the diff check or scopes it to code files.

## Missing evidence/commands

1. Add evidence commands proving missing `packages/settings`, `packages/storage`, and `packages/mcp` are reconciled with current core modules:
   `find packages -maxdepth 1 -type d -name settings -o -name storage -o -name mcp`
   `rg -n "SettingsService|SecureStore|McpClientManager|PromptRegistry" packages/core/src packages/cli/src packages/providers/src -g "*.ts"`
2. Add clean published-package smoke test for tools tarball: pack tools, install it into a temp project, and import `@vybestack/llxprt-code-tools`.
3. Add A2A verification: `npm run typecheck --workspace @vybestack/llxprt-code-a2a-server` and `npm run test --workspace @vybestack/llxprt-code-a2a-server`.
4. Add `package-lock.json` assertions: verify `packages/tools` exists and core/providers package-lock entries include tools dependencies after install.
5. Add root workspace assertion: `node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/tools')) process.exit(1)"`.
6. Add complete post-move external dependency scan: `rg -n "^import .* from ['\"][^./]" packages/tools/src -g "*.ts" | sort` plus comparison against `packages/tools/package.json` dependencies.

## Suggested edits

1. Replace dependency direction blocks with:

```text
packages/tools      -> no core/cli/providers imports
packages/core       -> packages/tools
packages/providers  -> packages/tools + packages/core as still required by issue #1584 interim architecture
packages/cli        -> packages/core + packages/providers only
packages/cli        -X-> packages/tools unless direct imports are intentionally added and documented
```

2. Replace REQ-MOVE-001.5 with:

```text
Tool key storage ownership MUST be split: IToolKeyStorage and pure utility functions (maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName) move to packages/tools; the SecureStore/@napi-rs/keyring-backed ToolKeyStorage implementation remains in packages/core until packages/storage exists. CoreToolKeyStorageAdapter implements IToolKeyStorage and owns the SecureStore-backed lifecycle.
```

3. Use this tools publish step in release.yml planning:

```yaml
- name: Publish @vybestack/llxprt-code-tools
  if: ${{ steps.vars.outputs.should_run_standard_release == 'true' }}
  run: npm publish --workspace=@vybestack/llxprt-code-tools --access public --provenance --tag=${{ steps.version.outputs.NPM_TAG }} ${{ steps.vars.outputs.is_dry_run == 'true' && '--dry-run' || '' }}
```

4. Use this sandbox pack order consistently:

```bash
npm pack -w @vybestack/llxprt-code-tools --pack-destination ./packages/tools/dist
npm pack -w @vybestack/llxprt-code-core --pack-destination ./packages/core/dist
npm pack -w @vybestack/llxprt-code-providers --pack-destination ./packages/providers/dist
npm pack -w @vybestack/llxprt-code --pack-destination ./packages/cli/dist
```

5. Add A2A consumer section:

```markdown
packages/a2a-server does not import core tool deep paths directly, but consumes Config.getToolRegistry() and ToolRegistry-shaped values through packages/a2a-server/src/agent/task.ts, packages/a2a-server/src/utils/testing_utils.ts, and packages/a2a-server/src/http/app.test.ts. Required verification: npm run typecheck --workspace @vybestack/llxprt-code-a2a-server; npm run test --workspace @vybestack/llxprt-code-a2a-server.
```

6. Replace P11 TODO/comment tracking with:

```text
Do not add TODO/progress comments to production files. Track large mechanical move progress in project-plans/issue1585/.completed/P11-files.md with one row per moved file: source, destination, classification, adapter/interface used, import rewrites completed, tests run.
```

7. Add P16 tarball smoke test:

```bash
rm -rf /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
mkdir -p /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
npm pack -w @vybestack/llxprt-code-tools --pack-destination /tmp/llxprt-tools-pack
cd /tmp/llxprt-tools-smoke
npm init -y
npm install /tmp/llxprt-tools-pack/vybestack-llxprt-code-tools-*.tgz
node -e "import('@vybestack/llxprt-code-tools').then(m => { if (!Object.keys(m).length) process.exit(1); })"
```

8. Add package-lock/root workspace assertions:

```bash
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) process.exit(1)"
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/tools')) process.exit(1)"
```
