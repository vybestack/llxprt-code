# Reimplement 98eef9ba — fix: Update web_fetch tool definition to instruct the model to provid… (#11252)

Upstream: https://github.com/google-gemini/gemini-cli/commit/98eef9ba0c5c5dfa57a74af9fecea43698d0a309
Areas: core
Rationale: web_fetch tool definition update; needs llxprt tool name mapping

## Upstream Files
- `packages/core/src/tools/web-fetch.ts` (exists: NO)

## Implementation Steps
1. Inspect upstream diff: `git show 98eef9ba --stat`.
2. Review each touched file: `git show 98eef9ba -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: fix: Update web_fetch tool definition to instruct the model to provid… (#11252) (upstream 98eef9ba)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

