# Pseudocode: Enriched Compression Prompts and Todo-Aware Summarization

**Requirement Coverage**: REQ-HD-010.1 through REQ-HD-010.5, REQ-HD-011.1 through REQ-HD-011.4, REQ-HD-012.1 through REQ-HD-012.3

---

## Interface Contracts

### INPUTS
```typescript
// Prompt enrichment: no runtime inputs — static prompt template changes.
//
// Todo-aware summarization inputs:
//   activeTodos from CompressionContext (set by buildCompressionContext)
//   Current todo state from TodoContextTracker or equivalent
//
// Transcript fallback inputs:
//   transcriptPath from CompressionContext (set by buildCompressionContext)
//   Conversation log path from CLI layer (may not be available in core)
```

### OUTPUTS
```typescript
// Prompt enrichment outputs:
//   Updated getCompressionPrompt() return value with 4 new XML sections.
//   Updated compression.md markdown file with matching sections.
//
// Todo-aware summarization outputs:
//   CompressionContext.activeTodos populated when todo state available.
//   LLM strategies append todo list to compression request.
//
// Transcript fallback outputs:
//   CompressionContext.transcriptPath populated when available.
//   LLM strategy summaries include transcript pointer.
```

### DEPENDENCIES
```typescript
// prompts.ts: getCompressionPrompt() function
// compression.md: default prompt file in prompt-config/defaults/
// types.ts: CompressionContext interface (activeTodos, transcriptPath fields)
// geminiChat.ts: buildCompressionContext() method
// MiddleOutStrategy.ts: uses prompt in compress()
// OneShotStrategy.ts: uses prompt in compress()
// Todo types from packages/core/src/tools/todo-schemas.ts
// TodoContextTracker from packages/core/src/services/todo-context-tracker.ts
```

---

## Pseudocode: Updated getCompressionPrompt() in prompts.ts

```
 10: FUNCTION getCompressionPrompt(): string
 11:   RETURN TEMPLATE STRING:
 12:
 13:   "You are the component that summarizes internal chat history into a given structure.
 14:
 15:    When the conversation history grows too large, you will be invoked to compress
 16:    the MIDDLE portion of the history into a structured XML snapshot, reducing it
 17:    by approximately 50%. This snapshot will be combined with preserved messages
 18:    from the top and bottom of the conversation. The agent will have access to the
 19:    full context: summary + preserved top messages + preserved bottom messages.
 20:
 21:    First, you will think through the middle portion of history in a private
 22:    <scratchpad>. Review the user's overall goal, the agent's actions, tool outputs,
 23:    file modifications, and any unresolved questions. Identify the most important
 24:    information to preserve. Remember: user prompts and their exact phrasing are
 25:    especially important to retain.
 26:
 27:    After your reasoning is complete, generate the final <state_snapshot> XML object.
 28:    Be thorough but concise. Focus on preserving essential context while eliminating
 29:    redundancy. Ensure the agent has sufficient information to continue work
 30:    effectively.
 31:
 32:    The structure MUST be as follows:
 33:
 34:    <state_snapshot>
 35:        <overall_goal>
 36:            <!-- A single, concise sentence describing the user's high-level objective. -->
 37:        </overall_goal>
 38:
 39:        <key_knowledge>
 40:            <!-- Crucial facts, conventions, and constraints the agent must remember. -->
 41:        </key_knowledge>
 42:
 43:        <current_progress>
 44:            <!-- What has been accomplished so far? -->
 45:        </current_progress>
 46:
 47:        <active_tasks>
 48:            <!-- What specific tasks need to be completed next? -->
 49:        </active_tasks>
 50:
 51:        <open_questions>
 52:            <!-- Unresolved issues, errors, or questions that need attention. -->
 53:        </open_questions>
 54:
 55:        // === NEW SECTION 1: task_context (REQ-HD-010.1) ===
 56:        <task_context>
 57:            <!-- For EACH active task or todo item, explain:
 58:                 - WHY it exists (what user request originated it)
 59:                 - What constraints apply
 60:                 - What approach was chosen
 61:                 - What has been tried so far
 62:                 This bridges the persistent todo list with conversation context.
 63:                 If todo items are provided below, reference them explicitly. -->
 64:        </task_context>
 65:
 66:        // === NEW SECTION 2: user_directives (REQ-HD-010.2) ===
 67:        <user_directives>
 68:            <!-- Specific user feedback, corrections, and preferences that MUST be
 69:                 honored going forward. Use exact quotes where possible. Examples:
 70:                 - User said: 'Always use single quotes in TypeScript files'
 71:                 - User corrected: 'The API endpoint is /v2, not /v1'
 72:                 - User preference: 'Run tests before committing' -->
 73:        </user_directives>
 74:
 75:        // === NEW SECTION 3: errors_encountered (REQ-HD-010.3) ===
 76:        <errors_encountered>
 77:            <!-- Errors hit during the session: exact error messages, root causes
 78:                 identified, and resolutions applied. This prevents the agent from
 79:                 repeating the same mistakes. Examples:
 80:                 - Error: 'Cannot find module ./utils' — caused by wrong import path,
 81:                   fixed by using '../utils'
 82:                 - Error: 'TypeError: x is not a function' — caused by default export
 83:                   vs named export mismatch -->
 84:        </errors_encountered>
 85:
 86:        // === NEW SECTION 4: code_references (REQ-HD-010.4) ===
 87:        <code_references>
 88:            <!-- Important code snippets, exact file paths, and function signatures
 89:                 that are critical for continuing work. Prefer exact content over
 90:                 prose descriptions. Examples:
 91:                 - File: src/auth/middleware.ts, function: validateToken(token: string)
 92:                 - Key interface: interface UserProfile { id: string; email: string; }
 93:                 - Config: database.host = 'localhost:5432' -->
 94:        </code_references>
 95:    </state_snapshot>"
```

---

## Pseudocode: Updated compression.md in prompt-config/defaults/

```
100: // The compression.md file must contain the same structure as getCompressionPrompt()
101: // but formatted as a standalone markdown/text file.
102: //
103: // The file is loaded by PromptResolver and takes priority over the hardcoded prompt
104: // when available.
105: //
106: // UPDATE: Add the 4 new XML sections (task_context, user_directives,
107: // errors_encountered, code_references) to the <state_snapshot> structure
108: // in the markdown file, matching the getCompressionPrompt() output above.
109: //
110: // NOTE: The markdown file uses a slightly different framing (one-shot style:
111: // "distill the entire history" vs middle-out style: "compress the MIDDLE portion").
112: // The new sections are generic — they apply to both framing styles.
113: // Add them after the existing <current_plan> section, before the closing
114: // </state_snapshot> tag.
115:
116: // Additions to compression.md after the <current_plan> section:
117:
118:     <task_context>
119:         <!-- For EACH active task or todo item, explain:
120:              - WHY it exists (what user request originated it)
121:              - What constraints apply
122:              - What approach was chosen and what has been tried so far
123:              This section bridges the persistent todo list with conversation context. -->
124:     </task_context>
125:
126:     <user_directives>
127:         <!-- Specific user feedback, corrections, and preferences that MUST be
128:              honored going forward. Use exact quotes where possible. -->
129:     </user_directives>
130:
131:     <errors_encountered>
132:         <!-- Errors hit during the session: exact error messages, root causes,
133:              and resolutions. Prevents repeating the same mistakes. -->
134:     </errors_encountered>
135:
136:     <code_references>
137:         <!-- Important code snippets, exact file paths, and function signatures.
138:              Prefer exact content over prose descriptions. -->
139:     </code_references>
```

---

## Pseudocode: Todo-Aware Summarization

### CompressionContext activeTodos Field (types.ts)

```
145: // Already defined in strategy-interface.md (line 64):
146: //   READONLY activeTodos?: READONLY ARRAY OF Todo
147: //
148: // The Todo type comes from packages/core/src/tools/todo-schemas.ts.
149: // It has the shape: { id: string, content: string, status: string, subtasks?: [...] }
```

### Populating activeTodos in buildCompressionContext() (geminiChat.ts)

```
155: // UPDATE buildCompressionContext() in geminiChat.ts (currently at line 2046)
156:
157: PRIVATE METHOD buildCompressionContext(promptId: string): CompressionContext
158:   LET promptResolver = NEW PromptResolver()
159:   LET promptBaseDir = path.join(os.homedir(), '.llxprt', 'prompts')
160:
161:   // === NEW: Collect active todos ===
162:   LET activeTodos = this.getActiveTodosForCompression()
163:
164:   // === NEW: Collect transcript path (if available) ===
165:   LET transcriptPath = this.getTranscriptPath()
166:
167:   RETURN {
168:     history: this.historyService.getCurated(),
169:     runtimeContext: this.runtimeContext,
170:     runtimeState: this.runtimeState,
171:     estimateTokens: (contents) =>
172:       this.historyService.estimateTokensForContents(contents),
173:     currentTokenCount: this.historyService.getTotalTokens(),
174:     logger: this.logger,
175:     resolveProvider: (profileName?) =>
176:       this.resolveProviderForRuntime(profileName ?? 'compression'),
177:     promptResolver,
178:     promptBaseDir,
179:     promptContext: {
180:       provider: this.runtimeState.provider,
181:       model: this.runtimeState.model,
182:     },
183:     promptId,
184:     activeTodos,           // ← NEW
185:     transcriptPath,        // ← NEW
186:   }
```

### Collecting Active Todos

```
190: PRIVATE METHOD getActiveTodosForCompression(): Todo[] | undefined
191:   // The todo state flows through tool calls (todo_write, todo_read).
192:   // The TodoReminderService tracks the latest todo state.
193:   // Access path depends on how GeminiChat can reach the todo state.
194:   //
195:   // Option A: If TodoContextTracker is accessible via runtimeContext
196:   //   LET tracker = this.runtimeContext.todoContextTracker
197:   //   IF tracker IS undefined
198:   //     RETURN undefined
199:   //   LET todos = tracker.getActiveTodos()
200:   //   RETURN todos.length > 0 ? todos : undefined
201:   //
202:   // Option B: If todo state is available through the event system
203:   //   (listen for todo events, maintain local cache)
204:   //
205:   // Option C: If a service is injected into GeminiChat
206:   //   return this.todoService?.getActiveTodos()
207:   //
208:   // The exact access path needs to be determined during implementation
209:   // based on which services are available to GeminiChat.
210:   //
211:   // For initial implementation, if the access path is not straightforward,
212:   // return undefined — the field is optional and LLM strategies handle
213:   // its absence gracefully.
214:
215:   TRY
216:     // Attempt to access todo state through available services
217:     LET todoState = this.runtimeContext.todoContextTracker?.getActiveTodos()
218:     IF todoState AND todoState.length > 0
219:       RETURN todoState
220:     RETURN undefined
221:   CATCH
222:     // If todo state is not accessible, return undefined — not critical
223:     RETURN undefined
```

### Collecting Transcript Path

```
228: PRIVATE METHOD getTranscriptPath(): string | undefined
229:   // REQ-HD-012.3: Low priority — depends on CLI layer exposing the
230:   // conversation log path to the core layer.
231:   //
232:   // The conversation log path is managed at the CLI level
233:   // (session recording). If it's available through runtimeContext
234:   // or a service, return it. Otherwise return undefined.
235:   //
236:   // For initial implementation, return undefined.
237:   // This can be wired up in a follow-up when the CLI exposes the path.
238:   RETURN undefined
```

---

## Pseudocode: LLM Strategies Using activeTodos

### MiddleOutStrategy Compression Request Assembly

```
245: // In MiddleOutStrategy.compress(), when building the LLM request:
246: // Currently the request is:
247: //   [{ human: prompt }, ...toCompress, { human: TRIGGER_INSTRUCTION }]
248: //
249: // UPDATE: If activeTodos is available, append todo context before the trigger
250:
251: METHOD compress(context: CompressionContext): PROMISE<CompressionResult>
252:   // ... existing split, prompt resolution ...
253:
254:   LET compressionRequest: IContent[] = [
255:     { speaker: 'human', blocks: [{ type: 'text', text: prompt }] },
256:     ...toCompress,
257:   ]
258:
259:   // === NEW: Append todo context if available ===
260:   IF context.activeTodos AND context.activeTodos.length > 0
261:     LET todoText = this.buildTodoContextText(context.activeTodos)
262:     compressionRequest.push({
263:       speaker: 'human',
264:       blocks: [{ type: 'text', text: todoText }],
265:     })
266:
267:   // === NEW: Append transcript reference if available ===
268:   IF context.transcriptPath
269:     LET transcriptNote = 'Full pre-compression transcript available at: '
270:                         + context.transcriptPath
271:     // Include in the trigger instruction or as a separate message
272:
273:   compressionRequest.push({
274:     speaker: 'human',
275:     blocks: [{ type: 'text', text: TRIGGER_INSTRUCTION }],
276:   })
277:
278:   // ... rest of compress flow unchanged ...
```

### Building Todo Context Text

```
285: PRIVATE METHOD buildTodoContextText(todos: READONLY ARRAY OF Todo): string
286:   LET lines: string[] = []
287:   lines.push('The following todo items are currently active. When generating')
288:   lines.push('the state snapshot, explain the CONTEXT behind each todo —')
289:   lines.push('why it exists, what user request created it, and what progress')
290:   lines.push('has been made:\n')
291:
292:   FOR EACH todo IN todos
293:     LET status = todo.status ?? 'pending'
294:     lines.push('- [' + status.toUpperCase() + '] ' + todo.content)
295:     IF todo.subtasks AND todo.subtasks.length > 0
296:       FOR EACH subtask IN todo.subtasks
297:         lines.push('  - ' + (subtask.content ?? ''))
298:
299:   RETURN lines.join('\n')
```

### OneShotStrategy — Same Pattern

```
305: // OneShotStrategy.compress() should receive the same activeTodos treatment.
306: // The pattern is identical to MiddleOutStrategy lines 260-276:
307: //   - Check context.activeTodos
308: //   - Build todo context text
309: //   - Append to compression request before trigger instruction
310: //
311: // REQ-HD-011.4: Non-LLM strategies (TopDownTruncation, HighDensity)
312: // ignore activeTodos entirely — they don't make LLM calls.
```

---

## Integration Points

```
Line 10-95: Prompt template changes
  - getCompressionPrompt() is the hardcoded fallback.
  - compression.md is the configurable override loaded by PromptResolver.
  - BOTH must be updated to stay consistent.
  - The 4 new sections are ADDITIVE — existing sections preserved.
  - LLM strategies resolve the prompt via PromptResolver first,
    falling back to getCompressionPrompt(). Both must have the new sections.

Line 112-114: compression.md has different framing (one-shot vs middle-out)
  - The default compression.md uses one-shot framing ("distill the entire history")
  - getCompressionPrompt() in prompts.ts uses middle-out framing ("compress the MIDDLE")
  - The new sections work with both framings — they're about WHAT to capture,
    not HOW to split the history.

Line 155-186: buildCompressionContext additions
  - Two new optional fields added to the returned object.
  - Existing fields are unchanged — backward compatible.
  - activeTodos may be undefined if todo state is not accessible.
  - transcriptPath is always undefined in initial implementation.

Line 190-223: Todo state access
  - The exact access path to todo state from GeminiChat needs to be
    determined during implementation.
  - TodoContextTracker, TodoReminderService, or direct event subscription
    are potential paths.
  - The implementation should try the most direct available path and
    return undefined if not accessible.

Line 245-276: LLM strategy request assembly
  - The todo context is added as an additional human message in the
    compression request, between the history and the trigger instruction.
  - This gives the LLM the todo list as context when generating the summary.
  - The trigger instruction remains the LAST message so the LLM generates
    the <state_snapshot> after seeing everything.

Line 268-271: Transcript path inclusion
  - For initial implementation, transcriptPath is undefined (line 238).
  - When available, it's included as a note in the summary.
  - The exact integration (separate message vs. appended to trigger) can
    be decided during implementation.
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Add the new XML sections OUTSIDE the <state_snapshot> tags
        WHY: The LLM is instructed to generate a <state_snapshot>. All sections
             must be inside it for the output to be well-structured.
[OK]    DO: Add the 4 new sections inside <state_snapshot>, after the existing 5.

[ERROR] DO NOT: Make the new sections required in the prompt ("You MUST fill all sections")
        WHY: Some sessions may have no errors, no todos, or no code references.
             The LLM should fill what's relevant and skip what's not.
[OK]    DO: Use instructive comments (<!-- -->) that guide but don't mandate.

[ERROR] DO NOT: Pass raw todo JSON to the LLM
        WHY: The todo state as JSON ([{"id":"1","content":"...","status":"pending"}])
             wastes tokens and is harder for the LLM to process.
[OK]    DO: Format todos as readable text (buildTodoContextText).

[ERROR] DO NOT: Include activeTodos in HighDensityStrategy.compress()
        WHY: REQ-HD-011.4 — non-LLM strategies ignore activeTodos.
             HighDensityStrategy doesn't make LLM calls, so the todo context
             would have nowhere to go.
[OK]    DO: Only use activeTodos in MiddleOutStrategy and OneShotStrategy.

[ERROR] DO NOT: Modify the prompt framing for existing sections
        WHY: Existing compression behavior should be preserved.
             Only ADD new sections — don't rewrite existing ones.
[OK]    DO: Keep the existing 5 sections unchanged. Append 4 new sections.

[ERROR] DO NOT: Import CLI-layer types into the core prompt module
        WHY: prompts.ts is in the core package. It must not depend on CLI.
             The prompt template is plain text — no imports needed.
[OK]    DO: The prompt template is just a string. Todo formatting happens in
        the strategy, which receives typed data via CompressionContext.

[ERROR] DO NOT: Block compression if todo state is unavailable
        WHY: activeTodos is optional. If the todo system isn't running or
             accessible, compression must proceed without it.
[OK]    DO: Check for undefined/empty and skip todo injection gracefully.
```
