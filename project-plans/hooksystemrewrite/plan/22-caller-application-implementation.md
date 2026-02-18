# Phase 22: Caller Application of Hook Results — Implementation

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P22

## Prerequisites
- P21 completed (failing tests exist for caller application)
- Verification: All 8 tests from P21 FAIL
- `npm run test -- hooks-caller-application.test.ts` shows 8 failures

## Purpose

Remove `void` prefix from all caller sites and implement hook result application. This is the CENTRAL behavioral change of the rewrite (HOOK-134).

## Implementation Tasks

### Task 1: Fix coreToolScheduler — BeforeTool Application

**File:** `packages/core/src/core/coreToolScheduler.ts`

**Location:** Line ~1727

```typescript
// BEFORE (fire-and-forget)
void triggerBeforeToolHook(this.config, toolName, args);
// ... tool executes unconditionally

// AFTER (apply result)
const beforeResult = await triggerBeforeToolHook(this.config, toolName, args);

if (beforeResult?.isBlockingDecision()) {
  // HOOK-017: Construct ToolResult with block reason
  const blockedResult: ToolResult = {
    llmContent: `Tool execution blocked: ${beforeResult.getEffectiveReason()}`,
    returnDisplay: undefined,
    error: undefined,
  };
  this.bufferResult(toolName, blockedResult);
  this.setStatus(toolName, 'idle');
  return; // Do not execute tool
}

// HOOK-019: Apply modified input if provided
const modifiedInput = beforeResult?.getModifiedToolInput();
const actualArgs = modifiedInput ?? args;

// Execute tool with (possibly modified) args
const toolResult = await this.executeToolFn(toolName, actualArgs);
```

### Task 2: Fix coreToolScheduler — AfterTool Application

**File:** `packages/core/src/core/coreToolScheduler.ts`

**Location:** Line ~1777

```typescript
// BEFORE
void triggerAfterToolHook(this.config, toolName, args, toolResult);

// AFTER
const afterResult = await triggerAfterToolHook(this.config, toolName, args, toolResult);

if (afterResult) {
  // HOOK-131: Append systemMessage
  const systemMessage = afterResult.getSystemMessage();
  if (systemMessage) {
    toolResult.llmContent += `\n\n[System] ${systemMessage}`;
  }
  
  // HOOK-027: Append additionalContext
  const additionalContext = afterResult.getAdditionalContext();
  if (additionalContext) {
    toolResult.llmContent += `\n\n${additionalContext}`;
  }
  
  // HOOK-132: Set suppressDisplay
  if (afterResult.shouldSuppressOutput()) {
    toolResult.suppressDisplay = true;
  }
  
  // HOOK-028: Check for agent termination
  if (afterResult.shouldStopExecution()) {
    this.terminateAgentLoop(afterResult.getStopReason());
  }
}
```

### Task 3: Fix geminiChat — BeforeToolSelection Application

**File:** `packages/core/src/core/geminiChat.ts`

**Location:** Line ~1337

```typescript
// BEFORE
void triggerBeforeToolSelectionHook(configForHooks, toolsFromConfig);

// AFTER
const toolSelectionResult = await triggerBeforeToolSelectionHook(configForHooks, toolsFromConfig);

if (toolSelectionResult) {
  // HOOK-055: Apply allowedFunctionNames
  const modifiedToolConfig = toolSelectionResult.getModifiedToolConfig();
  if (modifiedToolConfig?.allowedFunctionNames) {
    requestParams.toolConfig = {
      ...requestParams.toolConfig,
      functionCallingConfig: {
        ...requestParams.toolConfig?.functionCallingConfig,
        allowedFunctionNames: modifiedToolConfig.allowedFunctionNames,
      },
    };
  }
  
  // HOOK-056: Apply mode
  if (modifiedToolConfig?.mode) {
    requestParams.toolConfig = {
      ...requestParams.toolConfig,
      functionCallingConfig: {
        ...requestParams.toolConfig?.functionCallingConfig,
        mode: modifiedToolConfig.mode,
      },
    };
  }
  
  // HOOK-058: Check for agent termination
  if (toolSelectionResult.shouldStopExecution()) {
    return this.createStopResponse(toolSelectionResult.getStopReason());
  }
}
```

### Task 4: Fix geminiChat — BeforeModel Application

**File:** `packages/core/src/core/geminiChat.ts`

**Location:** Line ~1381

```typescript
// BEFORE
void triggerBeforeModelHook(config, requestParams);

// AFTER
const beforeModelResult = await triggerBeforeModelHook(config, requestParams);

if (beforeModelResult?.isBlockingDecision()) {
  // HOOK-036/037: Skip model call, use synthetic response
  const syntheticResponse = beforeModelResult.getSyntheticResponse();
  if (syntheticResponse) {
    return this.wrapSyntheticResponse(syntheticResponse);
  } else {
    // HOOK-037: Block without synthetic response = empty response
    return this.createEmptyBlockResponse(beforeModelResult.getEffectiveReason());
  }
}

// HOOK-038: Apply modified request
const modifiedRequest = beforeModelResult?.getModifiedLLMRequest();
if (modifiedRequest) {
  requestParams = this.applyRequestModifications(requestParams, modifiedRequest);
}

// HOOK-040: Check for agent termination
if (beforeModelResult?.shouldStopExecution()) {
  return this.createStopResponse(beforeModelResult.getStopReason());
}

// Now call the actual model API
const response = await this.callModelAPI(requestParams);
```

### Task 5: Fix geminiChat — AfterModel Application

**File:** `packages/core/src/core/geminiChat.ts`

**Location:** Line ~1418

```typescript
// BEFORE
void triggerAfterModelHook(config, response);

// AFTER
const afterModelResult = await triggerAfterModelHook(config, response);

if (afterModelResult) {
  // HOOK-046/047: Apply modified response
  const modifiedResponse = afterModelResult.getModifiedResponse();
  if (modifiedResponse) {
    response = modifiedResponse;
  }
  
  // HOOK-049: Suppress display
  if (afterModelResult.shouldSuppressOutput()) {
    this.suppressNextDisplay = true;
  }
  
  // HOOK-048: Check for agent termination
  if (afterModelResult.shouldStopExecution()) {
    return this.createStopResponse(afterModelResult.getStopReason());
  }
}
```

### Task 6: Add suppressDisplay to ToolResult (HOOK-149)

**File:** `packages/core/src/core/tools.ts`

```typescript
// BEFORE
export interface ToolResult {
  llmContent: string;
  returnDisplay: DisplayContent | undefined;
  metadata?: ToolMetadata;
  error?: string;
}

// AFTER
export interface ToolResult {
  llmContent: string;
  returnDisplay: DisplayContent | undefined;
  metadata?: ToolMetadata;
  error?: string;
  suppressDisplay?: boolean; // HOOK-149
}
```

## Files to Modify

| File | Changes | Key Requirements |
|------|---------|------------------|
| `coreToolScheduler.ts` | Remove `void` prefix L1727, L1777; apply hook results | HOOK-017, HOOK-019, HOOK-027, HOOK-028, HOOK-131, HOOK-132 |
| `geminiChat.ts` | Remove `void` prefix L1337, L1381, L1418; apply hook results | HOOK-036-040, HOOK-046-049, HOOK-055-058 |
| `tools.ts` | Add `suppressDisplay` field | HOOK-149 |

## Verification Commands

```bash
# Run the failing tests — they should now PASS
cd packages/core
npm run test -- hooks-caller-application.test.ts --no-coverage

# Expected: 8 passing tests

# Run full verification
npm run test
npm run typecheck
npm run lint
npm run format
npm run build

# Haiku sanity check
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

## Success Criteria for P22

- [ ] All 8 tests from P21 now PASS
- [ ] No `void` prefix on any trigger call in coreToolScheduler.ts
- [ ] No `void` prefix on any trigger call in geminiChat.ts
- [ ] BeforeTool blocking prevents tool execution
- [ ] BeforeTool input modification is applied
- [ ] AfterTool systemMessage is appended
- [ ] AfterTool suppressDisplay is set
- [ ] BeforeModel blocking skips API call
- [ ] BeforeModel synthetic response is used
- [ ] BeforeToolSelection restrictions are applied
- [ ] `suppressDisplay` field added to ToolResult
- [ ] Full verification suite passes

## Phase Completion Marker
- Update `project-plans/hooksystemrewrite/.completed/P22.md`
- Set Status: COMPLETED when all criteria met
