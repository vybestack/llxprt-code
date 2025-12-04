# Phase 13: OpenAIProvider Message Building Tests (TDD)

## Phase ID

`PLAN-20251202-THINKING.P13`

## Prerequisites

- Required: Phase 12a completed
- Verification: `cat project-plans/20251202thinking/.completed/P12a.md`
- Expected: Stub method exists

## Requirements Implemented (Expanded)

### REQ-THINK-004.1: Read includeInContext Setting

**Full Text**: Message builder MUST read reasoning.includeInContext ephemeral setting
**Behavior**:

- GIVEN: Settings with `reasoning.includeInContext = true`
- WHEN: Building messages
- THEN: Check setting value before including reasoning

### REQ-THINK-004.2: Read stripFromContext Setting

**Full Text**: Message builder MUST read reasoning.stripFromContext ephemeral setting
**Behavior**:

- GIVEN: Settings with `reasoning.stripFromContext = 'allButLast'`
- WHEN: Building messages
- THEN: Apply strip policy before building

### REQ-THINK-004.3: Include reasoning_content

**Full Text**: When includeInContext=true, assistant messages MUST include reasoning_content field
**Behavior**:

- GIVEN: Assistant message with ThinkingBlock and includeInContext=true
- WHEN: Building message
- THEN: Message has `reasoning_content` field

### REQ-THINK-004.4: Exclude reasoning_content

**Full Text**: When includeInContext=false, assistant messages MUST NOT include reasoning_content
**Behavior**:

- GIVEN: Assistant message with ThinkingBlock and includeInContext=false
- WHEN: Building message
- THEN: Message does NOT have `reasoning_content` field

### REQ-THINK-004.5: Apply Strip Policy

**Full Text**: Message builder MUST apply stripFromContext policy before building
**Behavior**:

- GIVEN: History with multiple ThinkingBlocks and stripFromContext='allButLast'
- WHEN: Building messages
- THEN: Only last message has reasoning_content

## Implementation Tasks

### Files to Modify

#### `packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts`

Add tests for message building:

```typescript
describe('buildMessagesWithReasoning @plan:PLAN-20251202-THINKING.P13', () => {
  // Test fixtures
  const createAiContentWithThinking = (
    thought: string,
    text: string
  ): IContent => ({
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought,
        sourceField: 'reasoning_content',
      },
      { type: 'text', text },
    ],
  });

  const createUserContent = (text: string): IContent => ({
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  });

  // Helper to create mock SettingsService
  const createMockSettings = (settingsMap: Record<string, unknown>): SettingsService => {
    return {
      get: (key: string) => settingsMap[key],
    } as any as SettingsService;
  };

  describe('REQ-THINK-004.1: includeInContext setting', () => {
    it('reads reasoning.includeInContext from settings', () => {
      const contents = [
        createUserContent('Hello'),
        createAiContentWithThinking('Thinking...', 'Response'),
      ];
      const settings = createMockSettings({ 'reasoning.includeInContext': true });

      const result = (provider as any).buildMessagesWithReasoning(contents, settings);

      const assistantMsg = result.find((m: any) => m.role === 'assistant');
      expect(assistantMsg.reasoning_content).toBeDefined();
    });
  });

  describe('REQ-THINK-004.2: stripFromContext setting', () => {
    it('reads reasoning.stripFromContext from settings', () => {
      const contents = [
        createAiContentWithThinking('First thought', 'First'),
        createUserContent('Next'),
        createAiContentWithThinking('Second thought', 'Second'),
      ];
      const settings = createMockSettings({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'allButLast',
      });

      const result = (provider as any).buildMessagesWithReasoning(contents, settings);

      const assistantMsgs = result.filter((m: any) => m.role === 'assistant');
      // First assistant should NOT have reasoning (stripped)
      expect(assistantMsgs[0].reasoning_content).toBeUndefined();
      // Last assistant SHOULD have reasoning
      expect(assistantMsgs[1].reasoning_content).toBe('Second thought');
    });
  });

  describe('REQ-THINK-004.3: include reasoning_content', () => {
    it('includes reasoning_content when includeInContext=true', () => {
      const contents = [createAiContentWithThinking('Thinking...', 'Answer')];
      const settings = createMockSettings({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (provider as any).buildMessagesWithReasoning(contents, settings);

      expect(result[0].reasoning_content).toBe('Thinking...');
      expect(result[0].content).toBe('Answer');
    });
  });

  describe('REQ-THINK-004.4: exclude reasoning_content', () => {
    it('excludes reasoning_content when includeInContext=false', () => {
      const contents = [createAiContentWithThinking('Thinking...', 'Answer')];
      const settings = createMockSettings({
        'reasoning.includeInContext': false,
      });

      const result = (provider as any).buildMessagesWithReasoning(contents, settings);

      expect(result[0].reasoning_content).toBeUndefined();
      expect(result[0].content).toBe('Answer');
    });

    it('defaults to false when setting not present', () => {
      const contents = [createAiContentWithThinking('Thinking...', 'Answer')];
      const settings = createMockSettings({});

      const result = (provider as any).buildMessagesWithReasoning(contents, settings);

      expect(result[0].reasoning_content).toBeUndefined();
    });
  });

  describe('REQ-THINK-004.5: apply strip policy', () => {
    it('applies stripFromContext=all policy', () => {
      const contents = [
        createAiContentWithThinking('T1', 'R1'),
        createAiContentWithThinking('T2', 'R2'),
      ];
      const settings = createMockSettings({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'all',
      });

      const result = (provider as any).buildMessagesWithReasoning(contents, settings);

      result.forEach((msg: any) => {
        if (msg.role === 'assistant') {
          expect(msg.reasoning_content).toBeUndefined();
        }
      });
    });

    it('applies stripFromContext=none policy', () => {
      const contents = [
        createAiContentWithThinking('T1', 'R1'),
        createAiContentWithThinking('T2', 'R2'),
      ];
      const settings = createMockSettings({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (provider as any).buildMessagesWithReasoning(contents, settings);

      const assistantMsgs = result.filter((m: any) => m.role === 'assistant');
      expect(assistantMsgs[0].reasoning_content).toBe('T1');
      expect(assistantMsgs[1].reasoning_content).toBe('T2');
    });

    it('defaults stripFromContext to none', () => {
      const contents = [createAiContentWithThinking('T1', 'R1')];
      const settings = createMockSettings({
        'reasoning.includeInContext': true,
        // stripFromContext not set
      });

      const result = (provider as any).buildMessagesWithReasoning(contents, settings);

      expect(result[0].reasoning_content).toBe('T1');
    });
  });

  describe('edge cases', () => {
    it('handles content with no ThinkingBlocks', () => {
      const contents = [createUserContent('Hello')];
      const settings = createMockSettings({ 'reasoning.includeInContext': true });

      const result = (provider as any).buildMessagesWithReasoning(contents, settings);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
    });

    it('handles empty content array', () => {
      const contents: IContent[] = [];
      const settings = createMockSettings({});

      const result = (provider as any).buildMessagesWithReasoning(contents, settings);

      expect(result).toEqual([]);
    });

    it('handles multiple ThinkingBlocks in one content', () => {
      const content: IContent = {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'First', sourceField: 'reasoning_content' as const },
          { type: 'thinking', thought: 'Second', sourceField: 'reasoning_content' as const },
          { type: 'text', text: 'Answer' },
        ],
      };
      const settings = createMockSettings({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (provider as any).buildMessagesWithReasoning([content], settings);

      // Multiple thoughts concatenated
      expect(result[0].reasoning_content).toBe('First\nSecond');
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check tests added
grep -c "buildMessagesWithReasoning" packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts
# Expected: 10+

# Check plan markers
grep "@plan.*THINKING.P13" packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts

# Check requirement markers
grep -c "@requirement.*REQ-THINK-004" packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts
# Expected: 5+

# Run tests (should fail since stub delegates to existing)
npm test -- --run packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts
```

### TDD Verification

Tests must:

- [ ] FAIL because stub doesn't implement settings logic
- [ ] Cover all REQ-THINK-004.x requirements
- [ ] Cover REQ-THINK-006 (settings integration)
- [ ] Include edge cases

### Deferred Implementation Detection

**Purpose**: Ensure no stub/placeholder code remains after implementation

**Check**: Run tests and verify they FAIL because stub doesn't read settings or apply policies, NOT because of import/syntax errors

**Recovery**: If tests pass unexpectedly, verify P12 stub was created correctly and doesn't already implement the logic

### Semantic Verification Checklist (MANDATORY)

**Behavioral Verification Questions**:

1. **Do tests fail because settings aren't being read (expected TDD state)?**
   - Expected: Yes, tests fail because reasoning_content not included/excluded properly

2. **Do tests cover reading reasoning.includeInContext setting?**
   - Expected: Yes, REQ-THINK-004.1 tests exist

3. **Do tests cover reading reasoning.stripFromContext setting?**
   - Expected: Yes, REQ-THINK-004.2 tests exist

4. **Do tests verify reasoning_content field is included when includeInContext=true?**
   - Expected: Yes, REQ-THINK-004.3 tests exist

5. **Do tests verify reasoning_content field is excluded when includeInContext=false?**
   - Expected: Yes, REQ-THINK-004.4 tests exist

6. **Do tests verify strip policy application (none/all/allButLast)?**
   - Expected: Yes, REQ-THINK-004.5 tests exist for all policies

7. **Do tests cover edge cases (empty content, multiple thinking blocks, etc.)?**
   - Expected: Yes, edge case tests exist

8. **Can I identify what needs to be implemented from reading the tests?**
   - Expected: Yes, tests clearly show P14 needs to read settings and apply policies

## Success Criteria

- All tests exist and are well-structured
- Tests fail appropriately (TDD state)
- Ready for implementation in P14

## Failure Recovery

If this phase fails:

1. Review test structure
2. Check fixture creation
3. Re-attempt

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P13.md`
