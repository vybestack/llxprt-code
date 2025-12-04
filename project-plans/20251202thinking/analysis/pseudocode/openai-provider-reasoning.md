# Pseudocode: OpenAIProvider Reasoning Handling

## Interface Contracts

```typescript
// INPUTS from streaming API
interface StreamingDelta {
  content?: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
}

// INPUTS from non-streaming API
interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
}

// OUTPUTS
interface IContent {
  speaker: 'ai';
  blocks: ContentBlock[];
}

// DEPENDENCIES (must be available)
// - settings service for ephemeral settings
// - reasoningUtils for filtering and conversion
```

## parseStreamingReasoningDelta

```
10: FUNCTION parseStreamingReasoningDelta(delta: StreamingDelta): IContent | null
11:   IF delta.reasoning_content EXISTS AND delta.reasoning_content.length > 0
12:     CREATE thinkingBlock = {
13:       type: 'thinking',
14:       thought: delta.reasoning_content,
15:       sourceField: 'reasoning_content',
16:       isHidden: false
17:     }
18:     RETURN {
19:       speaker: 'ai',
20:       blocks: [thinkingBlock]
21:     }
22:   END IF
23:   RETURN null
24: END FUNCTION
```

## Streaming Handler Integration

```
30: WITHIN generateChatStream async generator
31:   FOR EACH chunk IN stream
32:     GET delta = chunk.choices[0]?.delta
33:     IF delta IS undefined
34:       CONTINUE
35:     END IF
36:
37:     // NEW: Handle reasoning_content BEFORE content
38:     IF 'reasoning_content' IN delta AND delta.reasoning_content
39:       reasoningContent = parseStreamingReasoningDelta(delta)
40:       IF reasoningContent IS NOT null
41:         YIELD reasoningContent
42:       END IF
43:     END IF
44:
45:     // EXISTING: Handle regular content
46:     IF delta.content
47:       // ... existing content handling ...
48:     END IF
49:
50:     // EXISTING: Handle tool calls
51:     IF delta.tool_calls
52:       // ... existing tool_calls handling ...
53:     END IF
54:   END FOR
55: END WITHIN
```

## parseNonStreamingReasoning

```
60: FUNCTION parseNonStreamingReasoning(message: AssistantMessage): ThinkingBlock | null
61:   IF message.reasoning_content EXISTS AND message.reasoning_content.length > 0
62:     RETURN {
63:       type: 'thinking',
64:       thought: message.reasoning_content,
65:       sourceField: 'reasoning_content',
66:       isHidden: false
67:     }
68:   END IF
69:   RETURN null
70: END FUNCTION
```

## Non-Streaming Handler Integration

```
80: WITHIN generateChat (non-streaming)
81:   GET message = response.choices[0].message
82:
83:   INITIALIZE blocks = []
84:
85:   // NEW: Parse reasoning first
86:   thinkingBlock = parseNonStreamingReasoning(message)
87:   IF thinkingBlock IS NOT null
88:     PUSH thinkingBlock TO blocks
89:   END IF
90:
91:   // EXISTING: Parse content
92:   IF message.content
93:     PUSH { type: 'text', text: message.content } TO blocks
94:   END IF
95:
96:   // EXISTING: Parse tool calls
97:   IF message.tool_calls
98:     // ... existing tool_calls handling ...
99:   END IF
100:
101:  RETURN { speaker: 'ai', blocks }
102: END WITHIN
```

## buildMessagesWithReasoning

```
110: FUNCTION buildMessagesWithReasoning(contents: IContent[], settings: SettingsService): OpenAIMessage[]
111:   GET stripPolicy = settings.get('reasoning.stripFromContext') OR 'none'
112:   GET includeInContext = settings.get('reasoning.includeInContext') OR false
113:   GET format = settings.get('reasoning.format') OR 'field'
114:
115:   // Apply strip policy first
116:   filteredContents = filterThinkingForContext(contents, stripPolicy)
117:
118:   INITIALIZE messages = []
119:
120:   FOR EACH content IN filteredContents
121:     IF content.speaker === 'human'
122:       PUSH { role: 'user', content: getTextContent(content) } TO messages
123:     ELSE IF content.speaker === 'ai'
124:       thinkingBlocks = extractThinkingBlocks(content)
125:       textContent = getTextContent(content)
126:
127:       IF includeInContext AND thinkingBlocks.length > 0 AND format === 'field'
128:         reasoningContent = thinkingToReasoningField(thinkingBlocks)
129:         PUSH {
130:           role: 'assistant',
131:           content: textContent,
132:           reasoning_content: reasoningContent
133:         } TO messages
134:       ELSE
135:         PUSH { role: 'assistant', content: textContent } TO messages
136:       END IF
137:     ELSE IF content.speaker === 'tool'
138:       // ... existing tool response handling ...
139:     END IF
140:   END FOR
141:
142:   RETURN messages
143: END FUNCTION
```

## Integration Points

```
Line 39: CALL parseStreamingReasoningDelta(delta)
         - Must handle undefined delta gracefully
         - Must not throw on missing reasoning_content
         - Errors propagate to stream error handler

Line 116: CALL filterThinkingForContext(contents, stripPolicy)
         - filterThinkingForContext from reasoningUtils
         - Must return new array, not mutate input

Line 128: CALL thinkingToReasoningField(thinkingBlocks)
         - thinkingToReasoningField from reasoningUtils
         - Returns undefined if no blocks
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: throw Error when reasoning_content missing  // Breaks non-reasoning models
[OK] DO: Return null/skip when not present

[ERROR] DO NOT: Mutate the input contents array  // Side effects
[OK] DO: Create new messages array

[ERROR] DO NOT: Ignore settings when building messages  // Defeats purpose
[OK] DO: Always check settings before including reasoning_content

[ERROR] DO NOT: Hardcode includeInContext=true  // Breaks models that don't want it
[OK] DO: Read from ephemeral settings

[ERROR] DO NOT: Parse reasoning_content AFTER content  // Wrong order for streaming display
[OK] DO: Parse reasoning_content BEFORE content in stream
```
