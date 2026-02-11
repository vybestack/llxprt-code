# Phase 05: Middle-Out Strategy TDD

## Phase ID

`PLAN-20260211-COMPRESSION.P05`

## Prerequisites

- Required: Phase 04 completed (shared utils pass)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P04" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/utils.ts` (passing tests)

## Requirements Implemented (Expanded)

### REQ-CS-002.1: Behavioral Equivalence

**Full Text**: The `MiddleOutStrategy` shall produce the same compression output as the current inline implementation in `geminiChat.ts` for identical inputs and configuration, when using the default shipped prompt with no user overrides.
**Behavior**:
- GIVEN: A curated history of 20 messages, preserveThreshold=0.2, topPreserveThreshold=0.2
- WHEN: `MiddleOutStrategy.compress(context)` is called
- THEN: The result's `newHistory` contains the same top-preserved, summary-injected, ack-injected, bottom-preserved message structure as current inline code
**Why This Matters**: This is a refactor. Existing behavior must not change.

### REQ-CS-002.2: Sandwich Split

**Full Text**: The `MiddleOutStrategy` shall split curated history into three sections: top-preserved (first N%), middle-to-compress, and bottom-preserved (last N%), where N% is driven by the existing `preserveThreshold` and `topPreserveThreshold` settings.
**Behavior**:
- GIVEN: 20 messages, topPreserveThreshold=0.2, preserveThreshold=0.2
- WHEN: Strategy computes split
- THEN: Top=4 messages, Middle=12 messages, Bottom=4 messages (adjusted for tool-call boundaries)

### REQ-CS-002.3: Tool-Call Boundary Respect

**Full Text**: The `MiddleOutStrategy` shall adjust split points using shared boundary utilities.
**Behavior**:
- GIVEN: The naive split lands in the middle of a tool call/response pair
- WHEN: The strategy adjusts boundaries
- THEN: It uses `adjustForToolCallBoundary` from `compression/utils.ts`

### REQ-CS-002.4: LLM Compression Call

**Full Text**: The `MiddleOutStrategy` shall send the middle section to an LLM with the compression prompt.
**Behavior**:
- GIVEN: Middle section of 12 messages and a compression prompt
- WHEN: Strategy calls the LLM provider
- THEN: The prompt text + middle messages + trigger instruction are sent to the provider's `generateChatCompletion`

### REQ-CS-002.5: Compression Profile

**Full Text**: Where a `compression.profile` setting is configured, the `MiddleOutStrategy` shall resolve and use that profile's provider and model.
**Behavior**:
- GIVEN: `compression.profile` is set to `'flashlite'`
- WHEN: Strategy needs to call LLM
- THEN: It calls `context.resolveProvider('flashlite')` instead of using the active model

### REQ-CS-002.6: Default Compression Model

**Full Text**: Where no `compression.profile` setting is configured, the `MiddleOutStrategy` shall use the active foreground model.
**Behavior**:
- GIVEN: `compression.profile` is undefined
- WHEN: Strategy needs to call LLM
- THEN: It calls `context.resolveProvider()` (no profile name) → uses active model

### REQ-CS-002.7: Result Assembly

**Full Text**: The `MiddleOutStrategy` shall assemble its result as: `[...toKeepTop, summaryAsHumanMessage, ackAsAiMessage, ...toKeepBottom]`.
**Behavior**:
- GIVEN: Strategy has top=[msg1,msg2], summary text, bottom=[msg19,msg20]
- WHEN: It assembles the result
- THEN: `newHistory` is `[msg1, msg2, {speaker:'human', text:summary}, {speaker:'ai', text:'Got it...'}, msg19, msg20]`

### REQ-CS-002.8: Minimum Compressible Messages

**Full Text**: If the middle section contains fewer than 4 messages after boundary adjustment, then the strategy shall return the original history unmodified.
**Behavior**:
- GIVEN: History of 5 messages, thresholds result in middle of 2 messages
- WHEN: Strategy runs
- THEN: Returns `newHistory === original history`, `metadata.compressedMessageCount === originalMessageCount`

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/MiddleOutStrategy.test.ts`
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P05`
  - MUST include: `@requirement REQ-CS-002.1` through `REQ-CS-002.8`
  - Test structure:
    - **Split logic**: Given various history sizes and thresholds, verify correct top/middle/bottom split counts
    - **Tool-call boundaries**: The split uses `adjustForToolCallBoundary` (verify through behavior — split doesn't orphan tool responses)
    - **LLM call construction**: The middle section is sent to the provider with the prompt and trigger instruction
    - **Profile resolution**: When `compressionProfile()` returns a name, `resolveProvider(name)` is called; when undefined, `resolveProvider()` is called
    - **Result assembly**: `newHistory` structure matches `[...top, summaryHuman, ackAi, ...bottom]`
    - **Metadata**: All metadata fields populated correctly
    - **Minimum compressible**: < 4 middle messages → original history returned unchanged
    - **Empty middle**: After boundary adjustment, no middle → original returned
  - Provider/LLM mocking: Create a fake `IProvider` that implements `generateChatCompletion` returning a known summary. This is a behavioral boundary — we're testing the strategy's orchestration, not the LLM itself.

### Required Code Markers

```typescript
describe('MiddleOutStrategy @plan PLAN-20260211-COMPRESSION.P05', () => {
  describe('sandwich split @requirement REQ-CS-002.2', () => {
    it('splits history into top/middle/bottom by threshold percentages', () => {
      // ...
    });
  });
});
```

## Verification Commands

```bash
# Tests exist
grep -r "@plan PLAN-20260211-COMPRESSION.P05" packages/core/src/core/compression/ | wc -l
# Expected: 10+ occurrences

# Tests fail naturally (MiddleOutStrategy not implemented yet)
npx vitest run packages/core/src/core/compression/MiddleOutStrategy.test.ts 2>&1 | head -20
# Expected: import/module failures

# No mock theater
grep -r "toHaveBeenCalled\b" packages/core/src/core/compression/MiddleOutStrategy.test.ts
# Expected: 0 matches (the fake provider is checked by its OUTPUT, not by spy calls)
```

## Success Criteria

- 10+ behavioral tests covering all REQ-CS-002 sub-requirements
- Tests verify strategy INPUT→OUTPUT, not mock call counts
- Provider is faked at the boundary (returns known output), not spy-verified
- Tests fail with import errors, not syntax errors

## Failure Recovery

```bash
git checkout -- packages/core/src/core/compression/MiddleOutStrategy.test.ts
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P05.md`
Contents:
```
Phase: P05
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
