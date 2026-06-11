# Pseudocode: Confirmation Bus Extraction

## Component: Moving confirmation bus to packages/policy/src/confirmation-bus/

### Interface Contracts

```typescript
// INPUTS: Source files from packages/core/src/confirmation-bus/ and tools/tool-confirmation-types.ts
// OUTPUTS: Self-contained confirmation bus with NO core/telemetry/provider deps
// DEPENDENCIES (resolved within package):
//   types.ts → PolicyFunctionCall (local), ConfirmationOutcome/Payload (local)
//   message-bus.ts → types.ts, policy-engine.ts, PolicyLogger (injected interface)
```

### Pseudocode

```
# --- confirmation-bus/types.ts (CREATE, adapted) ---
10: CREATE packages/policy/src/confirmation-bus/types.ts
11: COPY MessageBusType enum (all 11 values unchanged)
12: COPY all message interfaces:
13:   ToolConfirmationRequest, ToolConfirmationResponse, ToolPolicyRejection
14:   ToolExecutionSuccess, ToolExecutionFailure, UpdatePolicy
15:   BucketAuthConfirmationRequest, BucketAuthConfirmationResponse
16:   HookExecutionRequest, HookExecutionResponse
17:   SerializableConfirmationDetails (union type)
18:   MessageBusMessage (discriminated union)

# --- ConfirmationOutcome enum (MOVE from tools/tool-confirmation-types.ts) ---
20: MOVE enum from ToolConfirmationOutcome → ConfirmationOutcome
21:   KEEP all 8 values: ProceedOnce, ProceedAlways, ProceedAlwaysAndSave,
22:   ProceedAlwaysServer, ProceedAlwaysTool, ModifyWithEditor, SuggestEdit, Cancel
23: RENAME: ToolConfirmationOutcome → ConfirmationOutcome

# --- ConfirmationPayload interface (MOVE from tools/tool-confirmation-types.ts) ---
30: MOVE interface from ToolConfirmationPayload → ConfirmationPayload
31:   KEEP fields: newContent?, editedCommand?
32: RENAME: ToolConfirmationPayload → ConfirmationPayload

# --- ToolCallsUpdateMessage (MAKE GENERIC) ---
40: CHANGE interface ToolCallsUpdateMessage to ToolCallsUpdateMessage<T = unknown>
41:   CHANGE field: readonly toolCalls: readonly ToolCall[]
42:   TO: readonly toolCalls: readonly T[]
43: REMOVE import: from '../scheduler/types.js' (ToolCall type)

# --- Update MessageBusMessage union ---
50: UPDATE MessageBusMessage to use ToolCallsUpdateMessage (with default T=unknown)

# --- Remove all core/external imports ---
60: REMOVE import: from '../tools/tool-confirmation-types.js'
61: REMOVE import: from '../scheduler/types.js'
62: REMOVE import: from '@google/genai' — FORBIDDEN
63: ADD import: PolicyFunctionCall interface defined locally in types.ts

# --- confirmation-bus/message-bus.ts (MOVE, update imports) ---
70: MOVE packages/core/src/confirmation-bus/message-bus.ts
71:   → packages/policy/src/confirmation-bus/message-bus.ts
72: CHANGE import from '../policy/policy-engine.js' → '../policy-engine.js'
73: CHANGE import from '../policy/types.js' → '../types.js'
74: CHANGE import from './types.js' → stays './types.js'
75: CHANGE import { ToolConfirmationOutcome, type ToolConfirmationPayload }
76:   FROM '../tools/tool-confirmation-types.js'
77:   TO './types.js' (ConfirmationOutcome, ConfirmationPayload)
78: CHANGE import { debugLogger } from '../utils/debugLogger.js'
79:   TO: accept PolicyLogger interface in constructor (optional, default no-op)
80:   DEFINE interface PolicyLogger { debug(...args: unknown[]): void; error(...args: unknown[]): void; }
81:   MessageBus constructor: constructor(policyEngine, logger?: PolicyLogger)
82:   DEFAULT logger to no-op: { debug: () => {}, error: () => {} }
82: UPDATE references: ToolConfirmationOutcome → ConfirmationOutcome
83: UPDATE references: ToolConfirmationPayload → ConfirmationPayload

# --- confirmation-bus/index.ts (CREATE) ---
90: CREATE packages/policy/src/confirmation-bus/index.ts
91: EXPORT all types from './types.js'
92: EXPORT { MessageBus } from './message-bus.js'
93: ADD backward-compat aliases:
94:   EXPORT { ConfirmationOutcome as ToolConfirmationOutcome } from './types.js'
95:   EXPORT { ConfirmationPayload as ToolConfirmationPayload } from './types.js'
```

### Integration Points

- Line 72-73: message-bus.ts now imports PolicyEngine from sibling module (same package)
- Line 78-81: PolicyLogger injection replaces debugLogger import from core/telemetry
- Line 40-42: Generic ToolCallsUpdateMessage allows core to provide concrete ToolCall type

### Anti-Pattern Warnings

```
[ERROR] DO NOT: Import from '../tools/tool-confirmation-types.js'
[OK] DO: Define ConfirmationOutcome/ConfirmationPayload locally in types.ts

[ERROR] DO NOT: Import from '../scheduler/types.js' for ToolCall
[OK] DO: Use generic <T = unknown> for ToolCallsUpdateMessage

[ERROR] DO NOT: Import debugLogger from core's utils/debugLogger.js
[ERROR] DO NOT: Import debugLogger from @vybestack/llxprt-code-telemetry
[OK] DO: Accept optional PolicyLogger interface in MessageBus constructor (default no-op)

[ERROR] DO NOT: Import FunctionCall from @google/genai
[OK] DO: Define PolicyFunctionCall interface locally

[ERROR] DO NOT: Forget backward-compat aliases in index.ts
[OK] DO: Export ConfirmationOutcome AS ToolConfirmationOutcome
```
