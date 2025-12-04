# Phase 08: Stream Integration Implementation

## Phase ID

`PLAN-20251202-THINKING-UI.P08`

## Prerequisites

- Required: Phase 07a (TDD Verification) completed
- Verification: All P07 tests exist and FAIL (TDD)
- Verification: Test structure validates correct behavior

---

## Purpose

Implement ThinkingBlock accumulation in useGeminiStream:
1. Capture ServerGeminiEventType.Thought events
2. Accumulate into ThinkingBlock array
3. Include in flushed HistoryItemGemini
4. Respect ephemeral setting for inclusion

---

## Requirements Implemented

### REQ-THINK-UI-001: ThinkingBlock Type Recognition (Stream Integration)

**Full Text**: The UI MUST recognize `thinking` type and route to display.

**Implementation**:
- Add state to track ThinkingBlocks during stream
- Convert Thought events to ThinkingBlock format
- Include blocks in HistoryItemGemini when flushing

### REQ-THINK-UI-003: Toggle via Ephemeral Setting

**Full Text**: Display controlled by `reasoning.includeInResponse` ephemeral setting.

**Implementation**:
- Check setting before including blocks in HistoryItem
- Default to true (include thinking)

---

## Implementation Tasks

### 1. Update `packages/cli/src/ui/hooks/useGeminiStream.ts`

**Add state for ThinkingBlock accumulation**:

```typescript
// @plan:PLAN-20251202-THINKING-UI.P08
// @requirement:REQ-THINK-UI-001
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';

// Add ref to track thinking blocks during a turn
const thinkingBlocksRef = useRef<ThinkingBlock[]>([]);
```

**Handle Thought events in processGeminiStreamEvents**:

```typescript
// In switch statement, handle Thought event
case ServerGeminiEventType.Thought:
  // @plan:PLAN-20251202-THINKING-UI.P08
  // @requirement:REQ-THINK-UI-001
  setThought(event.value); // Existing loading indicator

  // NEW: Accumulate as ThinkingBlock for history
  const thinkingBlock: ThinkingBlock = {
    type: 'thinking',
    thought: `${event.value.subject || ''}: ${event.value.description || ''}`.trim(),
    sourceField: 'thought',
  };
  thinkingBlocksRef.current.push(thinkingBlock);
  break;
```

**Include ThinkingBlocks when flushing history item**:

```typescript
// @plan:PLAN-20251202-THINKING-UI.P08
// @requirement:REQ-THINK-UI-003
const includeThinking = (config.getEphemeralSetting?.('reasoning.includeInResponse') ?? true) as boolean;

// In flushPendingHistoryItem or handleContentEvent
if (pending.type === 'gemini' || pending.type === 'gemini_content') {
  const itemWithThinking = {
    ...pending,
    text: sanitized,
    // Include thinking blocks if setting allows
    ...(includeThinking && thinkingBlocksRef.current.length > 0
      ? { thinkingBlocks: [...thinkingBlocksRef.current] }
      : {}),
  };
  addItem(itemWithThinking, timestamp);
  // Clear for next turn
  thinkingBlocksRef.current = [];
}
```

**Reset ThinkingBlocks on new turn**:

```typescript
// In submitQuery, before starting new turn
thinkingBlocksRef.current = [];
```

---

## Required Code Markers

All changes MUST include:

```typescript
/**
 * @plan:PLAN-20251202-THINKING-UI.P08
 * @requirement:REQ-THINK-UI-001
 * @requirement:REQ-THINK-UI-003
 */
```

Note: Use colon syntax `@plan:PLAN-ID`.

---

## Verification Commands

### All Tests Pass

```bash
npm test -- packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx --run
# Expected: All tests pass
```

### Plan Markers

```bash
grep "@plan:PLAN-20251202-THINKING-UI.P08" packages/cli/src/ui/hooks/useGeminiStream.ts && echo "PASS" || echo "FAIL"
```

### TypeScript Compilation

```bash
npm run typecheck
```

### Build Succeeds

```bash
npm run build
```

### Existing Tests Still Pass

```bash
npm test -- packages/cli/src/ui/hooks/useGeminiStream.test.tsx --run
# Expected: All existing tests pass
```

---

## Success Criteria

- All P07 tests pass
- All existing useGeminiStream tests pass
- TypeScript compiles
- Build succeeds
- ThinkingBlocks accumulated from Thought events
- ThinkingBlocks included in HistoryItemGemini
- Settings control inclusion
- No breaking changes

---

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/cli/src/ui/hooks/useGeminiStream.ts`
2. Review test expectations
3. Re-implement stream integration
4. Cannot complete plan until integration works

---

## Phase Completion Marker

Create: `project-plans/20251202thinking-2/.completed/P08.md`

Contents:
```markdown
Phase: P08
Completed: [DATE TIME]
Files Modified:
  - packages/cli/src/ui/hooks/useGeminiStream.ts
Test Status: All passing
Integration Status: ThinkingBlocks accumulated and included in HistoryItem
```
