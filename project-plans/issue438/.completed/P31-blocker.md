# Phase 31 Blocker - Apply-Patch Tool Missing

**Date:** 2025-02-13 (Phase P31 worker execution)

## Blocker Details

### Requirement: REQ-DIAG-015, REQ-DIAG-017, REQ-SCOPE-025

The plan calls for LSP integration in `packages/core/src/tools/apply-patch.ts`, but this file **does not exist** in the current codebase.

### Evidence

```bash
# File existence check
$ test -f /Users/acoliver/projects/llxprt/branch-3/llxprt-code/packages/core/src/tools/apply-patch.ts && echo "EXISTS" || echo "NOT_FOUND"
NOT_FOUND

# Tool directory listing
$ ls -la /Users/acoliver/projects/llxprt/branch-3/llxprt-code/packages/core/src/tools/ | grep apply-patch
# (no results - file does not exist)

# Grep for apply-patch in codebase
$ grep -r "apply-patch" /Users/acoliver/projects/llxprt/branch-3/llxprt-code/packages/core/src/tools/
# (no results)
```

### Impact on Phase P31

**Cannot Complete**: P31 requirements specify both edit.ts AND apply-patch.ts integration, but apply-patch.ts does not exist.

### Root Cause Analysis

The apply-patch tool may have been:
- Planned but not yet implemented
- Removed in a prior refactoring
- Never added to the codebase

### Resolution Path

Phase P31 can be **partially completed**:
- [OK] Edit tool LSP integration (REQ-DIAG-010, REQ-DIAG-020, REQ-DIAG-030)
- [OK] Edit tool LSP tests
- [ERROR] Apply-patch tool LSP integration (REQ-DIAG-015, REQ-DIAG-017, REQ-SCOPE-025) - BLOCKED
- [ERROR] Apply-patch LSP tests - BLOCKED

**Recommendation**: Create a separate issue/phase for apply-patch implementation before attempting P31 apply-patch integration. The blocker document should remain in `.completed/` to document this gap.

## Completion Status

**Phase P31**: PARTIALLY COMPLETE (edit portion only)
**Apply-Patch Portion**: BLOCKED - tool does not exist
**P31 Marker**: NOT CREATED (phase incomplete per plan requirements)
