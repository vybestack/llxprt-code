# Reimplement b8df8b2a — feat(core): wire up UI for ASK_USER policy decisions in message bus (#10630)

Upstream: https://github.com/google-gemini/gemini-cli/commit/b8df8b2ab8b673bbb4177669eff65988c67502ed
Areas: a2a-server, cli, core
Rationale: Policy/message-bus wiring diverges; port carefully into llxprt message bus + tool policy

## Upstream Files
- `packages/a2a-server/src/utils/testing_utils.ts` (exists: YES)
- `packages/cli/src/ui/hooks/useToolScheduler.test.ts` (exists: YES)
- `packages/core/src/confirmation-bus/types.ts` (exists: YES)
- `packages/core/src/core/coreToolScheduler.test.ts` (exists: YES)
- `packages/core/src/core/coreToolScheduler.ts` (exists: YES)
- `packages/core/src/core/nonInteractiveToolExecutor.test.ts` (exists: YES)
- `packages/core/src/tools/message-bus-integration.test.ts` (exists: NO)
- `packages/core/src/tools/tools.ts` (exists: YES)
- `packages/core/src/tools/web-fetch.test.ts` (exists: NO)
- `packages/core/src/tools/web-fetch.ts` (exists: NO)

## Implementation Steps
1. Inspect upstream diff: `git show b8df8b2a --stat`.
2. Review each touched file: `git show b8df8b2a -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: feat(core): wire up UI for ASK_USER policy decisions in message bus (#10630) (upstream b8df8b2a)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

