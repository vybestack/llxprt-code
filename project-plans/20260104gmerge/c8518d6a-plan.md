# Reimplement c8518d6a — refactor(tools): Move all tool names into tool-names.ts (#11493)

Upstream: https://github.com/google-gemini/gemini-cli/commit/c8518d6a630b182e4c6e90819b26ca19089ee395
Areas: cli, core
Rationale: Tool name refactor conflicts with llxprt tool names

## Upstream Files
- `packages/cli/src/config/config.test.ts` (exists: YES)
- `packages/cli/src/config/config.ts` (exists: YES)
- `packages/cli/src/config/policy.ts` (exists: NO)
- `packages/core/src/agents/codebase-investigator.ts` (exists: YES)
- `packages/core/src/agents/executor.test.ts` (exists: YES)
- `packages/core/src/agents/executor.ts` (exists: YES)
- `packages/core/src/core/prompts.ts` (exists: YES)
- `packages/core/src/tools/edit.ts` (exists: YES)
- `packages/core/src/tools/glob.ts` (exists: YES)
- `packages/core/src/tools/ls.ts` (exists: YES)
- `packages/core/src/tools/memoryTool.ts` (exists: YES)
- `packages/core/src/tools/smart-edit.ts` (exists: YES)
- `packages/core/src/tools/tool-names.ts` (exists: YES)
- `packages/core/src/tools/web-fetch.ts` (exists: NO)
- `packages/core/src/tools/web-search.ts` (exists: NO)
- `packages/core/src/tools/write-file.ts` (exists: YES)
- `packages/core/src/tools/write-todos.ts` (exists: NO)

## Implementation Steps
1. Inspect upstream diff: `git show c8518d6a --stat`.
2. Review each touched file: `git show c8518d6a -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: refactor(tools): Move all tool names into tool-names.ts (#11493) (upstream c8518d6a)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

