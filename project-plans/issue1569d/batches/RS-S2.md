# RS-S2: sonarjs/no-ignored-exceptions Frozen Batch Inventory

**Rule:** sonarjs/no-ignored-exceptions
**Status:** COMPLETE
**Date:** 2026-04-30

## Slice 1: packages/vscode-ide-companion (COMPLETE)

### packages/vscode-ide-companion/src/ide-server.ts

| Line | Col | Message |
|------|-----|---------|
| 450  | 9   | Handle this exception or don't catch it at all |

**Fix Applied:** Changed `catch (_err)` to parameterless `catch` with explanatory comment.

---

## Slice 2: packages/core/src (COMPLETE)

### Frozen Offender List (Top 20 by count, then path)

| # | Count | File |
|---|-------|------|
| 1 | 18 | packages/core/src/services/shellExecutionService.ts |
| 2 | 4 | packages/core/src/utils/googleErrors.ts |
| 3 | 4 | packages/core/src/services/fileDiscoveryService.ts |
| 4 | 4 | packages/core/src/ide/ide-client.ts |
| 5 | 4 | packages/core/src/core/logger.ts |
| 6 | 3 | packages/core/src/utils/ripgrepPathResolver.ts |
| 7 | 3 | packages/core/src/tools/google-web-fetch.ts |
| 8 | 3 | packages/core/src/ide/process-utils.ts |
| 9 | 3 | packages/core/src/debug/DebugLogger.ts |
| 10 | 3 | packages/core/src/debug/ConfigurationManager.ts |
| 11 | 3 | packages/core/src/core/prompts.ts |
| 12 | 2 | packages/core/src/utils/workspaceContext.ts |
| 13 | 2 | packages/core/src/utils/toolOutputLimiter.ts |
| 14 | 2 | packages/core/src/utils/gitUtils.ts |
| 15 | 2 | packages/core/src/utils/gitIgnoreParser.ts |
| 16 | 2 | packages/core/src/utils/errorParsing.ts |
| 17 | 2 | packages/core/src/tools/ast-edit/repository-context-provider.ts |
| 18 | 2 | packages/core/src/providers/gemini/GeminiProvider.ts |
| 19 | 2 | packages/core/src/config/schedulerSingleton.ts |
| 20 | 2 | packages/core/src/config/profileManager.ts |

**Total Frozen Violations:** 63

### Cleanup Applied

All `catch (_var)` patterns converted to parameterless `catch` with explanatory comments:
- shellExecutionService.ts: 18 catches → parameterless with context-specific comments
- googleErrors.ts: 4 catches → parameterless with parsing context
- fileDiscoveryService.ts: 4 catches → parameterless with filesystem context
- ide-client.ts: 4 catches → parameterless with connection context
- logger.ts: 4 catches → parameterless with logging context
- ripgrepPathResolver.ts: 3 catches → parameterless with resolution context
- google-web-fetch.ts: 3 catches → parameterless with URL parsing context
- process-utils.ts: 3 catches → parameterless with process info context
- DebugLogger.ts: 3 catches → parameterless with log evaluation context
- ConfigurationManager.ts: 3 catches → parameterless with config loading context
- prompts.ts: 3 catches → parameterless with settings context
- workspaceContext.ts: 2 catches → parameterless with path context
- toolOutputLimiter.ts: 2 catches → parameterless with encoding context
- gitUtils.ts: 2 catches → parameterless with git detection context
- gitIgnoreParser.ts: 2 catches → parameterless with ignore pattern context
- errorParsing.ts: 2 catches → parameterless with JSON parsing context
- repository-context-provider.ts: 2 catches → parameterless with git context
- GeminiProvider.ts: 2 catches → parameterless with auth/model context
- schedulerSingleton.ts: 2 catches → parameterless with disposal context
- profileManager.ts: 2 catches → parameterless with profile I/O context

### Files Changed (20 files)

1. packages/core/src/services/shellExecutionService.ts (18 catches fixed)
2. packages/core/src/utils/googleErrors.ts (4 catches fixed)
3. packages/core/src/services/fileDiscoveryService.ts (4 catches fixed)
4. packages/core/src/ide/ide-client.ts (4 catches fixed)
5. packages/core/src/core/logger.ts (4 catches fixed)
6. packages/core/src/utils/ripgrepPathResolver.ts (3 catches fixed)
7. packages/core/src/tools/google-web-fetch.ts (3 catches fixed)
8. packages/core/src/ide/process-utils.ts (3 catches fixed)
9. packages/core/src/debug/DebugLogger.ts (3 catches fixed)
10. packages/core/src/debug/ConfigurationManager.ts (3 catches fixed)
11. packages/core/src/core/prompts.ts (3 catches fixed)
12. packages/core/src/utils/workspaceContext.ts (2 catches fixed)
13. packages/core/src/utils/toolOutputLimiter.ts (2 catches fixed)
14. packages/core/src/utils/gitUtils.ts (2 catches fixed)
15. packages/core/src/utils/gitIgnoreParser.ts (2 catches fixed)
16. packages/core/src/utils/errorParsing.ts (2 catches fixed)
17. packages/core/src/tools/ast-edit/repository-context-provider.ts (2 catches fixed)
18. packages/core/src/providers/gemini/GeminiProvider.ts (2 catches fixed)
19. packages/core/src/config/schedulerSingleton.ts (2 catches fixed)
20. packages/core/src/config/profileManager.ts (2 catches fixed)

### Verification Results

```bash
# Forced rule lint on frozen files
$ npx eslint <20 files> --rule 'sonarjs/no-ignored-exceptions: error'
(no no-ignored-exceptions warnings)

# Quiet lint on frozen files
$ npx eslint <20 files> --quiet
Exit Code: 0

# Type checking
$ npm run typecheck
Exit Code: 0

# Targeted tests
$ npx vitest run src/services/shellExecutionService.test.ts src/tools/google-web-fetch.test.ts src/providers/gemini/GeminiProvider.test.ts
Test Files  3 passed (3)
Tests  116 passed (116)
```

## Status: GREEN

All 63 sonarjs/no-ignored-exceptions violations resolved in frozen files. No remaining violations in the 20 frozen files.
