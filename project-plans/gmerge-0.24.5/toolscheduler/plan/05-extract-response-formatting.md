# Phase 05: Extract Response Formatting Utilities

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P05`

## Prerequisites

- Required: Phase 04a completed successfully
- Verification: ToolExecutor extracted and all tests pass
- Expected: coreToolScheduler reduced, behavior preserved

## Purpose

**EXTRACT** (cut-paste) response formatting functions from `coreToolScheduler.ts` into `generateContentResponseUtilities.ts`. These are pure transformation functions with no state dependencies.

## Requirements Implemented

### TS-RESP-001, TS-RESP-002: Response Formatting

**Full Text**: When tool output contains text, binary data, and fileData, the system shall format the response as a Gemini FunctionResponse with appropriate Part structure and token limits.

**Behavior**:
- GIVEN: Code extracted from convertToFunctionResponse (lines 241-319) and helpers (lines 177-239)
- WHEN: Functions moved to generateContentResponseUtilities.ts
- THEN: coreToolScheduler imports and uses them, ALL tests pass

**Why This Matters**: These are pure functions that can be tested and reused independently.

## Implementation Tasks

### Files to Modify

#### 1. `packages/core/src/utils/generateContentResponseUtilities.ts`

**ADD the following functions extracted from coreToolScheduler.ts:**

```typescript
/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P05
 * @requirement TS-RESP-001, TS-RESP-002
 * 
 * Response formatting utilities — extracted from coreToolScheduler.ts
 */

// ============================================================
// EXTRACTED FROM coreToolScheduler.ts lines 177-189
// ============================================================
/**
 * Formats tool output for a Gemini FunctionResponse.
 */
function createFunctionResponsePart(
  callId: string,
  toolName: string,
  output: string,
): Part {
  return {
    functionResponse: {
      id: callId,
      name: toolName,
      response: { output },
    },
  };
}

// ============================================================
// EXTRACTED FROM coreToolScheduler.ts lines 191-207
// ============================================================
function limitStringOutput(
  text: string,
  toolName: string,
  config?: ToolOutputSettingsProvider,
): string {
  if (!config || typeof config.getEphemeralSettings !== 'function') {
    return text;
  }
  const limited = limitOutputTokens(text, config, toolName);
  if (!limited.wasTruncated) {
    return limited.content;
  }
  if (limited.content && limited.content.length > 0) {
    return limited.content;
  }
  return limited.message ?? '';
}

// ============================================================
// EXTRACTED FROM coreToolScheduler.ts lines 209-239
// ============================================================
function limitFunctionResponsePart(
  part: Part,
  toolName: string,
  config?: ToolOutputSettingsProvider,
): Part {
  if (!config || !part.functionResponse) {
    return part;
  }
  const response = part.functionResponse.response;
  if (!response || typeof response !== 'object') {
    return part;
  }
  const existingOutput = response['output'];
  if (typeof existingOutput !== 'string') {
    return part;
  }
  const limitedOutput = limitStringOutput(existingOutput, toolName, config);
  if (limitedOutput === existingOutput) {
    return part;
  }
  return {
    ...part,
    functionResponse: {
      ...part.functionResponse,
      response: {
        ...response,
        output: limitedOutput,
      },
    },
  };
}

// ============================================================
// EXTRACTED FROM coreToolScheduler.ts lines 334-344
// ============================================================
function toParts(input: PartListUnion): Part[] {
  const parts: Part[] = [];
  for (const part of Array.isArray(input) ? input : [input]) {
    if (typeof part === 'string') {
      parts.push({ text: part });
    } else if (part) {
      parts.push(part);
    }
  }
  return parts;
}

// ============================================================
// EXTRACTED FROM coreToolScheduler.ts lines 241-319
// ============================================================
/**
 * Converts tool output to Gemini FunctionResponse parts.
 * Handles text, binary data (images/PDFs), and mixed content.
 */
export function convertToFunctionResponse(
  toolName: string,
  callId: string,
  llmContent: PartListUnion,
  config?: ToolOutputSettingsProvider,
): Part[] {
  // [EXACT CODE FROM lines 247-318 — DO NOT REWRITE, CUT AND PASTE]
  
  // Handle simple string case
  if (typeof llmContent === 'string') {
    const limitedOutput = limitStringOutput(llmContent, toolName, config);
    return [createFunctionResponsePart(callId, toolName, limitedOutput)];
  }

  const parts = toParts(llmContent);

  // Separate text from binary types
  const textParts: string[] = [];
  const inlineDataParts: Part[] = [];
  const fileDataParts: Part[] = [];

  for (const part of parts) {
    if (part.text !== undefined) {
      textParts.push(part.text);
    } else if (part.inlineData) {
      inlineDataParts.push(part);
    } else if (part.fileData) {
      fileDataParts.push(part);
    } else if (part.functionResponse) {
      // Passthrough case - preserve existing response
      if (parts.length > 1) {
        toolSchedulerLogger.warn(
          'convertToFunctionResponse received multiple parts with a functionResponse. ' +
            'Only the functionResponse will be used, other parts will be ignored',
        );
      }
      const passthroughPart = {
        functionResponse: {
          id: callId,
          name: toolName,
          response: part.functionResponse.response,
        },
      };
      return [limitFunctionResponsePart(passthroughPart, toolName, config)];
    }
  }

  // Build the primary response part
  const part: Part = {
    functionResponse: {
      id: callId,
      name: toolName,
      response: textParts.length > 0 ? { output: textParts.join('\n') } : {},
    },
  };

  // Handle binary content - use sibling format for all providers
  const siblingParts: Part[] = [...fileDataParts, ...inlineDataParts];

  // Add descriptive text if response object is empty but we have binary content
  if (
    textParts.length === 0 &&
    (inlineDataParts.length > 0 || fileDataParts.length > 0)
  ) {
    const totalBinaryItems = inlineDataParts.length + fileDataParts.length;
    part.functionResponse!.response = {
      output: `Binary content provided (${totalBinaryItems} item(s)).`,
    };
  }

  // Apply output limits to the functionResponse
  const limitedPart = limitFunctionResponsePart(part, toolName, config);

  if (siblingParts.length > 0) {
    return [limitedPart, ...siblingParts];
  }

  return [limitedPart];
}
```

**CRITICAL**: Add necessary imports at top of file:
```typescript
import { limitOutputTokens, type ToolOutputSettingsProvider } from './toolOutputLimiter.js';
import type { Part, PartListUnion } from '@google/genai';
import { DebugLogger } from '../debug/index.js';

const toolSchedulerLogger = new DebugLogger('llxprt:core:tool-scheduler');
```

#### 2. `packages/core/src/core/coreToolScheduler.ts`

**DELETE lines 177-344** (all the response formatting functions)

**ADD import at top of file:**

```typescript
import { convertToFunctionResponse } from '../utils/generateContentResponseUtilities.js';
```

**UPDATE any calls to helper functions:**
- `createFunctionResponsePart` → No longer used directly, only via convertToFunctionResponse
- `limitStringOutput` → No longer used directly
- `limitFunctionResponsePart` → No longer used directly
- `toParts` → No longer used directly

**The only function that remains is `extractAgentIdFromMetadata` (lines 321-332):**
```typescript
// NOTE: This function stays in coreToolScheduler because it's used in
// setStatusInternal for agent ID fallback logic (state machine concern)
function extractAgentIdFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) {
    return undefined;
  }
  const candidate = metadata['agentId'];
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate;
  }
  return undefined;
}
```

**DELETE `createErrorResponse` function (lines 346-368):**
- Keep it in coreToolScheduler for now (it's tightly coupled to state)
- Can be extracted later if needed

## Subagent Prompt

```
You are implementing Phase 05 of the CoreToolScheduler refactoring.

CONTEXT: You are EXTRACTING pure transformation functions from coreToolScheduler.ts, NOT rewriting them.

TASK:
1. ADD functions to packages/core/src/utils/generateContentResponseUtilities.ts
2. CUT functions from coreToolScheduler.ts lines 177-344
3. UPDATE import in coreToolScheduler.ts

WHAT TO DO:
1. Read coreToolScheduler.ts lines 177-344 to see EXACT code
2. ADD to generateContentResponseUtilities.ts:
   - createFunctionResponsePart (lines 177-189)
   - limitStringOutput (lines 191-207)
   - limitFunctionResponsePart (lines 209-239)
   - convertToFunctionResponse (lines 241-319)
   - toParts (lines 334-344)
3. DELETE these functions from coreToolScheduler.ts
4. KEEP extractAgentIdFromMetadata (lines 321-332) — it's state-related
5. KEEP createErrorResponse (lines 346-368) — it's state-related
6. ADD import in coreToolScheduler.ts

CRITICAL RULES:
- DO NOT rewrite — CUT and PASTE
- DO include @plan markers
- ALL tests must pass
- TypeScript must compile

EXPECTED OUTPUT:
- Modified: generateContentResponseUtilities.ts (+~180 lines)
- Modified: coreToolScheduler.ts (-~150 lines functions, +1 line import)
- All tests pass

FORBIDDEN:
- Rewriting the functions
- Breaking imports
- Changing behavior
```

## Verification Commands

### Automated Checks

```bash
# Check functions added to generateContentResponseUtilities
grep "convertToFunctionResponse" packages/core/src/utils/generateContentResponseUtilities.ts || exit 1
grep "@plan PLAN-20260302-TOOLSCHEDULER.P05" packages/core/src/utils/generateContentResponseUtilities.ts || exit 1

# Check functions removed from coreToolScheduler
if grep -E "^function (createFunctionResponsePart|limitStringOutput|limitFunctionResponsePart|toParts)" packages/core/src/core/coreToolScheduler.ts; then
  echo "FAIL: Functions not removed from coreToolScheduler.ts"
  exit 1
fi

# Check import added
grep "import.*convertToFunctionResponse.*from.*generateContentResponseUtilities" packages/core/src/core/coreToolScheduler.ts || exit 1

# Check extractAgentIdFromMetadata KEPT (it's state-related)
grep "function extractAgentIdFromMetadata" packages/core/src/core/coreToolScheduler.ts || exit 1

# TypeScript compilation
npm run typecheck || exit 1

# Run ALL tests
npm test -- coreToolScheduler || exit 1
```

## Verification Commands

### Automated Checks

```bash
# Check functions added to generateContentResponseUtilities
grep "convertToFunctionResponse" packages/core/src/utils/generateContentResponseUtilities.ts || exit 1
grep "@plan PLAN-20260302-TOOLSCHEDULER.P05" packages/core/src/utils/generateContentResponseUtilities.ts || exit 1

# Check functions removed from coreToolScheduler
if grep -E "^function (createFunctionResponsePart|limitStringOutput|limitFunctionResponsePart|toParts)" packages/core/src/core/coreToolScheduler.ts; then
  echo "FAIL: Functions not removed from coreToolScheduler.ts"
  exit 1
fi

# Check import added
grep "import.*convertToFunctionResponse.*from.*generateContentResponseUtilities" packages/core/src/core/coreToolScheduler.ts || exit 1

# Check extractAgentIdFromMetadata KEPT (it's state-related)
grep "function extractAgentIdFromMetadata" packages/core/src/core/coreToolScheduler.ts || exit 1

# TypeScript compilation
npm run typecheck || exit 1

# Run ALL tests
npm test -- coreToolScheduler || exit 1
```

### Structural Verification Checklist

- [ ] convertToFunctionResponse added to generateContentResponseUtilities.ts
- [ ] Helper functions added (createFunctionResponsePart, limitStringOutput, etc.)
- [ ] Functions removed from coreToolScheduler.ts
- [ ] extractAgentIdFromMetadata kept (state-related)
- [ ] Import added correctly
- [ ] Plan markers present

### Semantic Verification Checklist

- [ ] All tests pass (behavior preserved)
- [ ] TypeScript compilation succeeds
- [ ] Response formatting logic unchanged (cut/paste)
- [ ] No TODO/HACK in extracted code

## Success Criteria

- [ ] Functions added to generateContentResponseUtilities.ts
- [ ] Functions removed from coreToolScheduler.ts
- [ ] extractAgentIdFromMetadata kept in coreToolScheduler.ts
- [ ] Import added correctly
- [ ] TypeScript compilation succeeds
- [ ] All tests pass
- [ ] Plan markers present

## Failure Recovery

If this phase fails:

1. **Compilation errors:** Check imports and function signatures
2. **Tests fail:** Verify functions were copied exactly (no modifications)
3. **Wrong functions removed:** Ensure extractAgentIdFromMetadata kept
4. Rollback: `git checkout -- packages/core/src/core/coreToolScheduler.ts packages/core/src/utils/generateContentResponseUtilities.ts`
5. Re-run Phase 05

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/toolscheduler/.completed/P05.md`

Contents:
```markdown
Phase: P05
Completed: [TIMESTAMP]
Files Modified:
  - packages/core/src/utils/generateContentResponseUtilities.ts (+~180 lines)
  - packages/core/src/core/coreToolScheduler.ts (-~150 lines)
Tests: All tests pass
Verification: Response formatting extracted, behavior preserved
```
