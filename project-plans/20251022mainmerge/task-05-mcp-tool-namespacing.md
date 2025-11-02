## Task 05 – Cherry-pick MCP Tool Namespacing Updates

### Scope
Cherry-pick these upstream commits:

1. `136a52243` – `refactor(tools): Implement namespacing for MCP tool identification`
2. `c73f6396a` – `refactor: optimize MCP tool name generation logic`
3. `75f81ae73` – `test: update MCP tool tests to match new naming convention`

### Key Files to Watch
- `packages/cli/src/mcp/mcp-client.ts`
- `packages/cli/src/mcp/mcp-tool.ts`
- `packages/cli/src/providers/providerConfigUtils.ts` / provider manager integrations
- MCP test suites (`packages/cli/src/mcp/...test.ts`)

### Acceptance Notes
- Ensure the new namespacing scheme doesn’t conflict with our subagent tooling or stateless-provider configs.
- Preserve any local overrides (e.g., tool display names) when merging.
- Run the MCP-related tests after applying the commits to confirm behaviour.
