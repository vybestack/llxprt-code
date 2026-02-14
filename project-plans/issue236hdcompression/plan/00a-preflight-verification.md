# Phase 0.5: Preflight Verification

## Purpose

Verify ALL assumptions before writing any code. This phase prevents the most
common planning failures: missing dependencies, wrong types, and impossible
call patterns.

## Dependency Verification

| Dependency | Verification Command | Status |
|------------|---------------------|--------|
| `node:path` | Built-in Node.js module — `node -e "require('path')"` | OK — built-in |
| `vitest` | `npm ls vitest` | OK — used throughout test suite |
| Existing compression types | `grep "CompressionStrategy" packages/core/src/core/compression/types.ts` | OK — interface exists |
| Existing strategy factory | `grep "getCompressionStrategy" packages/core/src/core/compression/compressionStrategyFactory.ts` | OK — function exists |
| Existing HistoryService | `grep "class HistoryService" packages/core/src/services/history/HistoryService.ts` | OK — class exists |
| Settings registry | `grep "SETTINGS_REGISTRY" packages/core/src/settings/settingsRegistry.ts` | OK — array exists |
| `IContent` type | `grep "interface IContent" packages/core/src/core/IContent.ts` | OK — type exists |

No external dependencies are required. All referenced modules are built-in
Node.js or already present in the project.

## Type/Interface Verification

| Type Name | Expected Definition | Actual Definition | Match? |
|-----------|---------------------|-------------------|--------|
| `CompressionStrategy` | Interface with `name`, `requiresLLM`, `compress()` | `grep -A 10 "interface CompressionStrategy" packages/core/src/core/compression/types.ts` | YES — will be extended with `trigger` and optional `optimize` |
| `CompressionStrategyName` | Union type derived from `COMPRESSION_STRATEGIES` tuple | `grep "CompressionStrategyName" packages/core/src/core/compression/types.ts` | YES — derived via `typeof COMPRESSION_STRATEGIES[number]` |
| `COMPRESSION_STRATEGIES` | Const tuple of strategy name strings | `grep "COMPRESSION_STRATEGIES" packages/core/src/core/compression/types.ts` | YES — currently `['middle-out', 'top-down-truncation', 'one-shot']` |
| `CompressionContext` | Interface with history, ephemerals, estimateTokens, logger | `grep -A 15 "interface CompressionContext" packages/core/src/core/compression/types.ts` | YES |
| `CompressionResult` | Interface with newHistory and metadata | `grep -A 5 "interface CompressionResult" packages/core/src/core/compression/types.ts` | YES |
| `IContent` | Interface with speaker and blocks | `grep -A 10 "interface IContent" packages/core/src/core/IContent.ts` | YES |
| `ToolCallBlock.parameters` | Typed as `unknown` | `grep "parameters" packages/core/src/core/IContent.ts` | YES — `parameters: unknown`, extraction requires runtime checks |
| `EphemeralSettings` | Interface for runtime-overridable settings | `grep "EphemeralSettings" packages/core/src/settings/` | YES — will be extended with density fields |

## Call Path Verification

| Function | Expected Caller | Actual Caller | Evidence |
|----------|-----------------|---------------|----------|
| `ensureCompressionBeforeSend()` | Called before every `sendMessage`/`sendMessageStream` | `geminiChat.ts` | `grep "ensureCompressionBeforeSend" packages/core/src/core/geminiChat.ts` |
| `shouldCompress()` | Called inside `ensureCompressionBeforeSend` | `geminiChat.ts` | `grep "shouldCompress" packages/core/src/core/geminiChat.ts` |
| `performCompression()` | Called when `shouldCompress()` returns true | `geminiChat.ts` | `grep "performCompression" packages/core/src/core/geminiChat.ts` |
| `getCompressionStrategy()` | Called in `performCompression()` to resolve strategy | `compressionStrategyFactory.ts` | `grep "getCompressionStrategy" packages/core/src/core/geminiChat.ts` |
| `historyService.add()` | Called at user message, AI response, and tool result sites | `geminiChat.ts` | `grep "historyService.add\|historyService\.add" packages/core/src/core/geminiChat.ts` |
| `historyService.clear()` | Called inside `performCompression()` for history rebuild | `geminiChat.ts` | `grep "historyService.clear\|\.clear()" packages/core/src/core/geminiChat.ts` |
| `waitForTokenUpdates()` | Called before threshold check | `geminiChat.ts` | `grep "waitForTokenUpdates" packages/core/src/core/geminiChat.ts` |
| `estimateContentTokens()` | Used for incremental token tracking in HistoryService | `HistoryService.ts` | `grep "estimateContentTokens" packages/core/src/services/history/HistoryService.ts` |
| `tokenizerLock` | Promise chain serializing token operations | `HistoryService.ts` | `grep "tokenizerLock" packages/core/src/services/history/HistoryService.ts` |

## Test Infrastructure Verification

| Component | Test File Exists? | Test Patterns Work? |
|-----------|-------------------|---------------------|
| Compression types | `packages/core/src/core/compression/__tests__/` exists | YES — existing strategy tests use `describe`/`it` |
| HistoryService | `packages/core/src/services/history/__tests__/` exists or tests colocated | YES — existing tests cover `add()`, `clear()`, `getCurated()` |
| geminiChat | `packages/core/src/core/__tests__/` exists | YES — existing tests for compression flow |
| Settings | `packages/core/src/settings/__tests__/` or colocated | YES — existing settings tests |
| Strategy factory | Tested through existing strategy tests | YES |
| Vitest runner | `npm run test -- --run` | YES — project-wide test runner works |

## Blocking Issues Found

None identified. All dependencies are internal, all types exist as expected,
all call paths are verified, and test infrastructure is in place.

**Notes for implementation:**
- `ToolCallBlock.parameters` is typed as `unknown` — runtime type guards needed
  for file path extraction (addressed in REQ-HD-005.4, REQ-HD-013.5)
- `@` file inclusions are unstructured text in human messages — heuristic pattern
  matching required (addressed in REQ-HD-006.1, REQ-HD-006.5)
- `tokenizerLock` is a private field — `recalculateTotalTokens()` must be a
  method on HistoryService to access it (addressed in REQ-HD-003.6)

## Verification Gate

- [x] All dependencies verified — no external deps needed
- [x] All types match expectations — interfaces exist as documented
- [x] All call paths are possible — orchestration flow verified
- [x] Test infrastructure ready — test directories and runner functional

**RESULT: PASS — proceed to implementation phases.**
