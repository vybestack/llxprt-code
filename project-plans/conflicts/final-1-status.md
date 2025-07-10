# Merge Conflict Resolution - docs/cli/configuration.md

## Status: ✅ Completed

### Conflict Details

- **File**: `docs/cli/configuration.md`
- **Lines**: 179-197
- **Branches**: HEAD vs multi-provider

### Resolution Summary

Successfully merged content from both branches by:

1. Removed conflict markers (<<<<<<< HEAD, =======, >>>>>>> multi-provider)
2. Kept all content from both branches
3. Added the multi-provider branch's new configuration options:
   - `enableTextToolCallParsing` - Enables text-based tool call parsing
   - `textToolCallModels` - Specifies models requiring text-based parsing

### Final State

The file now contains all configuration options from both branches in proper order:

- ...existing options...
- `usageStatisticsEnabled` (from HEAD)
- `enableTextToolCallParsing` (from multi-provider)
- `textToolCallModels` (from multi-provider)
- `hideTips` (continues after merge)
- ...remaining content...

### Verification

The merge preserves the documentation structure and maintains all configuration options from both branches without loss of information.
