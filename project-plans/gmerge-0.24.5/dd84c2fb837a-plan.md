# Playbook: Implement granular stop and block behavior for agent hooks

**Upstream SHA:** `dd84c2fb837a`
**Upstream Subject:** feat(hooks): implement granular stop and block behavior for agent hooks (#15824)
**Upstream Stats:** 7 files, 388 insertions(+), 17 deletions(-)

## What Upstream Does

Adds two new event types (`AgentExecutionStopped`, `AgentExecutionBlocked`) to handle BeforeAgent and AfterAgent hook decisions. When BeforeAgent/AfterAgent returns `continue: false`, the client emits `AgentExecutionStopped` and halts execution. When it returns `decision: 'block'`, the client emits `AgentExecutionBlocked`, displays a warning, and **continues** (allowing the agent to proceed but with user feedback). For AfterAgent blocks, the client automatically re-prompts with the blocking reason. The distinction: **stop** = terminate immediately, **block** = warn and continue (or re-prompt for AfterAgent).

## LLxprt Adaptation Strategy

LLxprt needs to implement the same agent-level stop/block semantics in `client.ts` and handle the events in CLI/UI:

1. **Event types**: Add `AgentExecutionStopped` and `AgentExecutionBlocked` to `GeminiEventType` enum
2. **Client logic**: Modify `client.ts` to emit these events based on hook decisions
3. **Non-interactive CLI**: Handle both events (stop early vs. display warning and continue)
4. **Interactive UI**: Handle both events in useGeminiStream  
5. **Tests**: Add tests for both stop and block scenarios in client, CLI, and UI

## Files to Create/Modify

- **MODIFY** `packages/core/src/core/turn.ts` - Add AgentExecutionStopped/Blocked event types
- **MODIFY** `packages/core/src/core/client.ts` - Emit new events based on hook decisions, handle re-prompting
- **MODIFY** `packages/cli/src/nonInteractiveCli.ts` - Handle AgentExecutionStopped and AgentExecutionBlocked events
- **MODIFY** `packages/cli/src/ui/hooks/useGeminiStream.ts` - Handle both events in interactive mode
- **MODIFY** `packages/core/src/core/client.test.ts` - Add tests for stop/block behavior
- **MODIFY** `packages/cli/src/nonInteractiveCli.test.ts` - Add tests for event handling
- **MODIFY** `packages/cli/src/ui/hooks/useGeminiStream.test.tsx` - Add tests for event handling

## Implementation Steps

1. **Modify `turn.ts`**:
   - Add `AgentExecutionStopped = 'agent_execution_stopped'` to `GeminiEventType`
   - Add `AgentExecutionBlocked = 'agent_execution_blocked'`
   - Add event type definitions: `ServerGeminiAgentExecutionStoppedEvent` and `ServerGeminiAgentExecutionBlockedEvent` with `{ reason: string }`
   - Add to `ServerGeminiStreamEvent` union type

2. **Modify `client.ts`**:
   - In `fireBeforeAgentHookSafe()`, check `shouldStopExecution()` → emit `AgentExecutionStopped`, return
   - Check `isBlockingDecision()` → emit `AgentExecutionBlocked`, return (don't add to history, don't run turn)
   - In `sendMessageStream`, handle both event types: `AgentExecutionStopped` adds user message to history then returns; `AgentExecutionBlocked` yields event and returns without history
   - In `fireAfterAgentHookSafe()`, check `shouldStopExecution()` → emit `AgentExecutionStopped`, return
   - Check `isBlockingDecision()` → emit `AgentExecutionBlocked`, then re-call `sendMessageStream` with blocking reason as prompt

3. **Modify `nonInteractiveCli.ts`**:
   - Add event handler for `AgentExecutionStopped`: write message to stderr, emit final result if needed, return
   - Add event handler for `AgentExecutionBlocked`: write warning to stderr with `[WARNING]` prefix, continue processing

4. **Modify `useGeminiStream.ts`**:
   - Add `handleAgentExecutionStoppedEvent`: flush pending history, add INFO message, setIsResponding(false)
   - Add `handleAgentExecutionBlockedEvent`: flush pending history, add WARNING message (don't stop responding)
   - Add both handlers to `processGeminiStreamEvents` switch statement

5. **Modify `client.test.ts`**:
   - Add test: "should stop execution in BeforeAgent when hook returns continue: false"
   - Add test: "should block execution in BeforeAgent when hook returns decision: block"
   - Add test: "should stop execution in AfterAgent when hook returns continue: false"
   - Add test: "should yield AgentExecutionBlocked and recurse in AfterAgent when hook returns decision: block"

6. **Modify `nonInteractiveCli.test.ts`**:
   - Add test: "should handle AgentExecutionStopped event"
   - Add test: "should handle AgentExecutionBlocked event"

7. **Modify `useGeminiStream.test.tsx`**:
   - Add test: "should handle AgentExecutionStopped event"
   - Add test: "should handle AgentExecutionBlocked event"

8. **Verify**: `npm run typecheck && npm run test -- packages/core/src/core/ packages/cli/src/`

## Execution Notes

- **Batch group:** Hooks (execute after 05049b5abfae - STOP_EXECUTION)
- **Dependencies:** 05049b5abfae (STOP_EXECUTION precedence), 15c9f88da6df (agent hook deduplication)
- **Verification:** `npm run typecheck && npm run test -- packages/core/src/core/ packages/cli/src/`
- **Important**: This commit distinguishes stop (terminate) from block (warn and continue) for agent hooks
