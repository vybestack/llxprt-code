# Orphaned Tool Call Analysis and Architectural Proposal

## Problem Summary

When a tool call is made but its execution is cancelled (e.g., user presses ESC), the tool call remains in history without a corresponding tool response. When this history is later sent to providers like OpenAI, they reject it with error 400: "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'."

## Root Cause Analysis

### Current Flow

1. **Tool Call Creation**: When AI makes a tool call, it gets a normalized ID (hist*tool*<uuid>) from HistoryService
2. **Tool Cancellation**: If user cancels (ESC), Turn.ts yields UserCancelled event but no synthetic response is created
3. **History State**: HistoryService.findUnmatchedToolCalls() correctly identifies orphaned calls
4. **Provider Conversion**: When sending to providers:
   - OpenAIProvider SHOULD transform hist*tool*\_ → call\_\_ but currently doesn't (BUG #1)
   - Even with proper ID transformation, OpenAI still requires matching responses (ISSUE #2)

### Key Findings

#### 1. ID Transformation Bug

- **Location**: OpenAIProvider.generateChatCompletionIContent (lines 961, 986)
- **Issue**: Passes hist*tool* IDs directly to OpenAI API without transformation
- **Should be**: hist*tool*<x> → call*<x> for OpenAI, toolu*<x> for Anthropic

#### 2. Missing Synthetic Responses

- **Capability exists**: SyntheticToolResponseHandler can create synthetic responses
- **Not integrated**: No component currently creates synthetic responses for cancelled tools
- **HistoryService knows**: Has findUnmatchedToolCalls() to identify orphans

#### 3. Cancellation Flow Gap

- **Turn.ts**: Yields UserCancelled events but doesn't create synthetic responses
- **GeminiChat**: Doesn't handle UserCancelled events or check for orphans
- **HistoryService**: Has validateAndFix() that could add synthetics but it's not called

## Architectural Proposal

### Solution Design

Handle orphans at the **HistoryService level** when getting curated history, not at the provider level.

### Implementation Approach

#### Option 1: Auto-patch in getCurated() (Recommended)

```typescript
// HistoryService.getCurated()
getCurated(): IContent[] {
  const curated = [...existing logic...];

  // Auto-patch orphaned tool calls with synthetic responses
  return this.patchOrphanedToolCalls(curated);
}

private patchOrphanedToolCalls(content: IContent[]): IContent[] {
  // Find orphaned tool calls
  const orphans = this.findUnmatchedToolCallsIn(content);

  if (orphans.length === 0) return content;

  // Create synthetic responses
  const syntheticResponses = orphans.map(orphan => ({
    speaker: 'tool' as const,
    blocks: [{
      type: 'tool_response' as const,
      callId: orphan.id,
      toolName: orphan.name,
      result: null,
      error: 'Tool execution cancelled by user'
    }]
  }));

  // Insert synthetic responses after their corresponding tool calls
  return this.insertSyntheticResponses(content, syntheticResponses);
}
```

#### Option 2: Handle in GeminiChat on UserCancelled

```typescript
// In GeminiChat or Turn
if (event.type === GeminiEventType.UserCancelled) {
  const orphans = this.historyService.findUnmatchedToolCalls();
  for (const orphan of orphans) {
    this.historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: orphan.id,
          toolName: orphan.name,
          result: null,
          error: 'Tool execution cancelled by user',
        },
      ],
    });
  }
}
```

#### Option 3: Use existing validateAndFix()

- Call HistoryService.validateAndFix() before sending to providers
- Already has logic to add synthetic responses
- Just needs to be invoked at the right time

### Recommended Solution

**Option 1** - Auto-patch in getCurated() because:

1. **Centralized**: Single place handles all orphan scenarios
2. **Transparent**: Providers always get valid history
3. **Non-breaking**: Doesn't change existing flows
4. **Already validated**: SyntheticToolResponseHandler.patchMessageHistory() exists but for IMessage

### Additional Fix Required

OpenAIProvider must transform IDs properly:

```typescript
// OpenAIProvider.generateChatCompletionIContent line 961
id: this.transformIdForProvider(tc.id), // Transform hist_tool_* to call_*

// Line 986
tool_call_id: this.transformIdForProvider(toolResponseBlock.callId),
```

## Testing Strategy

### Behavioral Test Requirements

1. Simulate tool call creation
2. Simulate cancellation (no response created)
3. Attempt to send next message
4. Verify no error occurs (synthetic response added)

### Edge Cases to Test

- Multiple orphaned tools
- Mixed orphaned and completed tools
- Orphans from different turns
- Provider switching with orphans

## Implementation Priority

1. **First**: Write failing behavioral test
2. **Second**: Implement auto-patching in getCurated()
3. **Third**: Fix ID transformation in providers
4. **Fourth**: Add comprehensive unit tests

## Risk Assessment

- **Low risk**: Solution is additive, doesn't break existing flows
- **High impact**: Fixes critical errors preventing conversation continuation
- **Testable**: Clear success criteria and test scenarios
