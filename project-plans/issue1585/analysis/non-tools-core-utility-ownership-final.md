# Non-Tools Core Utility Ownership Final

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-05

This document extends `analysis/non-tools-core-dependency-map.md` by adding explicit copy-vs-move ownership rules for utility relocation. It classifies every non-tools utility imported by `packages/core/src/tools/**` with a copy-vs-move ownership classification that prevents duplicated production utility behavior.

## Copy-vs-Move Ownership Rule

When a utility is imported by both tools-bound files (moving to `packages/tools`) and core-resident files (staying in `packages/core`), the utility must be classified with one of the following ownership classifications. The rule is: **a production utility with runtime behavior MUST NOT exist in both `packages/core` and `packages/tools` simultaneously in a form that allows independent behavior divergence.** Only structural type-only copies are permitted.

## Ownership Classifications

| Classification | Meaning | Action | Duplicated Behavior Allowed? |
| --- | --- | --- | --- |
| MOVE_PURE_UTILITY | Pure function/type with no core service deps; moves entirely to packages/tools | Move to `packages/tools/src/utils/`; remove from core; core imports from `@vybestack/llxprt-code-tools` | No — single copy in tools |
| COPY_STRUCTURAL_TYPE_ONLY | Type-only definition with no runtime behavior; may be copied | Copy type definition to `packages/tools/src/types/`; core retains its own copy | Yes — but types have no runtime behavior to diverge |
| CORE_ADAPTER | Import satisfied by a core adapter that tools never imports directly | Interface in tools, adapter in core; no utility copy needed | No — adapter is in core only |
| STAY_CORE_ONLY | Utility used only by core-resident files (retained MCP, tool-key-storage); does not move | Stay in core; tools has no copy | No — single copy in core |
| FORBIDDEN_UNRESOLVED | Import has no viable replacement and blocks the move | Must be resolved before P11; zero allowed | N/A — blocks move |

## Utility Relocation Table

Each utility currently in `packages/core/src/utils/` or `packages/core/src/services/` that is imported by tools-bound files is classified below.

### Pure Utilities — MOVE_PURE_UTILITY

These move entirely to `packages/tools/src/utils/`. Core files that still need them import from `@vybestack/llxprt-code-tools`.

| Utility | Current Location | Moves To | Core Consumers After Move |
| --- | --- | --- | --- |
| SchemaValidator | `utils/schemaValidator.js` | `packages/tools/src/utils/schemaValidator.ts` | Core imports from `@vybestack/llxprt-code-tools` (if still needed) |
| makeRelative, shortenPath | `utils/paths.js` | `packages/tools/src/utils/paths.ts` | Core imports from `@vybestack/llxprt-code-tools` (if still needed) |
| getErrorMessage, isNodeError | `utils/errors.js` | `packages/tools/src/utils/errors.ts` | Core imports from `@vybestack/llxprt-code-tools` (if still needed) |
| isGitRepository | `utils/gitUtils.js` | `packages/tools/src/utils/gitUtils.ts` | None in core-resident tools |
| getRipgrepPath | `utils/ripgrepPathResolver.js` | `packages/tools/src/utils/ripgrepPathResolver.ts` | None in core-resident tools |
| COMMON_IGNORE_PATTERNS | `utils/ignorePatterns.js` | `packages/tools/src/utils/ignorePatterns.ts` | None in core-resident tools |
| retrieveContent | `utils/retry.js` | `packages/tools/src/utils/retry.ts` | None in core-resident tools |
| ensureJsonSafe | `utils/unicodeUtils.js` | `packages/tools/src/utils/unicodeUtils.ts` | None in core-resident tools |
| getResponseText | `utils/generateContentResponseUtilities.js` | `packages/tools/src/utils/generateContentResponseUtilities.ts` | None in core-resident tools |
| fetchWithTimeout, isPrivateIp | `utils/fetch.js` | `packages/tools/src/utils/fetch.ts` | None in core-resident tools |
| initializeParser | `utils/shell-parser.js` | `packages/tools/src/utils/shell-parser.ts` | None in core-resident tools |
| summarizeToolOutput | `utils/summarizer.js` | `packages/tools/src/utils/summarizer.ts` | Core-resident files: none (replaced by IToolHost) |
| toolOutputLimiter | `utils/toolOutputLimiter.js` | `packages/tools/src/utils/toolOutputLimiter.ts` | None in core-resident tools |
| formatMemoryUsage | `utils/formatters.js` | `packages/tools/src/utils/formatters.ts` | None in core-resident tools |
| shell-utils | `utils/shell-utils.js` | `packages/tools/src/utils/shell-utils.ts` | None in core-resident tools |
| countLines, getSpecificMimeType | `utils/fileUtils.js` | `packages/tools/src/utils/fileUtils.ts` | None in core-resident tools |
| LANGUAGE_MAP, Lang | `utils/ast-grep-utils.js` | `packages/tools/src/utils/ast-grep-utils.ts` | None in core-resident tools |
| safeJsonStringify | `utils/safeJsonStringify.js` | `packages/tools/src/utils/safeJsonStringify.ts` | Used by tool-registry (moves) and mcp-tool (moves) |
| getGitLineChanges | `utils/gitLineChanges.js` | `packages/tools/src/utils/gitLineChanges.ts` | None in core-resident tools |
| getFolderStructure | `utils/getFolderStructure.js` | `packages/tools/src/utils/getFolderStructure.ts` | None in core-resident tools |
| resolveTextSearchTarget | `utils/resolveTextSearchTarget.js` | `packages/tools/src/utils/resolveTextSearchTarget.ts` | None in core-resident tools |
| debugLogger | `utils/debugLogger.js` | Package-local conditional delegate in `packages/tools/src/utils/debugLogger.ts`; delegates to real logging when `IToolHost.getDebugMode()` returns true, silent no-op otherwise; core-resident files keep core debugLogger | Core-resident (mcp-client-manager) keeps its own |
| type AnsiOutput | `utils/terminalSerializer.js` | `packages/tools/src/types/terminalSerializer.ts` (type-only; see COPY_STRUCTURAL_TYPE_ONLY) | See below |

### Type-Only — COPY_STRUCTURAL_TYPE_ONLY

These have no runtime behavior and may be copied. Both core and tools may have their own copy of the type definition.

| Type | Current Location | Copy To | Core Retains |
| --- | --- | --- | --- |
| AnsiOutput (type only) | `utils/terminalSerializer.js` | `packages/tools/src/types/terminalSerializer.ts` | Yes (type-only, no runtime code) |
| FileDiff (type only) | `tools/tools.js` | `packages/tools/src/types/` | Yes (type-only) |
| ToolResultDisplay (type only) | `tools/tools.js` | `packages/tools/src/types/` | Yes (type-only) |
| FileExclusions (type only) | `utils/ignorePatterns.js` | `packages/tools/src/types/` | Yes (type-only) |
| GitLineChangeMarker (type only) | `utils/gitLineChanges.js` | `packages/tools/src/types/` | Yes (type-only) |
| FileRead (type only) | `tools/tools.js` | `packages/tools/src/types/` | Yes (type-only) |

### Core-Only — STAY_CORE_ONLY

| Utility | Current Location | Stays In | Rationale |
| --- | --- | --- | --- |
| debugLogger (for retained core files) | `utils/debugLogger.js` | `packages/core/src/utils/` | mcp-client-manager.ts stays in core and needs the real debugLogger; tools gets a package-local no-op |
| WorkspaceContext | `utils/workspaceContext.js` | `packages/core/src/utils/` | Only used by core-resident test files and via IToolHost in tools |
| coreEvents, CoreEvent | `utils/events.js` | `packages/core/src/utils/` | Only used by retained mcp-client-manager.ts |
| GeminiClient | `core/client.js` | `packages/core/src/core/` | Only used by write-file.test.ts; not a utility |

### Core Adapter — CORE_ADAPTER

| Utility | Interface | Adapter | Rationale |
| --- | --- | --- | --- |
| FileDiscoveryService | IToolHost | CoreToolHostAdapter | getFileService() delegated through adapter |
| StandardFileSystemService | IStorageService | CoreStorageServiceAdapter | File system operations delegated through adapter |

## Anti-Duplication Verification

After P11 moves, verify zero runtime-duplicate utilities:

```bash
# For each MOVE_PURE_UTILITY: verify it no longer exists in its original core location
# (This is a post-P15 check; files are moved in P11, originals deleted in P15)
# For COPY_STRUCTURAL_TYPE_ONLY: verify the tools copy is type-only (no runtime exports)
rg -n "export (function|class|const|let|var)" packages/tools/src/types/ -g "*.ts"
# Expected: zero matches (types directory has no runtime exports)
```

## FORBIDDEN_UNRESOLVED Entries

**Zero entries.** All non-tools utility imports have been classified with explicit ownership rules. No `FORBIDDEN_UNRESOLVED` entries remain.

## Summary Statistics

| Classification | Count |
| --- | --- |
| MOVE_PURE_UTILITY | 23+ |
| COPY_STRUCTURAL_TYPE_ONLY | 6 |
| STAY_CORE_ONLY | 4 |
| CORE_ADAPTER | 2 |
| FORBIDDEN_UNRESOLVED | 0 |