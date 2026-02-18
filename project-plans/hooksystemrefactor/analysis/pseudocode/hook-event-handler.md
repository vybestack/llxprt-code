# Pseudocode: HookEventHandler

**Plan ID**: PLAN-20250218-HOOKSYSTEM
**Component**: HookEventHandler (`packages/core/src/hooks/hookEventHandler.ts`)
**Referenced By**: Phase P05 (lifecycle impl), P08 (messagebus impl), P11 (validation impl), P14 (semantics impl)

---

## Interface Contracts

### Inputs

```typescript
// INPUTS this component receives:
interface HookEventHandlerDependencies {
  config: Config;                     // provides session_id, getWorkingDir(), etc.
  hookRegistry: HookRegistry;         // provides hook definitions
  hookPlanner: HookPlanner;           // resolves hooks for an event
  hookRunner: HookRunner;             // executes hooks
  hookAggregator: HookAggregator;     // merges per-hook results
  messageBus?: MessageBus;            // optional; enables mediated path
  debugLogger?: DebugLogger;          // optional; enables local logging
}

// OUTPUTS this component produces:
// Direct path: Promise<AggregatedHookResult>  (on fire*Event methods)
// Mediated path: publishes HookExecutionResponse to MessageBus
```

### Dependencies

```typescript
// DEPENDENCIES this component requires (NEVER stubbed in integration):
interface Dependencies {
  hookPlanner: HookPlanner;     // Real dependency, injected
  hookRunner: HookRunner;       // Real dependency, injected
  hookAggregator: HookAggregator; // Real dependency, injected
  hookTranslator: HookTranslator;  // Used for model payload translation
}
```

### Anti-Pattern Warnings

```
[ERROR] DO NOT: return EMPTY_SUCCESS_RESULT from catch blocks
[OK]    DO:     return buildFailureEnvelope(error, stage, meta) from ALL catch blocks

[ERROR] DO NOT: return EMPTY_SUCCESS_RESULT by reference from no-match paths
[OK]    DO:     return makeEmptySuccessResult() factory call from no-match paths

[ERROR] DO NOT: use string for eventName in internal routing
[OK]    DO:     use HookEventName enum throughout internal logic

[ERROR] DO NOT: call config.getTargetDir() for cwd
[OK]    DO:     call config.getWorkingDir() for cwd
```

---

## Pseudocode

### Constructor / Initialization

```
10: METHOD constructor(config, hookRegistry, planner, runner, aggregator, messageBus?, debugLogger?)
11:   STORE config as this.config
12:   STORE hookRegistry as this.hookRegistry
13:   STORE planner as this.planner
14:   STORE runner as this.runner
15:   STORE aggregator as this.aggregator
16:   STORE messageBus as this.messageBus (may be undefined)
17:   STORE debugLogger as this.debugLogger (may be undefined)
18:   IF messageBus IS NOT undefined
19:     SUBSCRIBE to messageBus channel 'HOOK_EXECUTION_REQUEST'
20:     STORE subscription handle as this.subscriptionHandle
21:   END IF
22: END METHOD
```

### dispose()

```
30: METHOD dispose()
31:   IF this.subscriptionHandle IS NOT undefined
32:     UNSUBSCRIBE this.subscriptionHandle from messageBus
33:     SET this.subscriptionHandle = undefined
34:   END IF
35:   // If no MessageBus was injected, this is a no-op
36: END METHOD
```

### buildBaseInput()

```
40: METHOD buildBaseInput() -> BaseHookInput
41:   GET sessionId FROM config.getSessionId() (or equivalent)
42:   GET cwd FROM config.getWorkingDir()   // NOT getTargetDir()
43:   GET timestamp = new Date().toISOString()
44:   SET transcript_path = '' // placeholder until separately implemented
45:   RETURN { session_id, cwd, hook_event_name: '', timestamp, transcript_path }
46:   // Callers set hook_event_name after calling this
47: END METHOD
```

### makeEmptySuccessResult()

```
50: FUNCTION makeEmptySuccessResult() -> AggregatedHookResult
51:   RETURN spread copy of EMPTY_SUCCESS_RESULT constant
52:   // NEVER return the constant by reference
53: END FUNCTION
```

### buildFailureEnvelope()

```
60: FUNCTION buildFailureEnvelope(error: unknown, stage: string, meta?: FailureMeta) -> AggregatedHookResult
61:   EXTRACT message FROM error (if Error instance use error.message, else stringify)
62:   SET normalizedError = { stage, message, details: error }
63:   IF meta.eventName EXISTS
64:     ADD meta.eventName to normalizedError
65:   END IF
66:   IF meta.correlationId EXISTS
67:     ADD meta.correlationId to normalizedError
68:   END IF
69:   RETURN {
70:     success: false,
71:     allOutputs: [],
72:     errors: [normalizedError],
73:     totalDuration: 0,
74:     hookResults: []
75:   }
76: END FUNCTION
```

### executeHooksCore() — shared execution routine

```
80: METHOD executeHooksCore(eventName: HookEventName, input: Record<string, unknown>) -> AggregatedHookResult
81:   BEGIN try
82:     CALL planner.createPlan(eventName, input) -> executionPlan
83:     IF executionPlan.hooks IS EMPTY
84:       RETURN makeEmptySuccessResult()    // Line 50-52: deterministic no-op
85:     END IF
86:     CALL runner.execute(executionPlan) -> hookResults
87:     CALL aggregator.aggregate(hookResults) -> aggregatedResult
88:     CALL processCommonHookOutputFields(aggregatedResult) -> processedResult
89:     CALL emitPerHookLogs(eventName, hookResults)    // Line 170-195: per-hook logging
90:     CALL emitBatchSummary(eventName, hookResults)   // Line 200-215: batch summary
91:     RETURN aggregatedResult                          // callers may access processedResult fields
92:   CATCH error
93:     CALL buildFailureEnvelope(error, 'execution', { eventName }) // Line 60-75
94:     RETURN failure envelope
95:   END try
96: END METHOD
```

### processCommonHookOutputFields()

```
100: FUNCTION processCommonHookOutputFields(aggregated: AggregatedHookResult) -> ProcessedHookResult
101:   SET shouldStop = false
102:   SET stopReason = undefined
103:   SET systemMessage = undefined
104:   SET suppressOutput = false
105:
106:   FOR EACH output IN aggregated.allOutputs
107:     IF output.shouldStopExecution() IS true
108:       SET shouldStop = true
109:       SET stopReason = output.getEffectiveReason() (normalized)
110:       BREAK  // First stop intent wins (or accumulate if needed)
111:     END IF
112:   END FOR
113:
114:   FOR EACH output IN aggregated.allOutputs
115:     IF output.systemMessage IS NOT undefined
116:       SET systemMessage = output.systemMessage
117:       IF output.suppressOutput IS true
118:         SET suppressOutput = true
119:       END IF
120:     END IF
121:   END FOR
122:
123:   RETURN {
124:     aggregated,
125:     shouldStop,
126:     stopReason,
127:     systemMessage,
128:     suppressOutput
129:   }
130: END FUNCTION
```

### Direct path: fire*Event methods

```
140: METHOD fireBeforeToolEvent(params: { toolName: string; toolInput: Record<string, unknown> }) -> AggregatedHookResult
141:   BEGIN try
142:     GET base = buildBaseInput()                 // Line 40-46
143:     SET base.hook_event_name = HookEventName.BeforeTool
144:     BUILD input = merge(base, { tool_name: params.toolName, tool_input: params.toolInput })
145:     // BeforeTool: no model translation needed
146:     CALL executeHooksCore(HookEventName.BeforeTool, input)  // Line 80-95
147:     RETURN result
148:   CATCH error
149:     RETURN buildFailureEnvelope(error, 'fireBeforeToolEvent', { eventName: HookEventName.BeforeTool })
150:   END try
151: END METHOD

155: METHOD fireBeforeModelEvent(params: { modelRequest: Record<string, unknown> }) -> AggregatedHookResult
156:   BEGIN try
157:     GET base = buildBaseInput()
158:     SET base.hook_event_name = HookEventName.BeforeModel
159:     BUILD raw input = merge(base, { model_request: params.modelRequest })
160:     CALL hookTranslator.translateBeforeModel(raw input) -> translatedInput  // Line 220-235
161:     IF translation failed
162:       RETURN buildFailureEnvelope(translationError, 'translation', { eventName: HookEventName.BeforeModel })
163:     END IF
164:     CALL executeHooksCore(HookEventName.BeforeModel, translatedInput)  // Line 80-95
165:     RETURN result
166:   CATCH error
167:     RETURN buildFailureEnvelope(error, 'fireBeforeModelEvent', { eventName: HookEventName.BeforeModel })
168:   END try
169: END METHOD

// fireAfterModelEvent and fireBeforeToolSelectionEvent follow same pattern as fireBeforeModelEvent (lines 155-169)
// fireAfterToolEvent, fireBeforeAgentEvent, fireAfterAgentEvent, fireSessionStartEvent,
// fireSessionEndEvent, fireNotificationEvent follow same pattern as fireBeforeToolEvent (lines 140-151)
// NOTE: fireSessionStartEvent uses SessionStartSource enum; fireSessionEndEvent uses SessionEndReason enum
```

### Mediated path: handleHookExecutionRequest()

```
250: METHOD handleHookExecutionRequest(rawMessage: unknown) -> void
251:   GET correlationId = extractCorrelationId(rawMessage) OR crypto.randomUUID()  // Line 260-270
252:   BEGIN try
253:     VALIDATE rawMessage has eventName, input fields -> requestIsValid  // Line 280-295
254:     IF NOT requestIsValid
255:       PUBLISH buildFailedResponse(correlationId, 'invalid_request', 'Request missing required fields')
256:       RETURN
257:     END IF
258:
259:     GET eventName FROM rawMessage (as HookEventName)
260:     VALIDATE eventName IS IN HookEventName enum -> eventIsSupported  // Line 300-315
261:     IF NOT eventIsSupported
262:       PUBLISH buildFailedResponse(correlationId, 'unsupported_event', 'Unsupported event name')
263:       RETURN
264:     END IF
265:
266:     GET input FROM rawMessage.input
267:     CALL validateEventPayload(eventName, input) -> payloadIsValid  // Line 320-360
268:     IF NOT payloadIsValid
269:       PUBLISH buildFailedResponse(correlationId, 'validation_failure', 'Invalid payload for event')
270:       RETURN
271:     END IF
272:
273:     IF eventName IN [BeforeModel, AfterModel, BeforeToolSelection]
274:       CALL translateModelPayload(eventName, input) -> translatedInput  // Line 370-395
275:       IF translation failed
276:         PUBLISH buildFailedResponse(correlationId, 'translation_failure', 'Translation error', details)
277:         RETURN
278:       END IF
279:       SET input = translatedInput
280:     END IF
281:
282:     CALL executeHooksCore(eventName, input)  // Line 80-95
283:     PUBLISH buildSuccessResponse(correlationId, result)  // Line 400-415
284:   CATCH error
285:     PUBLISH buildFailedResponse(correlationId, 'internal_error', error.message)
286:   END try
287: END METHOD
```

### extractCorrelationId()

```
260: FUNCTION extractCorrelationId(rawMessage: unknown) -> string
261:   IF rawMessage IS object AND rawMessage.correlationId IS string AND NOT EMPTY
262:     RETURN rawMessage.correlationId
263:   END IF
264:   RETURN crypto.randomUUID()
265: END FUNCTION
```

### validateEventPayload() — routing switch

```
320: FUNCTION validateEventPayload(eventName: HookEventName, input: unknown) -> boolean
321:   SWITCH ON eventName
322:     CASE BeforeTool:      RETURN validateBeforeToolInput(input)        // type predicate
323:     CASE AfterTool:       RETURN validateAfterToolInput(input)
324:     CASE BeforeAgent:     RETURN validateBeforeAgentInput(input)
325:     CASE AfterAgent:      RETURN validateAfterAgentInput(input)
326:     CASE BeforeModel:     RETURN validateBeforeModelInput(input)
327:     CASE AfterModel:      RETURN validateAfterModelInput(input)
328:     CASE BeforeToolSelection: RETURN validateBeforeToolSelectionInput(input)
329:     CASE Notification:    RETURN validateNotificationInput(input)
330:     DEFAULT:              RETURN false  // unsupported events fail validation
331:   END SWITCH
332: END FUNCTION
```

### emitPerHookLogs()

```
370: METHOD emitPerHookLogs(eventName: HookEventName, hookResults: HookResult[])
371:   IF this.debugLogger IS undefined
372:     RETURN  // logging is optional
373:   END IF
374:   FOR EACH result IN hookResults
375:     BUILD logRecord = {
376:       eventName: eventName,
377:       hookName: result.hookName OR result.hookType,
378:       duration: result.durationMs,
379:       success: result.success,
380:       exitCode: result.exitCode,
381:       stdout: result.stdout,
382:       stderr: result.stderr,
383:       errorMessage: result.error?.message IF NOT result.success
384:     }
385:     CALL this.debugLogger.log('hook:result', logRecord)
386:     IF NOT result.success
387:       CALL this.debugLogger.log('hook:failure', { ...logRecord, error: result.error })
388:     END IF
389:   END FOR
390: END METHOD
```

### emitBatchSummary()

```
400: METHOD emitBatchSummary(eventName: HookEventName, hookResults: HookResult[])
401:   IF this.debugLogger IS undefined
402:     RETURN  // logging is optional
403:   END IF
404:   COMPUTE totalHooks = hookResults.length
405:   COMPUTE successCount = COUNT WHERE result.success IS true
406:   COMPUTE failureCount = totalHooks - successCount
407:   COMPUTE totalDuration = SUM of result.durationMs
408:   BUILD summary = { eventName, totalHooks, successCount, failureCount, totalDuration }
409:   CALL this.debugLogger.log('hook:batch_summary', summary)
410: END METHOD
```

### buildSuccessResponse() / buildFailedResponse()

```
420: FUNCTION buildSuccessResponse(correlationId: string, output: AggregatedHookResult) -> HookExecutionResponse
421:   RETURN { correlationId, success: true, output }
422: END FUNCTION

425: FUNCTION buildFailedResponse(correlationId: string, code: string, message: string, details?: unknown) -> HookExecutionResponse
426:   RETURN { correlationId, success: false, error: { code, message, details } }
427: END FUNCTION
```
