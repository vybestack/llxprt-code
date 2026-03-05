# Playbook: Deduplicate agent hooks and add cross-platform integration tests

**Upstream SHA:** `15c9f88da6df`
**Upstream Subject:** fix(hooks): deduplicate agent hooks and add cross-platform integration tests (#15701)
**Upstream Stats:** 6 files, 774 insertions(+), 219 deletions(-)

## What Upstream Does

This commit focuses on two main areas: (1) fixes hook deduplication for BeforeAgent/AfterAgent by implementing proper hook state tracking in `GeminiClient` to prevent multiple fires during recursive sendMessageStream calls, and (2) converts all integration test hook commands from shell scripts to Node.js inline commands for cross-platform compatibility (Windows/Unix). The hook deduplication uses a `hookStateMap` keyed by `prompt_id` to track whether BeforeAgent has fired and accumulate response text for AfterAgent. Only the outermost call (activeCalls === 1) fires AfterAgent.

## LLxprt Adaptation Strategy

LLxprt likely has a similar agentic loop structure to Gemini CLI upstream. The key adaptations:

1. **Client hook state**: Add `hookStateMap` to track hook firing per prompt_id in the equivalent of `GeminiClient`
2. **Safe hook firing**: Add `fireBeforeAgentHookSafe()` and `fireAfterAgentHookSafe()` methods with deduplication logic
3. **Integration tests**: LLxprt may not have the same integration test structure - **SKIP** test changes if incompatible, but note the pattern for future tests
4. **Hook responses**: Update `processTurn` to accumulate responses in hookState for AfterAgent

**Decision**: Implement the client-side deduplication logic but SKIP integration test migrations if LLxprt's test infrastructure differs significantly.

## Files to Create/Modify

- **MODIFY** `packages/core/src/core/client.ts` - Add hookStateMap, deduplication methods, refactor sendMessageStream
- **MODIFY** `packages/core/src/core/client.test.ts` - Add hook deduplication tests
- **SKIP** Integration test modifications (only if LLxprt has equivalent test infrastructure)

## Implementation Steps

1. **Modify `client.ts`**:
   - Add private `hookStateMap: Map<string, { hasFiredBeforeAgent: boolean; cumulativeResponse: string; activeCalls: number; originalRequest: PartListUnion }>()`
   - Add `fireBeforeAgentHookSafe()` method that checks `hookState.hasFiredBeforeAgent`, increments `activeCalls`, fires only if not already fired
   - Add `fireAfterAgentHookSafe()` method that checks `activeCalls === 1` and no pending tool calls, uses cumulative response
   - Refactor `sendMessageStream` to extract turn logic into `processTurn()` method
   - In `processTurn`, accumulate response text to `hookState.cumulativeResponse` after each turn completes
   - Call safe hook methods instead of direct hook triggers
   - Clean up old prompt_id state when `lastPromptId` changes

2. **Modify `client.test.ts`**:
   - Add test for single turn: BeforeAgent and AfterAgent fire exactly once
   - Add test for recursive calls: BeforeAgent fires once, AfterAgent fires once with cumulative response
   - Add test for prompt_id change: old state is cleaned up
   - Mock `fireBeforeAgentHook` and `fireAfterAgentHook` from `clientHookTriggers.ts`
   - Add `MockTurnContext` interface with `getResponseText` mock

3. **Integration tests**: Only adapt if LLxprt has similar test-helper.ts infrastructure. Otherwise skip and note for future.

4. **Verify**: `npm run typecheck && npm run test -- packages/core/src/core/client`

## Execution Notes

- **Batch group:** Hooks (execute after e6344a8c2478 - project-level warnings)
- **Dependencies:** e6344a8c2478 (project hooks), earlier hook infrastructure
- **Verification:** `npm run typecheck && npm run test -- packages/core/src/core/client`
- **Note**: Integration test adaptations are OPTIONAL - skip if test infrastructure differs significantly
