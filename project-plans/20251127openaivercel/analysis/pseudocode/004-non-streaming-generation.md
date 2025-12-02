# Pseudocode: Non-Streaming Generation

## Purpose

Generate chat completions using Vercel AI SDK non-streaming mode (generateText).

## Referenced By

- P09: Non-Streaming Tests
- P10: Non-Streaming Implementation

---

## Interface Contracts (TypeScript)

```typescript
// INPUTS
interface GenerateNonStreamingInput {
  model: LanguageModel;     // Vercel AI SDK model instance
  messages: CoreMessage[];   // Converted messages from 002-message-conversion.md
  options: GenerationOptions;
}

interface GenerationOptions {
  temperature?: number;      // 0.0 to 2.0
  maxTokens?: number;        // Max tokens to generate
  tools?: ITool[];           // Tool definitions
  streaming?: boolean;       // Always false for this function
}

// OUTPUTS
interface GenerateNonStreamingOutput {
  stream: AsyncIterable<IContent>;  // Yields complete response as IContent chunks
}

interface IContent {
  speaker: 'ai';
  blocks: Block[];
  metadata?: { usage?: { inputTokens: number; outputTokens: number } };
}

// DEPENDENCIES
import { generateText } from 'ai';                  // Vercel AI SDK
import { normalizeToHistoryToolId } from './utils'; // 001-tool-id-normalization.md
import { wrapError } from './errors';               // 005-error-handling.md
```

## Integration Points (Line-by-Line)

| Line(s) | Integration Point | Connected Component |
|---------|-------------------|---------------------|
| 001-048 | generateNonStreaming | Main function, async generator |
| 023 | convertTools | Transforms ITool[] to Vercel format |
| 029 | generateText | Vercel AI SDK function from 'ai' package |
| 030-033 | wrapError | Error handling from 005-error-handling.md |
| 036-038 | createTextContent | Yields text IContent if present |
| 041-043 | createToolCallsContent | Yields tool calls if present |
| 046 | createUsageContent | Yields usage metadata |
| 087 | normalizeToHistoryToolId | CRITICAL: Converts call_ back to hist_tool_ |
| 140-153 | convertTools | Shared with 003-streaming-generation.md |

## Anti-Pattern Warnings

```
[WARNING] ANTI-PATTERN: Forgetting to normalize tool IDs back to history format (line 087)
   CRITICAL: Tool calls must use hist_tool_ prefix for history storage
   
[WARNING] ANTI-PATTERN: Not checking for empty text before yielding (lines 036-038)
   Instead: Only yield text content if result.text is non-empty
   
[WARNING] ANTI-PATTERN: Using @ai-sdk/openai for generateText
   Instead: Import generateText from 'ai' package (not provider-specific)

[WARNING] ANTI-PATTERN: Returning null for usage instead of default values
   Instead: Always yield usage content with zeros if not available (lines 112-120)

[WARNING] ANTI-PATTERN: Not wrapping errors from generateText
   Instead: Always wrap with wrapError for consistent error types (line 032)
```

---

## Function: generateNonStreaming

Main non-streaming generation function.

```
001: FUNCTION generateNonStreaming(
002:   model: LanguageModel,
003:   messages: CoreMessage[],
004:   options: GenerationOptions
005: ) -> AsyncIterable<IContent>
006:   
007:   // Build request options
008:   requestOptions = {
009:     model: model,
010:     messages: messages
011:   }
012:   
013:   // Add optional parameters if provided
014:   IF options.temperature IS DEFINED THEN
015:     requestOptions.temperature = options.temperature
016:   END IF
017:   
018:   IF options.maxTokens IS DEFINED THEN
019:     requestOptions.maxTokens = options.maxTokens
020:   END IF
021:   
022:   IF options.tools IS DEFINED AND NOT EMPTY THEN
023:     requestOptions.tools = convertTools(options.tools)
024:   END IF
025:   
026:   // Make non-streaming API call
027:   // generateText returns complete response
028:   TRY
029:     result = AWAIT generateText(requestOptions)
030:   CATCH error
031:     // Error handling per 005-error-handling.md
032:     THROW wrapError(error)
033:   END TRY
034:   
035:   // Yield text content if present
036:   IF result.text IS NOT null AND result.text IS NOT '' THEN
037:     YIELD createTextContent(result.text)
038:   END IF
039:   
040:   // Yield tool calls if present
041:   IF result.toolCalls IS NOT null AND result.toolCalls IS NOT EMPTY THEN
042:     YIELD createToolCallsContent(result.toolCalls)
043:   END IF
044:   
045:   // Yield usage metadata
046:   YIELD createUsageContent(result.usage)
047:   
048: END FUNCTION
```

---

## Function: createTextContent

Creates IContent for text response.

```
060: FUNCTION createTextContent(text: string) -> IContent
061:   
062:   RETURN {
063:     speaker: 'ai',
064:     blocks: [{
065:       type: 'text',
066:       text: text
067:     }]
068:   }
069:   
070: END FUNCTION
```

---

## Function: createToolCallsContent

Creates IContent for tool calls.

```
080: FUNCTION createToolCallsContent(toolCalls: ToolCall[]) -> IContent
081:   
082:   blocks = EMPTY_ARRAY
083:   
084:   FOR EACH toolCall IN toolCalls
085:     // CRITICAL: Normalize ID back to history format
086:     // Uses pseudocode from 001-tool-id-normalization.md lines 030-050
087:     historyId = normalizeToHistoryToolId(toolCall.toolCallId)
088:     
089:     block = {
090:       type: 'tool_call',
091:       id: historyId,
092:       name: toolCall.toolName,
093:       parameters: toolCall.args
094:     }
095:     
096:     APPEND block TO blocks
097:   END FOR
098:   
099:   RETURN {
100:     speaker: 'ai',
101:     blocks: blocks
102:   }
103:   
104: END FUNCTION
```

---

## Function: createUsageContent

Creates usage metadata IContent.

```
110: FUNCTION createUsageContent(usage: Usage) -> IContent
111:   
112:   IF usage IS null THEN
113:     // Return minimal usage if not available
114:     RETURN {
115:       speaker: 'ai',
116:       blocks: [],
117:       metadata: {
118:         usage: { inputTokens: 0, outputTokens: 0 }
119:       }
120:     }
121:   END IF
122:   
123:   RETURN {
124:     speaker: 'ai',
125:     blocks: [],
126:     metadata: {
127:       usage: {
128:         inputTokens: usage.promptTokens,
129:         outputTokens: usage.completionTokens
130:       }
131:     }
132:   }
133:   
134: END FUNCTION
```

---

## Function: convertTools

Converts tool definitions to Vercel SDK format.

```
140: FUNCTION convertTools(tools: ITool[]) -> Record<string, ToolDefinition>
141:   
142:   result = EMPTY_OBJECT
143:   
144:   FOR EACH tool IN tools
145:     result[tool.name] = {
146:       description: tool.description OR '',
147:       parameters: tool.parameters OR {}
148:     }
149:   END FOR
150:   
151:   RETURN result
152:   
153: END FUNCTION
```

---

## Response Structure

```
160: // Vercel AI SDK generateText returns:
161: // {
162: //   text: string,           // Generated text content
163: //   toolCalls: ToolCall[],  // Array of tool calls (may be empty)
164: //   usage: {
165: //     promptTokens: number,
166: //     completionTokens: number
167: //   },
168: //   finishReason: 'stop' | 'length' | 'tool-calls' | 'error'
169: // }
170:
171: // ToolCall structure:
172: // {
173: //   toolCallId: string,   // e.g., 'call_abc123'
174: //   toolName: string,     // e.g., 'read_file'
175: //   args: object          // Parsed arguments
176: // }
```

---

## Critical Implementation Notes

```
180: // Line 029: generateText is from 'ai' package, not @ai-sdk/openai
181: 
182: // Line 030-032: Errors should be wrapped using wrapError
183: //               See 005-error-handling.md for error types
184:
185: // Line 087: CRITICAL - Tool IDs from API use call_ prefix
186: //           Must normalize to hist_tool_ for history storage
187: //           Uses normalizeToHistoryToolId from utils.ts
188:
189: // Line 036-038: Check for non-empty text before yielding
190: //               API may return empty text with tool calls
191:
192: // Line 046: Usage is always yielded, even if null/undefined
193: //           Consumers expect usage metadata in response
```

---

## Difference from Streaming

```
200: // Non-streaming vs Streaming comparison:
201: //
202: // Non-streaming (this file):
203: // - Single await for complete response
204: // - All text available at once
205: // - Tool calls available immediately
206: // - Simple error handling (try/catch)
207: //
208: // Streaming (003-streaming-generation.md):
209: // - Async iteration over text chunks
210: // - Progressive text delivery
211: // - Tool calls available after stream ends
212: // - Error may occur mid-stream
```

---

## When Non-Streaming is Used

```
220: // Non-streaming mode is used when:
221: // options.streaming === false
222: //
223: // Use cases:
224: // - Batch processing
225: // - When complete response needed before processing
226: // - Testing (simpler assertions)
227: //
228: // Default is streaming (options.streaming !== false)
```
