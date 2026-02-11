# Phase 01: Preflight Verification

## Phase ID

`PLAN-20260211-COMPRESSION.P01`

## Purpose

Verify ALL assumptions before writing any code. This prevents the most common planning failures.

## Dependency Verification

| Dependency | Check | Status |
|------------|-------|--------|
| vitest | `npm ls vitest` | |
| typescript | `npm run typecheck` compiles | |

No new external dependencies required for this feature.

## Type/Interface Verification

| Type Name | Expected Location | Verify |
|-----------|-------------------|--------|
| `IContent` | `packages/core/src/services/history/IContent.ts` | Interface with `speaker`, `blocks` fields |
| `HistoryService` | `packages/core/src/services/history/HistoryService.ts` | Has `getCurated()`, `clear()`, `add()`, `startCompression()`, `endCompression()`, `estimateTokensForContents()` |
| `AgentRuntimeContext` | `packages/core/src/runtime/AgentRuntimeContext.ts` | Interface with `ephemerals` sub-object, `state`, `history`, `provider` |
| `AgentRuntimeState` | `packages/core/src/runtime/AgentRuntimeState.ts` | Has `model`, `provider` |
| `EphemeralSettings` | `packages/core/src/types/modelParams.ts` | Interface with existing settings like `'compression-threshold'` |
| `ChatCompressionSettings` | `packages/core/src/config/config.ts` | Currently has `contextPercentageThreshold` only |
| `SETTINGS_REGISTRY` | `packages/core/src/settings/settingsRegistry.ts` | Array of `SettingSpec` objects with `key`, `type`, `default`, `enumValues`, etc. |
| `SettingSpec` | `packages/core/src/settings/settingsRegistry.ts` | Has fields: `key`, `type`, `default`, `category`, `persistToProfile`, `enumValues` |
| `getDirectSettingSpecs()` | `packages/core/src/settings/settingsRegistry.ts` | Returns `DirectSettingSpec[]` used for `/set` autocomplete |
| `PromptResolver` | `packages/core/src/prompt-config/prompt-resolver.ts` | Has `resolveFile(baseDir, relativePath, context)` |
| `ALL_DEFAULTS` | `packages/core/src/prompt-config/defaults/index.ts` | Record<string, string> combining CORE_DEFAULTS, TOOL_DEFAULTS, etc. |
| `compression.md` | `packages/core/src/prompt-config/defaults/compression.md` | Already exists! Contains the XML state_snapshot prompt |
| `IProvider` | Verify `generateChatCompletion` method signature | |

## Call Path Verification

| Function | Expected Caller | Verify |
|----------|-----------------|--------|
| `performCompression()` | Called from `ensureCompressionBeforeSend()` in geminiChat.ts | `grep -n "performCompression" packages/core/src/core/geminiChat.ts` |
| `getCompressionSplit()` | Called from `performCompression()` | `grep -n "getCompressionSplit" packages/core/src/core/geminiChat.ts` |
| `directCompressionCall()` | Called from `performCompression()` | `grep -n "directCompressionCall" packages/core/src/core/geminiChat.ts` |
| `applyCompression()` | Called from `performCompression()` | `grep -n "applyCompression" packages/core/src/core/geminiChat.ts` |
| `adjustForToolCallBoundary()` | Called from `getCompressionSplit()` | `grep -n "adjustForToolCallBoundary" packages/core/src/core/geminiChat.ts` |
| `getCompressionPrompt()` | Called from `directCompressionCall()` | `grep -n "getCompressionPrompt" packages/core/src/core/geminiChat.ts` |
| `resolveProviderForRuntime()` | Called from `directCompressionCall()` | `grep -n "resolveProviderForRuntime" packages/core/src/core/geminiChat.ts` |
| `compression.md` in `CORE_DEFAULTS` | Referenced in `core-defaults.ts` line 305 | `grep -n "compression" packages/core/src/prompt-config/defaults/core-defaults.ts` |

## Test Infrastructure Verification

| Component | Test File Exists? | Pattern Works? |
|-----------|-------------------|----------------|
| geminiChat | `packages/core/src/core/client.test.ts` | `grep "describe\|it\|test" packages/core/src/core/client.test.ts \| head -5` |
| settingsRegistry | `packages/core/src/settings/settingsRegistry.test.ts` | Check exists |
| prompt-config | `packages/core/src/prompt-config/prompt-service.test.ts` | Check exists |
| compression/ | Does NOT exist yet — will be created | |

## Key Discoveries to Verify

1. `compression.md` already exists as a default prompt — verify its content matches the current `getCompressionPrompt()` output (or is a newer version)
2. The current `getCompressionPrompt()` in `prompts.ts` may differ from `compression.md` — determine which is the source of truth used at runtime
3. `geminiChat.ts` does NOT currently have `PromptService` or `PromptResolver` access — need to thread it through `AgentRuntimeContext` or constructor
4. Existing `CORE_DEFAULTS` already loads `compression.md` — verify this is accessible at runtime or just for prompt installation

## Required Decisions (Must Be Resolved Before P02)

### Decision 1: Prompt File Path
The requirements specify `compression/middle-out.md` but `compression.md` already exists in defaults.

**Resolution required**: Determine whether PromptResolver supports subdirectory paths (e.g., `compression/middle-out.md`). If yes, rename. If no, use `compression.md` and update requirements accordingly.

**Verification command**:
```bash
# Check if PromptResolver handles subdirectory paths
grep -rn "resolveFile\|resolve.*path" packages/core/src/prompt-config/prompt-resolver.ts | head -20
```

This decision MUST be documented before proceeding to Phase 02.

## Blocking Issues Found

[To be filled by preflight worker]

## Verification Gate

- [ ] All dependencies verified
- [ ] All types match expectations
- [ ] All call paths confirmed
- [ ] Test infrastructure ready (or creation planned)
- [ ] `compression.md` default relationship to `getCompressionPrompt()` understood
- [ ] Prompt access path from `performCompression()` identified

IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P01.md`
Contents:
```
Phase: P01
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
