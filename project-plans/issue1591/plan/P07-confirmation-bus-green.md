# Phase P07: Confirmation Bus — GREEN Implementation

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Implementation
Prerequisites: P06a (confirmation bus RED tests verified)

## Purpose

Replace P03b skeleton stubs with real confirmation bus source files copied from core. Define all policy-owned structural types. Core originals remain untouched. All P06 RED tests must now pass (GREEN state).

## Worker / Verifier Assignment

- **Worker**: typescriptexpert (copies source files, defines policy-owned types)
- **Verifier**: typescriptreviewer (verifies GREEN state in P07a)

## Expanded Requirements

- Define PolicyFunctionCall interface (replaces FunctionCall from @google/genai)
- Define PolicyToolCallState interface (replaces ToolCall from scheduler/types)
- Define ConfirmationOutcome enum (replaces ToolConfirmationOutcome from tools)
- Define ConfirmationPayload interface (replaces ToolConfirmationPayload from tools)
- Make ToolCallsUpdateMessage generic: ToolCallsUpdateMessage<T = unknown>
- Define PolicyLogger interface (injected by core, default no-op)
- MessageBus uses injected PolicyLogger instead of importing debugLogger
- All imports within policy package use relative paths only
- Zero imports from `@vybestack/llxprt-code-core`, `@google/genai`, `@vybestack/llxprt-code-telemetry`
- **COPY** (not move) source files from core. Core originals remain intact until P10d.

## @plan / @requirement Marker Requirements

Every function/class/module created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P07
 * @requirement REQ-003.1
 */
```

Marker mapping:
- `confirmation-bus/types.ts`: `@requirement REQ-003.1`–`REQ-003.6`
- `confirmation-bus/message-bus.ts`: `@requirement REQ-003.7`
- `confirmation-bus/index.ts`: `@requirement REQ-003.8`
- `src/index.ts` updates: `@requirement REQ-005.1`

## Exact File Tasks

| File | Action | Description |
|------|--------|-------------|
| `packages/policy/src/confirmation-bus/types.ts` | CREATE | All message types, enums, interfaces, PolicyFunctionCall, PolicyToolCallState, PolicyLogger |
| `packages/policy/src/confirmation-bus/message-bus.ts` | COPY from `core/src/confirmation-bus/message-bus.ts` | Update imports to relative, inject PolicyLogger. Core original untouched. |
| `packages/policy/src/confirmation-bus/index.ts` | CREATE | Barrel export with backward-compat aliases |
| `packages/policy/src/index.ts` | UPDATE | Add confirmation-bus exports |

### Exact Type Definitions (From Current Source — Copy These Exactly)

**`PolicyFunctionCall`** (replaces `FunctionCall` from `@google/genai`):
```typescript
export interface PolicyFunctionCall {
  /** The unique id of the function call. */
  id?: string;
  /** The function parameters and values in JSON object format. */
  args?: Record<string, unknown>;
  /** The name of the function to call. */
  name?: string;
}
```
Note: `partialArgs` and `willContinue` from the full `FunctionCall` are omitted — confirmation-bus only uses `name`, `args`, and `id`.

**`PolicyToolCallState`** (replaces `ToolCall` discriminated union):
```typescript
export interface PolicyToolCallState {
  status: string;
  request: { functionCall?: PolicyFunctionCall; [key: string]: unknown };
  [key: string]: unknown;
}
```
Minimal structural type. The full `ToolCall` is a discriminated union of 7 variants (`ValidatingToolCall | ScheduledToolCall | ...`), each with `status`, `request`, `tool`, `invocation`, etc. Policy only needs `status` and `request.functionCall`.

**`ConfirmationOutcome`** (replaces `ToolConfirmationOutcome`):
```typescript
export enum ConfirmationOutcome {
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAlwaysAndSave = 'proceed_always_and_save',
  ProceedAlwaysServer = 'proceed_always_server',
  ProceedAlwaysTool = 'proceed_always_tool',
  ModifyWithEditor = 'modify_with_editor',
  SuggestEdit = 'suggest_edit',
  Cancel = 'cancel',
}
```
Exact 1:1 copy of current `ToolConfirmationOutcome` values.

**`ConfirmationPayload`** (replaces `ToolConfirmationPayload`):
```typescript
export interface ConfirmationPayload {
  newContent?: string;
  editedCommand?: string;
}
```
Exact 1:1 copy of current `ToolConfirmationPayload`.

### Import Updates for Copied Files

**confirmation-bus/types.ts:**
```
REMOVE: import { FunctionCall } from '@google/genai'
ADD: interface PolicyFunctionCall { id?: string; name?: string; args?: Record<string, unknown> }
REMOVE: import { ToolConfirmationOutcome, ToolConfirmationPayload } from '../tools/tool-confirmation-types.js'
ADD: enum ConfirmationOutcome { ... } (all 8 values)
ADD: interface ConfirmationPayload { newContent?: string; editedCommand?: string }
REMOVE: import { ToolCall } from '../scheduler/types.js'
ADD: interface PolicyToolCallState { status: string; request: { functionCall?: PolicyFunctionCall; [key: string]: unknown }; [key: string]: unknown }
CHANGE: ToolCallsUpdateMessage → ToolCallsUpdateMessage<T = unknown>
ADD: interface PolicyLogger { debug(...args: unknown[]): void; error(...args: unknown[]): void }
ADD: interface PolicyPathResolver { getUserPoliciesDir(): string; getSystemPoliciesDir(): string }
```

**confirmation-bus/message-bus.ts:**
```
CHANGE: import from '../policy/policy-engine.js' → '../policy-engine.js'
CHANGE: import from '../policy/types.js' → '../types.js'
REMOVE: import { FunctionCall } from '@google/genai' → USE PolicyFunctionCall from ./types.js
REMOVE: import from '../tools/tool-confirmation-types.js' → USE ConfirmationOutcome from ./types.js
REMOVE: import { debugLogger } from '../utils/debugLogger.js'
ADD: constructor parameter: logger?: PolicyLogger (default no-op)
REPLACE: all debugLogger calls → this.logger calls
```

**confirmation-bus/index.ts:**
```
EXPORT all types from './types.js'
EXPORT { MessageBus } from './message-bus.js'
EXPORT { ConfirmationOutcome as ToolConfirmationOutcome } from './types.js'
EXPORT { type ConfirmationPayload as ToolConfirmationPayload } from './types.js'
```

## Verification Commands

```bash
# 1. All P06 tests must now PASS (GREEN)
npm run test --workspace @vybestack/llxprt-code-policy
# Expected: ALL tests pass

# 2. Zero forbidden imports in production code — use rg --glob
rg "from.*@vybestack/llxprt-code-core|from.*@google/genai|from.*@vybestack/llxprt-code-telemetry" packages/policy/src/confirmation-bus --type ts -g '!*.test.ts'
# Expected: zero matches

# 3. Verify PolicyFunctionCall is defined (not imported from @google/genai)
rg "interface PolicyFunctionCall" packages/policy/src/confirmation-bus/types.ts
# Expected: 1 match

# 4. Verify ToolCallsUpdateMessage is generic
rg "ToolCallsUpdateMessage<" packages/policy/src/confirmation-bus/types.ts
# Expected: 1 match (shows <T = unknown>)

# 5. Verify PolicyLogger interface
rg "interface PolicyLogger" packages/policy/src/confirmation-bus/types.ts
# Expected: 1 match

# 6. Verify ConfirmationOutcome (not ToolConfirmationOutcome in policy source)
rg "ToolConfirmationOutcome" packages/policy/src/confirmation-bus --type ts -g '!*.test.ts'
# Expected: only in backward-compat alias export line

# 7. Build verification
npm run build --workspace @vybestack/llxprt-code-policy
npm run typecheck --workspace @vybestack/llxprt-code-policy

# 8. Verify @plan markers
rg "@plan.*PLAN-20260609-ISSUE1591\.P07" packages/policy/src/confirmation-bus --type ts -g '!*.test.ts' --count
# Expected: 3+ files (types.ts, message-bus.ts, index.ts)
```

## Success Criteria

- [ ] All P06 tests pass (GREEN state achieved)
- [ ] Zero forbidden imports in confirmation-bus production code
- [ ] PolicyFunctionCall defined locally (no @google/genai dependency)
- [ ] PolicyToolCallState defined locally (no scheduler dependency)
- [ ] ConfirmationOutcome defined locally (no tool-confirmation-types dependency)
- [ ] ToolCallsUpdateMessage<T = unknown> is generic
- [ ] PolicyLogger interface defined, MessageBus accepts optional injection
- [ ] Backward-compat aliases present in confirmation-bus/index.ts
- [ ] Package builds and typechecks successfully
- [ ] @plan markers present in all production files
- [ ] @requirement markers map to REQ-003, REQ-005

## Failure Recovery

1. If tests still fail — identify failing test, fix source (not test)
2. If forbidden import found — replace with local definition or injected interface
3. If build fails — check import paths in moved files
4. Targeted revert: `git checkout -- packages/policy/src/confirmation-bus/<specific-file>`
5. Do NOT use broad `rm -rf` or `git checkout -- packages/`
