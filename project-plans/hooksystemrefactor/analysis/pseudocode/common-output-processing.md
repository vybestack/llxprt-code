# Pseudocode: Common Output Processing

**Plan ID**: PLAN-20250218-HOOKSYSTEM
**Component**: processCommonHookOutputFields + failure envelopes + per-hook logging
**Referenced By**: Phase P14 (semantics impl)

---

## Interface Contracts

### Inputs

```typescript
// INPUTS this component receives:
interface ProcessingInput {
  aggregated: AggregatedHookResult;  // from HookAggregator
}

// OUTPUTS this component produces:
interface ProcessedHookResult {
  aggregated: AggregatedHookResult;
  shouldStop: boolean;
  stopReason: string | undefined;
  systemMessage: string | undefined;
  suppressOutput: boolean;
}
```

### Dependencies

```typescript
// DEPENDENCIES:
interface ProcessingDeps {
  aggregatedResult: AggregatedHookResult;  // produced by HookAggregator
  debugLogger?: DebugLogger;               // for log emission
  // Pure functions — no external service calls
}
```

### Anti-Pattern Warnings

```
[ERROR] DO NOT: re-implement stop/message parsing in callers
[OK]    DO:     callers consume ProcessedHookResult fields directly

[ERROR] DO NOT: emit logs using console.log
[OK]    DO:     use this.debugLogger.log() only (DebugLogger infrastructure)

[ERROR] DO NOT: throw from processCommonHookOutputFields
[OK]    DO:     return ProcessedHookResult with derived fields; errors caught at caller level

[ERROR] DO NOT: use EMPTY_SUCCESS_RESULT by reference in no-match paths
[OK]    DO:     call makeEmptySuccessResult() factory (returns fresh copy)

[ERROR] DO NOT: use makeEmptySuccessResult() in catch blocks
[OK]    DO:     use buildFailureEnvelope() in ALL catch blocks
```

---

## Pseudocode

### processCommonHookOutputFields()

```
10: FUNCTION processCommonHookOutputFields(aggregated: AggregatedHookResult) -> ProcessedHookResult
11:   // Initialize all derived fields
12:   SET shouldStop = false
13:   SET stopReason = undefined
14:   SET systemMessage = undefined
15:   SET suppressOutput = false
16:
17:   // Pass 1: scan for stop intent
18:   FOR EACH hookOutput IN aggregated.allOutputs
19:     IF hookOutput.shouldStopExecution() IS true (or equivalent stop field check)
20:       SET shouldStop = true
21:       GET rawReason = hookOutput.getEffectiveReason() OR hookOutput.stopReason OR hookOutput.reason
22:       SET stopReason = normalizeStopReason(rawReason)  // lines 50-60
23:       BREAK  // first stop intent wins
24:     END IF
25:   END FOR
26:
27:   // Pass 2: scan for systemMessage and suppressOutput
28:   FOR EACH hookOutput IN aggregated.allOutputs
29:     IF hookOutput.systemMessage IS NOT undefined AND NOT NULL AND NOT EMPTY
30:       SET systemMessage = hookOutput.systemMessage
31:       IF hookOutput.suppressOutput IS true
32:         SET suppressOutput = true
33:       END IF
34:       // Note: last systemMessage wins (or first — implementation choice)
35:     END IF
36:   END FOR
37:
38:   RETURN {
39:     aggregated,
40:     shouldStop,
41:     stopReason,
42:     systemMessage,
43:     suppressOutput
44:   }
45: END FUNCTION
```

### normalizeStopReason()

```
50: FUNCTION normalizeStopReason(rawReason: unknown) -> string | undefined
51:   IF rawReason IS undefined OR rawReason IS null
52:     RETURN undefined
53:   END IF
54:   IF typeof rawReason IS 'string'
55:     GET trimmed = rawReason.trim()
56:     IF trimmed IS EMPTY
57:       RETURN undefined
58:     END IF
59:     RETURN trimmed
60:   END IF
61:   RETURN String(rawReason)  // coerce non-string reasons to string
62: END FUNCTION
```

### makeEmptySuccessResult()

```
70: FUNCTION makeEmptySuccessResult() -> AggregatedHookResult
71:   // ALWAYS return a fresh copy — NEVER the shared EMPTY_SUCCESS_RESULT constant by reference
72:   RETURN {
73:     ...EMPTY_SUCCESS_RESULT,    // spread to get fresh object
74:     // equivalent to:
75:     // success: true,
76:     // hookResults: [],
77:     // allOutputs: [],
78:     // errors: [],
79:     // totalDuration: 0
80:   }
81: END FUNCTION
```

### buildFailureEnvelope()

```
90: FUNCTION buildFailureEnvelope(
91:     error: unknown,
92:     stage: string,
93:     meta?: FailureMeta
94:   ) -> AggregatedHookResult
95:
96:   // Extract human-readable message
97:   GET message =
98:     IF error IS Error instance: error.message
99:     ELSE IF typeof error IS 'string': error
100:    ELSE: JSON.stringify(error) OR 'Unknown error'
101:
102:  // Build normalized error object
103:  BUILD normalizedError = {
104:    stage,
105:    message,
106:    details: error
107:  }
108:
109:  IF meta?.eventName IS NOT undefined
110:    SET normalizedError.eventName = meta.eventName
111:  END IF
112:
113:  IF meta?.correlationId IS NOT undefined
114:    SET normalizedError.correlationId = meta.correlationId
115:  END IF
116:
117:  RETURN {
118:    success: false,
119:    hookResults: [],
120:    allOutputs: [],
121:    errors: [normalizedError],
122:    totalDuration: 0
123:  }
124: END FUNCTION
```

### emitPerHookLogs()

```
130: METHOD emitPerHookLogs(eventName: HookEventName, hookResults: HookResult[])
131:   IF this.debugLogger IS undefined
132:     RETURN  // no-op when logger not injected
133:   END IF
134:
135:   FOR EACH result IN hookResults
136:     BUILD record = {
137:       eventName: eventName.toString(),
138:       hookIdentity: result.hookName OR result.hookType OR 'unknown',
139:       duration: result.durationMs,
140:       success: result.success,
141:       exitCode: result.exitCode,         // may be undefined
142:       stdout: result.stdout,             // may be undefined
143:       stderr: result.stderr,             // may be undefined
144:       errorMessage: result.success ? undefined : (result.error?.message OR 'execution failed')
145:     }
146:
147:     // Log every hook result regardless of success/failure
148:     CALL this.debugLogger.log('hook:result', record)
149:
150:     // Emit additional failure diagnostic for failed hooks
151:     IF NOT result.success
152:       CALL this.debugLogger.log('hook:failure_diagnostic', {
153:         ...record,
154:         error: result.error,
155:         details: result.errorDetails
156:       })
157:     END IF
158:   END FOR
159: END METHOD
```

### emitBatchSummary()

```
165: METHOD emitBatchSummary(eventName: HookEventName, hookResults: HookResult[], totalDurationMs: number)
166:   IF this.debugLogger IS undefined
167:     RETURN  // no-op when logger not injected
168:   END IF
169:
170:   COMPUTE hookCount = hookResults.length
171:   COMPUTE successCount = hookResults.filter(r => r.success).length
172:   COMPUTE failureCount = hookCount - successCount
173:
174:   BUILD summary = {
175:     eventName: eventName.toString(),
176:     hookCount,
177:     successCount,
178:     failureCount,
179:     totalDurationMs
180:   }
181:
182:   CALL this.debugLogger.log('hook:batch_summary', summary)
183: END METHOD
```

### Integration in executeHooksCore()

```
190: SECTION: how processCommonHookOutputFields integrates in executeHooksCore()
191:
192:   // After aggregation (executeHooksCore line 87):
193:   CALL aggregator.aggregate(hookResults) -> aggregatedResult
194:
195:   // Apply common output processing:
196:   CALL processCommonHookOutputFields(aggregatedResult) -> processedResult
197:
198:   // Emit per-hook logs:
199:   CALL emitPerHookLogs(eventName, hookResults)           // lines 130-158
200:
201:   // Emit batch summary:
202:   COMPUTE totalDuration = SUM of hookResults[].durationMs
203:   CALL emitBatchSummary(eventName, hookResults, totalDuration)  // lines 165-182
204:
205:   // Return to caller: aggregatedResult is the backward-compatible return
206:   // processedResult is available for callers that consume ProcessedHookResult
207:   RETURN processedResult.aggregated
208:   // OR if we change signature: RETURN processedResult
209:
210: END SECTION
```

---

## Error Handling Paths

```
Scenario 1: aggregated.allOutputs is empty (no hook outputs)
  -> Both for loops run zero iterations
  -> All derived fields remain at defaults: shouldStop=false, stopReason=undefined, systemMessage=undefined, suppressOutput=false
  -> Returns clean ProcessedHookResult with defaults

Scenario 2: multiple hooks signal stop
  -> First stop intent found sets shouldStop=true
  -> Loop breaks after first match
  -> Second stop intent is ignored (first wins semantics)

Scenario 3: systemMessage present but suppressOutput=false
  -> systemMessage is set
  -> suppressOutput remains false
  -> Caller is responsible for displaying systemMessage

Scenario 4: systemMessage present with suppressOutput=true
  -> systemMessage is set (for logging purposes)
  -> suppressOutput=true signals caller to skip display

Scenario 5: debugLogger not injected
  -> emitPerHookLogs returns at line 132 (no-op)
  -> emitBatchSummary returns at line 167 (no-op)
  -> No logging side effects

Scenario 6: buildFailureEnvelope called with non-Error object
  -> Message extracted via JSON.stringify fallback (line 100)
  -> Failure envelope shape is valid regardless of error type
```

---

## Transaction Boundaries

```
processCommonHookOutputFields():
  - Pure function — no side effects
  - No transactions; operates on in-memory data only
  - Safe to call multiple times with same input (idempotent)

emitPerHookLogs() / emitBatchSummary():
  - Log emission only (no state mutation)
  - If logger call throws: exceptions escape to caller (executeHooksCore catch block)

buildFailureEnvelope():
  - Pure function — no side effects
  - No transactions; always returns valid AggregatedHookResult shape

makeEmptySuccessResult():
  - Pure function — no side effects
  - Returns fresh object on every call (important for mutation safety)
```
