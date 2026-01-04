# Reimplement 7dd2d8f7 — fix(tools): restore static tool names to fix configuration exclusions (#11551)

Upstream: https://github.com/google-gemini/gemini-cli/commit/7dd2d8f79496143144b665b346f063ff8825cfcb
Areas: core
Rationale: Tool naming consistency differs in llxprt

## Upstream Files
- `packages/core/src/tools/edit.ts` (exists: YES)
- `packages/core/src/tools/glob.ts` (exists: YES)
- `packages/core/src/tools/grep.ts` (exists: YES)
- `packages/core/src/tools/ls.ts` (exists: YES)
- `packages/core/src/tools/memoryTool.ts` (exists: YES)
- `packages/core/src/tools/read-file.ts` (exists: YES)
- `packages/core/src/tools/read-many-files.ts` (exists: YES)
- `packages/core/src/tools/ripGrep.ts` (exists: YES)
- `packages/core/src/tools/shell.ts` (exists: YES)
- `packages/core/src/tools/smart-edit.ts` (exists: YES)
- `packages/core/src/tools/web-fetch.ts` (exists: NO)
- `packages/core/src/tools/web-search.ts` (exists: NO)
- `packages/core/src/tools/write-file.ts` (exists: YES)
- `packages/core/src/tools/write-todos.ts` (exists: NO)

## Implementation Steps
1. Inspect upstream diff: `git show 7dd2d8f7 --stat`.
2. Review each touched file: `git show 7dd2d8f7 -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: fix(tools): restore static tool names to fix configuration exclusions (#11551) (upstream 7dd2d8f7)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

