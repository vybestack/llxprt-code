# Pseudocode: Orchestration (geminiChat.ts)

**Requirement Coverage**: REQ-HD-002.1 through REQ-HD-002.10, REQ-HD-001.10

---

## Interface Contracts

### INPUTS (for ensureDensityOptimized)
```typescript
// No direct parameters — uses instance state:
//   this.runtimeContext.ephemerals  — settings accessors
//   this.historyService             — history operations
//   this.densityDirty               — dirty flag
```

### OUTPUTS
```typescript
// ensureDensityOptimized returns: Promise<void>
//   Side effects:
//   - History may be mutated (via applyDensityResult)
//   - Token count recalculated
//   - densityDirty set to false
```

### DEPENDENCIES
```typescript
// Already available in GeminiChat:
//   this.runtimeContext: AgentRuntimeContext
//   this.historyService: HistoryService
//   this.logger: DebugLogger

// Must import:
import { parseCompressionStrategyName, getCompressionStrategy } from './compression/compressionStrategyFactory.js';
import type { DensityConfig } from './compression/types.js';
```

---

## Pseudocode: New Field — densityDirty

```
 10: // NEW private field on GeminiChat class
 11: PRIVATE densityDirty: boolean = true
 12:
 13: // INVARIANT: densityDirty is set to true ONLY when new content is added
 14: // to history via the turn-loop paths. It is NOT set by:
 15: //   - applyDensityResult() internal mutations
 16: //   - compression rebuild (clear + add inside startCompression/endCompression)
 17: //   - token recalculation events
```

---

## Pseudocode: Setting densityDirty = true

```
 20: // In every place where GeminiChat adds content to history for a NEW turn:
 21: //
 22: // Location 1: After adding user message to history
 23: // (in the sendMessage/sendMessageStream flow, before calling ensureCompressionBeforeSend)
 24: //
 25: // Location 2: In recordHistory() — where AI responses and tool results are added
 26: //
 27: // The dirty flag tracks content mutations from the TURN LOOP,
 28: // not from compression/density internal operations.
 29:
 30: // APPROACH: Set densityDirty = true at the call sites in GeminiChat where
 31: // historyService.add() is called for user messages, AI responses, and tool results.
 32: //
 33: // Specifically, identify all GeminiChat methods that call:
 34: //   this.historyService.add(content)
 35: // for turn-loop content, and add:
 36: //   this.densityDirty = true;
 37: // immediately before or after the add() call.
 38: //
 39: // DO NOT set densityDirty inside performCompression() where clear()+add() rebuilds history.
 40: // DO NOT set densityDirty in ensureDensityOptimized() after applyDensityResult().
```

---

## Pseudocode: ensureDensityOptimized()

```
 50: PRIVATE ASYNC METHOD ensureDensityOptimized(): PROMISE<void>
 51:   // REQ-HD-002.3: Skip if no new content since last optimization
 52:   IF NOT this.densityDirty
 53:     RETURN
 54:
 55:   TRY
 56:     // === STEP 1: Resolve the active compression strategy ===
 57:     LET strategyName = parseCompressionStrategyName(
 58:       this.runtimeContext.ephemerals.compressionStrategy()
 59:     )
 60:     LET strategy = getCompressionStrategy(strategyName)
 61:
 62:     // REQ-HD-002.2: If strategy has no optimize method, skip
 63:     IF NOT strategy.optimize
 64:       RETURN
 65:
 66:     // === STEP 2: Build DensityConfig from ephemerals ===
 67:     LET config: DensityConfig = {
 68:       readWritePruning: this.runtimeContext.ephemerals.densityReadWritePruning(),
 69:       fileDedupe: this.runtimeContext.ephemerals.densityFileDedupe(),
 70:       recencyPruning: this.runtimeContext.ephemerals.densityRecencyPruning(),
 71:       recencyRetention: this.runtimeContext.ephemerals.densityRecencyRetention(),
 72:       workspaceRoot: this.runtimeContext.config.getWorkspaceRoot(),
 73:     }
 74:
 75:     // === STEP 3: Get raw history ===
 76:     LET history = this.historyService.getRawHistory()
 77:
 78:     // === STEP 4: Run optimization ===
 79:     LET result = strategy.optimize(history, config)
 80:
 81:     // REQ-HD-002.5: Short-circuit if no changes
 82:     IF result.removals.length === 0 AND result.replacements.size === 0
 83:       this.logger.debug('Density optimization produced no changes')
 84:       RETURN
 85:
 86:     // === STEP 5: Apply result ===
 87:     this.logger.debug('Applying density optimization', {
 88:       removals: result.removals.length,
 89:       replacements: result.replacements.size,
 90:       metadata: result.metadata,
 91:     })
 92:
 93:     // REQ-HD-002.4: Apply and wait for token recalculation
 94:     AWAIT this.historyService.applyDensityResult(result)
 95:     AWAIT this.historyService.waitForTokenUpdates()
 96:
 97:   FINALLY
 98:     // REQ-HD-002.7: Always clear dirty flag, even on error or no-op
 99:     this.densityDirty = false
```

---

## Pseudocode: Updated ensureCompressionBeforeSend()

```
110: PRIVATE ASYNC METHOD ensureCompressionBeforeSend(
111:   prompt_id: string,
112:   pendingTokens: number,
113:   source: 'send' | 'stream',
114: ): PROMISE<void>
115:
116:   // Existing: wait for any ongoing compression
117:   IF this.compressionPromise
118:     this.logger.debug('Waiting for ongoing compression to complete')
119:     TRY
120:       AWAIT this.compressionPromise
121:     FINALLY
122:       this.compressionPromise = null
123:
124:   // Existing: wait for token updates to settle
125:   AWAIT this.historyService.waitForTokenUpdates()
126:
127:   // === NEW: Density optimization step ===
128:   // REQ-HD-002.1: Run density optimization after settling tokens, before threshold check
129:   AWAIT this.ensureDensityOptimized()
130:
131:   // Existing: threshold check (now uses post-optimization token count)
132:   IF this.shouldCompress(pendingTokens)
133:     LET triggerMessage = source === 'stream'
134:       ? 'Triggering compression before message send in stream'
135:       : 'Triggering compression before message send'
136:     this.logger.debug(triggerMessage, {
137:       pendingTokens,
138:       historyTokens: this.historyService.getTotalTokens(),
139:     })
140:     this.compressionPromise = this.performCompression(prompt_id)
141:     TRY
142:       AWAIT this.compressionPromise
143:     FINALLY
144:       this.compressionPromise = null
```

---

## Pseudocode: Updated enforceContextWindow() (Emergency Path)

```
150: PRIVATE ASYNC METHOD enforceContextWindow(
151:   pendingTokens: number,
152:   promptId: string,
153:   provider?: IProvider,
154: ): PROMISE<void>
155:
156:   AWAIT this.historyService.waitForTokenUpdates()
157:
158:   LET completionBudget = Math.max(0, this.getCompletionBudget(provider))
159:   LET userContextLimit = this.runtimeContext.ephemerals.contextLimit()
160:   LET limit = tokenLimit(this.runtimeState.model, userContextLimit)
161:   LET marginAdjustedLimit = Math.max(0, limit - GeminiChat.TOKEN_SAFETY_MARGIN)
162:
163:   LET projected = this.getEffectiveTokenCount()
164:                  + Math.max(0, pendingTokens)
165:                  + completionBudget
166:
167:   IF projected <= marginAdjustedLimit
168:     RETURN
169:
170:   this.logger.warn('Projected token usage exceeds context limit, attempting compression', {
171:     projected, marginAdjustedLimit, completionBudget, pendingTokens,
172:   })
173:
174:   // === NEW: Run density optimization before emergency compression ===
175:   // REQ-HD-002.8: Emergency path also optimizes before compressing
176:   AWAIT this.ensureDensityOptimized()
177:   AWAIT this.historyService.waitForTokenUpdates()
178:
179:   // Re-check after optimization — may have freed enough space
180:   LET postOptProjected = this.getEffectiveTokenCount()
181:                         + Math.max(0, pendingTokens)
182:                         + completionBudget
183:
184:   IF postOptProjected <= marginAdjustedLimit
185:     this.logger.debug('Density optimization reduced tokens below limit', {
186:       postOptProjected, marginAdjustedLimit,
187:     })
188:     RETURN
189:
190:   // Still over — proceed with full compression
191:   AWAIT this.performCompression(promptId)
192:   AWAIT this.historyService.waitForTokenUpdates()
193:
194:   LET recomputed = this.getEffectiveTokenCount()
195:                   + Math.max(0, pendingTokens)
196:                   + completionBudget
197:
198:   IF recomputed <= marginAdjustedLimit
199:     this.logger.debug('Compression reduced tokens below limit', {
200:       recomputed, marginAdjustedLimit,
201:     })
202:     RETURN
203:
204:   THROW NEW Error(
205:     'Request would exceed the ${limit} token context window even after compression ...'
206:   )
```

---

## Pseudocode: Threshold Precedence (in shouldCompress)

```
210: // REQ-HD-001.10: Threshold precedence
211: // The existing shouldCompress() already reads from ephemerals:
212: //   const threshold = this.runtimeContext.ephemerals.compressionThreshold()
213: //
214: // The compressionThreshold() accessor resolves:
215: //   1. Ephemeral override (from /set compression-threshold)
216: //   2. Profile setting
217: //   3. Strategy default (trigger.defaultThreshold)
218: //
219: // For step 3, the accessor needs to fall back to the strategy's defaultThreshold
220: // when no ephemeral or profile setting is set. This means:
221: //   - The ephemeral accessor for compressionThreshold must be updated to
222: //     read the strategy's trigger.defaultThreshold as the final fallback
223: //   - OR the existing hardcoded COMPRESSION_TOKEN_THRESHOLD constant
224: //     (currently 0.85 in compression-config.ts) serves as the default
225: //     and matches all strategies' defaultThreshold values
226: //
227: // Since all strategies declare defaultThreshold: 0.85, and the existing
228: // constant COMPRESSION_TOKEN_THRESHOLD is also 0.85, no change is needed
229: // in shouldCompress() itself — the precedence already works correctly.
230: //
231: // FUTURE: If a strategy declares a different defaultThreshold, the
232: // accessor would need to resolve the active strategy and read its
233: // trigger.defaultThreshold as the fallback.
```

---

## Integration Points

```
Line 11: densityDirty initialization
  - Initialized to true so the first turn always runs optimization.
  - After the first optimization pass, it's set to false.
  - New content addition sets it back to true.

Line 30-39: Dirty flag set points in GeminiChat
  - Must identify ALL places in GeminiChat where historyService.add() is called
    for turn-loop content.
  - Key locations: recordHistory() which handles user input, model output,
    and automatic function calling history.
  - Also any direct add() calls for tool results.
  - CRITICAL: Do NOT set dirty inside performCompression() where it
    calls clear() + add() to rebuild after compression.

Line 57-60: Strategy resolution in ensureDensityOptimized
  - Uses the SAME factory path as performCompression().
  - parseCompressionStrategyName validates the strategy name.
  - getCompressionStrategy creates a fresh instance.
  - If the active strategy is 'middle-out' (threshold-only), strategy.optimize
    is undefined, and we return early at line 63.

Line 72: workspaceRoot resolution
  - Uses this.runtimeContext.config.getWorkspaceRoot().
  - This MUST be available when ensureDensityOptimized runs.
  - In normal CLI usage, workspace root is set during session initialization.

Line 94-95: Apply + wait sequence
  - applyDensityResult() internally calls recalculateTotalTokens().
  - recalculateTotalTokens() enqueues on tokenizerLock.
  - waitForTokenUpdates() awaits tokenizerLock to drain.
  - After line 95, totalTokens reflects the post-optimization history.

Line 129: Position in ensureCompressionBeforeSend
  - AFTER waitForTokenUpdates() — token count from latest add() is settled
  - BEFORE shouldCompress() — threshold check uses post-optimization tokens
  - This is the exact position specified in the technical overview.

Line 174-188: Emergency path optimization
  - The emergency path in enforceContextWindow() currently calls
    performCompression() directly.
  - We add ensureDensityOptimized() BEFORE performCompression().
  - After optimization, re-check if we're still over the limit.
  - If density optimization freed enough space, skip full compression.

Line 210-229: Threshold precedence analysis
  - No code change needed in shouldCompress() for the initial implementation.
  - All strategies use 0.85, matching the existing default.
  - Future strategy-specific defaults would need accessor changes.
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Set densityDirty = true inside applyDensityResult() or recalculateTotalTokens()
        WHY: This creates an infinite loop — optimization sets dirty, which triggers
             another optimization, which sets dirty again.
[OK]    DO: Only set densityDirty = true at turn-loop content add sites.

[ERROR] DO NOT: Set densityDirty = true inside performCompression()
        WHY: performCompression() calls historyService.clear() then add() in a loop.
             Those adds are rebuilding compressed history, not new user content.
             Setting dirty here would cause unnecessary optimization on the next turn
             when history hasn't actually changed (just been compressed).
[OK]    DO: Skip dirty flag in the compression rebuild path. The compression itself
        has already optimized the history.

[ERROR] DO NOT: Call ensureDensityOptimized() BEFORE waitForTokenUpdates()
        WHY: The token count from the latest add() may still be in-flight.
             Optimization needs accurate history state. The technical spec
             explicitly requires settling token updates first.
[OK]    DO: await historyService.waitForTokenUpdates() THEN ensureDensityOptimized().

[ERROR] DO NOT: Hold the compression lock (startCompression/endCompression) during density optimization
        WHY: The density optimization step runs BEFORE compression. It doesn't need
             the lock because no concurrent add() calls occur in the pre-send window.
             Taking the lock would prevent queued adds from flushing between
             optimization and compression.
[OK]    DO: Run ensureDensityOptimized() without the compression lock. Only
        performCompression() uses start/endCompression.

[ERROR] DO NOT: Call ensureDensityOptimized() from event handlers or callbacks
        WHY: REQ-HD-002.10 — only safe in the sequential pre-send window.
             Calling from tokensUpdated event or other async contexts risks
             concurrent history mutations.
[OK]    DO: Only call from ensureCompressionBeforeSend() and enforceContextWindow().

[ERROR] DO NOT: Skip the dirty flag check ("always optimize, it's cheap")
        WHY: Even though optimize() is synchronous, it still requires
             applyDensityResult + recalculateTotalTokens which are async.
             Skipping the flag means unnecessary token recalculation on every send.
[OK]    DO: Check densityDirty before calling optimize. Skip when clean.

[ERROR] DO NOT: Clear densityDirty BEFORE running optimization (at the top of the method)
        WHY: If optimization throws, densityDirty would be false and the next
             turn would skip optimization even though it never ran successfully.
[OK]    DO: Clear densityDirty in the FINALLY block — always cleared after
        the method completes, whether it succeeded or threw.
```
