# Reimplement f4330c9f — remove support for workspace extensions and migrations (#11324)

Upstream: https://github.com/google-gemini/gemini-cli/commit/f4330c9f5ef495b8787606c135157a4b5f24ca67
Areas: cli
Rationale: Workspace extensions/migrations removal conflicts with llxprt

## Upstream Files
- `packages/cli/src/commands/extensions/list.ts` (exists: YES)
- `packages/cli/src/commands/extensions/update.ts` (exists: YES)
- `packages/cli/src/commands/mcp/list.ts` (exists: YES)
- `packages/cli/src/config/config.test.ts` (exists: YES)
- `packages/cli/src/config/extension.test.ts` (exists: YES)
- `packages/cli/src/config/extension.ts` (exists: YES)
- `packages/cli/src/config/extensions/extensionEnablement.test.ts` (exists: YES)
- `packages/cli/src/config/extensions/extensionEnablement.ts` (exists: YES)
- `packages/cli/src/config/extensions/update.test.ts` (exists: YES)
- `packages/cli/src/gemini.tsx` (exists: YES)
- `packages/cli/src/ui/AppContainer.test.tsx` (exists: NO)
- `packages/cli/src/ui/AppContainer.tsx` (exists: YES)
- `packages/cli/src/ui/components/DialogManager.tsx` (exists: YES)
- `packages/cli/src/ui/components/WorkspaceMigrationDialog.tsx` (exists: YES)
- `packages/cli/src/ui/contexts/UIActionsContext.tsx` (exists: YES)
- `packages/cli/src/ui/contexts/UIStateContext.tsx` (exists: YES)
- `packages/cli/src/ui/hooks/useExtensionUpdates.test.ts` (exists: YES)
- `packages/cli/src/ui/hooks/useWorkspaceMigration.ts` (exists: YES)
- `packages/cli/src/zed-integration/zedIntegration.ts` (exists: YES)

## Implementation Steps
1. Inspect upstream diff: `git show f4330c9f --stat`.
2. Review each touched file: `git show f4330c9f -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: remove support for workspace extensions and migrations (#11324) (upstream f4330c9f)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

