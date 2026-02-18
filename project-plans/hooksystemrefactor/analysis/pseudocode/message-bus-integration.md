# Pseudocode: MessageBus Integration

**Plan ID**: PLAN-20250218-HOOKSYSTEM
**Component**: MessageBus integration wiring in HookSystem + HookEventHandler
**Referenced By**: Phase P08 (messagebus impl)

---

## Interface Contracts

### Inputs

```typescript
// INPUTS this component receives (at subscription time):
interface InboundBusMessage {
  type: 'HOOK_EXECUTION_REQUEST';
  payload: HookExecutionRequest;
}

// OUTPUTS this component produces (published to bus):
interface OutboundBusMessage {
  type: 'HOOK_EXECUTION_RESPONSE';
  payload: HookExecutionResponse;
}
```

### Dependencies

```typescript
// DEPENDENCIES (real, injected):
interface MessageBusIntegrationDeps {
  messageBus: MessageBus;          // real; provides subscribe/publish
  hookEventHandler: HookEventHandler; // real; handles routing + execution
}
```

### Anti-Pattern Warnings

```
[ERROR] DO NOT: throw from the subscription handler — always publish failure response
[OK]    DO:     catch all errors in handleHookExecutionRequest and publish failure

[ERROR] DO NOT: create multiple subscriptions for the same handler instance
[OK]    DO:     subscribe once at constructor time, store handle, unsubscribe in dispose()

[ERROR] DO NOT: process messages after dispose() is called
[OK]    DO:     check disposal state at start of message handler

[ERROR] DO NOT: publish response without correlationId
[OK]    DO:     always echo correlationId (generate one if absent)
```

---

## Pseudocode

### HookSystem: wire MessageBus dependency

```
10: METHOD HookSystem.constructor(config, hooks, messageBus?, debugLogger?)
11:   STORE config, hooks, messageBus, debugLogger
12:   INSTANTIATE hookRegistry = new HookRegistry(hooks)
13:   INSTANTIATE hookPlanner = new HookPlanner(hookRegistry)
14:   INSTANTIATE hookRunner = new HookRunner()
15:   INSTANTIATE hookAggregator = new HookAggregator()
16:   INSTANTIATE hookEventHandler = new HookEventHandler(
17:     config,
18:     hookRegistry,
19:     hookPlanner,
20:     hookRunner,
21:     hookAggregator,
22:     messageBus,    // passed through; may be undefined
23:     debugLogger    // passed through; may be undefined
24:   )
25:   STORE hookEventHandler as this.eventHandler
26: END METHOD
```

### HookSystem: expose management APIs

```
30: METHOD HookSystem.setHookEnabled(hookId: string, enabled: boolean) -> void
31:   CALL this.hookRegistry.setEnabled(hookId, enabled)
32: END METHOD

35: METHOD HookSystem.getAllHooks() -> HookDefinition[]
36:   RETURN this.hookRegistry.getAll()
37: END METHOD
```

### HookSystem: teardown

```
40: METHOD HookSystem.dispose() -> void
41:   IF this.eventHandler EXISTS
42:     CALL this.eventHandler.dispose()  // unsubscribes from bus
43:   END IF
44: END METHOD
```

### HookEventHandler: subscription setup

```
50: METHOD HookEventHandler.constructor(... messageBus?, ...)
51:   // (other init from hook-event-handler.md lines 10-21)
52:   IF messageBus IS NOT undefined
53:     SET this.isDisposed = false
54:     CALL messageBus.subscribe('HOOK_EXECUTION_REQUEST', this.onBusRequest.bind(this))
55:     STORE returned subscription handle as this.busSubscription
56:   END IF
57: END METHOD
```

### HookEventHandler: message handler

```
60: METHOD HookEventHandler.onBusRequest(rawMessage: unknown) -> Promise<void>
61:   IF this.isDisposed IS true
62:     // silently ignore messages after disposal
63:     RETURN
64:   END IF
65:
66:   // Extract correlation ID first (needed for all response paths)
67:   GET correlationId = extractCorrelationId(rawMessage)  // hook-event-handler.md lines 260-264
68:
69:   BEGIN try
70:     VALIDATE rawMessage structure
71:     IF rawMessage.eventName IS NOT defined OR rawMessage.input IS NOT defined
72:       PUBLISH failure response { correlationId, code: 'invalid_request', message: 'Missing eventName or input' }
73:       RETURN
74:     END IF
75:
76:     // Delegate to shared routing + execution logic
77:     GET result = AWAIT routeAndExecuteMediated(rawMessage.eventName, rawMessage.input, correlationId)
78:     PUBLISH success response { correlationId, success: true, output: result }
79:   CATCH error
80:     PUBLISH failure response { correlationId, code: 'internal_error', message: error.message }
81:   END try
82: END METHOD
```

### HookEventHandler: routeAndExecuteMediated()

```
90: METHOD routeAndExecuteMediated(eventName: unknown, input: unknown, correlationId: string) -> AggregatedHookResult
91:   // Step 1: validate eventName is a known HookEventName enum value
92:   IF eventName NOT IN HookEventName enum values
93:     THROW { code: 'unsupported_event', message: 'Unknown event: ' + eventName }
94:     // caller in onBusRequest will catch and publish failure
95:   END IF
96:
97:   // Step 2: validate event-specific payload (type predicate)
98:   CALL validateEventPayload(eventName AS HookEventName, input)  // hook-event-handler.md lines 320-331
99:   IF validation failed
100:    THROW { code: 'validation_failure', message: 'Invalid payload for ' + eventName }
101:  END IF
102:
103:  // Step 3: translate model payloads if needed
104:  IF eventName IN [BeforeModel, AfterModel, BeforeToolSelection]
105:    CALL translateModelPayload(eventName, input) -> translatedInput  // message-bus-integration.md lines 140-165
106:    IF translation failed
107:      THROW { code: 'translation_failure', message: 'Translation error', details: translationError }
108:    END IF
109:    SET input = translatedInput
110:  END IF
111:
112:  // Step 4: execute hooks through shared core
113:  CALL executeHooksCore(eventName AS HookEventName, input AS Record<string, unknown>)
114:  RETURN result
115: END METHOD
```

### MessageBus publish helper

```
120: METHOD publishResponse(response: HookExecutionResponse) -> void
121:   CALL this.messageBus.publish('HOOK_EXECUTION_RESPONSE', response)
122:   // Fire-and-forget; publication errors are logged but not re-thrown
123:   // The HookEventHandler must not throw across the bus boundary
124: END METHOD
```

### HookEventHandler: dispose()

```
130: METHOD HookEventHandler.dispose() -> void
131:   SET this.isDisposed = true
132:   IF this.busSubscription IS NOT undefined
133:     CALL this.messageBus.unsubscribe(this.busSubscription)
134:     SET this.busSubscription = undefined
135:   END IF
136:   // After dispose(), onBusRequest returns immediately (line 61-64)
137: END METHOD
```

### Model payload translation routing

```
140: METHOD translateModelPayload(eventName: HookEventName, input: Record<string, unknown>) -> Record<string, unknown>
141:   SWITCH ON eventName
142:     CASE BeforeModel:
143:       EXTRACT model_request FROM input
144:       CALL hookTranslator.translateBeforeModelRequest(model_request) -> hookLlmRequest
145:       RETURN MERGE(input, { llm_request: hookLlmRequest })
146:
147:     CASE AfterModel:
148:       EXTRACT model_request FROM input
149:       EXTRACT model_response FROM input
150:       CALL hookTranslator.translateAfterModelRequest(model_request) -> hookLlmRequest
151:       CALL hookTranslator.translateAfterModelResponse(model_response) -> hookLlmResponse
152:       RETURN MERGE(input, { llm_request: hookLlmRequest, llm_response: hookLlmResponse })
153:
154:     CASE BeforeToolSelection:
155:       EXTRACT model_request FROM input
156:       CALL hookTranslator.translateBeforeToolSelectionRequest(model_request) -> hookLlmRequest
157:       RETURN MERGE(input, { llm_request: hookLlmRequest })
158:
159:     DEFAULT:
160:       RETURN input  // no translation needed
161:   END SWITCH
162: END METHOD
```

---

## Integration Point Notes

```
Line 54: CALL messageBus.subscribe(...)
         - messageBus MUST be injected, not globally imported
         - subscription handle MUST be stored for cleanup

Line 77: AWAIT routeAndExecuteMediated(...)
         - shared with direct path for execution semantics parity
         - any throw from routeAndExecuteMediated is caught at line 79-80

Line 121: CALL this.messageBus.publish(...)
          - MessageBus type must support publish(channel, payload)
          - Return value not awaited (fire-and-forget for response)

Line 133: CALL this.messageBus.unsubscribe(this.busSubscription)
          - unsubscribe signature must match subscribe return type
          - after this call, no further messages reach this handler
```
