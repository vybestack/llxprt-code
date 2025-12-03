# Phase 07: Stream Integration TDD

## Phase ID

`PLAN-20251202-THINKING-UI.P07`

## Prerequisites

- Required: Phase 06a (Type Extension Verification) completed
- Verification: HistoryItemGemini type includes thinkingBlocks
- Verification: GeminiMessage can render ThinkingBlockDisplay

---

## Purpose

Write tests for useGeminiStream to:
1. Accumulate ThinkingBlocks from ServerGeminiEventType.Thought events
2. Include thinkingBlocks in flushed HistoryItemGemini items
3. Control visibility via ephemeral settings

This is TDD - tests MUST be written before implementation.

---

## Requirements Implemented

### REQ-THINK-UI-001: ThinkingBlock Type Recognition (Stream Integration)

**Full Text**: The UI MUST recognize `thinking` type and route to display.

**This Phase**:
- Test that Thought events are captured
- Test that ThinkingBlocks are accumulated
- Test that blocks are included in HistoryItem

### REQ-THINK-UI-003: Toggle via Ephemeral Setting (Stream Integration)

**Full Text**: Display controlled by `reasoning.includeInResponse` ephemeral setting.

**This Phase**:
- Test setting controls whether blocks are included in HistoryItem
- Test default behavior (enabled)

---

## Test File

**Path**: `packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx`

**Why separate file?**: The main test file is large. A focused test file for thinking integration is cleaner.

---

## Test Cases to Write

### 1. Basic Thought Event Capture

```typescript
/**
 * @plan:PLAN-20251202-THINKING-UI.P07
 * @requirement:REQ-THINK-UI-001
 */
describe('ThinkingBlock accumulation', () => {
  it('should accumulate thinking content from Thought events', async () => {
    // Setup mock stream with Thought event
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Thought,
          value: { subject: 'Analyzing', description: 'The problem' },
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Here is the answer...',
        };
      })(),
    );

    // Submit query
    await submitQuery('test query');

    // Verify thinkingBlocks in history item
    const geminiItem = history.find(h => h.type === 'gemini');
    expect(geminiItem?.thinkingBlocks).toBeDefined();
    expect(geminiItem?.thinkingBlocks).toHaveLength(1);
    expect(geminiItem?.thinkingBlocks?.[0].thought).toContain('Analyzing');
  });
});
```

### 2. Multiple Thought Events

```typescript
it('should accumulate multiple thinking blocks', async () => {
  mockSendMessageStream.mockReturnValue(
    (async function* () {
      yield {
        type: ServerGeminiEventType.Thought,
        value: { subject: 'Step 1', description: 'First thought' },
      };
      yield {
        type: ServerGeminiEventType.Thought,
        value: { subject: 'Step 2', description: 'Second thought' },
      };
      yield {
        type: ServerGeminiEventType.Content,
        value: 'Answer...',
      };
    })(),
  );

  await submitQuery('test query');

  const geminiItem = history.find(h => h.type === 'gemini');
  expect(geminiItem?.thinkingBlocks).toHaveLength(2);
});
```

### 3. Thought Events Without Content

```typescript
it('should handle thought-only responses', async () => {
  // Some models may only emit thoughts without final content
  mockSendMessageStream.mockReturnValue(
    (async function* () {
      yield {
        type: ServerGeminiEventType.Thought,
        value: { subject: 'Thinking', description: 'Deep thoughts' },
      };
    })(),
  );

  await submitQuery('test query');

  // Should still create history item with thinking blocks
  const items = history.filter(h => h.type === 'gemini');
  // Behavior TBD - may not create item without content
});
```

### 4. Settings Control

```typescript
/**
 * @plan:PLAN-20251202-THINKING-UI.P07
 * @requirement:REQ-THINK-UI-003
 */
describe('ThinkingBlock visibility settings', () => {
  it('should include thinkingBlocks when reasoning.includeInResponse is true', async () => {
    mockGetEphemeralSetting.mockImplementation((key: string) => {
      if (key === 'reasoning.includeInResponse') return true;
      return undefined;
    });

    // Stream with thought
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield { type: ServerGeminiEventType.Thought, value: { subject: 'Thinking' } };
        yield { type: ServerGeminiEventType.Content, value: 'Answer' };
      })(),
    );

    await submitQuery('test');

    const geminiItem = history.find(h => h.type === 'gemini');
    expect(geminiItem?.thinkingBlocks).toHaveLength(1);
  });

  it('should NOT include thinkingBlocks when reasoning.includeInResponse is false', async () => {
    mockGetEphemeralSetting.mockImplementation((key: string) => {
      if (key === 'reasoning.includeInResponse') return false;
      return undefined;
    });

    // Stream with thought
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield { type: ServerGeminiEventType.Thought, value: { subject: 'Thinking' } };
        yield { type: ServerGeminiEventType.Content, value: 'Answer' };
      })(),
    );

    await submitQuery('test');

    const geminiItem = history.find(h => h.type === 'gemini');
    expect(geminiItem?.thinkingBlocks).toBeUndefined();
  });
});
```

### 5. ThinkingBlock Structure

```typescript
it('should create ThinkingBlock with correct structure', async () => {
  mockSendMessageStream.mockReturnValue(
    (async function* () {
      yield {
        type: ServerGeminiEventType.Thought,
        value: { subject: 'Analysis', description: 'Detailed thinking' },
      };
      yield { type: ServerGeminiEventType.Content, value: 'Answer' };
    })(),
  );

  await submitQuery('test');

  const geminiItem = history.find(h => h.type === 'gemini');
  const block = geminiItem?.thinkingBlocks?.[0];
  expect(block).toMatchObject({
    type: 'thinking',
    thought: expect.any(String),
    sourceField: 'thought',
  });
});
```

---

## Required Code Markers

All tests MUST include:

```typescript
/**
 * @plan:PLAN-20251202-THINKING-UI.P07
 * @requirement:REQ-THINK-UI-001
 * @requirement:REQ-THINK-UI-003
 */
```

Note: Use colon syntax `@plan:PLAN-ID`.

---

## Verification Commands

### Test File Exists

```bash
test -f packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx && echo "PASS" || echo "FAIL"
```

### Plan Markers

```bash
grep "@plan:PLAN-20251202-THINKING-UI.P07" packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx && echo "PASS" || echo "FAIL"
```

### Test Count

```bash
grep -c "it\('" packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx
# Expected: 5+
```

### Tests Fail (TDD)

```bash
npm test -- packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx --run 2>&1 | tail -20
# Expected: Tests fail because implementation doesn't exist yet
```

---

## Success Criteria

- Test file exists
- 5+ test cases written
- Tests cover Thought event capture
- Tests cover settings control
- Tests verify ThinkingBlock structure
- Tests FAIL with current implementation (TDD)
- No mock theater

---

## Phase Completion Marker

Create: `project-plans/20251202thinking-2/.completed/P07.md`

Contents:
```markdown
Phase: P07
Completed: [DATE TIME]
Files Created:
  - packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx
Test Count: 5+
Test Status: FAILING (TDD - expected)
```
