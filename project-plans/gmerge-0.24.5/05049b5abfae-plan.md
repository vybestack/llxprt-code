# Playbook: Implement STOP_EXECUTION and enhance hook decision handling

**Upstream SHA:** `05049b5abfae`
**Upstream Subject:** feat(hooks): implement STOP_EXECUTION and enhance hook decision handling (#15685)
**Upstream Stats:** 10 files, 379 insertions(+), 28 deletions(-)

## What Upstream Does

Introduces `ToolErrorType.STOP_EXECUTION` to distinguish between "stop agent execution entirely" (continue: false) versus "block this specific operation" (decision: block/deny). The key priority change: `shouldStopExecution()` is now checked **before** `getBlockingError()` in BeforeTool hooks. AfterTool now also checks for `getBlockingError()` for deny decisions. The `getEffectiveReason()` method prioritizes `stopReason` over `reason`. CLI code (nonInteractiveCli, useGeminiStream) handles STOP_EXECUTION by halting the agent loop immediately. Tests added for new precedence rules and stop behavior.

## LLxprt Adaptation Strategy

LLxprt needs the same precedence change for hook decision handling:

1. **Tool error type**: Add `STOP_EXECUTION` to `ToolErrorType` enum
2. **Hook types**: Change `getEffectiveReason()` to prioritize `stopReason`  
3. **Tool triggers**: Reorder checks in `coreToolHookTriggers.ts` — `shouldStopExecution()` before `getBlockingError()`
4. **Non-interactive CLI**: Handle STOP_EXECUTION in tool loop
5. **Interactive UI hook**: Handle STOP_EXECUTION in useGeminiStream
6. **Tests**: Update test expectations for precedence and add STOP_EXECUTION tests

## Files to Create/Modify

- **MODIFY** `packages/core/src/tools/tool-error.ts` - Add STOP_EXECUTION enum value
- **MODIFY** `packages/core/src/hooks/types.ts` - Change getEffectiveReason precedence
- **MODIFY** `packages/core/src/core/coreToolHookTriggers.ts` - Reorder BeforeTool/AfterTool checks
- **MODIFY** `packages/cli/src/nonInteractiveCli.ts` - Handle STOP_EXECUTION tool error
- **MODIFY** `packages/cli/src/ui/hooks/useGeminiStream.ts` - Handle STOP_EXECUTION in interactive mode
- **MODIFY** `packages/core/src/core/coreToolHookTriggers.test.ts` - Add precedence tests
- **MODIFY** `packages/cli/src/nonInteractiveCli.test.ts` - Add STOP_EXECUTION test
- **MODIFY** `packages/cli/src/ui/hooks/useGeminiStream.test.tsx` - Add STOP_EXECUTION test
- **SKIP** Integration test modifications (optional)

## Implementation Steps

1. **Modify `tool-error.ts`**: Add `STOP_EXECUTION = 'stop_execution'` to `ToolErrorType` enum after WEB_SEARCH_FAILED.

2. **Modify `types.ts`**: In `DefaultHookOutput.getEffectiveReason()`, change to `return this.stopReason || this.reason || 'No reason provided';`

3. **Modify `coreToolHookTriggers.ts` in BeforeTool section**:
   - Move `shouldStopExecution()` check BEFORE `getBlockingError()` check
   - STOP_EXECUTION case uses `ToolErrorType.STOP_EXECUTION` instead of `EXECUTION_FAILED`
   - AfterTool: Add `shouldStopExecution()` check with STOP_EXECUTION error type
   - AfterTool: Add `getBlockingError()` check for deny decisions

4. **Modify `nonInteractiveCli.ts`**:
   - After tool execution loop, check `completedToolCalls.find(tc => tc.response.errorType === ToolErrorType.STOP_EXECUTION)`
   - If found, write stop message to stderr, emit final result event, and return early

5. **Modify `useGeminiStream.ts`**:
   - In `onComplete` callback, check for `stopExecutionTool` with same logic
   - If found, add INFO message, setIsResponding(false), markToolsAsSubmitted, return without calling sendMessageStream

6. **Modify `coreToolHookTriggers.test.ts`**:
   - Add test: "should prioritize continue: false over decision: block in BeforeTool"
   - Add test: "should block execution in BeforeTool if decision is block"
   - Add test: "should handle continue: false in AfterTool"
   - Add test: "should block result in AfterTool if decision is deny"

7. **Modify `nonInteractiveCli.test.ts`**: Add test for STOP_EXECUTION handling

8. **Modify `useGeminiStream.test.tsx`**: Add test for STOP_EXECUTION in tool calls

9. **Verify**: `npm run typecheck && npm run test -- packages/core/src/core/ packages/core/src/tools/ packages/core/src/hooks/ packages/cli/src/`

## Execution Notes

- **Batch group:** Hooks (execute after 90eb1e0281bf - tool input modification)
- **Dependencies:** 90eb1e0281bf (tool input modification), earlier hook commits
- **Verification:** `npm run typecheck && npm run test -- packages/core/src/core/ packages/core/src/tools/ packages/core/src/hooks/ packages/cli/src/`
- **Critical**: This changes hook decision precedence — continue:false now takes priority over decision:block
