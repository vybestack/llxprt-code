## Task 05 – MCP Tool Namespacing

### Summary
- Applied upstream MCP namespacing patches (136a52243, c73f6396a, 75f81ae73) without creating commits, preserving a dirty worktree per instructions.
- Ensured `DiscoveredMCPTool` now emits namespaced identifiers (`mcp__${server}__${tool}`), updated CLI status output to render human-friendly names, and tightened registry collision handling.
- Reviewed provider configuration helpers (`packages/cli/src/providers/providerConfigUtils.ts`) and provider manager wiring to confirm no assumptions about legacy tool IDs; no code changes required.

### Conflicts & Resolutions
- No merge conflicts occurred during the cherry-picks. Manual audit focused on aligning comments and ensuring the registry comment references the new namespace format.

### Verification
```
pnpm exec vitest run --root packages/core src/tools/mcp-tool.test.ts src/tools/tool-registry.test.ts
pnpm exec vitest run --root packages/cli src/ui/commands/mcpCommand.test.ts
pnpm exec eslint packages/core/src/tools/mcp-tool.ts packages/core/src/tools/tool-registry.ts packages/cli/src/ui/commands/mcpCommand.ts
```
All commands completed successfully.

### Follow-up
- Monitor downstream agent/subagent integrations once subagent suites run, to confirm no latent dependencies on pre-namespaced tool IDs remain.
