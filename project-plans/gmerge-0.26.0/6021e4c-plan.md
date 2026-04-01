# REIMPLEMENT Playbook: 6021e4c — Add types for event driven scheduler

## Upstream Change Summary

This commit adds types and infrastructure for an event-driven scheduler. It's a prefactoring change that:

1. Adds new message types to the confirmation bus (`TOOL_CALLS_UPDATE`)
2. Adds `SerializableConfirmationDetails` type - a data-only version of confirmation details for bus transmission
3. Adds `outcome` and `payload` fields to `ToolConfirmationResponse`
4. Updates `WaitingToolCall` to support both legacy (with callbacks) and new serializable details
5. Adds `correlationId` to `WaitingToolCall`
6. Updates all usages to cast `confirmationDetails` to `ToolCallConfirmationDetails` where callbacks are needed

This prepares for decoupling the UI from the scheduler by making confirmation details serializable.

**Files changed upstream:**
- `packages/a2a-server/src/agent/task.ts`
- `packages/cli/src/ui/hooks/useGeminiStream.ts`
- `packages/cli/src/ui/hooks/useReactToolScheduler.ts`
- `packages/core/src/confirmation-bus/types.ts`
- `packages/core/src/core/coreToolScheduler.test.ts`
- `packages/core/src/scheduler/types.ts`

## LLxprt Current State

### Key Differences
- LLxprt does NOT have `packages/a2a-server` - this is upstream's A2A (Agent-to-Agent) server
- LLxprt has its own subagent system, not upstream's agent system

### `packages/core/src/confirmation-bus/types.ts`

Check if this file exists and what types it contains. Need to add:
- `TOOL_CALLS_UPDATE` to `MessageBusType` enum
- `ToolCallsUpdateMessage` interface
- `SerializableConfirmationDetails` type
- `outcome` and `payload` fields to `ToolConfirmationResponse`

### `packages/core/src/scheduler/types.ts`

Check if this file exists. Need to update `WaitingToolCall` to support serializable confirmation details.

## Adaptation Plan

> **WARNING: COMPATIBILITY TYPING ONLY** — do not introduce event-driven runtime behavior. LLxprt uses a minimal scheduler design. This commit adds types only; it must not change runtime control flow, scheduling logic, or callback wiring.

> **WARNING: GUARDRAIL:** Do NOT widen `WaitingToolCall.confirmationDetails` globally unless necessary. Prefer a targeted transport type (e.g., a bus message payload type) instead of modifying core in-memory scheduler state used by UI callbacks. If widening is unavoidable, add a single narrowing helper/type guard in one place — do NOT scatter casts across files.

### 1. Modify `packages/core/src/confirmation-bus/types.ts`

Add to `MessageBusType` enum:
```typescript
export enum MessageBusType {
  TOOL_CONFIRMATION_REQUEST = 'tool-confirmation-request',
  TOOL_CONFIRMATION_RESPONSE = 'tool-confirmation-response',
  UPDATE_POLICY = 'update-policy',
  HOOK_EXECUTION_REQUEST = 'hook-execution-request',
  HOOK_EXECUTION_RESPONSE = 'hook-execution-response',
  HOOK_POLICY_DECISION = 'hook-policy-decision',
  TOOL_CALLS_UPDATE = 'tool-calls-update',  // ADD THIS
}
```

Add new interface:
```typescript
export interface ToolCallsUpdateMessage {
  type: MessageBusType.TOOL_CALLS_UPDATE;
  toolCalls: ToolCall[];
}
```

Add to `ToolConfirmationRequest`:
```typescript
export interface ToolConfirmationRequest {
  type: MessageBusType.TOOL_CONFIRMATION_REQUEST;
  toolCall: FunctionCall;
  correlationId: string;
  serverName?: string;
  details?: SerializableConfirmationDetails;  // ADD THIS
}
```

Add to `ToolConfirmationResponse`:
```typescript
export interface ToolConfirmationResponse {
  type: MessageBusType.TOOL_CONFIRMATION_RESPONSE;
  correlationId: string;
  confirmed: boolean;
  outcome?: ToolConfirmationOutcome;  // ADD THIS
  payload?: ToolConfirmationPayload;  // ADD THIS
  requiresUserConfirmation?: boolean;
}
```

Add `SerializableConfirmationDetails` type:
```typescript
export type SerializableConfirmationDetails =
  | { type: 'info'; title: string; prompt: string; urls?: string[] }
  | {
      type: 'edit';
      title: string;
      fileName: string;
      filePath: string;
      fileDiff: string;
      originalContent: string | null;
      newContent: string;
    }
  | {
      type: 'exec';
      title: string;
      command: string;
      rootCommand: string;
      rootCommands: string[];
    }
  | {
      type: 'mcp';
      title: string;
      serverName: string;
      toolName: string;
      toolDisplayName: string;
    };
```

Add to `Message` union type:
```typescript
export type Message =
  | ToolConfirmationRequest
  | ToolConfirmationResponse
  | UpdatePolicy
  | HookExecutionRequest
  | HookExecutionResponse
  | HookPolicyDecision
  | ToolCallsUpdateMessage;  // ADD THIS
```

### 2. Modify `packages/core/src/scheduler/types.ts`

**Import path note:** LLxprt uses `../tools/tool-confirmation-types.js` (not `../tools/tools.js`) for confirmation types. Verify imports use the correct path when referencing `ToolCallConfirmationDetails`.

Update `WaitingToolCall`:
```typescript
import type { SerializableConfirmationDetails } from '../confirmation-bus/types.js';

export type WaitingToolCall = {
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  confirmationDetails:
    | ToolCallConfirmationDetails
    | SerializableConfirmationDetails;  // CHANGED: was just ToolCallConfirmationDetails
  correlationId?: string;  // ADD THIS
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};
```

### 3. Update usages with type casts

In files that access `confirmationDetails.onConfirm`, add type casts:
```typescript
// OLD:
await call.confirmationDetails.onConfirm(ToolConfirmationOutcome.ProceedOnce);

// NEW:
await (call.confirmationDetails as ToolCallConfirmationDetails).onConfirm(
  ToolConfirmationOutcome.ProceedOnce,
);
```

Files to update:
- `packages/cli/src/ui/hooks/useGeminiStream.ts`
- `packages/cli/src/ui/hooks/useReactToolScheduler.ts`
- `packages/core/src/core/coreToolScheduler.test.ts`

### 4. Skip A2A Server Changes

LLxprt doesn't have `packages/a2a-server`, so skip those changes.

## Files to Read

1. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/confirmation-bus/types.ts`
2. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/scheduler/types.ts`
3. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/hooks/useGeminiStream.ts`
4. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/hooks/useReactToolScheduler.ts`
5. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/core/coreToolScheduler.test.ts`

## Files to Modify

1. `packages/core/src/confirmation-bus/types.ts` - Add new types
2. `packages/core/src/scheduler/types.ts` - Update WaitingToolCall
3. `packages/cli/src/ui/hooks/useGeminiStream.ts` - Add type casts
4. `packages/cli/src/ui/hooks/useReactToolScheduler.ts` - Add type casts
5. `packages/core/src/core/coreToolScheduler.test.ts` - Add type casts

## Specific Verification

1. TypeScript compilation: `npm run typecheck`
2. All tests pass: `npm run test`
3. Run focused scheduler tests: `npm run test -- --testPathPattern=coreToolScheduler`
4. Verify scheduler and confirmation bus functionality works correctly
5. Confirm no runtime behavior changes — only type-level changes should be present in the diff

## Notes

This is a prefactoring change that enables future event-driven scheduler work. The immediate change is mostly type system updates to support both legacy (callback-based) and new (serializable) confirmation details.

If widening `WaitingToolCall.confirmationDetails` is unavoidable, introduce a single narrowing helper or type guard (e.g., `isCallbackConfirmationDetails(details): details is ToolCallConfirmationDetails`) in one location rather than scattering `as ToolCallConfirmationDetails` casts across multiple call sites.
