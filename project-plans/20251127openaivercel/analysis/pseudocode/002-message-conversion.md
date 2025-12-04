# Pseudocode: Message Conversion

## Purpose

Convert IContent array (internal format) to CoreMessage array (Vercel AI SDK format).

## Referenced By

- P05: Message Conversion Tests
- P06: Message Conversion Implementation
- P10: Non-Streaming Implementation
- P12: Streaming Implementation

---

## Interface Contracts (TypeScript)

```typescript
// INPUTS
interface ConvertToVercelMessagesInput {
  contents: IContent[];  // Array of internal message format
}

interface IContent {
  speaker: 'human' | 'ai' | 'tool' | 'system';
  blocks: Block[];
  metadata?: Record<string, unknown>;
}

type Block = 
  | { type: 'text'; text: string }
  | { type: 'image'; data: string }
  | { type: 'tool_call'; id: string; name: string; parameters: object }
  | { type: 'tool_response'; callId: string; result: string; status?: 'error'; error?: string };

// OUTPUTS
interface ConvertToVercelMessagesOutput {
  messages: CoreMessage[];  // Vercel AI SDK format
}

type CoreMessage = 
  | { role: 'user'; content: string | UserContentPart[] }
  | { role: 'assistant'; content: string | AssistantContentPart[] }
  | { role: 'tool'; content: ToolResultPart[] }
  | { role: 'system'; content: string };

// DEPENDENCIES
import { normalizeToOpenAIToolId } from './utils';  // 001-tool-id-normalization.md
```

## Integration Points (Line-by-Line)

| Line(s) | Integration Point | Connected Component |
|---------|-------------------|---------------------|
| 001-012 | convertToVercelMessages | Entry point called by OpenAIVercelProvider.generateChatCompletion |
| 020-041 | convertSingleMessage | Internal dispatcher |
| 060-080 | convertUserMessage | Handles human speaker, supports images |
| 090-118 | convertAssistantMessage | Handles AI speaker, normalizes tool call IDs (line 103) |
| 103 | normalizeToOpenAIToolId | CRITICAL: Converts hist_tool_ to call_ |
| 130-155 | convertToolResponseMessage | Handles tool results, normalizes IDs (line 137) |
| 137 | normalizeToOpenAIToolId | CRITICAL: Converts hist_tool_ to call_ |
| 160-163 | convertSystemMessage | Extracts text from system messages |
| 170-180 | extractTextContent | Utility to join text blocks |

## Anti-Pattern Warnings

```
[WARNING] ANTI-PATTERN: Ignoring tool ID normalization (lines 103, 137)
   CRITICAL: API will fail if IDs aren't normalized. Tool response matching depends on ID format.
   
[WARNING] ANTI-PATTERN: Returning null for tool_response result
   Instead: Always return empty string if result is null/undefined (line 142)
   
[WARNING] ANTI-PATTERN: Assuming single text block per message
   Instead: Join multiple text blocks with newlines (line 179)
   
[WARNING] ANTI-PATTERN: Converting images without checking format
   Instead: Verify image is base64 data URL before passing to API

[WARNING] ANTI-PATTERN: Hardcoding Vercel content types
   Instead: Use 'tool-call' and 'tool-result' (with hyphen, not underscore)
```

---

## Function: convertToVercelMessages

Main entry point for message conversion.

```
001: FUNCTION convertToVercelMessages(contents: IContent[]) -> CoreMessage[]
002:   result = EMPTY_ARRAY of CoreMessage
003:   
004:   FOR EACH content IN contents
005:     converted = convertSingleMessage(content)
006:     IF converted IS NOT null THEN
007:       APPEND converted TO result
008:     END IF
009:   END FOR
010:   
011:   RETURN result
012: END FUNCTION
```

---

## Function: convertSingleMessage

Dispatches to appropriate converter based on content type.

```
020: FUNCTION convertSingleMessage(content: IContent) -> CoreMessage | null
021:   speaker = content.speaker
022:   blocks = content.blocks
023:   
024:   // Check if this is a tool response message (special case)
025:   // Tool responses come as speaker='tool' with tool_response blocks
026:   IF hasToolResponseBlocks(blocks) THEN
027:     RETURN convertToolResponseMessage(blocks)
028:   END IF
029:   
030:   // Route based on speaker
031:   SWITCH speaker
032:     CASE 'human':
033:       RETURN convertUserMessage(blocks)
034:     CASE 'ai':
035:       RETURN convertAssistantMessage(blocks)
036:     CASE 'system':
037:       RETURN convertSystemMessage(blocks)
038:     DEFAULT:
039:       RETURN null  // Unknown speaker type
040:   END SWITCH
041: END FUNCTION
```

---

## Function: hasToolResponseBlocks

Checks if blocks contain tool response.

```
050: FUNCTION hasToolResponseBlocks(blocks: Block[]) -> boolean
051:   FOR EACH block IN blocks
052:     IF block.type == 'tool_response' THEN
053:       RETURN true
054:     END IF
055:   END FOR
056:   RETURN false
057: END FUNCTION
```

---

## Function: convertUserMessage

Converts human speaker messages to user role.

```
060: FUNCTION convertUserMessage(blocks: Block[]) -> CoreMessage
061:   // Check if message contains images
062:   hasImages = ANY block IN blocks WHERE block.type == 'image'
063:   
064:   IF hasImages THEN
065:     // Build multi-part content array
066:     parts = EMPTY_ARRAY
067:     FOR EACH block IN blocks
068:       IF block.type == 'text' THEN
069:         APPEND { type: 'text', text: block.text } TO parts
070:       ELSE IF block.type == 'image' THEN
071:         APPEND { type: 'image', image: block.data } TO parts
072:       END IF
073:     END FOR
074:     RETURN { role: 'user', content: parts }
075:   ELSE
076:     // Text-only message - extract and join text
077:     text = extractTextContent(blocks)
078:     RETURN { role: 'user', content: text }
079:   END IF
080: END FUNCTION
```

---

## Function: convertAssistantMessage

Converts AI speaker messages to assistant role.

```
090: FUNCTION convertAssistantMessage(blocks: Block[]) -> CoreMessage
091:   // Check if message contains tool calls
092:   hasToolCalls = ANY block IN blocks WHERE block.type == 'tool_call'
093:   
094:   IF hasToolCalls THEN
095:     // Build multi-part content array with text and tool calls
096:     parts = EMPTY_ARRAY
097:     FOR EACH block IN blocks
098:       IF block.type == 'text' THEN
099:         APPEND { type: 'text', text: block.text } TO parts
100:       ELSE IF block.type == 'tool_call' THEN
101:         // CRITICAL: Normalize tool ID to OpenAI format
102:         // Uses pseudocode from 001-tool-id-normalization.md lines 001-020
103:         normalizedId = normalizeToOpenAIToolId(block.id)
104:         APPEND {
105:           type: 'tool-call',
106:           toolCallId: normalizedId,
107:           toolName: block.name,
108:           args: block.parameters
109:         } TO parts
110:       END IF
111:     END FOR
112:     RETURN { role: 'assistant', content: parts }
113:   ELSE
114:     // Text-only message
115:     text = extractTextContent(blocks)
116:     RETURN { role: 'assistant', content: text }
117:   END IF
118: END FUNCTION
```

---

## Function: convertToolResponseMessage

Converts tool speaker messages to tool role.

```
130: FUNCTION convertToolResponseMessage(blocks: Block[]) -> CoreMessage
131:   toolResults = EMPTY_ARRAY
132:   
133:   FOR EACH block IN blocks
134:     IF block.type == 'tool_response' THEN
135:       // CRITICAL: Normalize tool call ID to OpenAI format
136:       // Uses pseudocode from 001-tool-id-normalization.md lines 001-020
137:       normalizedId = normalizeToOpenAIToolId(block.callId)
138:       
139:       toolResult = {
140:         type: 'tool-result',
141:         toolCallId: normalizedId,
142:         result: block.result OR ''
143:       }
144:       
145:       // Include error flag if present
146:       IF block.status == 'error' OR block.error IS NOT null THEN
147:         toolResult.isError = true
148:       END IF
149:       
150:       APPEND toolResult TO toolResults
151:     END IF
152:   END FOR
153:   
154:   RETURN { role: 'tool', content: toolResults }
155: END FUNCTION
```

---

## Function: convertSystemMessage

Converts system messages.

```
160: FUNCTION convertSystemMessage(blocks: Block[]) -> CoreMessage
161:   text = extractTextContent(blocks)
162:   RETURN { role: 'system', content: text }
163: END FUNCTION
```

---

## Function: extractTextContent

Extracts and joins text from blocks.

```
170: FUNCTION extractTextContent(blocks: Block[]) -> string
171:   textParts = EMPTY_ARRAY
172:   
173:   FOR EACH block IN blocks
174:     IF block.type == 'text' THEN
175:       APPEND block.text TO textParts
176:     END IF
177:   END FOR
178:   
179:   RETURN JOIN textParts WITH '\n'
180: END FUNCTION
```

---

## Type Mappings

```
190: // IContent.speaker -> CoreMessage.role
191: 'human' -> 'user'
192: 'ai' -> 'assistant'
193: 'tool' -> 'tool'
194: 'system' -> 'system'
195:
196: // Block types to Vercel content types
197: 'text' -> { type: 'text', text: string }
198: 'image' -> { type: 'image', image: string }
199: 'tool_call' -> { type: 'tool-call', toolCallId, toolName, args }
200: 'tool_response' -> { type: 'tool-result', toolCallId, result, isError? }
```

---

## Critical Integration Points

```
210: // Line 103, 137: Tool ID normalization is CRITICAL
211: // - Tool IDs from history use hist_tool_ prefix
212: // - Vercel SDK expects call_ prefix
213: // - Failure to normalize breaks tool response matching
214:
215: // Line 142: Result may be empty string, not null
216: // - Vercel SDK expects string, not null/undefined
217:
218: // Line 146-148: Error handling
219: // - isError flag tells SDK this is an error result
220: // - Important for model to understand tool failure
```
