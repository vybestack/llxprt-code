# Issue #981 Fix Summary

## Root Cause
Pipeline mode in OpenAIProvider did not capture and preserve the original OpenAI `tool_call_id` from streaming deltas, breaking tool response matching in multi-turn conversations.

## Changes Made

### 1. ToolCallCollector.ts
- Added optional `id` field to `ToolCallFragment` interface
- Added optional `id` field to `ToolCallCandidate` interface
- Updated `assembleCall()` to extract and preserve the ID from the first fragment

### 2. ToolCallNormalizer.ts
- Added optional `id` field to `NormalizedToolCall` interface
- Added optional `id` field to `ValidatedToolCall` interface
- Updated `normalize()` to preserve the ID through normalization

### 3. ToolCallPipeline.ts
- Updated `process()` to pass the ID from `ToolCallCandidate` to `ValidatedToolCall`
- Removed the now-unnecessary `extractToolCallId()` method (ID flows directly through)

### 4. OpenAIProvider.ts
- **Critical fix**: Updated pipeline mode fragment collection (line 3964-3985) to capture `deltaToolCall.id`
- Updated tool call emission (line 4239) to use the original ID when available, falling back to synthetic ID
- Updated Kimi reasoning tool call extraction (line 3725) to generate a synthetic ID for tool calls parsed from reasoning content

### 5. ToolCallPipeline.toolCallId.test.ts
- Added new test file with 8 comprehensive tests covering:
  - ID field support in fragments and normalized tool calls
  - ID preservation through the full pipeline flow
  - Multiple tool calls with different IDs
  - Qwen/OpenAI-specific scenarios
  - Backward compatibility (fragments without IDs)
  - Full flow simulation

## Verification Status
- [OK] All 8 new tests pass
- [OK] All 2525 existing tests pass (no regressions)
- [OK] TypeScript compilation succeeds (no type errors)
- [OK] ESLint passes (no linting errors)
- [OK] Build succeeds
- [OK] Code formatted with Prettier

## Impact
This fix restores tool response matching in pipeline mode for all OpenAI-compatible providers including:
- OpenAI models (GPT-4, GPT-4o, etc.)
- Qwen models (Qwen 3 Next 80b, etc.)
- Other local models using OpenAI-compatible APIs

The fix is backward compatible - if no ID is provided, it falls back to synthesizing one as before.

## Files Modified
1. `packages/core/src/providers/openai/ToolCallCollector.ts`
2. `packages/core/src/providers/openai/ToolCallNormalizer.ts`
3. `packages/core/src/providers/openai/ToolCallPipeline.ts`
4. `packages/core/src/providers/openai/OpenAIProvider.ts`
5. `packages/core/src/providers/openai/ToolCallPipeline.toolCallId.test.ts` (new file)

## Related Issues
- Fixes: #981
- Closes issue #981