# typescriptreviewer Review 05

## Verdict

FAIL

## Must-fix issues

1. Missing architecture for non-tools core utilities/types imported by moved tools. Add an exhaustive `non-tools-core-dependency-map.md` covering imports such as `../utils/paths`, errors, fileUtils, fetch, retry, telemetry/metrics, services/history/IContent, runtime/contracts/RuntimeProviderChat, ide/lsp helpers, debug loggers, etc. Classify each as moved pure utility, tools-owned type, adapter, retained-core, or unresolved.
2. External dependency relocation is incomplete because it scans only current direct imports under `packages/core/src/tools`. Add dependency scans for any non-tools utilities moved into `packages/tools` and require their runtime dependencies in `packages/tools/package.json` before P11.
3. ToolFormatter/provider/history type ownership is unresolved. Define tools-owned structural replacement types for `RuntimeProviderTool`, `ToolCallBlock`, `MediaBlock`/history content shapes, and forbid packages/tools importing core runtime/history contracts.
4. MCP interface instructions contradict themselves. Normalize the rule: `IMcpToolService` is always defined; `CoreMcpToolServiceAdapter` is conditional only if `mcp-tool.ts` moves.
5. `mcp-tool.ts` decision artifact is required by P11 but not created by P09. Add `analysis/mcp-tool-decision.md` to P09 outputs and gate P11 on it.
6. Consumer inventory is too narrow. Replace/supplement package-only TS scan with repository-wide scan covering TS/TSX/JS/CJS/MJS/JSON excluding dist/node_modules/bundle.
7. Behavioral fixture capture is not executable enough and risks placeholder golden files. Require a `capture-pre-extraction-fixtures.mjs` script that runs current implementations and writes fixtures, with scans rejecting placeholders.
8. P10 tests in `packages/tools` may fail at module resolution unless stub exports exist. Require P06-P08 to export stubs/signatures for every P10-tested symbol and add an export manifest.
9. P15 format diff check conflicts with project-plan completion artifacts. Scope git diff to exclude `project-plans` or create completion artifacts after the diff check.
10. ToolRegistry host interface is not exact enough. Add a concrete TypeScript signature containing every current tool-registry Config/provider/settings/prompt/discovery method and verify every current config usage maps to it.
11. Test guidance still uses mocks language without enough guardrails. Clarify allowable infrastructure fakes vs forbidden self-mocking in packages/tools tests; provider mocks may remain only alongside non-mocked formatter integration coverage.

## Pedantic issues

1. Phase numbering is nonstandard: execution starts at P00a while P00 overview is non-executable. Mark P00 explicitly as non-executable in manifest/tracker.
2. `dependency-relocation-final.md` duplicates the Per-File External Import Classification section; clean up to reduce ambiguity.
3. `manual-trusted-publishing.md` rollback wording should not prescribe a patch version bump outside the repository release/versioning process.
4. `ToolKeyStorageFacade` is mentioned in interface-contracts but not clearly scheduled in phase tasks. Either add it to P11 Group 7 or remove the mention.
5. Docker/npm left-to-right install-order claim should be stated as a required/tested ordering, not relied on as an unverified npm behavior.
6. Some grep/rg verification commands count matches but do not fail directly. Prefer failing commands such as `! rg -n pattern file`.

## Missing evidence/commands

1. Non-tools relative dependency inventory:

```bash
rg -n "from ['\"]\.\./" packages/core/src/tools -g "*.ts" | rg -v "from ['\"]\./|from ['\"]\.\./tools/" > project-plans/issue1585/analysis/non-tools-core-relative-imports.txt
```

2. Moved utility dependency scan after classifying utilities to move:

```bash
xargs rg -n "^import .* from ['\"][^./]" < project-plans/issue1585/analysis/moved-non-tools-utils.txt > project-plans/issue1585/analysis/moved-utility-external-imports.txt
```

3. Repository-wide consumer scan:

```bash
rg -n "@vybestack/llxprt-code-core/tools/|from ['\"]\.?/.*tools/|import\\(.*tools|vi\\.mock\\(.*tools|new URL\\(.*tools|\"\./tools/" . -g "*.ts" -g "*.tsx" -g "*.js" -g "*.cjs" -g "*.mjs" -g "*.json" -g "!packages/*/dist/**" -g "!node_modules/**" -g "!bundle/**" > project-plans/issue1585/analysis/all-tool-consumers-final.txt
```

4. MCP import evidence:

```bash
rg -n "^import .* from" packages/core/src/tools/mcp-tool.ts -g "*.ts" > project-plans/issue1585/analysis/mcp-tool-imports.txt
```

5. Fixture capture script execution and placeholder rejection:

```bash
node project-plans/issue1585/analysis/capture-pre-extraction-fixtures.mjs
rg -n "captured from actual|placeholder|TODO|/\\*" packages/tools/src/__tests__/fixtures
# Expected: zero placeholder markers
```

6. A complete package dependency verifier for packages/tools. The current post-move dependency check is only a partial Node snippet; replace with a complete command or script that fails on undeclared external imports.

## Suggested edits

1. Add to `analysis/final-architecture.md`:

```md
## Non-Tools Core Dependency Rule
Moving a file from packages/core/src/tools/** is not sufficient if that file imports utilities, types, or services from elsewhere in packages/core/src/**. Before P11, create analysis/non-tools-core-dependency-map.md from analysis/non-tools-core-relative-imports.txt. Every non-tools relative import used by a moved tool MUST be classified exactly once as MOVE_PURE_UTILITY, MOVE_TYPE_ONLY, TOOLS_OWNED_INTERFACE, CORE_ADAPTER, STAY_WITH_RETAINED_CORE_TOOL, REPLACE_WITH_TOOLS_OWNED_TYPE, or FORBIDDEN_UNRESOLVED. P11 MUST NOT move a tool file until all of its non-tools core imports have entries in this map and no FORBIDDEN_UNRESOLVED entries remain.
```

2. Add to `plan/09-tool-inventory-and-move-map.md` a step to classify non-tools core dependencies using the command above, create `analysis/non-tools-core-dependency-map.md`, and fail P09 if any import lacks a package-local move, tools-owned interface, core adapter, or retained-core rationale.
3. Add to `plan/11-tool-move-impl.md`: before each migration group, verify all non-tools core imports for that group are resolved against `analysis/non-tools-core-dependency-map.md`; no moved file in packages/tools may import from packages/core via package import, copied relative path, or unresolved utility dependency.
4. Fix `analysis/interface-contracts-detailed.md` MCP wording to: `IMcpToolService` is always created in `packages/tools/src/interfaces/IMcpToolService.ts`. `CoreMcpToolServiceAdapter` is created only if `mcp-tool.ts` moves. If `mcp-tool.ts` stays in core, `IMcpToolService` remains as the future packages/mcp boundary, and no core adapter is required in this issue.
5. Add to `plan/09-tool-inventory-and-move-map.md` Files To Create: `analysis/mcp-tool-decision.md`, requiring actual import list, per-import classification, final `MOVE_AFTER_INTERFACE` or `STAY_CORE_INFRASTRUCTURE` decision, and retained allowlist update if staying.
6. Add to `plan/10-tool-move-tdd.md`: create `project-plans/issue1585/analysis/capture-pre-extraction-fixtures.mjs`; script imports current core tool implementations before P11, executes representative behavior against temp files/services, and writes JSON fixtures. Hand-authored placeholder fixture values are forbidden.
7. Add to P06/P08/P10 prerequisites: before P10, `packages/tools` MUST export stub classes/functions for every tool and utility referenced by P10 tests. Stubs may throw NotYetImplemented, but import resolution and constructor signatures must match the target public API. Add `analysis/tools-public-export-manifest.md` mapping every tested symbol to its export path.
8. Change P15 format verification to:

```bash
npm run format
git diff --quiet -- ':!project-plans/'
```

9. Add ToolFormatter type ownership section defining tools-owned structural types for provider/history content and explicitly forbidding imports from `packages/core/src/runtime/contracts` or `packages/core/src/services/history` in `packages/tools`.
10. Add exact `IToolRegistryHost` TypeScript signature with every current tool-registry Config/provider/settings/prompt/discovery method and a verification step mapping every current config usage in `tool-registry.ts` to that interface.
11. Add mock-hygiene rule: `packages/tools` tests must not `vi.mock` the tool/formatter/registry under test; infrastructure fakes are allowed only when primary assertions verify observable behavior. Provider mocks may remain only with non-mocked formatter integration coverage.
