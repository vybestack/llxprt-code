# Task 05: Port commit 03bcbcc1 - MCP Loading Indicator

## Status: ✅ COMPLETED

## Summary
Successfully cherry-picked and adapted commit 03bcbcc1 which adds MCP loading indicator when initializing the CLI.

## Cherry-pick Details
- **Commit**: 03bcbcc1 - Add MCP loading indicator when initializing Gemini CLI (#6923)
- **Author**: Pascal Birchler <pascalb@google.com>
- **Date**: Thu Aug 28 21:53:56 2025 +0200
- **Type**: PORT (requires adaptation)

## Files Modified
1. `packages/cli/src/config/config.ts` - Added eventEmitter parameter to config
2. `packages/cli/src/gemini.tsx` - Added InitializingComponent with MCP loading indicator UI
3. `packages/core/src/config/config.ts` - Added eventEmitter support to Config class
4. `packages/core/src/tools/mcp-client-manager.ts` - Added event emissions for MCP server connections
5. `packages/core/src/tools/tool-registry.ts` - Added eventEmitter parameter to constructor

## Conflicts Resolved
All conflicts were resolved while preserving llxprt's multi-provider architecture:

1. **Import conflicts**: Merged React imports and EventEmitter type imports
2. **Config parameters**: Added eventEmitter while preserving llxprt's settings structure
3. **MCP client manager**: Kept cliConfig parameter while adding event emissions
4. **Tool registry**: Added missing config parameter to discoverAllMcpTools call

## TypeScript Issues Fixed
1. Fixed `skipNextSpeakerCheck` - Removed from config since it doesn't exist in llxprt's settings
2. Fixed `discoverAllMcpTools` - Added missing Config parameter

## Quality Checks
- ✅ Lint: Passing (8 unrelated warnings in trustedFolders.test.ts)
- ✅ Build: Successful
- ✅ Tests: All passing (24 passed, 1 skipped)

## Preserved LLxprt Features
- Multi-provider architecture maintained
- Package naming (@vybestack/llxprt-code-core) preserved
- LLxprt branding maintained
- No "Gemini" references introduced in user-visible strings

## Commits Created
1. Cherry-pick: `5ce9a7df4` - Add MCP loading indicator when initializing Gemini CLI (#6923)
2. Fix commit: `4a10dbf3c` - fix: Resolve merge conflicts and fix TypeScript errors after cherry-pick 03bcbcc1

## Notes
- The MCP loading indicator now shows progress when connecting to MCP servers
- The feature integrates seamlessly with llxprt's multi-provider architecture
- No rebranding was needed as the loading messages are generic ("Connecting to MCP servers...")