# typescriptreviewer Review 10

## Verdict

FAIL

## Must-fix issues

1. P10/P11 test sequencing is contradictory: P10 creates all active tools behavioral tests before moves, while P11 requires full tools test suite after each migration group. Add group-scoped test tags/activation and run only current+completed group tests until all groups finish. References: `project-plans/issue1585/plan/10-tool-move-tdd.md`, `plan/11-tool-move-impl.md`.
2. P11 Group 3 moves key-storage-dependent web tools (`codesearch`, `exa-web-search`, `google-web-search`) before `CoreToolKeyStorageAdapter` exists in Group 5. Move these tools to Group 5/7 or create the adapter before Group 3 and update canonical assignments. Reference: `plan/11-tool-move-impl.md`.
3. Cleanup verification only checks `*.ts` under `packages/core/src/tools` and can leave snapshots/fixtures/non-TS artifacts. Add all-file retained artifact verification with `find packages/core/src/tools -type f | sort` and classify every remaining file. References: `plan/15-cleanup-no-shims.md`, `plan/15a-cleanup-no-shims-verification.md`, `plan/16-full-verification.md`.
4. P13 contains invalid ripgrep negative-lookahead commands; ripgrep Rust regex does not support lookaround. Replace with separate scans or perl-based checks. Reference: `plan/13-consumer-migration.md`.
5. `manual-trusted-publishing.md` still has placeholder/verify fields for environment and branch/tag rules. Convert to an explicit manual gate requiring exact npm UI baseline values from existing packages before release, or fill exact values. Reference: `project-plans/issue1585/manual-trusted-publishing.md`.
6. `plan/00-overview.md` references non-existent `manual/trusted-publishing.md` instead of `project-plans/issue1585/manual-trusted-publishing.md`.
7. P11 prerequisite text for MCP/LSP decision artifacts is malformed/interleaved and easy to misexecute. Split into separate MCP and LSP decision artifact gates with exact commands and required content. Reference: `plan/11-tool-move-impl.md`.
8. `zod-to-json-schema` core dependency remediation is identified in `dependency-relocation-final.md` but not assigned clearly to an execution phase. Add explicit task to add `zod-to-json-schema ^3.25.1` to `packages/core/package.json` and verify package-lock. References: `analysis/dependency-relocation-final.md`, `packages/core/package.json`.

## Pedantic issues

1. Phase numbering uses `00a`/`02b`/`02c` etc., diverging from strict dev-docs sequential-number guidance. The manifest makes it workable, but the plan should state this is an intentional refactor-plan adaptation.
2. Some phase names still sound feature-oriented rather than mechanical-refactor-oriented; cosmetic only.
3. P10 has duplicate Step 3 headings. Rename the second to Step 4.
4. P13 has duplicate Step 8 headings. Collapse after replacing invalid regex commands.
5. P16 Step 1 uses `git diff --quiet`, which conflicts with later project-plans exclusions. Prefer `npm run format:check` or `git diff --quiet -- ':!project-plans/'`.
6. P14 wording says `scripts/version.js actualWorkspaces` determines publish order. Safer wording: it determines version-processing order and must be consistent with actual `release.yml` publish order.

## Missing evidence

1. Missing all-file cleanup evidence for `packages/core/src/tools/**`. Add `find packages/core/src/tools -type f | sort > project-plans/issue1585/analysis/core-tools-final-files.txt` and require classification of every row.
2. Missing group-scoped P11 test-command matrix mapping each migration group to the tests/tags that must pass at that point.
3. Missing explicit verification that `packages/tools` does not depend on future/missing packages `@vybestack/llxprt-code-settings`, `@vybestack/llxprt-code-storage`, or `@vybestack/llxprt-code-mcp` until those packages exist.
4. Trusted publisher evidence remains placeholder/manual. Add a filled baseline table from existing npm package access settings or mark first release blocked until exact values are recorded.
5. Ensure P13/P16 duplicate top-level-export compatibility command from `analysis/top-level-export-compatibility-evidence.md` to prove no dangling core `./tools/*` deep exports remain except retained infrastructure.

## Suggested edits

1. Add to `plan/11-tool-move-impl.md`: a Group-Scoped Test Rule stating P10 creates all tests but P11 group verification runs only current+previous group tests; full tools suite is required only after all applicable groups complete.
2. In P11 Group 3, remove `codesearch.ts`, `exa-web-search.ts`, and `google-web-search.ts` if they require `IToolKeyStorage`; add them to Group 5 or Group 7 with explicit `IToolKeyStorage` constructor/adapters.
3. Add to P15a/P16: `find packages/core/src/tools -type f | sort > project-plans/issue1585/analysis/core-tools-final-files.txt` and require every remaining file to match an approved retained-file allowlist including snapshots/fixtures.
4. Replace all P13 `rg` commands using `(?!...)` with separate non-lookaround scans; specifically separate old-path scans from symbol-aware key-storage scans.
5. Replace `plan/00-overview.md` artifact path `manual/trusted-publishing.md` with `project-plans/issue1585/manual-trusted-publishing.md`.
6. Rewrite P11 MCP/LSP prerequisites into two separate gates: `analysis/mcp-tool-decision.md` and `analysis/lsp-diagnostics-helper-decision.md`, each with its own `rg` import command and required four-field decision content.
7. Add explicit phase task and verification for adding `zod-to-json-schema ^3.25.1` to `packages/core/package.json` and `package-lock.json`.
8. In `manual-trusted-publishing.md`, replace blanks/verify language with a required filled baseline table from existing core/providers npm trusted publisher settings or clearly mark first release blocked until exact values are filled.
9. Add verification command that `packages/tools/package.json` has no dependencies/devDependencies on `@vybestack/llxprt-code-settings`, `@vybestack/llxprt-code-storage`, or `@vybestack/llxprt-code-mcp` until those packages actually exist.
10. Add P13/P16 command: inspect `packages/core/package.json` exports and fail if `./tools/*` exports remain for moved modules, allowing only retained MCP/key-storage infrastructure if intentionally retained.
