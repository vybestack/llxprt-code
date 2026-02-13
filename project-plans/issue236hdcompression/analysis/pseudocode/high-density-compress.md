# Pseudocode: HighDensityStrategy.compress()

**Requirement Coverage**: REQ-HD-008.1 through REQ-HD-008.6, REQ-HD-004.3

---

## Interface Contracts

### INPUTS
```typescript
// compress() receives:
context: CompressionContext

interface CompressionContext {
  readonly history: readonly IContent[];          // curated history (via getCurated())
  readonly runtimeContext: AgentRuntimeContext;
  readonly runtimeState: AgentRuntimeState;
  readonly estimateTokens: (contents: readonly IContent[]) => Promise<number>;
  readonly currentTokenCount: number;
  readonly logger: DebugLogger;
  readonly resolveProvider: (profileName?: string) => IProvider;
  readonly promptResolver: PromptResolver;
  readonly promptBaseDir: string;
  readonly promptContext: Readonly<Partial<PromptContext>>;
  readonly promptId: string;
  // NEW optional fields (used by LLM strategies, ignored here):
  readonly activeTodos?: readonly Todo[];
  readonly transcriptPath?: string;
}
```

### OUTPUTS
```typescript
// compress() returns:
interface CompressionResult {
  newHistory: IContent[];
  metadata: CompressionResultMetadata;
}

interface CompressionResultMetadata {
  originalMessageCount: number;
  compressedMessageCount: number;
  strategyUsed: CompressionStrategyName;    // 'high-density'
  llmCallMade: boolean;                      // always false
  topPreserved?: number;
  bottomPreserved?: number;
  middleCompressed?: number;
}
```

### DEPENDENCIES
```typescript
// Internal types:
import type { CompressionContext, CompressionResult, CompressionResultMetadata } from './types.js';
import type { IContent, ToolResponseBlock, ToolCallBlock, TextBlock } from '../../services/history/IContent.js';

// No LLM provider needed — this strategy is deterministic (REQ-HD-008.1)
```

---

## Pseudocode: compress()

```
 10: METHOD compress(context: CompressionContext): PROMISE<CompressionResult>
 11:   LET history = context.history
 12:   LET originalCount = history.length
 13:
 14:   // === EDGE CASE: Empty or very small history ===
 15:   IF history.length === 0
 16:     RETURN {
 17:       newHistory: [],
 18:       metadata: this.buildMetadata(0, 0, false),
 19:     }
 20:
 21:   // === STEP 1: Determine the recent tail to preserve ===
 22:   LET preserveThreshold = context.runtimeContext.ephemerals.preserveThreshold()
 23:   LET tailSize = Math.ceil(history.length * preserveThreshold)
 24:   LET tailStartIndex = history.length - tailSize
 25:
 26:   // Ensure tail start doesn't split a tool call / tool response pair
 27:   tailStartIndex = adjustForToolCallBoundary(history, tailStartIndex)
 28:
 29:   // If tail covers everything, nothing to compress
 30:   IF tailStartIndex <= 0
 31:     RETURN {
 32:       newHistory: [...history],
 33:       metadata: this.buildMetadata(originalCount, originalCount, false),
 34:     }
 35:
 36:   // === STEP 2: Calculate target token count ===
 37:   LET threshold = context.runtimeContext.ephemerals.compressionThreshold()
 38:   LET contextLimit = context.runtimeContext.ephemerals.contextLimit()
 39:   LET targetTokens = Math.floor(threshold * contextLimit * 0.6)
 40:
 41:   context.logger.debug('HighDensity compress', {
 42:     originalCount,
 43:     tailStartIndex,
 44:     tailSize: history.length - tailStartIndex,
 45:     targetTokens,
 46:   })
 47:
 48:   // === STEP 3: Build the compressed history ===
 49:   LET newHistory: IContent[] = []
 50:
 51:   // 3a: Process entries BEFORE the tail — summarize tool responses
 52:   FOR index FROM 0 TO tailStartIndex - 1
 53:     LET entry = history[index]
 54:
 55:     IF entry.speaker === 'human'
 56:       // Preserve human messages intact (REQ-HD-008.4)
 57:       newHistory.push(entry)
 58:
 59:     ELSE IF entry.speaker === 'ai'
 60:       // Preserve AI messages intact — text blocks, tool_call blocks, thinking blocks
 61:       // (REQ-HD-008.4: all tool call blocks preserved)
 62:       newHistory.push(entry)
 63:
 64:     ELSE IF entry.speaker === 'tool'
 65:       // Summarize tool responses (REQ-HD-008.3)
 66:       LET summarizedBlocks = this.summarizeToolResponseBlocks(entry.blocks)
 67:       newHistory.push({
 68:         ...entry,
 69:         blocks: summarizedBlocks,
 70:       })
 71:
 72:   // 3b: Preserve the tail entries intact
 73:   FOR index FROM tailStartIndex TO history.length - 1
 74:     newHistory.push(history[index])
 75:
 76:   // === STEP 4: Check if we need more aggressive trimming ===
 77:   LET estimatedTokens = AWAIT context.estimateTokens(newHistory)
 78:
 79:   IF estimatedTokens > targetTokens
 80:     context.logger.debug('HighDensity: post-summarization still over target, applying aggressive trim', {
 81:       estimatedTokens,
 82:       targetTokens,
 83:     })
 84:     // Second pass: truncate older entries from the front
 85:     newHistory = this.truncateToTarget(newHistory, tailStartIndex, targetTokens, context)
 86:
 87:   // === STEP 5: Assemble result ===
 88:   RETURN {
 89:     newHistory,
 90:     metadata: this.buildMetadata(originalCount, newHistory.length, false),
 91:   }
```

---

## Pseudocode: summarizeToolResponseBlocks()

```
100: PRIVATE METHOD summarizeToolResponseBlocks(blocks: ContentBlock[]): ContentBlock[]
101:   RETURN blocks.map(block =>
102:     IF block.type !== 'tool_response'
103:       RETURN block   // preserve non-response blocks as-is
104:
105:     LET response = block AS ToolResponseBlock
106:     LET summary = this.buildToolSummaryText(response)
107:
108:     RETURN {
109:       ...response,
110:       result: summary,
111:     }
112:   )
```

---

## Pseudocode: buildToolSummaryText()

```
120: PRIVATE METHOD buildToolSummaryText(response: ToolResponseBlock): string
121:   LET toolName = response.toolName
122:   LET outcome = response.error ? 'error' : 'success'
123:
124:   // Extract key parameter for context
125:   LET keyParam = ''
126:
127:   // Try to extract a meaningful identifier from the result
128:   IF typeof response.result === 'string'
129:     LET lineCount = response.result.split('\n').length
130:     keyParam = lineCount + ' lines'
131:   ELSE IF typeof response.result === 'object' AND response.result !== null
132:     LET r = response.result AS Record<string, unknown>
133:     IF r.file_path OR r.absolute_path OR r.path
134:       keyParam = String(r.file_path ?? r.absolute_path ?? r.path)
135:     ELSE IF r.output
136:       LET outputStr = String(r.output)
137:       keyParam = outputStr.length + ' chars'
138:
139:   // Build compact summary
140:   IF keyParam
141:     RETURN '[' + toolName + ': ' + keyParam + ' — ' + outcome + ']'
142:   ELSE
143:     RETURN '[' + toolName + ' — ' + outcome + ']'
144:
145:   // Examples:
146:   // "[read_file: src/index.ts — success, 245 lines]"
147:   // "[run_shell_command: 128 chars — success]"
148:   // "[write_file: src/foo.ts — success]"
149:   // "[grep — error]"
```

---

## Pseudocode: truncateToTarget()

```
155: PRIVATE METHOD truncateToTarget(
156:   history: IContent[],
157:   tailStartIndex: number,
158:   targetTokens: number,
159:   context: CompressionContext,
160: ): IContent[]
161:   // Remove entries from the front (oldest) until under target.
162:   // Never remove entries in the preserved tail.
163:   // This is a fallback — tool response summarization should handle most cases.
164:
165:   LET result = [...history]
166:   LET currentTokens = AWAIT context.estimateTokens(result)
167:   LET headEnd = Math.min(tailStartIndex, result.length)
168:
169:   WHILE currentTokens > targetTokens AND headEnd > 0
170:     // Remove the oldest non-tail entry
171:     result.shift()
172:     headEnd = headEnd - 1
173:     currentTokens = AWAIT context.estimateTokens(result)
174:
175:   RETURN result
```

---

## Pseudocode: buildMetadata() Helper

```
180: PRIVATE METHOD buildMetadata(
181:   originalCount: number,
182:   compressedCount: number,
183:   llmCallMade: boolean,
184: ): CompressionResultMetadata
185:   RETURN {
186:     originalMessageCount: originalCount,
187:     compressedMessageCount: compressedCount,
188:     strategyUsed: 'high-density',
189:     llmCallMade,                    // always false for this strategy
190:     topPreserved: undefined,        // N/A for high-density — no sandwich split
191:     bottomPreserved: undefined,
192:     middleCompressed: undefined,
193:   }
```

---

## Integration Points

```
Line 22-23: preserveThreshold from ephemerals
  - Same setting used by MiddleOutStrategy and other strategies.
  - Controls how much of the recent tail is protected from compression.
  - Accessed via context.runtimeContext.ephemerals.preserveThreshold().

Line 27: adjustForToolCallBoundary (from compression/utils.ts)
  - Existing utility function used by MiddleOutStrategy (imported from ./utils.js).
  - Ensures the tail boundary doesn't split a tool_call / tool_response pair.
  - HighDensityStrategy MUST import and use this same utility.

Line 37-39: Target token calculation
  - Formula: threshold × contextLimit × 0.6
  - This follows the same approach as TopDownTruncationStrategy.
  - At default 85% threshold, target is ~51% of context window.
  - Provides headroom before the next compression trigger.

Line 77: estimateTokens callback
  - Provided by the orchestrator via CompressionContext.
  - Routes through HistoryService.estimateTokensForContents().
  - Returns approximate token count for the given content array.

Line 100-111: summarizeToolResponseBlocks preserves block structure
  - The spread operator preserves callId, toolName, type, error, isComplete.
  - Only the result field is replaced with the summary string.
  - This ensures the model can still see WHAT tool was called and whether it succeeded.

Line 155-175: truncateToTarget is the aggressive fallback
  - Only runs if summarization alone doesn't reach the token target.
  - Removes oldest entries from the head (not the preserved tail).
  - Uses iterative estimation — not ideal for performance but correct.
  - In practice, tool response summarization should be sufficient in most cases.
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Make any LLM calls in compress()
        WHY: REQ-HD-008.1 — HighDensityStrategy.compress() shall NOT make LLM calls.
             The whole point is deterministic, free compression.
[OK]    DO: Use deterministic summarization only.

[ERROR] DO NOT: Remove tool_call blocks from AI entries
        WHY: REQ-HD-008.4 — all tool call blocks shall be preserved intact.
             Only tool response payloads are summarized.
[OK]    DO: Pass AI entries through unchanged. Only modify tool speaker entries.

[ERROR] DO NOT: Remove human messages during compression
        WHY: REQ-HD-008.4 — human messages are preserved intact.
             The model needs to see what the user asked.
[OK]    DO: Push human messages to newHistory as-is.

[ERROR] DO NOT: Ignore preserveThreshold and compress the entire history
        WHY: The recent tail must be preserved so the model has recent context.
             Without it, the model loses track of the current conversation.
[OK]    DO: Use preserveThreshold from ephemerals, same as other strategies.

[ERROR] DO NOT: Return newHistory with fewer than the preserved tail entries
        WHY: The tail is the minimum that must survive compression.
             truncateToTarget must never remove tail entries.
[OK]    DO: Only truncate from the head (index 0..tailStartIndex-1).

[ERROR] DO NOT: Use response.result directly as the summary
        WHY: response.result can be a large object, array, or multi-KB string.
             The summary must be a compact one-line string.
[OK]    DO: Build a new string summary using buildToolSummaryText().

[ERROR] DO NOT: Assume context.history is raw history
        WHY: compress() receives the CURATED history (via getCurated()),
             which filters empty AI messages. optimize() receives RAW history.
             Different methods, different views.
[OK]    DO: Work with context.history as provided — curated for compress,
        raw for optimize.
```
