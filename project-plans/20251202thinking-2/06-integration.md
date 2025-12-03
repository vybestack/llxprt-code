# Phase 06: HistoryItem Type Extension

## Phase ID

`PLAN-20251202-THINKING-UI.P06`

## Prerequisites

- Required: Phase 05a (Implementation Verification) completed
- Verification: ThinkingBlockDisplay tests pass
- ThinkingBlockDisplay component is fully implemented

---

## Purpose

This phase extends the HistoryItem types to support ThinkingBlocks. This is a STUB phase that
only adds the type definitions. The actual streaming integration happens in Phase 08.

---

## Requirements Implemented

### REQ-THINK-UI-001: ThinkingBlock Type Recognition (Type Extension)

**Full Text**: The UI MUST recognize `thinking` type in ContentBlock union and route it to appropriate display component.

**This Phase**:
- Add `thinkingBlocks?: ThinkingBlock[]` to HistoryItemGemini type
- Add `thinkingBlocks?: ThinkingBlock[]` to HistoryItemGeminiContent type
- Update GeminiMessage props interface to accept thinkingBlocks
- Update HistoryItemDisplay to pass thinkingBlocks

---

## Implementation Tasks

### 1. Update `packages/cli/src/ui/types.ts`

**Changes**:

```typescript
// Add import
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';

// Update HistoryItemGemini
export type HistoryItemGemini = HistoryItemBase & {
  type: 'gemini';
  text: string;
  model?: string;
  thinkingBlocks?: ThinkingBlock[];  // @plan:PLAN-20251202-THINKING-UI.P06
};

// Update HistoryItemGeminiContent
export type HistoryItemGeminiContent = HistoryItemBase & {
  type: 'gemini_content';
  text: string;
  model?: string;
  thinkingBlocks?: ThinkingBlock[];  // @plan:PLAN-20251202-THINKING-UI.P06
};
```

**Requirements**:
- MUST include: `@plan:PLAN-20251202-THINKING-UI.P06`
- MUST include: `@requirement:REQ-THINK-UI-001`

### 2. Update `packages/cli/src/ui/components/messages/GeminiMessage.tsx`

**Changes**:

```typescript
// Add imports
import { ThinkingBlockDisplay } from './ThinkingBlockDisplay.js';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import { useRuntimeApi } from '../../contexts/RuntimeContext.js';

// Update props interface
interface GeminiMessageProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
  model?: string;
  thinkingBlocks?: ThinkingBlock[];  // @plan:PLAN-20251202-THINKING-UI.P06
}

// Inside component - render thinking blocks
/**
 * @plan:PLAN-20251202-THINKING-UI.P06
 * @requirement:REQ-THINK-UI-001
 * @requirement:REQ-THINK-UI-003
 */
const { getEphemeralSetting } = useRuntimeApi();
const showThinking = (getEphemeralSetting('reasoning.includeInResponse') ?? true) as boolean;

// In render, before or after MarkdownDisplay:
{showThinking && thinkingBlocks?.map((block, index) => (
  <ThinkingBlockDisplay
    key={`thinking-${index}`}
    block={block}
    visible={true}
  />
))}
```

### 3. Update `packages/cli/src/ui/components/HistoryItemDisplay.tsx`

**Changes**:

```typescript
// Update the gemini case to pass thinkingBlocks
{itemForDisplay.type === 'gemini' && (
  <GeminiMessage
    text={itemForDisplay.text}
    isPending={isPending}
    availableTerminalHeight={...}
    terminalWidth={terminalWidth}
    model={itemForDisplay.model}
    thinkingBlocks={itemForDisplay.thinkingBlocks}  // @plan:PLAN-20251202-THINKING-UI.P06
  />
)}
```

---

## Required Code Markers

All changes MUST include:

```typescript
/**
 * @plan:PLAN-20251202-THINKING-UI.P06
 * @requirement:REQ-THINK-UI-001
 */
```

Note: Use colon syntax `@plan:PLAN-ID` not space syntax `@plan PLAN-ID`.

---

## Verification Commands

### TypeScript Compilation

```bash
npm run typecheck
```

### Plan Markers (Colon Syntax)

```bash
grep "@plan:PLAN-20251202-THINKING-UI.P06" packages/cli/src/ui/types.ts && echo "PASS" || echo "FAIL"
grep "@plan:PLAN-20251202-THINKING-UI.P06" packages/cli/src/ui/components/messages/GeminiMessage.tsx && echo "PASS" || echo "FAIL"
```

### ThinkingBlockDisplay Import

```bash
grep "import.*ThinkingBlockDisplay" packages/cli/src/ui/components/messages/GeminiMessage.tsx && echo "PASS" || echo "FAIL"
```

### Type Extension

```bash
grep "thinkingBlocks.*ThinkingBlock" packages/cli/src/ui/types.ts && echo "PASS" || echo "FAIL"
```

---

## Success Criteria

- TypeScript compiles without errors
- All existing tests pass
- ThinkingBlockDisplay imported and used in GeminiMessage
- thinkingBlocks prop added to HistoryItemGemini type
- thinkingBlocks passed through HistoryItemDisplay to GeminiMessage
- Settings access uses `useRuntimeApi()` hook

---

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/cli/src/ui/types.ts`
2. `git checkout -- packages/cli/src/ui/components/messages/GeminiMessage.tsx`
3. `git checkout -- packages/cli/src/ui/components/HistoryItemDisplay.tsx`
4. Review type definitions
5. Re-implement type extension

---

## Phase Completion Marker

Create: `project-plans/20251202thinking-2/.completed/P06.md`

Contents:
```markdown
Phase: P06
Completed: [DATE TIME]
Files Modified:
  - packages/cli/src/ui/types.ts
  - packages/cli/src/ui/components/messages/GeminiMessage.tsx
  - packages/cli/src/ui/components/HistoryItemDisplay.tsx
Tests Modified: 0
Test Status: All passing
Type Extension Status: thinkingBlocks added to HistoryItemGemini
```
