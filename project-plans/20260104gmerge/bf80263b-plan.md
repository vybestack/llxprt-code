# Reimplement bf80263b — feat: Implement message bus and policy engine (#11523)

Upstream: https://github.com/google-gemini/gemini-cli/commit/bf80263bd64bfada12df13e3f8855758eb3ae866
Areas: cli, core, integration-tests
Rationale: Message bus/policy engine overhaul; port carefully with llxprt tool names

## Upstream Files
- `integration-tests/replace.test.ts` (exists: YES)
- `packages/cli/src/config/policy.test.ts` (exists: NO)
- `packages/cli/src/config/policy.ts` (exists: NO)
- `packages/cli/src/gemini.test.tsx` (exists: YES)
- `packages/cli/src/gemini.tsx` (exists: YES)
- `packages/core/src/config/config.ts` (exists: YES)
- `packages/core/src/confirmation-bus/message-bus.ts` (exists: YES)
- `packages/core/src/confirmation-bus/types.ts` (exists: YES)
- `packages/core/src/index.ts` (exists: YES)
- `packages/core/src/tools/glob.ts` (exists: YES)
- `packages/core/src/tools/grep.ts` (exists: YES)
- `packages/core/src/tools/ls.ts` (exists: YES)
- `packages/core/src/tools/read-file.ts` (exists: YES)
- `packages/core/src/tools/read-many-files.ts` (exists: YES)
- `packages/core/src/tools/ripGrep.ts` (exists: YES)
- `packages/core/src/tools/tools.ts` (exists: YES)
- `packages/core/src/tools/web-fetch.test.ts` (exists: NO)
- `packages/core/src/tools/web-fetch.ts` (exists: NO)
- `packages/core/src/tools/web-search.ts` (exists: NO)

## Implementation Steps
1. Inspect upstream diff: `git show bf80263b --stat`.
2. Review each touched file: `git show bf80263b -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: feat: Implement message bus and policy engine (#11523) (upstream bf80263b)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

