# typescriptreviewer Review 06

## Verdict

FAIL

## Must-fix issues

1. Consumer inventory is not actually exhaustive. `specification.md:120-133`, `analysis/all-tool-consumers-final.md:11-24`, and `plan/13-consumer-migration.md:45-48` miss top-level `evals/**` and `integration-tests/**` consumers and use a packages-only command in P13. Remediate by changing P13 to the repo-wide scan and adding rows for `evals/globalSetup.ts`, `integration-tests/globalSetup.ts`, `integration-tests/google_web_search.test.ts`, `packages/core/src/index.ts` re-exports, and LSP `new URL('../../tools/...')` entries.
2. `lsp-diagnostics-helper.ts` is omitted from the move/retain decision. It exists under `packages/core/src/tools/`, but `analysis/tool-move-map.md`, `final-architecture.md`, and P11/P15 do not classify it. Add it as `MOVE_AFTER_INTERFACE` with `ILspService` or as `STAY_CORE_INFRASTRUCTURE` with rationale and retained allowlist updates.
3. Non-tools core dependency relocation is still too vague. `final-architecture.md:170-189`, `dependency-relocation-final.md:151-167`, and `plan/11-tool-move-impl.md:47-50` require a map that does not exist. Add `analysis/non-tools-core-dependency-map.md` seeded from actual imports and classify every non-tools import before P10/P11.
4. Interface mapping has contradictions. In `interface-contracts-detailed.md`, `getConversationLoggingEnabled` and `getDebugMode` are both explicit `IToolHost` methods but are also mapped through `hasFeatureFlag`; `getSettingsService` maps to `IStorageService / ITodoService` instead of `ISettingsService`; `debugLogger` is undecided between no-op and `ILogger`. Normalize these mappings and choose one debug logging strategy.
5. P10 TDD verification is ambiguous. `plan/10-tool-move-tdd.md` runs tests without stating that failures are expected in RED state against stubs. Add explicit compile-pass/test-fail expectations so tests are not weakened to pass against stubs.
6. Required issue/comment evidence artifact is missing. `specification.md` and `00-overview.md` reference `analysis/issue-body-and-comments.md`, but it is not present. Add the artifact with issue body, comments, and mapping to requirements.
7. Important actual consumers are under-covered. Add explicit sections for runtime, hooks, utils, LSP, storage, todo, evals, and integration-tests in `analysis/all-tool-consumers-final.md` and P13.
8. Release tarball chmod is inconsistent: `release-process.md` says `0o755`, while P08/pseudocode/final review mention `644`. Inspect current `scripts/build_sandbox.js`, choose one value, and update all references.
9. Provider migration should be generated/cross-checked from actual `rg` output. Add an automated checklist from `rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts"` and require every row be crossed off.
10. Core top-level re-export behavior is not concrete enough. Add `analysis/core-top-level-tool-export-manifest.md` enumerating every current `packages/core/src/index.ts` tool export, final source, and consumer need.

## Pedantic issues

1. `plan/00-overview.md:5` includes revision history; not a blocker, but avoid including revision context in prompts for clean external review.
2. `dependency-relocation-final.md` has inconsistent verification dates: generated/verified on 2026-06-08 in one place but says 2026-06-05 elsewhere.
3. `dependency-relocation-final.md` repeats the per-file external import classification section.
4. `plan/12-core-adapters-and-registry-integration.md:146-147` repeats the same adapter count command.
5. `analysis/release-process.md` duplicates the `.github/workflows/build-sandbox.yml` section.
6. `plan/10-tool-move-tdd.md` has a capitalization typo: “FORbidden”.
7. `plan/10-tool-move-tdd.md` has duplicate “Step 2” headings.
8. `analysis/final-architecture.md:73-91` has a malformed ownership table row/sentence for core adapters.

## Missing evidence/commands

1. `analysis/issue-body-and-comments.md` is missing despite being listed in spec/overview.
2. `analysis/non-tools-core-dependency-map.md` is missing despite being a critical P11 gate.
3. `analysis/all-tool-consumers-final.txt` raw evidence is missing or not visible, though the markdown requires it.
4. `analysis/tool-config-usage.txt` raw evidence is missing or not visible, though multiple files require it.
5. `analysis/mcp-tool-decision.md` is missing as a pre-P11 gating artifact.
6. `analysis/tools-public-export-manifest.json` / `.md` is missing or not visible, though P10 references it.
7. No concrete package/core top-level export manifest exists for all current and final exports.
8. No repository-wide post-migration scan command includes `evals/**` and `integration-tests/**`.
9. Suggested missing commands:

```bash
rg -n "@vybestack/llxprt-code-core/tools/|['\"]\.?\.?/.*tools/|import\(.*tools|vi\.mock\(.*tools|new URL\(.*tools" . \
  -g "*.ts" -g "*.tsx" -g "*.js" -g "*.cjs" -g "*.mjs" -g "*.json" \
  -g "!packages/*/dist/**" -g "!node_modules/**" -g "!bundle/**" \
  > project-plans/issue1585/analysis/all-tool-consumers-final.txt

rg -n "from ['\"]\.\./(config|core|services|storage|ide|lsp|utils|runtime|confirmation-bus|prompts|agents|scheduler)|from ['\"]\.\./\.\./(config|core|services|storage|ide|lsp|utils|runtime|confirmation-bus|prompts|agents|scheduler)" \
  packages/core/src/tools -g "*.ts" \
  > project-plans/issue1585/analysis/non-tools-core-relative-imports.txt

rg -n "export .* from './tools/" packages/core/src/index.ts \
  > project-plans/issue1585/analysis/core-top-level-tool-export-baseline.txt

gh issue view 1585 --comments \
  > project-plans/issue1585/analysis/issue-body-and-comments.raw.txt
```

## Suggested edits

1. In `plan/13-consumer-migration.md`, replace the Step 0 evidence command with the repo-wide scan from Missing evidence item 9.
2. Add `lsp-diagnostics-helper.ts` classification to `analysis/tool-move-map.md` either as `MOVE_AFTER_INTERFACE` with `ILspService` or `STAY_CORE_INFRASTRUCTURE` with rationale and retained allowlist updates.
3. Add `analysis/non-tools-core-dependency-map.md` with a table seeded from actual imports.
4. In `interface-contracts-detailed.md`, normalize mappings:
   - `getConversationLoggingEnabled()` -> `IToolHost.getConversationLoggingEnabled()`.
   - `getDebugMode()` -> `IToolHost.getDebugMode()`.
   - `getSettingsService()` -> `ISettingsService`.
   - `getPromptRegistry()` -> `IPromptRegistryService`.
5. In `plan/10-tool-move-tdd.md`, make tests compile-pass but behavior-fail in RED state against stubs; failure must not be import resolution/syntax/missing export.
6. Add `analysis/core-top-level-tool-export-manifest.md` with every current `packages/core/src/index.ts` tool export and final disposition.
7. Normalize tarball permissions across `analysis/release-process.md`, `analysis/pseudocode/release-updates.md`, `plan/08-package-scaffold-impl.md`, and `plan/16a-final-review.md` after inspecting current `scripts/build_sandbox.js`.
8. Add `analysis/issue-body-and-comments.md` and link each issue/comment requirement to existing `REQ-*` IDs.
