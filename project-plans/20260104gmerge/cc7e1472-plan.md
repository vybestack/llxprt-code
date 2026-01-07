# Reimplement cc7e1472 — Pass whole extensions rather than just context files (#10910)

Upstream: https://github.com/google-gemini/gemini-cli/commit/cc7e1472f9c51338c5ed1ce15226764caf8ced33
Areas: a2a-server, cli, core
Rationale: Extensions data flow differs (context files); needs adaptation

## Upstream Files
- `packages/a2a-server/src/config/config.ts` (exists: YES)
- `packages/cli/src/commands/extensions/disable.ts` (exists: YES)
- `packages/cli/src/commands/extensions/enable.ts` (exists: YES)
- `packages/cli/src/commands/extensions/update.ts` (exists: YES)
- `packages/cli/src/commands/mcp/list.ts` (exists: YES)
- `packages/cli/src/config/config.integration.test.ts` (exists: YES)
- `packages/cli/src/config/config.test.ts` (exists: YES)
- `packages/cli/src/config/config.ts` (exists: YES)
- `packages/cli/src/config/extension.test.ts` (exists: YES)
- `packages/cli/src/config/extension.ts` (exists: YES)
- `packages/cli/src/config/extensions/github.test.ts` (exists: YES)
- `packages/cli/src/config/extensions/github.ts` (exists: YES)
- `packages/cli/src/config/extensions/update.test.ts` (exists: YES)
- `packages/cli/src/config/extensions/update.ts` (exists: YES)
- `packages/cli/src/config/extensions/variableSchema.ts` (exists: YES)
- `packages/cli/src/config/settings.test.ts` (exists: YES)
- `packages/cli/src/config/settings.ts` (exists: YES)
- `packages/cli/src/gemini.tsx` (exists: YES)
- `packages/cli/src/ui/AppContainer.tsx` (exists: YES)
- `packages/cli/src/ui/commands/directoryCommand.test.tsx` (exists: YES)
- `packages/cli/src/ui/commands/directoryCommand.tsx` (exists: YES)
- `packages/cli/src/ui/commands/memoryCommand.test.ts` (exists: YES)
- `packages/cli/src/ui/commands/memoryCommand.ts` (exists: YES)
- `packages/cli/src/ui/components/views/ExtensionsList.test.tsx` (exists: NO)
- `packages/cli/src/ui/components/views/ExtensionsList.tsx` (exists: NO)
- `packages/cli/src/ui/components/views/McpStatus.tsx` (exists: NO)
- `packages/cli/src/ui/hooks/useExtensionUpdates.test.ts` (exists: YES)
- `packages/cli/src/ui/hooks/useExtensionUpdates.ts` (exists: YES)
- `packages/cli/src/zed-integration/zedIntegration.ts` (exists: YES)
- `packages/core/src/config/config.ts` (exists: YES)
- `packages/core/src/tools/mcp-client-manager.test.ts` (exists: YES)
- `packages/core/src/tools/mcp-client-manager.ts` (exists: YES)
- `packages/core/src/tools/tool-registry.ts` (exists: YES)
- `packages/core/src/utils/memoryDiscovery.test.ts` (exists: YES)
- `packages/core/src/utils/memoryDiscovery.ts` (exists: YES)

## Implementation Steps
1. Inspect upstream diff: `git show cc7e1472 --stat`.
2. Review each touched file: `git show cc7e1472 -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: Pass whole extensions rather than just context files (#10910) (upstream cc7e1472)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

