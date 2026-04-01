# REIMPLEMENT Playbook: 1b6b6d4 — refactor(cli): centralize tool mapping

## Upstream Change Summary

Upstream centralized the tool status/display mapping logic into a separate `toolMapping.ts` file:

1. **Created new file `toolMapping.ts`**: Contains `mapCoreStatusToDisplayStatus()` and `mapToDisplay()` functions
2. **Removed mapping logic from `useReactToolScheduler.ts`**: The `mapToDisplay` function is now imported
3. **Updated `useGeminiStream.ts`**: Imports `mapToDisplay` from `toolMapping.ts` instead
4. **Added new tests**: `toolMapping.test.ts` with comprehensive coverage

## LLxprt Current State

**File**: `packages/cli/src/ui/hooks/useReactToolScheduler.ts`

LLxprt has `mapToDisplay` function defined inline with LLxprt-specific features:
- Includes `agentId` handling in the tool group output
- Uses `DEFAULT_AGENT_ID` fallback
- Has different logger pattern (`DebugLogger.getLogger()`)

LLxprt's `mapToDisplay`:
```typescript
export function mapToDisplay(
  toolOrTools: TrackedToolCall[] | TrackedToolCall,
): HistoryItemToolGroup {
  // ...
  const groupAgentId = toolCalls
    .map((trackedCall) => {
      const responseAgentId = 'response' in trackedCall ? trackedCall.response?.agentId : undefined;
      return responseAgentId ?? trackedCall.request.agentId;
    })
    .find((agentId) => typeof agentId === 'string' && agentId.trim().length > 0) ?? DEFAULT_AGENT_ID;
  // ...
}
```

**File**: `packages/cli/src/ui/hooks/useGeminiStream.ts`

Imports `mapToDisplay` from `useReactToolScheduler.js`:
```typescript
import {
  useReactToolScheduler,
  mapToDisplay as mapTrackedToolCallsToDisplay,
  // ...
} from './useReactToolScheduler.js';
```

## Adaptation Plan

### Decision: SHOULD LLxprt adopt this refactoring?

**Arguments FOR adopting**:
- Cleaner separation of concerns
- Easier to test mapping logic independently
- Aligns with upstream architecture

**Arguments AGAINST**:
- LLxprt has additional `agentId` handling
- More files to maintain
- Minimal benefit if LLxprt's scheduler differs significantly

**Recommendation**: Partially adopt - extract mapping to separate file but preserve LLxprt-specific `agentId` logic and keep `TrackedToolCall` as the input type (not bare `ToolCall`).

### File-by-File Changes

#### 1. Create `packages/cli/src/ui/hooks/toolMapping.ts`

**Important**: LLxprt's scheduler operates on `TrackedToolCall` (not bare `ToolCall`). The new file must accept `TrackedToolCall[] | TrackedToolCall` to stay compatible with all existing call sites. `TrackedToolCall` is imported from (or re-exported by) `useReactToolScheduler.ts` — confirm the exact import path before creating the file.

**agentId propagation semantics** (3-level precedence — must be preserved exactly):
1. `response.agentId` — preferred (set when the subagent response arrives)
2. `request.agentId` — fallback (set when the call is dispatched)
3. `DEFAULT_AGENT_ID` — last resort (if neither level has a non-empty string)

Tests for `mapToDisplay` **must** verify all three levels independently.

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Status as CoreStatus,
  DEFAULT_AGENT_ID,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import {
  ToolCallStatus,
  type HistoryItemToolGroup,
  type IndividualToolCallDisplay,
} from '../types.js';
import type { TrackedToolCall } from './useReactToolScheduler.js';

const logger = DebugLogger.getLogger('llxprt:cli:tool-mapping');

/**
 * Maps a CoreToolScheduler status to the UI's ToolCallStatus enum.
 * Memoized as a constant map for better performance.
 */
const STATUS_MAP: Record<CoreStatus, ToolCallStatus> = {
  validating: ToolCallStatus.Executing,
  awaiting_approval: ToolCallStatus.Confirming,
  executing: ToolCallStatus.Executing,
  success: ToolCallStatus.Success,
  cancelled: ToolCallStatus.Canceled,
  error: ToolCallStatus.Error,
  scheduled: ToolCallStatus.Pending,
};

export function mapCoreStatusToDisplayStatus(coreStatus: CoreStatus): ToolCallStatus {
  const mappedStatus = STATUS_MAP[coreStatus];
  if (mappedStatus !== undefined) {
    return mappedStatus;
  }
  logger.warn(`Unknown core status encountered: ${coreStatus}`);
  return ToolCallStatus.Error;
}

/**
 * Transforms `TrackedToolCall` objects into `HistoryItemToolGroup` objects for UI display.
 * LLxprt enhancement: Includes agentId handling for subagent support.
 *
 * agentId precedence: response.agentId > request.agentId > DEFAULT_AGENT_ID
 */
export function mapToDisplay(
  toolOrTools: TrackedToolCall[] | TrackedToolCall,
): HistoryItemToolGroup {
  const toolCalls = Array.isArray(toolOrTools) ? toolOrTools : [toolOrTools];

  // LLxprt-specific: Determine group agentId (3-level precedence)
  const groupAgentId =
    toolCalls
      .map((trackedCall) => {
        const responseAgentId =
          'response' in trackedCall
            ? trackedCall.response?.agentId
            : undefined;
        return responseAgentId ?? trackedCall.request.agentId;
      })
      .find(
        (agentId): agentId is string =>
          typeof agentId === 'string' && agentId.trim().length > 0,
      ) ?? DEFAULT_AGENT_ID;

  const toolDisplays = toolCalls.map((call): IndividualToolCallDisplay => {
    let description: string;
    let renderOutputAsMarkdown = false;

    const displayName = call.tool?.displayName ?? call.request.name;

    if (call.status === 'error') {
      description = JSON.stringify(call.request.args);
    } else {
      description = call.invocation.getDescription();
      renderOutputAsMarkdown = call.tool.isOutputMarkdown;
    }

    const baseDisplayProperties = {
      callId: call.request.callId,
      name: displayName,
      description,
      renderOutputAsMarkdown,
    };

    // ... rest of mapping logic (adapt from LLxprt's current implementation in useReactToolScheduler.ts)
  });

  return {
    type: 'tool_group',
    agentId: groupAgentId,
    tools: toolDisplays,
  };
}
```

#### 2. Update `packages/cli/src/ui/hooks/useReactToolScheduler.ts`

1. Remove the `mapToDisplay` function and `STATUS_MAP`
2. Remove `mapCoreStatusToDisplayStatus` function
3. Export types that `toolMapping.ts` needs
4. Keep the `TrackedToolCall` types

#### 3. Update `packages/cli/src/ui/hooks/useGeminiStream.ts`

Change import:
```typescript
import { mapToDisplay as mapTrackedToolCallsToDisplay } from './toolMapping.js';
```

#### 4. Create `packages/cli/src/ui/hooks/toolMapping.test.ts`

Adapt upstream's tests, adding LLxprt-specific tests for `agentId` handling.

## Files to Read

- `packages/cli/src/ui/hooks/useReactToolScheduler.ts`
- `packages/cli/src/ui/hooks/useGeminiStream.ts`

## Files to Modify

- `packages/cli/src/ui/hooks/useReactToolScheduler.ts`
- `packages/cli/src/ui/hooks/useGeminiStream.ts`

## Files to Create

- `packages/cli/src/ui/hooks/toolMapping.ts`
- `packages/cli/src/ui/hooks/toolMapping.test.ts`

## Grep-Driven Migration Checklist

Before considering the refactor complete, run these greps and act on every hit:

1. **Find all `mapToDisplay` import sites** to update them:
   ```
   grep -r "mapToDisplay" packages/cli/src --include="*.ts" --include="*.tsx" -l
   ```
   Update every import to pull from `./toolMapping.js` (or `../hooks/toolMapping.js` as appropriate).

2. **Verify no circular imports** — `toolMapping.ts` must NOT import from `useGeminiStream.ts` or `useReactToolScheduler.ts` body (only the `TrackedToolCall` type import is allowed):
   ```
   grep -n "from.*useGeminiStream\|from.*useReactToolScheduler" packages/cli/src/ui/hooks/toolMapping.ts
   ```
   Only a type-only import of `TrackedToolCall` is acceptable.

3. **Confirm `useToolScheduler.test.ts` still passes** after the extraction — the test file exercises the scheduler end-to-end and will catch broken re-exports.

4. **Confirm `mapCoreStatusToDisplayStatus` is not still duplicated** in `useReactToolScheduler.ts` after extraction:
   ```
   grep -n "mapCoreStatusToDisplayStatus\|STATUS_MAP" packages/cli/src/ui/hooks/useReactToolScheduler.ts
   ```
   Must return zero hits.

## Specific Verification

1. `npm run test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run format`
5. `npm run build`
6. `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
7. Manual: Verify tool calls display correctly in UI

## LLxprt-Specific Preservation

- **PRESERVE** `agentId` handling in `mapToDisplay`
- **PRESERVE** `DEFAULT_AGENT_ID` fallback logic
- **PRESERVE** LLxprt's `DebugLogger.getLogger()` pattern
