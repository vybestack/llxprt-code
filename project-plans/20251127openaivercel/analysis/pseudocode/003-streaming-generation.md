# Pseudocode: Streaming Generation

## Purpose

Generate chat completions using Vercel AI SDK streaming mode, yielding IContent blocks as chunks arrive.

## Referenced By

- P11: Streaming Tests
- P12: Streaming Implementation

---

## Interface Contracts (TypeScript)

```typescript
// INPUTS
interface GenerateStreamingInput {
  model: LanguageModel;     // Vercel AI SDK model instance
  messages: CoreMessage[];   // Converted messages from 002-message-conversion.md
  options: GenerationOptions;
}

interface GenerationOptions {
  temperature?: number;      // 0.0 to 2.0
  maxTokens?: number;        // Max tokens to generate
  tools?: ITool[];           // Tool definitions
  streaming?: boolean;       // Always true for this function
}

// OUTPUTS
interface GenerateStreamingOutput {
  stream: AsyncIterable<IContent>;  // Yields IContent chunks progressively
}

interface IContent {
  speaker: 'ai';
  blocks: Block[];
  metadata?: { usage?: { inputTokens: number; outputTokens: number } };
}

// DEPENDENCIES
import { streamText } from 'ai';                    // Vercel AI SDK
import { normalizeToHistoryToolId } from './utils'; // 001-tool-id-normalization.md
import { wrapError } from './errors';               // 005-error-handling.md
```

## Integration Points (Line-by-Line)

| Line(s) | Integration Point | Connected Component |
|---------|-------------------|---------------------|
| 001-042 | generateStreaming | Main function, async generator |
| 023 | convertTools | Transforms ITool[] to Vercel format |
| 028 | streamText | Vercel AI SDK function from 'ai' package |
| 031 | streamTextChunks | Yields text IContent progressively |
| 035-036 | stream.toolCalls | Promise resolved after text stream exhausts |
| 039-040 | stream.usage | Promise for token usage metadata |
| 068 | wrapError | Error handling from 005-error-handling.md |
| 092 | normalizeToHistoryToolId | CRITICAL: Converts call_ back to hist_tool_ |
| 150-163 | convertTools | Shared with 004-non-streaming-generation.md |

## Anti-Pattern Warnings

```
[WARNING] ANTI-PATTERN: Accessing toolCalls before textStream is exhausted (line 035)
   CRITICAL: toolCalls Promise only resolves after stream iteration completes
   
[WARNING] ANTI-PATTERN: Forgetting to normalize tool IDs back to history format (line 092)
   CRITICAL: Tool calls must use hist_tool_ prefix for history storage
   
[WARNING] ANTI-PATTERN: Not handling empty text chunks (lines 054-063)
   Instead: Skip empty/null chunks to avoid noise in output
   
[WARNING] ANTI-PATTERN: Catching errors mid-stream and continuing
   Instead: Wrap error and re-throw to abort stream (line 068)

[WARNING] ANTI-PATTERN: Using @ai-sdk/openai for streamText
   Instead: Import streamText from 'ai' package (not provider-specific)
```

---

## Function: generateStreaming

Main streaming generation function.

```
001: FUNCTION generateStreaming(
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
026:   // Create stream using Vercel AI SDK
027:   // streamText returns object with async iterables
028:   stream = CALL streamText(requestOptions)
029:   
030:   // Phase 1: Stream text chunks as they arrive
031:   YIELD FROM streamTextChunks(stream.textStream)
032:   
033:   // Phase 2: After text stream completes, yield tool calls if any
034:   // Tool calls are only available after stream is exhausted
035:   toolCalls = AWAIT stream.toolCalls
036:   YIELD FROM convertToolCalls(toolCalls)
037:   
038:   // Phase 3: Yield usage metadata at end
039:   usage = AWAIT stream.usage
040:   YIELD createUsageContent(usage)
041:   
042: END FUNCTION
```

---

## Function: streamTextChunks

Yields IContent for each text chunk.

```
050: FUNCTION streamTextChunks(textStream: AsyncIterable<string>) -> AsyncIterable<IContent>
051:   
052:   TRY
053:     FOR AWAIT EACH chunk IN textStream
054:       // Skip empty chunks
055:       IF chunk IS NOT null AND chunk IS NOT '' THEN
056:         YIELD {
057:           speaker: 'ai',
058:           blocks: [{
059:             type: 'text',
060:             text: chunk
061:           }]
062:         }
063:       END IF
064:     END FOR
065:   CATCH error
066:     // Wrap and re-throw stream errors
067:     // Error handling per 005-error-handling.md
068:     THROW wrapError(error)
069:   END TRY
070:   
071: END FUNCTION
```

---

## Function: convertToolCalls

Converts tool calls from API response to IContent format.

```
080: FUNCTION convertToolCalls(toolCalls: ToolCall[]) -> AsyncIterable<IContent>
081:   
082:   IF toolCalls IS null OR toolCalls IS EMPTY THEN
083:     RETURN  // No tool calls to yield
084:   END IF
085:   
086:   // Build blocks for all tool calls
087:   blocks = EMPTY_ARRAY
088:   
089:   FOR EACH toolCall IN toolCalls
090:     // CRITICAL: Normalize ID back to history format
091:     // Uses pseudocode from 001-tool-id-normalization.md lines 030-050
092:     historyId = normalizeToHistoryToolId(toolCall.toolCallId)
093:     
094:     block = {
095:       type: 'tool_call',
096:       id: historyId,
097:       name: toolCall.toolName,
098:       parameters: toolCall.args
099:     }
100:     
101:     APPEND block TO blocks
102:   END FOR
103:   
104:   // Yield single IContent with all tool call blocks
105:   YIELD {
106:     speaker: 'ai',
107:     blocks: blocks
108:   }
109:   
110: END FUNCTION
```

---

## Function: createUsageContent

Creates usage metadata IContent.

```
120: FUNCTION createUsageContent(usage: Usage) -> IContent
121:   
122:   IF usage IS null THEN
123:     // Return minimal usage if not available
124:     RETURN {
125:       speaker: 'ai',
126:       blocks: [],
127:       metadata: {
128:         usage: { inputTokens: 0, outputTokens: 0 }
129:       }
130:     }
131:   END IF
132:   
133:   RETURN {
134:     speaker: 'ai',
135:     blocks: [],
136:     metadata: {
137:       usage: {
138:         inputTokens: usage.promptTokens,
139:         outputTokens: usage.completionTokens
140:       }
141:     }
142:   }
143:   
144: END FUNCTION
```

---

## Function: convertTools

Converts tool definitions to Vercel SDK format.

```
150: FUNCTION convertTools(tools: ITool[]) -> Record<string, ToolDefinition>
151:   
152:   result = EMPTY_OBJECT
153:   
154:   FOR EACH tool IN tools
155:     result[tool.name] = {
156:       description: tool.description OR '',
157:       parameters: tool.parameters OR {}
158:     }
159:   END FOR
160:   
161:   RETURN result
162:   
163: END FUNCTION
```

---

## Streaming Lifecycle

```
170: // The Vercel AI SDK stream has specific lifecycle:
171: //
172: // 1. textStream - AsyncIterable that yields text chunks
173: //    - Chunks arrive as API sends them
174: //    - May be empty if response is all tool calls
175: //
176: // 2. toolCalls - Promise that resolves after stream completes
177: //    - Contains array of tool calls
178: //    - Empty array if no tools were called
179: //
180: // 3. usage - Promise that resolves after stream completes
181: //    - Contains token counts
182: //    - May be null if provider doesn't report usage
183: //
184: // 4. finishReason - Promise for completion reason
185: //    - 'stop' | 'length' | 'tool-calls' | 'error'
```

---

## Critical Implementation Notes

```
190: // Line 028: streamText is from 'ai' package, not @ai-sdk/openai
191: 
192: // Line 031: textStream must be fully consumed before accessing toolCalls
193: //           Do not try to access toolCalls while iterating textStream
194:
195: // Line 035-036: toolCalls is a Promise, must await before iterating
196:
197: // Line 092: CRITICAL - Tool IDs from API use call_ prefix
198: //           Must normalize to hist_tool_ for history storage
199: //           Uses normalizeToHistoryToolId from utils.ts
200:
201: // Line 068: Errors during streaming should be wrapped
202: //           See 005-error-handling.md for error wrapping
203:
204: // Lines 056-062: Each text chunk becomes its own IContent
205: //                This allows progressive UI updates
```

---

## Default Mode

```
210: // Streaming is the DEFAULT mode for this provider
211: // Non-streaming only used when options.streaming === false
212: //
213: // Decision flow in generateChatCompletion:
214: // IF options.streaming === false THEN
215: //   USE generateNonStreaming (see 004-non-streaming-generation.md)
216: // ELSE
217: //   USE generateStreaming (this file)
218: // END IF
```
