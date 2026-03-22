# Playbook: Extract Policy Helpers from Core Tool Scheduler

**Upstream SHA:** `5fe5d1da467`
**Upstream Subject:** policy: extract legacy policy from core tool scheduler to policy engine (#15902)
**Upstream Stats:** ~6 files, moderate insertions/deletions

## What Upstream Does

Upstream moves inline policy helper functions (`getPolicyContextFromInvocation`, `evaluatePolicyDecision`, `handlePolicyDenial`, `publishConfirmationRequest`) out of the monolithic `coreToolScheduler.ts` and into a separate policy utility layer. It also extracts a `shell-permissions.ts` file for shell-specific permission logic.

## Why REIMPLEMENT in LLxprt

1. LLxprt's `coreToolScheduler.ts` has already diverged significantly from upstream — it uses a `PolicyContext` type imported from `packages/core/src/scheduler/types.ts` (line 153) and a separate `PolicyEngine` class in `packages/core/src/policy/policy-engine.ts`.
2. LLxprt already has `packages/core/src/policy/utils.ts` with bounded-regex helpers (`buildArgsPatterns`, `escapeRegex`, `validatePolicyRegex`) that upstream does not have.
3. Upstream introduces `shell-permissions.ts`; LLxprt must NOT reintroduce this file — LLxprt's shell safety logic lives in `packages/core/src/policy/policy-engine.ts` (which already calls `splitCommands` from `shell-utils.ts`).
4. `createErrorResponse` is a file-scoped `const` in `coreToolScheduler.ts` (line 171), used 9 times across the file, and is NOT exported. The extracted `handlePolicyDenial` must construct the error response inline (the shape is a simple object literal at lines 175-193) and accept a `setStatusFn` callback.
5. The beneficial intent — reducing scheduler complexity by extracting policy plumbing — should be adapted to LLxprt's existing policy engine files.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/core/src/core/coreToolScheduler.ts` — `getPolicyContextFromInvocation` at line 1144, `evaluatePolicyDecision` at line 1164, `handlePolicyDenial` at line 1178, `publishConfirmationRequest` at line 1204
- [OK] `packages/core/src/core/coreToolScheduler.ts` — local `type PolicyContext` at line 134 (duplicates the one in `scheduler/types.ts`)
- [OK] `packages/core/src/core/coreToolScheduler.ts` — `createErrorResponse` file-scoped const at line 171 (NOT exported, NOT importable)
- [OK] `packages/core/src/scheduler/types.ts` — `PolicyContext` type at line 153
- [OK] `packages/core/src/policy/policy-engine.ts` — `PolicyEngine.evaluate()` handles rule matching and shell sub-command validation
- [OK] `packages/core/src/policy/types.ts` — `PolicyDecision`, `PolicyRule`, `PolicyEngineConfig`, `PolicySettings` types
- [OK] `packages/core/src/policy/utils.ts` — `escapeRegex`, `buildArgsPatterns`, `validatePolicyRegex`
- [OK] `packages/core/src/policy/index.ts` — Public re-exports from `types`, `policy-engine`, `stable-stringify`, `config`, `toml-loader`

**Must NOT create:**
- `packages/core/src/policy/shell-permissions.ts` — LLxprt handles this through `PolicyEngine.evaluate()` and `shell-utils.ts`

## Files to Modify / Create

### 1. Create: `packages/core/src/policy/policy-helpers.ts`

New file following the **kebab-case** naming convention used by all existing files in `packages/core/src/policy/` (`policy-engine.ts`, `stable-stringify.ts`, `toml-loader.ts`).

Contains the four extracted functions adapted for LLxprt's architecture:

- `getPolicyContextFromInvocation(invocation, request)` → returns `PolicyContext`
  - Imported types: `AnyToolInvocation`, `BaseToolInvocation` from `../tools/tools.js` (direct import, NOT through barrel `../index.js`, to avoid circular dependency — no policy file currently imports tool types via the barrel); `ToolCallRequestInfo` from `../scheduler/types.js`
  - Logic: identical to the private method at line 1144-1162; if `invocation instanceof BaseToolInvocation`, call `invocation.getPolicyContext()` and fill in `toolName` if missing; otherwise return `{toolName: request.name, args: request.args}`

- `evaluatePolicyDecision(invocation, request, policyEngine)` → returns `{decision, context}`
  - Takes `policyEngine: PolicyEngine` as an explicit parameter (was `this.config.getPolicyEngine()`)
  - Calls `getPolicyContextFromInvocation`, then `policyEngine.evaluate(context.toolName, context.args, context.serverName)`

- `handlePolicyDenial(request, context, setStatusFn, messageBus)` → void
  - **No `callId` parameter** — `callId` is already available as `request.callId` (see `ToolCallRequestInfo`).
  - Since `createErrorResponse` is a file-scoped const at line 171 in the scheduler and is used 9 times across the file (not just in the extracted methods), it must NOT be moved out. Instead, `handlePolicyDenial` constructs the error response **inline** (replicating the shape at lines 175-193: `{ callId, error, responseParts: [{ functionResponse: { id, name, response: { error: message } } }], resultDisplay, errorType, agentId }`).
  - Accepts `setStatusFn: (callId: string, status: 'error', response: ToolCallResponseInfo) => void` callback and `messageBus: MessageBus`.
  - Imports: `ToolCallResponseInfo` from `../scheduler/types.js`; `ToolErrorType` from `../index.js` (already re-exported); `MessageBus` from `../confirmation-bus/message-bus.js`; `MessageBusType` from `../confirmation-bus/types.js`; `FunctionCall` from `@google/genai`; `DEFAULT_AGENT_ID` from `../core/turn.js`.
  - `randomUUID` from `node:crypto` (for correlation ID on rejection event).

- `publishConfirmationRequest(correlationId, context, messageBus)` → void
  - Builds `FunctionCall` and publishes `MessageBusType.TOOL_CONFIRMATION_REQUEST`.
  - Imports: `FunctionCall` from `@google/genai`; `MessageBus` from `../confirmation-bus/message-bus.js`; `MessageBusType` from `../confirmation-bus/types.js`.

Import `PolicyContext` from `../scheduler/types.js`; `PolicyDecision` from `./types.js`; `PolicyEngine` from `./policy-engine.js`.


### 2. Modify: `packages/core/src/policy/index.ts`

Add re-export:
```typescript
export {
  getPolicyContextFromInvocation,
  evaluatePolicyDecision,
  handlePolicyDenial,
  publishConfirmationRequest,
} from './policy-helpers.js';
```

### 3. Modify: `packages/core/src/core/coreToolScheduler.ts`

- Remove the local `type PolicyContext` at lines 134-138 — import `PolicyContext` from `../scheduler/types.js` (it already exists there at line 153 with the identical shape).
- Remove the four private methods: `getPolicyContextFromInvocation` (lines 1144-1162), `evaluatePolicyDecision` (lines 1164-1176), `handlePolicyDenial` (lines 1178-1202), `publishConfirmationRequest` (lines 1204-1218).
- Import the four functions from `../policy/policy-helpers.js` (relative path from `core/` to `policy/` is `../policy/`, NOT `../../policy/` — verified from existing import at line 33: `import { PolicyDecision } from '../policy/types.js'`).
- Import `PolicyContext` from `../scheduler/types.js` (add to existing imports or new import statement).
- Update call sites:
  - `this.evaluatePolicyDecision(invocation, reqInfo)` → `evaluatePolicyDecision(invocation, reqInfo, this.config.getPolicyEngine())`
  - `this.handlePolicyDenial(reqInfo, evaluation.context)` → `handlePolicyDenial(reqInfo, evaluation.context, this.setStatusInternal.bind(this), this.messageBus)` — binds `setStatusInternal` as a callback since it's a private method
  - `this.getPolicyContextFromInvocation(invocation, reqInfo)` → `getPolicyContextFromInvocation(invocation, reqInfo)`
  - `this.publishConfirmationRequest(correlationId, context)` → `publishConfirmationRequest(correlationId, context, this.messageBus)`
- Affected call sites at lines: 844, 853, 928, 936, 1066, 1070.

### 4. Create: `packages/core/src/policy/policy-helpers.test.ts`

Behavioral tests for the extracted functions in isolation:
- `getPolicyContextFromInvocation` returns correct context from `BaseToolInvocation` and fallback
- `evaluatePolicyDecision` calls `policyEngine.evaluate()` with correct args
- `handlePolicyDenial` publishes `TOOL_POLICY_REJECTION` with correct payload
- `publishConfirmationRequest` publishes `TOOL_CONFIRMATION_REQUEST`

## Preflight Checks

```bash
# Verify the inline methods still exist where expected
grep -n "getPolicyContextFromInvocation\|evaluatePolicyDecision\|handlePolicyDenial\|publishConfirmationRequest" \
  packages/core/src/core/coreToolScheduler.ts

# Verify local PolicyContext type at line 134
sed -n '134p' packages/core/src/core/coreToolScheduler.ts

# Verify PolicyContext already in scheduler/types.ts
grep -n "PolicyContext" packages/core/src/scheduler/types.ts

# Verify createErrorResponse is NOT exported (file-scoped const at line 171)
grep -n "createErrorResponse" packages/core/src/core/coreToolScheduler.ts | head -3

# Verify no shell-permissions.ts exists
test ! -f packages/core/src/policy/shell-permissions.ts && echo "OK: no shell-permissions.ts"

# Verify existing policy engine
test -f packages/core/src/policy/policy-engine.ts && echo "OK: policy-engine.ts exists"

# Verify policy-helpers.ts does not exist yet
test ! -f packages/core/src/policy/policy-helpers.ts && echo "OK: policy-helpers.ts absent"
```

## Implementation Steps

1. **Read** `coreToolScheduler.ts` lines 128-142 (local `PolicyContext` type), 171-193 (`createErrorResponse`), and 1144-1218 (the four private methods) to capture exact signatures and dependencies.
2. **Read** `scheduler/types.ts` line 153-157 to confirm `PolicyContext` shape matches the local one.
3. **Decide** on `createErrorResponse` strategy: `createErrorResponse` is used 9 times across `coreToolScheduler.ts` (not just the extracted methods), so it must stay in the scheduler. `handlePolicyDenial` will construct the error response shape inline — it is a simple object literal (lines 175-193). Do NOT extract `createErrorResponse` to a shared file.
4. **Create** `packages/core/src/policy/policy-helpers.ts`:
   - Move function bodies from coreToolScheduler, adapting from `this.config.getPolicyEngine()` → parameter, `this.messageBus` → parameter, `this.setStatusInternal(...)` → callback parameter.
   - Import `BaseToolInvocation`, `AnyToolInvocation` from `../tools/tools.js` (direct, NOT barrel); `ToolCallRequestInfo`, `ToolCallResponseInfo`, `PolicyContext` from `../scheduler/types.js`; `PolicyDecision` from `./types.js`; `PolicyEngine` from `./policy-engine.js`; `MessageBus` from `../confirmation-bus/message-bus.js`; `MessageBusType` from `../confirmation-bus/types.js`; `FunctionCall` from `@google/genai`; `ToolErrorType` from `../index.js`; `DEFAULT_AGENT_ID` from `../core/turn.js`; `randomUUID` from `node:crypto`.
5. **Update** `packages/core/src/policy/index.ts` with re-exports from `./policy-helpers.js`.
6. **Modify** `coreToolScheduler.ts`:
   - Remove local `type PolicyContext` at lines 134-138.
   - Remove four private methods (lines 1144-1218).
   - Import from `../policy/policy-helpers.js`.
   - Import `PolicyContext` from `../scheduler/types.js`.
   - Update all six call sites (see Section 3 above for exact transformations).
7. **Create** `packages/core/src/policy/policy-helpers.test.ts` with behavioral tests.
8. **Run verification.**

## Verification

```bash
npm run typecheck
npm run lint
npm run test -- --reporter=verbose packages/core/src/policy/policy-helpers.test.ts
npm run test -- --reporter=verbose packages/core/src/core/coreToolScheduler.test.ts
npm run build
```

## Execution Notes / Risks

- **Risk: `createErrorResponse` is file-scoped.** It is defined as `const createErrorResponse = (...)` at line 171 of `coreToolScheduler.ts` and is used 9 times throughout the file (not just in the four extracted methods). It must NOT be moved out. `handlePolicyDenial` constructs the error response shape inline — the response structure is simple (lines 175-193). Note: the inline construction must include the `agentId` field (line 192: `agentId: request.agentId ?? DEFAULT_AGENT_ID`) — import `DEFAULT_AGENT_ID` from `../core/turn.js`.
- **Risk: Method references in tests.** `coreToolScheduler.test.ts` has extensive mocking. The four methods being removed are private, so tests should not directly reference them, but verify no test spies on them via `as any` casting.
- **Risk: Circular imports.** The new `policy-helpers.ts` must import `BaseToolInvocation`/`AnyToolInvocation` from `../tools/tools.js` directly — NOT from the barrel `../index.js`. No existing policy file imports tool types via the barrel (verified), and no existing tool file imports from `policy/` (verified). The `tools → policy` direction has no existing edges, and `policy → tools` is new but safe as long as it goes direct. If a circular dependency is detected at build time, fall back to a duck-typed interface parameter (`{ getPolicyContext(): PolicyContext }`) instead of the concrete `BaseToolInvocation` class.
- **Do NOT** create `shell-permissions.ts`. LLxprt's shell safety is handled inside `PolicyEngine.evaluate()` and `shell-utils.ts`.
- **Do NOT** change the public API of `PolicyEngine` — the extraction is purely internal plumbing.
