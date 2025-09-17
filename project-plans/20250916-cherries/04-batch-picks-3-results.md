# Task 04: Batch Cherry-picks 3 - Results

## Date
2025-09-17

## Summary
Successfully cherry-picked 3 out of 5 commits from batch 3, focusing on security, MCP, and CLI features.

## Commits Cherry-picked

### ✅ Successfully Picked (3)

1. **10c6af7e → 7c999841e**: Fix(trust) - Disable commands from untrusted directories when useFolderTrust is enabled (#7341)
   - **Status**: Applied with conflicts resolved
   - **Changes**: Added folder trust security checks for command execution
   - **Conflicts resolved**:
     - `FileCommandLoader.test.ts`: Added missing folder trust mock methods
     - `App.test.tsx`: Merged ephemeral settings with folder trust methods

2. **a0fbe000 → 3983c60bb**: Skip MCP server connections in untrusted folders (#7358)
   - **Status**: Applied with conflicts resolved
   - **Changes**: Added security check to prevent MCP server connections in untrusted folders
   - **Conflicts resolved**:
     - Import statements: Updated to use `type` imports for better TypeScript practices
     - `discoverAllMcpTools`: Added Config parameter throughout
     - Removed eventEmitter references (not present in llxprt)
     - Fixed `restartMcpServers` method to pass config parameter

3. **648ab84b → 9eeda67f7**: feat(cli): deprecate redundant CLI flags (#7360)
   - **Status**: Applied with conflicts resolved
   - **Changes**: Added deprecation warnings for various CLI flags that should use settings.json instead
   - **Conflicts resolved**:
     - Simple concatenation of deprecation calls after screen-reader option

### ❌ Skipped (2)

1. **f00cf42f**: docs(config): update documentation for settings structure (#7352)
   - **Reason**: Documentation-only commit with Gemini-specific migration dates and branding
   - **Impact**: No functional impact, documentation can be updated separately if needed

2. **71ad272a**: Show citations at the end of each turn (#7350)
   - **Reason**: Depends on settings v1→v2 migration structure that wasn't included
   - **Impact**: Feature enhancement not critical for functionality
   - **Conflicts**: Extensive conflicts in settings migration code

## Key Preservation Points

### Multi-provider Architecture
- ✅ All changes preserved llxprt's multi-provider support
- ✅ No provider-specific assumptions introduced

### Import Patterns
- ✅ Updated to use TypeScript `type` imports where appropriate
- ✅ Maintained correct package references (`@vybestack/llxprt-code-core`)

### Security Enhancements
- ✅ Folder trust security now properly integrated
- ✅ MCP server protection in untrusted folders active
- ✅ Commands restricted in untrusted directories

## Quality Checks

### Lint
✅ **PASSED** - Fixed TypeScript `any` type issues in trustedFolders.test.ts

### Build
✅ **PASSED** - Fixed missing Config parameter in `restartMcpServers`

### Tests
✅ **PASSED** - All test suites pass

## Files Modified

### Core Changes
- `packages/core/src/tools/mcp-client-manager.ts`
- `packages/core/src/tools/mcp-client-manager.test.ts`
- `packages/core/src/tools/mcp-client.ts`
- `packages/core/src/tools/mcp-client.test.ts`
- `packages/core/src/tools/tool-registry.ts`
- `packages/core/src/tools/mcp-tool.ts`
- `packages/core/src/tools/mcp-tool.test.ts`

### CLI Changes
- `packages/cli/src/config/config.ts`
- `packages/cli/src/config/trustedFolders.test.ts`
- `packages/cli/src/services/FileCommandLoader.ts`
- `packages/cli/src/services/FileCommandLoader.test.ts`
- `packages/cli/src/ui/App.test.tsx`

## Recommendations

1. **Settings Migration**: Consider implementing a proper settings migration strategy for llxprt that doesn't rely on Gemini-specific dates
2. **Citations Feature**: Can be implemented independently if needed, without the full settings migration
3. **Documentation**: Update llxprt documentation to reflect the new security features

## Next Steps

This completes batch 3 of the cherry-pick process. The codebase now includes:
- Enhanced folder trust security
- MCP server protection
- CLI flag deprecation warnings

All quality checks pass, and the multi-provider architecture remains intact.