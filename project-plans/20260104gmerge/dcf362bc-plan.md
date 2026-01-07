# Reimplement dcf362bc — Inline tree-sitter wasm and add runtime fallback (#11157)

Upstream: https://github.com/google-gemini/gemini-cli/commit/dcf362bcf9b30e6cd42b1cc5fd7948167ec32852
Areas: cli, core, docs, esbuild.config.js, integration-tests, repo
Rationale: Tree-sitter wasm bundling + shell tool runtime fallback (needs llxprt adaptation)

## Upstream Files
- `docs/cli/commands.md` (exists: YES)
- `docs/tools/shell.md` (exists: YES)
- `esbuild.config.js` (exists: YES)
- `integration-tests/flicker.test.ts` (exists: NO)
- `integration-tests/run_shell_command.test.ts` (exists: YES)
- `package-lock.json` (exists: YES)
- `package.json` (exists: YES)
- `packages/cli/src/services/prompt-processors/shellProcessor.test.ts` (exists: YES)
- `packages/core/package.json` (exists: YES)
- `packages/core/src/services/shellExecutionService.test.ts` (exists: YES)
- `packages/core/src/services/shellExecutionService.ts` (exists: YES)
- `packages/core/src/tools/__snapshots__/shell.test.ts.snap` (exists: YES)
- `packages/core/src/tools/shell.test.ts` (exists: YES)
- `packages/core/src/tools/shell.ts` (exists: YES)
- `packages/core/src/utils/fileUtils.ts` (exists: YES)
- `packages/core/src/utils/shell-utils.test.ts` (exists: YES)
- `packages/core/src/utils/shell-utils.ts` (exists: YES)
- `packages/core/tsconfig.json` (exists: YES)

## Implementation Steps
1. Inspect upstream diff: `git show dcf362bc --stat`.
2. Review each touched file: `git show dcf362bc -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: Inline tree-sitter wasm and add runtime fallback (#11157) (upstream dcf362bc)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

