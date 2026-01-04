# Reimplement 9b9ab609 — feat(logging): Centralize debug logging with a dedicated utility (#11417)

Upstream: https://github.com/google-gemini/gemini-cli/commit/9b9ab60985681a77ee558acb886b7c6ce96bbb29
Areas: cli, core
Rationale: Debug logger already exists; upstream debugLogger is different

## Upstream Files
- `packages/cli/src/ui/contexts/KeypressContext.tsx` (exists: YES)
- `packages/core/src/index.ts` (exists: YES)
- `packages/core/src/utils/debugLogger.test.ts` (exists: NO)
- `packages/core/src/utils/debugLogger.ts` (exists: NO)

## Implementation Steps
1. Inspect upstream diff: `git show 9b9ab609 --stat`.
2. Review each touched file: `git show 9b9ab609 -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: feat(logging): Centralize debug logging with a dedicated utility (#11417) (upstream 9b9ab609)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

