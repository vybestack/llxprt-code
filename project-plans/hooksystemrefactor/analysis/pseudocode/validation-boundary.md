# Pseudocode: Validation Boundary

**Plan ID**: PLAN-20250218-HOOKSYSTEM
**Component**: hookValidators.ts (new) + validation integration in HookEventHandler
**Referenced By**: Phase P11 (validation impl)

---

## Interface Contracts

### Inputs

```typescript
// INPUTS this component receives:
type ValidatorInput = unknown;  // raw untyped input from MessageBus

// OUTPUTS this component produces:
// true + type narrowing (input is T) when valid
// false when invalid (no type narrowing)
```

### Dependencies

```typescript
// DEPENDENCIES:
interface ValidatorDeps {
  // Pure functions — no dependencies
  // Each validator is a standalone type predicate
}
```

### Anti-Pattern Warnings

```
[ERROR] DO NOT: return plain boolean without type predicate
[OK]    DO:     use TypeScript type predicate syntax: (input: unknown): input is T

[ERROR] DO NOT: throw on validation failure — validators return boolean
[OK]    DO:     return false; caller handles failure by returning buildFailureEnvelope

[ERROR] DO NOT: validate on the direct path (fire*Event)
[OK]    DO:     validation runs only at mediated ingress before planning/execution

[ERROR] DO NOT: reject inputs with extra/unknown fields
[OK]    DO:     tolerate extra fields; validate only required structural invariants
```

---

## Pseudocode

### Shared validation primitive

```
10: FUNCTION isObject(value: unknown) -> value is Record<string, unknown>
11:   RETURN value IS NOT null AND typeof value IS 'object' AND NOT Array.isArray(value)
12: END FUNCTION

15: FUNCTION isNonEmptyString(value: unknown) -> value is string
16:   RETURN typeof value IS 'string' AND value.trim().length > 0
17: END FUNCTION
```

### validateBeforeToolInput()

```
20: FUNCTION validateBeforeToolInput(input: unknown): input is BeforeToolInput
21:   IF NOT isObject(input)
22:     RETURN false
23:   END IF
24:   IF NOT isNonEmptyString((input as any).tool_name)
25:     RETURN false    // tool_name is required and must be non-empty string
26:   END IF
27:   IF NOT isObject((input as any).tool_input)
28:     RETURN false    // tool_input must be an object (may be empty)
29:   END IF
30:   RETURN true       // type narrowed to BeforeToolInput
31: END FUNCTION
```

### validateAfterToolInput()

```
35: FUNCTION validateAfterToolInput(input: unknown): input is AfterToolInput
36:   IF NOT isObject(input)
37:     RETURN false
38:   END IF
39:   IF NOT isNonEmptyString((input as any).tool_name)
40:     RETURN false
41:   END IF
42:   IF NOT isObject((input as any).tool_input)
43:     RETURN false
44:   END IF
45:   // tool_response: any type is acceptable, must be present
46:   IF (input as any).tool_response IS undefined
47:     RETURN false
48:   END IF
49:   RETURN true
50: END FUNCTION
```

### validateBeforeAgentInput()

```
55: FUNCTION validateBeforeAgentInput(input: unknown): input is BeforeAgentInput
56:   IF NOT isObject(input)
57:     RETURN false
58:   END IF
59:   // BeforeAgent requires base context fields to be present
60:   // Additional required fields defined in types.ts BeforeAgentInput interface
61:   RETURN true       // minimal validation: accept well-formed object
62: END FUNCTION
```

### validateAfterAgentInput()

```
65: FUNCTION validateAfterAgentInput(input: unknown): input is AfterAgentInput
66:   IF NOT isObject(input)
67:     RETURN false
68:   END IF
69:   RETURN true       // minimal validation: accept well-formed object
70: END FUNCTION
```

### validateBeforeModelInput()

```
75: FUNCTION validateBeforeModelInput(input: unknown): input is BeforeModelInput
76:   IF NOT isObject(input)
77:     RETURN false
78:   END IF
79:   IF NOT isObject((input as any).model_request)
80:     RETURN false    // model_request is required for BeforeModel
81:   END IF
82:   RETURN true
83: END FUNCTION
```

### validateAfterModelInput()

```
88: FUNCTION validateAfterModelInput(input: unknown): input is AfterModelInput
89:   IF NOT isObject(input)
90:     RETURN false
91:   END IF
92:   IF NOT isObject((input as any).model_request)
93:     RETURN false    // model_request required
94:   END IF
95:   IF NOT isObject((input as any).model_response)
96:     RETURN false    // model_response required for AfterModel
97:   END IF
98:   RETURN true
99: END FUNCTION
```

### validateBeforeToolSelectionInput()

```
104: FUNCTION validateBeforeToolSelectionInput(input: unknown): input is BeforeToolSelectionInput
105:   IF NOT isObject(input)
106:     RETURN false
107:   END IF
108:   IF NOT isObject((input as any).model_request)
109:     RETURN false    // model_request required
110:   END IF
111:   IF NOT Array.isArray((input as any).available_tools)
112:     RETURN false    // available_tools must be array (may be empty)
113:   END IF
114:   RETURN true
115: END FUNCTION
```

### validateNotificationInput()

```
120: FUNCTION validateNotificationInput(input: unknown): input is NotificationInput
121:   IF NOT isObject(input)
122:     RETURN false
123:   END IF
124:   IF NOT isNonEmptyString((input as any).message)
125:     RETURN false    // message is required
126:   END IF
127:   // level is optional; if present it should be a string
128:   IF (input as any).level IS NOT undefined AND typeof (input as any).level IS NOT 'string'
129:     RETURN false
130:   END IF
131:   RETURN true
132: END FUNCTION
```

### Integration into HookEventHandler: validateEventPayload()

```
140: FUNCTION validateEventPayload(eventName: HookEventName, input: unknown) -> boolean
141:   // This function is typed on HookEventName enum — no raw string
142:   SWITCH ON eventName
143:     CASE HookEventName.BeforeTool:
144:       RETURN validateBeforeToolInput(input)          // lines 20-30
145:     CASE HookEventName.AfterTool:
146:       RETURN validateAfterToolInput(input)           // lines 35-49
147:     CASE HookEventName.BeforeAgent:
148:       RETURN validateBeforeAgentInput(input)         // lines 55-61
149:     CASE HookEventName.AfterAgent:
150:       RETURN validateAfterAgentInput(input)          // lines 65-69
151:     CASE HookEventName.BeforeModel:
152:       RETURN validateBeforeModelInput(input)         // lines 75-82
153:     CASE HookEventName.AfterModel:
154:       RETURN validateAfterModelInput(input)          // lines 88-98
155:     CASE HookEventName.BeforeToolSelection:
156:       RETURN validateBeforeToolSelectionInput(input) // lines 104-114
157:     CASE HookEventName.Notification:
158:       RETURN validateNotificationInput(input)        // lines 120-131
159:     DEFAULT:
160:       RETURN false  // unknown events fail validation
161:   END SWITCH
162: END FUNCTION
```

### Mediated path: validation gate

```
170: SECTION: Validation gate in handleHookExecutionRequest()
171:   // After routing to supported event:
172:   GET input FROM request.input
173:   CALL validateEventPayload(eventName, input)
174:   IF NOT valid
175:     BUILD failure response = {
176:       correlationId,
177:       success: false,
178:       error: {
179:         code: 'VALIDATION_FAILURE',
180:         message: 'Invalid payload for event: ' + eventName,
181:         details: { stage: 'validation', eventName }
182:       }
183:     }
184:     PUBLISH failure response to messageBus
185:     RETURN  // do NOT call executeHooksCore
186:   END IF
187:   // If valid, proceed to translation (if model event) or executeHooksCore
188: END SECTION
```

---

## Error Handling Paths

```
Scenario 1: input is null/undefined
  -> isObject(null) returns false -> validator returns false
  -> Gate at line 174-186 triggers -> failure response published

Scenario 2: input is correct type but missing required field
  -> Specific field check fails -> validator returns false
  -> Gate at line 174-186 triggers -> failure response published

Scenario 3: input has all required fields + extra unknown fields
  -> Required field checks all pass -> validator returns true
  -> Execution proceeds normally (extra fields ignored/tolerated)

Scenario 4: validation succeeds but execution throws
  -> Not a validation concern; caught at executeHooksCore level
```
