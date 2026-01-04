# Reimplement c9c633be — refactor: move `web_fetch` tool name to `tool-names.ts` (#11174)

Upstream: https://github.com/google-gemini/gemini-cli/commit/c9c633be627ebbbba017369ad9d638cd7b2ff81a
Areas: cli, core
Rationale: Tool naming: web_fetch constant differs (llxprt uses google_web_fetch/direct_web_fetch)

## Upstream Files
- `packages/cli/src/config/policy.test.ts` (exists: NO)
- `packages/cli/src/config/policy.ts` (exists: NO)
- `packages/core/src/tools/tool-names.ts` (exists: YES)
- `packages/core/src/tools/web-fetch.ts` (exists: NO)

## Implementation Steps
1. Inspect upstream diff: `git show c9c633be --stat`.
2. Review each touched file: `git show c9c633be -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: refactor: move `web_fetch` tool name to `tool-names.ts` (#11174) (upstream c9c633be)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

