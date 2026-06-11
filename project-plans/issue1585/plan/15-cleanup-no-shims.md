# Phase 15: Cleanup And No Shims

## Phase ID

`PLAN-20260608-ISSUE1585.P15`

## Purpose

Remove moved core tool files and deep exports. Ensure no wrappers, V2/New files, or compatibility shims remain. Apply core tools directory final policy.

## Prerequisites

- Required: P14a completed (release process verified).
- Artifacts: move-map-final.md, all consumers migrated.

## Requirements Implemented

### REQ-CLEAN-001, REQ-DEP-001, REQ-NO-SHIMS, REQ-RETAINED-CORE-TOOLS

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-NO-SHIMS, REQ-RETAINED-CORE-TOOLS, REQ-PKG-BOUNDARY

**Behavior specification**:
- GIVEN: All moved code has been migrated, consumers have been updated, release process is updated
- WHEN: Old core tools files are deleted, deep exports are removed
- THEN: `packages/core/src/tools/` contains only files from the approved allowlist (mcp-client.ts, mcp-client-manager.ts, tool-key-storage.ts, their tests, any STAY_CORE_INFRASTRUCTURE file with rationale); no re-export shims exist

**Why it matters**: Leftover files or shims create dual import paths, confuse consumers, and prevent detecting when a consumer accidentally uses old deep paths.

## Implementation Tasks

### Step 1: Remove Moved Files From Core

Delete all files from packages/core/src/tools/ that are classified as MOVE_NOW or MOVE_AFTER_INTERFACE in the move map. Include their associated test files if they moved to packages/tools.

**Exception**: `tool-key-storage.ts` class stays in core (only pure functions maskKeyForDisplay/getSupportedToolNames/isValidToolKeyName moved). The ToolKeyStorage class and its SecureStore imports remain.

For each deleted file, verify:
- No remaining imports reference it from core or other packages
- The moved replacement in packages/tools provides the same exports
- No other file in core re-exports the deleted module

### Step 2: Remove Deep Export Paths

Edit packages/core/package.json to remove all `./tools/*` exports for moved modules. Only retained infrastructure exports remain:

Remaining core tools exports (after cleanup):
- `./tools/mcp-client.js` (retained core infrastructure)
- `./tools/mcp-client-manager.js` (retained core infrastructure)
- No other ./tools/* exports

### Step 3: Verify No Re-Export Shims

```bash
# Check for re-export shims in core tools directory using rg (consistent syntax)
rg -n "from '@vybestack/llxprt-code-tools|from '\.\./\.\./tools" packages/core/src/tools -g "*.ts"
# Expected: zero matches (no files that merely re-export from tools package)
# Check for wrapper/V2/New files
find packages/core/src/tools -name '*V2*' -o -name '*New*' -o -name '*Wrapper*' -o -name '*Shim*' 2>/dev/null
# Expected: zero matches
```

**No-shim scope**: The scan is restricted to `packages/core/src/tools/**`. Explicit `packages/core/src/index.ts` top-level re-exports from `@vybestack/llxprt-code-tools` are allowed for CLI compatibility and must NOT be flagged. This is REQ-NO-SHIM-SCOPE per `plan/requirements-appendix.md`.

**Separation rule**: `packages/core/src/tools/**` → zero re-exports from `@vybestack/llxprt-code-tools`. `packages/core/src/index.ts` → allowed explicit re-exports for public API compatibility.

**Separately verify allowed top-level re-exports**:
```bash
rg -n "export .* from ['\"]@vybestack/llxprt-code-tools" packages/core/src/index.ts
# Expected: non-zero (allowed for CLI compatibility — this is NOT a shim)
```

### Step 4: Apply Core Tools Directory Policy

After cleanup, packages/core/src/tools/ may only contain the following approved files/artifacts. This is an all-file policy, not TypeScript-only: snapshots, fixtures, JSON files, and any other non-TS artifacts must also be deleted or explicitly listed with rationale in the move map:

1. mcp-client.ts — STAY_CORE_INFRASTRUCTURE
2. mcp-client-manager.ts — STAY_CORE_INFRASTRUCTURE
3. tool-key-storage.ts — STAY_CORE_INFRASTRUCTURE (ToolKeyStorage class + SecureStore; only pure functions maskKeyForDisplay/getSupportedToolNames/isValidToolKeyName moved to packages/tools/src/utils/tool-key-utils.ts)
4. mcp-client.test.ts — test stays with mcp-client
5. mcp-client-manager.test.ts — test stays with mcp-client-manager
6. tool-key-storage.test.ts (if exists) — test for retained ToolKeyStorage class (SecureStore integration)
7. `mcp-tool.ts` — if classified STAY_CORE_INFRASTRUCTURE because it cannot move without core coupling (document decision in move map)
8. `lsp-diagnostics-helper.ts` — if classified STAY_CORE_INFRASTRUCTURE per analysis/lsp-diagnostics-helper-decision.md (current decision is MOVE_AFTER_INTERFACE per that artifact, so this file moves in P11 Group 3 and is NOT in the allowlist; if the decision were to change to STAY_CORE_INFRASTRUCTURE, it would be added here with documented rationale)
9. Any file explicitly classified as `STAY_CORE_INFRASTRUCTURE` or `STAY_UNTIL_FUTURE_PKG` with written rationale in the move map. **`STAY_UNTIL_FUTURE_PKG` entries must meet strict criteria**: (1) the file imports a core service with no tools-owned interface and cannot be feasibly abstracted; (2) the file's primary purpose belongs in a future package (settings/storage/mcp); (3) moving to tools would duplicate core behavior or create a throwaway interface. Every `STAY_UNTIL_FUTURE_PKG` entry in the move map MUST have explicit justification for why `MOVE_AFTER_INTERFACE` is not feasible.

Verify with:
```bash
find packages/core/src/tools -type f | sort
# Must match the approved retained-file list exactly, including snapshots, fixtures, and other non-TS artifacts
# Save evidence for final review:
find packages/core/src/tools -type f | sort > project-plans/issue1585/analysis/core-tools-final-files.txt
```

### Step 5: Final Forbidden Import Scan

```bash
rg -n "@vybestack/llxprt-code-core|packages/core/src|@vybestack/llxprt-code-providers|packages/providers/src|packages/cli/src" packages/tools/src -g "*.ts"
# Expected: zero matches

# Test fixture anti-coupling check
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/tools/src/__tests__/fixtures -g "*.ts"
# Expected: zero matches (fixtures must not import core/providers)
```

### Files To Delete

All MOVE_NOW and MOVE_AFTER_INTERFACE files and their tests from packages/core/src/tools/, EXCEPT:
- tool-key-storage.ts retains the ToolKeyStorage class definition (pure functions were extracted to packages/tools)

### Files To Modify

- packages/core/package.json (remove moved deep exports)

## Verification Commands

```bash
# Verify retained files only
find packages/core/src/tools -type f | sort
# Verify no re-export shims using rg (consistent syntax)
rg -n "from '@vybestack/llxprt-code-tools" packages/core/src/tools -g "*.ts"
# Expected: zero
# Separately verify allowed top-level re-exports in index.ts (NOT flagged as shims)
rg -n "export .* from ['"]@vybestack/llxprt-code-tools" packages/core/src/index.ts
# Expected: non-zero (allowed for CLI compatibility)
# Verify forbidden imports
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/tools/src -g "*.ts"
# Expected: zero
# Verify test fixture anti-coupling
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/tools/src/__tests__/fixtures -g "*.ts"
# Expected: zero
# Full typecheck
npm run typecheck
# Full test
npm run test
# Build
npm run build
# Format diff check (REQ-FORMAT-DIFF-CHECK)
npm run format && git diff --quiet -- ':!project-plans/'
```

## Semantic Verification Checklist

- [ ] All moved files deleted from core (except tool-key-storage.ts ToolKeyStorage class).
- [ ] No re-export shims exist.
- [ ] No V2/New/wrapper files exist.
- [ ] Core tools directory matches approved retained-file list.
- [ ] Forbidden import scan passes.
- [ ] Test fixture anti-coupling scan passes.
- [ ] Typecheck and tests pass.
- [ ] Format diff check passes (`git diff --quiet -- ':!project-plans/'` exits 0).

## Success Criteria

- packages/core/src/tools/ contains only approved retained files.
- Zero re-export shims.
- Full verification passes.

## Failure Recovery

Remove missed shims or re-add accidentally deleted files.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P15.md` with deleted files list, retained files list, and verification output.
