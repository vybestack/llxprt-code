# Phase 16: End-to-End Tests

## Phase ID

`PLAN-20251202-THINKING.P16`

## Prerequisites

- Required: Phase 15a completed
- Verification: `cat project-plans/20251202thinking/.completed/P15a.md`
- Expected: All components integrated and unit tested

## Purpose

Verify the complete reasoning flow works end-to-end with mock API responses.

## Test Scenarios

### Scenario 1: Streaming with reasoning_content

**Test Name**: `e2e: streaming response with reasoning_content`

```typescript
it('yields ThinkingBlock before TextBlock when streaming', async () => {
  // Mock streaming response with reasoning_content
  const mockStream = createMockStream([
    { delta: { reasoning_content: 'Thinking step 1...' } },
    { delta: { reasoning_content: ' Step 2...' } },
    { delta: { content: 'Here is ' } },
    { delta: { content: 'my answer.' } },
  ]);

  mockOpenAI.chat.completions.create.mockReturnValue(mockStream);

  const results: IContent[] = [];
  for await (const content of provider.generateChatStream(messages)) {
    results.push(content);
  }

  // First yields should be thinking
  expect(results[0].blocks[0].type).toBe('thinking');
  expect((results[0].blocks[0] as ThinkingBlock).thought).toBe('Thinking step 1...');

  // Later yields should be text
  const textBlocks = results.flatMap(r => r.blocks.filter(b => b.type === 'text'));
  expect(textBlocks.length).toBeGreaterThan(0);
});
```

### Scenario 2: Non-streaming with reasoning_content

**Test Name**: `e2e: non-streaming response with reasoning_content`

```typescript
it('includes ThinkingBlock in non-streaming response', async () => {
  mockOpenAI.chat.completions.create.mockResolvedValue({
    choices: [{
      message: {
        role: 'assistant',
        content: 'My answer',
        reasoning_content: 'I thought about this carefully...',
      },
    }],
  });

  const result = await provider.generateChat(messages);

  const thinking = result.blocks.find(b => b.type === 'thinking') as ThinkingBlock;
  expect(thinking).toBeDefined();
  expect(thinking.thought).toBe('I thought about this carefully...');
  expect(thinking.sourceField).toBe('reasoning_content');

  const text = result.blocks.find(b => b.type === 'text');
  expect(text).toBeDefined();
});
```

### Scenario 3: Round-trip with includeInContext=true

**Test Name**: `e2e: reasoning included in subsequent request`

```typescript
it('includes reasoning_content in next request when setting enabled', async () => {
  const history: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 'Processing...', sourceField: 'reasoning_content' },
        { type: 'text', text: 'Hi there!' },
      ],
    },
  ];

  const settings = {
    'reasoning.includeInContext': true,
    'reasoning.stripFromContext': 'none',
  };

  const messages = provider.buildMessagesWithReasoning(history, settings);

  const assistantMsg = messages.find(m => m.role === 'assistant');
  expect(assistantMsg.reasoning_content).toBe('Processing...');
});
```

### GAP 6 FIX: Scenario 3b - Full Round-Trip Verification

**Test Name**: `e2e: thinking blocks survive complete round-trip`

**Purpose**: Verify that reasoning_content received from API, stored in history, and sent back in subsequent requests maintains integrity throughout the entire flow.

```typescript
it('verifies thinking blocks survive full round-trip cycle', async () => {
  // STEP 1: Simulate API response with reasoning_content
  const mockApiResponse = {
    choices: [{
      message: {
        role: 'assistant',
        content: 'Final answer',
        reasoning_content: 'Let me think about this carefully...',
      },
    }],
  };

  mockOpenAI.chat.completions.create.mockResolvedValue(mockApiResponse);

  // STEP 2: Generate response and capture IContent
  const generatedContent = await provider.generateChat([
    { role: 'user', content: 'Test question' }
  ]);

  // STEP 3: Verify ThinkingBlock was created from parsing
  const thinkingBlock = generatedContent.blocks.find(b => b.type === 'thinking') as ThinkingBlock;
  expect(thinkingBlock).toBeDefined();
  expect(thinkingBlock.thought).toBe('Let me think about this carefully...');
  expect(thinkingBlock.sourceField).toBe('reasoning_content');

  const textBlock = generatedContent.blocks.find(b => b.type === 'text') as TextBlock;
  expect(textBlock).toBeDefined();
  expect(textBlock.text).toBe('Final answer');

  // STEP 4: Store in history (simulated)
  const history: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Test question' }] },
    generatedContent, // Store the parsed content with ThinkingBlock
  ];

  // STEP 5: Build next request with includeInContext=true
  const settings = {
    'reasoning.includeInContext': true,
    'reasoning.stripFromContext': 'none',
  };

  const messages = provider.buildMessagesWithReasoning(history, settings);

  // STEP 6: Verify reasoning_content appears in built message
  const assistantMsg = messages.find(m => m.role === 'assistant') as any;
  expect(assistantMsg).toBeDefined();
  expect(assistantMsg.content).toBe('Final answer');
  expect(assistantMsg.reasoning_content).toBe('Let me think about this carefully...');

  // STEP 7: Verify round-trip integrity
  // The reasoning_content we received in STEP 1 should match what we send in STEP 6
  expect(assistantMsg.reasoning_content).toBe(mockApiResponse.choices[0].message.reasoning_content);
});

it('verifies round-trip with multiple thinking blocks', async () => {
  // Test that multiple ThinkingBlocks are correctly concatenated during round-trip
  const history: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Complex question' }] },
    {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 'First thought...', sourceField: 'reasoning_content' },
        { type: 'thinking', thought: 'Second thought...', sourceField: 'reasoning_content' },
        { type: 'text', text: 'Answer based on thoughts' },
      ],
    },
  ];

  const settings = {
    'reasoning.includeInContext': true,
    'reasoning.stripFromContext': 'none',
  };

  const messages = provider.buildMessagesWithReasoning(history, settings);

  const assistantMsg = messages.find(m => m.role === 'assistant') as any;
  expect(assistantMsg.reasoning_content).toBe('First thought...\nSecond thought...');
});
```

**Why This Matters**:
- Scenario 3b explicitly tests the ENTIRE round-trip: API → Parse → Store → Build → API
- Verifies data integrity at each step
- Ensures ThinkingBlock structure is preserved
- Tests concatenation of multiple thinking blocks
- Validates that sourceField='reasoning_content' survives the trip

### Scenario 4: Round-trip with includeInContext=false

**Test Name**: `e2e: reasoning excluded from subsequent request`

```typescript
it('excludes reasoning_content when setting disabled', async () => {
  const history: IContent[] = [
    {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 'Processing...', sourceField: 'reasoning_content' },
        { type: 'text', text: 'Answer' },
      ],
    },
  ];

  const settings = {
    'reasoning.includeInContext': false,
  };

  const messages = provider.buildMessagesWithReasoning(history, settings);

  const assistantMsg = messages.find(m => m.role === 'assistant');
  expect(assistantMsg.reasoning_content).toBeUndefined();
});
```

### Scenario 5: Model without reasoning_content

**Test Name**: `e2e: graceful handling of non-reasoning model`

```typescript
it('works normally when model returns no reasoning_content', async () => {
  mockOpenAI.chat.completions.create.mockResolvedValue({
    choices: [{
      message: {
        role: 'assistant',
        content: 'Normal response',
        // No reasoning_content field
      },
    }],
  });

  const result = await provider.generateChat(messages);

  const thinking = result.blocks.find(b => b.type === 'thinking');
  expect(thinking).toBeUndefined();

  const text = result.blocks.find(b => b.type === 'text');
  expect(text).toBeDefined();
});
```

### Scenario 6: Context limit with stripped reasoning

**Test Name**: `e2e: effective token count with stripped reasoning`

```typescript
it('calculates effective tokens excluding stripped reasoning', () => {
  const history: IContent[] = [
    {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 'Very long reasoning that takes many tokens...' },
        { type: 'text', text: 'Short' },
      ],
    },
  ];

  const withReasoning = getEffectiveTokenCount(history, {
    'reasoning.includeInContext': true,
  });

  const withoutReasoning = getEffectiveTokenCount(history, {
    'reasoning.includeInContext': false,
  });

  expect(withoutReasoning).toBeLessThan(withReasoning);
});
```

### Scenario 7: Tool Call + Reasoning Round-Trip (Kimi K2 Fix)

**Test Name**: `e2e: reasoning preserved across tool call boundary`

This tests the original bug that motivated this feature: Kimi K2 breaking after tool calls when reasoning_content is not included.

```typescript
it('preserves reasoning across tool call boundary when includeInContext=true', async () => {
  // Step 1: Initial response with reasoning + tool call
  const history: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'List files in /tmp' }] },
    {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 'User wants to see files in /tmp...', sourceField: 'reasoning_content' },
        { type: 'tool_call', id: 'call_1', name: 'list_files', parameters: { path: '/tmp' } },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        { type: 'tool_response', callId: 'call_1', toolName: 'list_files', result: 'file1.txt\nfile2.txt' },
      ],
    },
  ];

  const settings = {
    'reasoning.includeInContext': true,
    'reasoning.stripFromContext': 'none',
  };

  // Step 2: Build messages for next request
  const messages = provider.buildMessagesWithReasoning(history, settings);

  // Step 3: Verify reasoning is included in assistant message before tool call
  const assistantMsg = messages.find(m =>
    m.role === 'assistant' &&
    m.tool_calls?.some(tc => tc.id === 'call_1')
  );

  expect(assistantMsg).toBeDefined();
  expect(assistantMsg.reasoning_content).toBe('User wants to see files in /tmp...');
});

it('excludes reasoning but preserves tool calls when includeInContext=false', async () => {
  const history: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'List files' }] },
    {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 'Thinking about this...', sourceField: 'reasoning_content' },
        { type: 'tool_call', id: 'call_2', name: 'list_files', parameters: { path: '.' } },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        { type: 'tool_response', callId: 'call_2', toolName: 'list_files', result: 'output' },
      ],
    },
  ];

  const settings = {
    'reasoning.includeInContext': false,
  };

  const messages = provider.buildMessagesWithReasoning(history, settings);

  // Assistant message should have tool_calls but NO reasoning_content
  const assistantMsg = messages.find(m => m.role === 'assistant');
  expect(assistantMsg.tool_calls).toBeDefined();
  expect(assistantMsg.reasoning_content).toBeUndefined();
});

it('handles multi-turn with reasoning after tool response', async () => {
  // Simulates: user -> AI (thinking + tool) -> tool response -> AI (new thinking + text)
  const history: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'What time is it?' }] },
    {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 'Need to check time...', sourceField: 'reasoning_content' },
        { type: 'tool_call', id: 'call_time', name: 'get_time', parameters: {} },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        { type: 'tool_response', callId: 'call_time', toolName: 'get_time', result: '3:45 PM' },
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 'Got the time, formulating response...', sourceField: 'reasoning_content' },
        { type: 'text', text: 'It is currently 3:45 PM.' },
      ],
    },
  ];

  const settings = {
    'reasoning.includeInContext': true,
    'reasoning.stripFromContext': 'allButLast',
  };

  const messages = provider.buildMessagesWithReasoning(history, settings);

  // First AI message: NO reasoning (stripped by allButLast)
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  expect(assistantMsgs[0].reasoning_content).toBeUndefined();
  expect(assistantMsgs[0].tool_calls).toBeDefined();

  // Second AI message: HAS reasoning (it's the last one)
  expect(assistantMsgs[1].reasoning_content).toBe('Got the time, formulating response...');
});
```

**Why These Tests Matter**:
- Scenario 7a: Validates the core Kimi K2 fix - reasoning must be included with tool calls
- Scenario 7b: Validates that disabling reasoning doesn't break tool calls
- Scenario 7c: Validates the `allButLast` strip policy with tool calls

## Implementation Tasks

### Files to Create

#### `packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts`

Contains all E2E test scenarios above with proper mocking.

## Verification Commands

### Automated Checks

```bash
# Run E2E tests
npm test -- --run packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts

# Run all OpenAI tests
npm test -- --run packages/core/src/providers/openai/

# Run full test suite
npm run test:ci

# TypeScript compiles
npm run typecheck

# Lint passes
npm run lint
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Run ALL of these checks - if ANY match, phase FAILS:

# Check for TODO/FIXME/HACK markers left in test file
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts
# Expected: No matches (or only in comments explaining WHY, not WHAT to do)

# Check for skipped tests
grep -rn -E "(it\.skip|test\.skip|describe\.skip|xit|xtest|xdescribe)" packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts
# Expected: No skipped tests

# Check for placeholder assertions
grep -rn -E "(expect\(true\)|expect\(1\)\.toBe\(1\)|\.toBeTruthy\(\)$)" packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts
# Expected: No placeholder/trivial assertions
```

### Semantic Verification Checklist (MANDATORY)

**Go beyond markers. Actually verify the behavior is tested.**

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does each test verify a distinct requirement?**
   - [ ] Scenario 1: REQ-THINK-003.1 (Streaming parsing)
   - [ ] Scenario 2: REQ-THINK-003.2, REQ-THINK-003.3 (Non-streaming parsing, sourceField)
   - [ ] Scenario 3: REQ-THINK-004.1, REQ-THINK-004.3 (includeInContext=true)
   - [ ] Scenario 4: REQ-THINK-004.4 (includeInContext=false)
   - [ ] Scenario 5: REQ-THINK-003.4 (Graceful absence)
   - [ ] Scenario 6: REQ-THINK-005.1, REQ-THINK-005.2 (Effective token count)
   - [ ] Scenario 7: EC-006 (Tool call + reasoning boundary)

2. **Are assertions specific, not generic?**
   - [ ] Each test asserts on specific field values (not just `.toBeDefined()`)
   - [ ] Tests verify correct block types and ordering
   - [ ] Tests verify correct field names (`reasoning_content`, not generic)

3. **Would tests catch regression?**
   - [ ] If parseStreamingReasoningDelta returned null, tests would fail
   - [ ] If buildMessagesWithReasoning ignored settings, tests would fail
   - [ ] If tool calls lost reasoning_content, tests would fail

4. **Is mock data realistic?**
   - [ ] Mock streaming chunks match real OpenAI API format
   - [ ] Mock non-streaming responses match real API format
   - [ ] Tool call structures match real API format

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

#### Test Coverage Verified

- [ ] All 7 scenarios have corresponding test cases
- [ ] Scenario 7 has 3 sub-tests (7a, 7b, 7c)
- [ ] Each test has clear setup, action, and assertions
- [ ] Edge cases from domain-model.md EC-001 through EC-007 covered

#### Integration Points Verified

- [ ] Tests mock OpenAI API correctly (not calling real API)
- [ ] Tests use provider.generateChatStream() and provider.generateChat()
- [ ] Tests use provider.buildMessagesWithReasoning() with settings
- [ ] Tests verify IContent block structure matches expectations

## Success Criteria

- All E2E test scenarios pass
- Complete flow verified: parse → store → filter → build → send
- Non-reasoning models still work
- Context limit calculation correct

## Phase Completion

This is the final implementation phase. After verification:

1. Create `project-plans/20251202thinking/.completed/P16.md`
2. Update `execution-tracker.md` with all phases complete
3. Feature is ready for integration testing with real Kimi K2 API

## Out of Scope Reminder

The following are NOT part of this phase (separate plans):

- UI rendering of ThinkingBlocks
- Anthropic provider support
- Gemini provider updates
- Token tracking (thoughts_token_count)
