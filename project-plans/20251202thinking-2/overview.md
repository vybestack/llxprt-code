# Plan: ThinkingBlock UI Rendering

Plan ID: PLAN-20251202-THINKING-UI
Generated: 2025-12-02
Total Phases: 10 (00a, 03, 03a, 04, 04a, 05, 05a, 06, 06a, 07, 07a, 08, 08a)
Requirements: REQ-THINK-UI-001, REQ-THINK-UI-002, REQ-THINK-UI-003
Extends: PLAN-20251202-THINKING (Phase 1 reasoning support)

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 00a)
2. PLAN-20251202-THINKING completed (ThinkingBlock interface, reasoning settings exist)
3. Verified all dependencies and types exist as assumed

---

## Problem Statement

ThinkingBlocks from reasoning/thinking models (Kimi K2, MiniMax m2, DeepSeek, Anthropic Claude) are correctly parsed and stored in history, but they are NOT displayed in the CLI UI. Users cannot see the model's reasoning process.

### Current State

- `ThinkingBlock` interface exists in `IContent.ts`
- Reasoning settings exist (`reasoning.includeInResponse` controls display)
- OpenAI provider parses `reasoning_content` into `ThinkingBlock`
- UI has `thought` state (ThoughtSummary) for streaming loading indicator
- **CRITICAL**: GeminiMessage/GeminiMessageContent only receive `text: string` prop
- **CRITICAL**: HistoryItemGemini type only has `text: string` and `model?: string`
- NO mechanism to display stored ThinkingBlocks inline with responses

### User Impact

- Users cannot observe model reasoning
- Cannot verify model is actually thinking
- Cannot debug unexpected responses

---

## Requirements

### REQ-THINK-UI-001: ThinkingBlock Type Recognition

**Full Text**: The UI MUST recognize `thinking` type in ContentBlock union and route it to appropriate display component.

**Behavior**:
- GIVEN: Response content contains ThinkingBlock
- WHEN: UI renders response
- THEN: ThinkingBlock is displayed inline with other content

### REQ-THINK-UI-002: ThinkingBlock Visual Style

**Full Text**: ThinkingBlocks MUST be displayed with distinct visual styling to differentiate from regular response content.

**Behavior**:
- GIVEN: ThinkingBlock is being rendered
- WHEN: Component displays
- THEN: Text is italic with shaded background (theme-aware)

**Visual Spec**:
- Italic text
- Slightly shaded background (darker shade in light mode, lighter shade in dark mode)
- Inline with other response content (not collapsible panels)
- No special prefix/label needed

### REQ-THINK-UI-003: Toggle via Ephemeral Setting

**Full Text**: ThinkingBlock display MUST be controlled by `reasoning.includeInResponse` ephemeral setting.

**Behavior**:
- GIVEN: User runs `/set reasoning.includeInResponse false`
- WHEN: Response with ThinkingBlock is rendered
- THEN: ThinkingBlock is NOT displayed, only regular content shown

**Behavior (enabled)**:
- GIVEN: User runs `/set reasoning.includeInResponse true` (default)
- WHEN: Response with ThinkingBlock is rendered
- THEN: ThinkingBlock IS displayed with appropriate styling

---

## Architecture

### Current Data Flow (CRITICAL UNDERSTANDING)

```
OpenAI API Response
    |
    v
OpenAIProvider.parseReasoningContent()
    |
    v
ThinkingBlock { type: 'thinking', thought: '...', sourceField: 'reasoning_content' }
    |
    v
Stored in IContent.blocks (via HistoryService in core package)
    |
    X <-- DISCONNECTION: CLI UI HistoryItem types do NOT include blocks
    |
    v
useGeminiStream receives ServerGeminiEventType.Thought -> setThought(ThoughtSummary)
    |                         (ephemeral, for loading indicator only)
    |
    +-- ServerGeminiEventType.Content -> accumulates to text string buffer
    |
    v
handleContentEvent() creates HistoryItemGemini { type: 'gemini', text: string }
    |
    v
HistoryItemDisplay.tsx dispatches to GeminiMessage
    |
    v
GeminiMessage receives { text: string } -- NO ThinkingBlock access
```

### Problem Analysis

1. **HistoryItemGemini** (packages/cli/src/ui/types.ts lines 73-78) only has:
   ```typescript
   type HistoryItemGemini = { type: 'gemini', text: string, model?: string }
   ```

2. **GeminiMessage** receives `text: string` prop, not ContentBlocks

3. **ThinkingBlocks exist in IContent.blocks** (core package) but the CLI UI
   history system uses its own simplified HistoryItem types that are TEXT-ONLY

### Integration Approach (CORRECTED)

There are two viable approaches:

#### Approach A: Extend HistoryItem Types (Recommended)

1. Add `thinkingBlocks?: ThinkingBlock[]` to HistoryItemGemini type
2. Modify useGeminiStream to collect ThinkingBlocks from stream events
3. Pass thinkingBlocks to GeminiMessage for rendering
4. Render ThinkingBlockDisplay before/after text content

**Pros**: Clean separation, no changes to streaming architecture
**Cons**: Requires HistoryItem type changes

#### Approach B: New HistoryItem Type for Thinking

1. Create `HistoryItemThinking` type
2. Emit separate history items for ThinkingBlocks
3. Render in sequence with content

**Pros**: Minimal changes to existing types
**Cons**: Thinking blocks would be separate items, not inline

### Chosen Approach: Approach A (Extend HistoryItem Types)

### Corrected Data Flow

```
ServerGeminiEventType.Thought (streaming event)
    |
    v
[NEW] Accumulate thinking content in useGeminiStream
    |
    v
[NEW] When flushing pending item, include thinkingBlocks array
    |
    v
HistoryItemGemini { type: 'gemini', text: string, thinkingBlocks?: ThinkingBlock[] }
    |
    v
HistoryItemDisplay passes thinkingBlocks to GeminiMessage
    |
    v
GeminiMessage renders ThinkingBlockDisplay for each block (if visible)
    |
    v
ThinkingBlockDisplay shows italic/shaded thinking content
```

### Integration Points (UPDATED)

1. **packages/cli/src/ui/types.ts** - Add `thinkingBlocks?: ThinkingBlock[]` to HistoryItemGemini
2. **packages/cli/src/ui/hooks/useGeminiStream.ts** - Accumulate thinking content, include in HistoryItem
3. **packages/cli/src/ui/components/HistoryItemDisplay.tsx** - Pass thinkingBlocks to GeminiMessage
4. **packages/cli/src/ui/components/messages/GeminiMessage.tsx** - Render ThinkingBlockDisplay
5. **Settings Access**: Use `useRuntimeApi()` hook, NOT `config?.getEphemeralSetting?.(...)`

### Config Access Pattern (CORRECTED)

GeminiMessage does NOT receive config prop. To access ephemeral settings:

```typescript
import { useRuntimeApi } from '../../contexts/RuntimeContext.js';

// Inside component
const { getEphemeralSetting } = useRuntimeApi();
const showThinking = getEphemeralSetting('reasoning.includeInResponse') ?? true;
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/cli/src/ui/types.ts` | Add thinkingBlocks to HistoryItemGemini |
| `packages/cli/src/ui/hooks/useGeminiStream.ts` | Accumulate ThinkingBlocks from stream |
| `packages/cli/src/ui/components/HistoryItemDisplay.tsx` | Pass thinkingBlocks to GeminiMessage |
| `packages/cli/src/ui/components/messages/GeminiMessage.tsx` | Render ThinkingBlockDisplay |
| `packages/cli/src/ui/components/messages/GeminiMessageContent.tsx` | Optionally render ThinkingBlocks |
| **NEW** `packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx` | ThinkingBlock display component |

---

## Phase Structure (UPDATED)

```
Phase 00a: Preflight Verification
Phase 03:  ThinkingBlockDisplay stub
Phase 03a: Verify stub
Phase 04:  ThinkingBlockDisplay TDD
Phase 04a: Verify TDD
Phase 05:  ThinkingBlockDisplay implementation
Phase 05a: Verify implementation
Phase 06:  HistoryItem type extension (stub)
Phase 06a: Verify type extension
Phase 07:  Stream integration TDD
Phase 07a: Verify TDD
Phase 08:  Stream integration implementation
Phase 08a: Verify integration
```

---

## Success Criteria

1. ThinkingBlocks displayed inline when `reasoning.includeInResponse = true`
2. ThinkingBlocks NOT displayed when `reasoning.includeInResponse = false`
3. ThinkingBlocks have italic text with shaded background
4. Styling is theme-aware (adapts to dark/light mode)
5. Tests verify behavior, not just structure
6. No breaking changes to existing message rendering

---

## Out of Scope

- Collapsible panels (explicitly rejected per overview.md)
- ThinkingBlock streaming animation (use existing spinner)
- Token counting in thinking blocks (separate plan)
- Other providers' thinking support (separate plan)
