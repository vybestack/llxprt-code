# Domain Model: Reasoning/Thinking Token Support

## Entity Relationships

```
┌─────────────────────┐
│   EphemeralSettings │
│   (reasoning.*)     │
└─────────┬───────────┘
          │ controls
          ▼
┌─────────────────────┐       ┌─────────────────────┐
│   OpenAIProvider    │◄──────│   reasoningUtils    │
│   (parse & build)   │       │   (utility funcs)   │
└─────────┬───────────┘       └─────────────────────┘
          │ yields/consumes
          ▼
┌─────────────────────┐
│    ThinkingBlock    │
│    (neutral format) │
└─────────┬───────────┘
          │ stored in
          ▼
┌─────────────────────┐
│   HistoryService    │
│   (context mgmt)    │
└─────────┬───────────┘
          │ provides to
          ▼
┌─────────────────────┐
│   Context Limit     │
│   Calculator        │
└─────────────────────┘
```

## State Transitions

### Reasoning Content Flow

1. **Ingress (API → ThinkingBlock)**
   ```
   API Response → OpenAIProvider.parse() → ThinkingBlock → HistoryService.add()
   ```

2. **Storage (Neutral Format)**
   ```
   ThinkingBlock stored with:
   - thought: string (the reasoning text)
   - sourceField: 'reasoning_content' (for round-trip)
   - isHidden: boolean (UI visibility)
   ```

3. **Egress (ThinkingBlock → API)**
   ```
   HistoryService.get() → filterThinkingForContext() → buildMessages() → API Request
   ```

## Business Rules

### BR-001: Default Behavior Is Conservative
- `reasoning.includeInContext = false` by default
- This prevents breaking models that don't expect reasoning in context
- Users must explicitly enable for models that need it (Kimi K2, etc.)

### BR-002: Storage Is Always Complete
- All ThinkingBlocks are stored regardless of settings
- Filtering happens at egress time based on current settings
- This allows changing settings without losing data

### BR-003: Display Is Independent of Context
- `reasoning.includeInResponse` controls UI display
- `reasoning.includeInContext` controls API context
- User can see reasoning without sending it back, or vice versa

### BR-004: Effective Token Count Governs Compression
- If reasoning is stripped from context, those tokens don't count
- Compression triggers based on what will actually be sent
- Display shows effective count to avoid user confusion

### BR-005: Strip Policy Applies Before Include
- `stripFromContext` filters first (all, allButLast, none)
- `includeInContext` then determines if remaining thinking is included
- This allows keeping only the most recent reasoning

### BR-006: `reasoning.enabled=false` Behavior
- When `enabled=false`, the provider SHOULD NOT request reasoning from the model
- This typically means NOT sending reasoning-related parameters in the request
- If the model spontaneously returns reasoning, it is still parsed and stored
- This allows users to receive unexpected reasoning without actively requesting it
- The setting does NOT affect UI display (use `includeInResponse` for that)

### BR-007: `reasoning.format='native'` Is Future Scope
- For this implementation plan, `format='native'` behaves identically to `format='field'`
- Both use the `reasoning_content` field for OpenAI-compatible APIs
- True native format support (Anthropic extended thinking, Gemini thoughts) is a separate plan
- Providers should accept `native` as valid but treat it as `field`

### BR-008: Settings Read at Request Time
- Settings are read fresh for each API request
- Changing settings mid-conversation takes effect immediately
- No need to restart or re-process history
- This applies to all reasoning.* settings

### BR-009: Strip Policy Applies to History, Not Current Response
- `stripFromContext` affects reasoning from PREVIOUS turns in history
- The current model response's reasoning is always captured in full
- Strip policy is applied at egress (message building) time
- Stored ThinkingBlocks are never modified by strip policy

## Edge Cases

### EC-001: Model Doesn't Return reasoning_content
- Parser must handle absence gracefully
- No ThinkingBlock emitted, no error thrown
- This is the normal case for non-reasoning models

### EC-002: reasoning_content Is Empty String
- Treat as no reasoning content
- Don't emit empty ThinkingBlock

### EC-003: Mixed Streaming (reasoning then content)
- Kimi K2 streams reasoning_content first, then content
- Parser must handle interleaved deltas
- Both should yield appropriate blocks

### EC-004: Settings Changed Mid-Conversation
- New settings apply from next request
- Already-stored ThinkingBlocks remain unchanged
- Egress uses current settings, not settings at storage time

### EC-005: Profile Load Changes Reasoning Settings
- Immediate effect on subsequent requests
- No re-processing of history needed
- UI should update visibility immediately

### EC-006: Tool Call with Reasoning Before Response
- Kimi K2 may return reasoning + tool call without text response
- ThinkingBlock should be emitted BEFORE ToolCallBlock
- Both should be stored in the same IContent
- On round-trip, reasoning_content must accompany the tool call message

### EC-007: Empty Reasoning String After Stripping
- If all reasoning is stripped, don't send empty `reasoning_content: ''`
- Omit the field entirely when empty
- This prevents confusing models that interpret empty string differently

## Error Scenarios

### ERR-001: Invalid reasoning.* Setting Value
- Reject with clear error message
- Don't change current setting
- Example: `/set reasoning.format xml` → error, 'field' or 'native' only

### ERR-002: Token Estimation Fails
- Fall back to character-based estimate
- Log warning, don't crash
- Use conservative estimate (higher)

### ERR-003: reasoning_content Too Large
- No artificial limit - let model's context limit handle it
- Token tracking will show the cost
- Compression will trigger if needed

## Data Flow Diagram

```
┌──────────────┐
│  API Stream  │
│  (Kimi K2)   │
└──────┬───────┘
       │ reasoning_content delta
       ▼
┌──────────────────────────────┐
│     OpenAIProvider           │
│  parseStreamingResponse()    │
│                              │
│  if (delta.reasoning_content)│
│    yield ThinkingBlock       │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│     HistoryService           │
│     add(content)             │
│                              │
│  stores ThinkingBlock        │
│  with sourceField metadata   │
└──────┬───────────────────────┘
       │
       ▼ (on next request)
┌──────────────────────────────┐
│     OpenAIProvider           │
│     buildMessages()          │
│                              │
│  1. get settings             │
│  2. filterThinkingForContext │
│  3. if includeInContext      │
│       add reasoning_content  │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────┐
│  API Request │
│  (with or    │
│  without     │
│  reasoning)  │
└──────────────┘
```

## Context Limit Flow

```
┌──────────────────────────────┐
│  Calculate Effective Count   │
│                              │
│  1. Get all history          │
│  2. Apply stripFromContext   │
│  3. If !includeInContext     │
│       subtract thinking      │
│  4. Return effective count   │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  Display Context Usage       │
│                              │
│  Shows: 123000/212000        │
│  (effective / limit)         │
└──────────────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  Compression Decision        │
│                              │
│  if (effective > threshold)  │
│    trigger compression       │
└──────────────────────────────┘
```
