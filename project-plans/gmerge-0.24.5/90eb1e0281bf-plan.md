# Playbook: Implement support for tool input modification

**Upstream SHA:** `90eb1e0281bf`
**Upstream Subject:** Implement support for tool input modification (#15492)
**Upstream Stats:** 12 files, 413 insertions(+), 24 deletions(-)

## What Upstream Does

Enables BeforeTool hooks to modify tool input parameters before execution via the `tool_input` field in `hookSpecificOutput`. The hook returns modified parameters, which are applied via `Object.assign()` to the invocation params, then the tool is rebuilt with the new params to ensure validation. A system message is appended to the tool result indicating which parameters were modified. The implementation spans: (1) `BeforeToolHookOutput.getModifiedToolInput()` method in types.ts, (2) input modification logic in `executeToolWithHooks()`, (3) sequential hook chaining in `HookRunner`, and (4) integration tests.

## LLxprt Adaptation Strategy

LLxprt's hook system already has `BeforeToolHookOutput` in `types.ts`. The changes needed:

1. **Hook output**: Add `getModifiedToolInput()` method to `BeforeToolHookOutput` class
2. **Tool execution**: Modify `executeToolWithHooks()` in `coreToolHookTriggers.ts` to apply modified input, rebuild invocation
3. **Hook aggregator**: Merge `hookSpecificOutput` objects when aggregating (currently might not merge them)
4. **Hook runner**: Support sequential input modification in `applyHookOutputToInput()` for BeforeTool events
5. **Types**: Add `tool_input` field to `BeforeToolOutput` interface
6. **Tests**: Add tests for input modification scenarios

## Files to Create/Modify

- **MODIFY** `packages/core/src/hooks/types.ts` - Add `getModifiedToolInput()` to `BeforeToolHookOutput`, update interface
- **MODIFY** `packages/core/src/core/coreToolHookTriggers.ts` - Apply input modifications in `executeToolWithHooks()`
- **MODIFY** `packages/core/src/hooks/hookAggregator.ts` - Merge hookSpecificOutput objects
- **MODIFY** `packages/core/src/hooks/hookRunner.ts` - Handle BeforeTool input modification in sequential execution
- **MODIFY** `packages/core/src/core/coreToolScheduler.ts` - Pass `tool` parameter to `executeToolWithHooks()`
- **CREATE** `packages/core/src/core/coreToolHookTriggers.test.ts` - Tests for input modification
- **MODIFY** `packages/core/src/hooks/types.test.ts` - Test createHookOutput returns BeforeToolHookOutput
- **SKIP** Integration tests (only if compatible test infrastructure exists)

## Implementation Steps

1. **Modify `types.ts`**:
   - In `BeforeToolHookOutput` class, add `getModifiedToolInput()` method (similar to `getModifiedToolInput()` in upstream)
   - Add `tool_input?: Record<string, unknown>` to `BeforeToolOutput` interface hookSpecificOutput

2. **Modify `hookAggregator.ts`**:
   - In `aggregateResults()`, merge `hookSpecificOutput` from each output: `merged.hookSpecificOutput = { ...(merged.hookSpecificOutput || {}), ...output.hookSpecificOutput }`

3. **Modify `hookRunner.ts`**:
   - In `applyHookOutputToInput()`, add case for `HookEventName.BeforeTool`:
     ```typescript
     case HookEventName.BeforeTool:
       if ('tool_input' in hookOutput.hookSpecificOutput) {
         const newToolInput = hookOutput.hookSpecificOutput['tool_input'] as Record<string, unknown>;
         if (newToolInput && 'tool_input' in modifiedInput) {
           (modifiedInput as BeforeToolInput).tool_input = {
             ...(modifiedInput as BeforeToolInput).tool_input,
             ...newToolInput,
           };
         }
       }
       break;
     ```

4. **Modify `coreToolHookTriggers.ts`**:
   - Add `tool: AnyDeclarativeTool` parameter to `executeToolWithHooks()`
   - After firing BeforeTool hook, check `beforeOutput instanceof BeforeToolHookOutput` and call `getModifiedToolInput()`
   - If modified: `Object.assign(invocation.params, modifiedInput)`, set `inputWasModified = true`, track `modifiedKeys`
   - Rebuild invocation: `invocation = tool.build(invocation.params)` with error handling
   - After tool execution, append modification message if `inputWasModified`

5. **Modify `coreToolScheduler.ts`**:
   - Pass `toolCall.tool` to `executeToolWithHooks()` calls

6. **Create `coreToolHookTriggers.test.ts`**:
   - Test: hook provides modified input → params are updated, tool rebuilds
   - Test: hook doesn't provide input → no modification
   - Mock MessageBus, mock tool with `build()` method

7. **Modify `types.test.ts`**:
   - Add test: `createHookOutput(HookEventName.BeforeTool, {})` returns `BeforeToolHookOutput`

8. **Verify**: `npm run typecheck && npm run test -- packages/core/src/hooks/ packages/core/src/core/`

## Execution Notes

- **Batch group:** Hooks (execute after 15c9f88da6df - deduplication)
- **Dependencies:** 15c9f88da6df (hook deduplication), dced409ac42d (folder trust)
- **Verification:** `npm run typecheck && npm run test -- packages/core/src/hooks/ packages/core/src/core/`
- **Important**: Requires `@requirement:HOOK-019` tag in relevant code
