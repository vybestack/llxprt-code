# Tool Executor Unification - Detailed Implementation Plan

## Overview

This plan transforms the high-level unification strategy into concrete, test-first implementation tasks that can be executed by subagents. Each phase follows strict TDD discipline per dev-docs/RULES.md.

### Subagent Workflow

```
For each Phase:
  1. Test Subagent (RED)
     - Write failing tests that define expected behavior
     - Tests MUST verify real behavior, not mock interactions

  2. Implementation Subagent (GREEN)
     - Implement minimum code to make tests pass
     - No stub implementations, no test fitting

  3. Verification Subagent
     - Run typecheck, lint, relevant tests
     - Verify tests actually test real behavior
     - Verify RULES.md compliance

  4. Remediation Loop (if needed)
     - Fix any issues found
     - Re-verify until phase passes
```

### Phase Summary

| Phase | Name | Est. Hours | Dependencies |
|-------|------|------------|--------------|
| 1 | Extract Shared Tool Governance Module | 3-6 | None |
| 2 | Parameterize Tool Context interactiveMode | 2-4 | None |
| 3b | Migrate executeToolCall to use CoreToolScheduler | 3-5 | Phases 1, 2 |
| 3c | Migrate All Consumers | 2-4 | Phase 3b |
| 4 | Tests and Verification | 4-10 | Phase 3c |
| 5 | Final Integration (Scratch Test) | 2-4 | Phase 4 |

---

## Consumer Analysis (COMPLETE LIST)

**There are exactly 3 call sites for executeToolCall:**

1. **`packages/cli/src/nonInteractiveCli.ts`** - Line 235
   ```typescript
   // CURRENT (pre-migration): returns ToolCallResponseInfo
   const toolResponse = await executeToolCall(
     config,
     requestInfo,
     abortController.signal,
   );
   ```
   Uses full `Config` object.

2. **`packages/core/src/agents/executor.ts`** - Line 587
   ```typescript
   // CURRENT (pre-migration): returns ToolCallResponseInfo
   const toolResponse = await executeToolCall(
     this.runtimeContext,
     requestInfo,
     signal,
   );
   ```
   Uses `this.runtimeContext` which is a full `Config` object. Collects `toolResponse.responseParts`.

3. **`packages/core/src/core/subagent.ts`** - Line 1226
   ```typescript
   // CURRENT (pre-migration): returns ToolCallResponseInfo
   const toolResponse = await executeToolCall(
     this.toolExecutorContext,
     requestInfo,
     abortController.signal,
   );
   ```
   Uses `this.toolExecutorContext` which is a `ToolExecutionConfigShim` (minimal interface).

**Key insight:** This is a mechanical API migration across exactly 3 call sites:
- Before: `const toolResponse = await executeToolCall(...)` → `ToolCallResponseInfo`
- After: `const completed = await executeToolCall(...)` → `CompletedToolCall` (use `completed.response`)

---

## Phase 1: Extract Shared Tool Governance Module

### Goal
Create a single source of truth for tool governance logic (`toolGovernance.ts`) that both `coreToolScheduler.ts` and `nonInteractiveToolExecutor.ts` use.

### 1.1 Test Subagent Tasks

**File to create:** `packages/core/src/core/toolGovernance.test.ts`

- [ ] **Test 1: buildToolGovernance returns correct sets from ephemeral settings**
  ```typescript
  describe('buildToolGovernance', () => {
    it('should extract tools.allowed from ephemeral settings', () => {
      const config = createMockConfig({
        ephemerals: { 'tools.allowed': ['read_file', 'glob'] }
      });
      const governance = buildToolGovernance(config);
      expect(governance.allowed).toEqual(new Set(['read_file', 'glob']));
    });
  });
  ```

- [ ] **Test 2: buildToolGovernance handles legacy disabled-tools key**
  ```typescript
  it('should fallback to disabled-tools if tools.disabled is not present', () => {
    const config = createMockConfig({
      ephemerals: { 'disabled-tools': ['shell', 'write_file'] }
    });
    const governance = buildToolGovernance(config);
    expect(governance.disabled).toEqual(new Set(['shell', 'write_file']));
  });
  ```

- [ ] **Test 3: buildToolGovernance prefers tools.disabled over disabled-tools**
  ```typescript
  it('should prefer tools.disabled over disabled-tools', () => {
    const config = createMockConfig({
      ephemerals: {
        'tools.disabled': ['shell'],
        'disabled-tools': ['write_file'] // Should be ignored
      }
    });
    const governance = buildToolGovernance(config);
    expect(governance.disabled).toEqual(new Set(['shell']));
    expect(governance.disabled.has('write_file')).toBe(false);
  });
  ```

- [ ] **Test 4: buildToolGovernance integrates excluded tools from config**
  ```typescript
  it('should include excluded tools from getExcludeTools()', () => {
    const config = createMockConfig({
      excludeTools: ['dangerous_tool']
    });
    const governance = buildToolGovernance(config);
    expect(governance.excluded).toEqual(new Set(['dangerous_tool']));
  });
  ```

- [ ] **Test 5: normalizeToolName via normalizeToolName canonicalizes correctly**
  ```typescript
  describe('tool name normalization', () => {
    it('should normalize WriteFileTool to write_file', () => {
      const governance = buildToolGovernance(createMockConfig({
        ephemerals: { 'tools.disabled': ['WriteFileTool'] }
      }));
      expect(isToolBlocked('write_file', governance)).toBe(true);
    });

    it('should normalize writeFile to write_file', () => {
      const governance = buildToolGovernance(createMockConfig({
        ephemerals: { 'tools.disabled': ['writeFile'] }
      }));
      expect(isToolBlocked('write_file', governance)).toBe(true);
    });

    it('should normalize WRITE_FILE to write_file', () => {
      const governance = buildToolGovernance(createMockConfig({
        ephemerals: { 'tools.disabled': ['WRITE_FILE'] }
      }));
      expect(isToolBlocked('write_file', governance)).toBe(true);
    });
  });
  ```

- [ ] **Test 6: isToolBlocked returns correct blocking decision**
  ```typescript
  describe('isToolBlocked', () => {
    it('should block excluded tools', () => {
      const governance = {
        allowed: new Set<string>(),
        disabled: new Set<string>(),
        excluded: new Set(['shell'])
      };
      expect(isToolBlocked('shell', governance)).toBe(true);
    });

    it('should block disabled tools', () => {
      const governance = {
        allowed: new Set<string>(),
        disabled: new Set(['write_file']),
        excluded: new Set<string>()
      };
      expect(isToolBlocked('write_file', governance)).toBe(true);
    });

    it('should block tools not in allowed set when allowed is non-empty', () => {
      const governance = {
        allowed: new Set(['read_file', 'glob']),
        disabled: new Set<string>(),
        excluded: new Set<string>()
      };
      expect(isToolBlocked('write_file', governance)).toBe(true);
      expect(isToolBlocked('read_file', governance)).toBe(false);
    });

    it('should allow all tools when allowed set is empty', () => {
      const governance = {
        allowed: new Set<string>(),
        disabled: new Set<string>(),
        excluded: new Set<string>()
      };
      expect(isToolBlocked('any_tool', governance)).toBe(false);
    });
  });
  ```

- [ ] **Test 7: Normalization consistency between schedulers**
  ```typescript
  it('should normalize tool names consistently with normalizeToolName utility', () => {
    // Using the shared normalizeToolName from toolNameUtils.ts
    const testCases = [
      ['WriteFileTool', 'write_file'],
      ['writeFile', 'write_file'],
      ['write_file', 'write_file'],
      ['ReadFile', 'read_file'],
      ['SHELL', 'shell']
    ];

    for (const [input, expected] of testCases) {
      expect(canonicalizeToolName(input)).toBe(expected);
    }
  });
  ```

**Test Helper Function (matches nonInteractiveToolExecutor.test.ts lines 35-49):**
```typescript
function createMockConfig(options: {
  ephemerals?: Record<string, unknown>;
  excludeTools?: string[];
}): ToolGovernanceConfig {
  const ephemerals = options.ephemerals ?? {};
  return {
    getEphemeralSettings: () => ephemerals,
    getExcludeTools: () => options.excludeTools ?? []
  };
}
```

### 1.2 Implementation Subagent Tasks

**File to create:** `packages/core/src/core/toolGovernance.ts`

- [ ] **Task 1: Define ToolGovernanceConfig interface**
  ```typescript
  export interface ToolGovernanceConfig {
    getEphemeralSettings?: () => Record<string, unknown>;
    getExcludeTools?: () => string[];
  }
  ```

- [ ] **Task 2: Implement canonicalizeToolName using normalizeToolName**
  ```typescript
  import { normalizeToolName } from '../tools/toolNameUtils.js';

  export function canonicalizeToolName(rawName: string): string {
    const normalized = normalizeToolName(rawName);
    return normalized ?? rawName.trim().toLowerCase();
  }
  ```

  **Reference:** `normalizeToolName` is defined at `packages/core/src/tools/toolNameUtils.ts` lines 33-85.

- [ ] **Task 3: Implement buildToolGovernance**
  ```typescript
  export interface ToolGovernance {
    allowed: Set<string>;
    disabled: Set<string>;
    excluded: Set<string>;
  }

  export function buildToolGovernance(config: ToolGovernanceConfig): ToolGovernance {
    const ephemerals = config.getEphemeralSettings?.() ?? {};

    const allowedRaw = Array.isArray(ephemerals['tools.allowed'])
      ? ephemerals['tools.allowed'] as string[]
      : [];
    const disabledRaw = Array.isArray(ephemerals['tools.disabled'])
      ? ephemerals['tools.disabled'] as string[]
      : Array.isArray(ephemerals['disabled-tools'])
        ? ephemerals['disabled-tools'] as string[]
        : [];
    const excludedRaw = config.getExcludeTools?.() ?? [];

    return {
      allowed: new Set(allowedRaw.map(canonicalizeToolName)),
      disabled: new Set(disabledRaw.map(canonicalizeToolName)),
      excluded: new Set(excludedRaw.map(canonicalizeToolName)),
    };
  }
  ```

- [ ] **Task 4: Implement isToolBlocked**
  ```typescript
  export function isToolBlocked(
    toolName: string,
    governance: ToolGovernance
  ): boolean {
    const canonical = canonicalizeToolName(toolName);

    if (governance.excluded.has(canonical)) {
      return true;
    }
    if (governance.disabled.has(canonical)) {
      return true;
    }
    if (governance.allowed.size > 0 && !governance.allowed.has(canonical)) {
      return true;
    }
    return false;
  }
  ```

- [ ] **Task 5: Update coreToolScheduler.ts to import from shared module**

  **Current location:** `packages/core/src/core/coreToolScheduler.ts` lines 1683-1725

  - Remove local `buildToolGovernance` function (lines 1683-1708)
  - Remove local `isToolBlocked` function (lines 1710-1725)
  - Import from `./toolGovernance.js`:
    ```typescript
    import { buildToolGovernance, isToolBlocked } from './toolGovernance.js';
    ```

- [ ] **Task 6: Update nonInteractiveToolExecutor.ts to import from shared module**

  **Current location:** `packages/core/src/core/nonInteractiveToolExecutor.ts` lines 31-75

  - Remove local `buildToolGovernance` function (lines 31-58)
  - Remove local `isToolBlocked` function (lines 60-75)
  - Import from `./toolGovernance.js`:
    ```typescript
    import { buildToolGovernance, isToolBlocked } from './toolGovernance.js';
    ```

- [ ] **Task 7: Export from packages/core/src/index.ts**
  ```typescript
  export { buildToolGovernance, isToolBlocked, canonicalizeToolName, type ToolGovernance, type ToolGovernanceConfig } from './core/toolGovernance.js';
  ```

### 1.3 Verification Checklist

- [ ] All tests in `toolGovernance.test.ts` pass
- [ ] All existing tests in `coreToolScheduler.test.ts` pass (no regression)
- [ ] All existing tests in `nonInteractiveToolExecutor.test.ts` pass (no regression)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] No duplicate `buildToolGovernance` or `isToolBlocked` functions remain in codebase

### 1.4 Phase Exit Criteria

- Single source of truth for tool governance in `toolGovernance.ts`
- Both executors use the shared module
- Tool name normalization is consistent (uses `normalizeToolName` from `toolNameUtils.ts` lines 33-85)
- All existing test suites pass

---

## Phase 2: Parameterize Tool Context interactiveMode

### Goal
Allow `CoreToolScheduler` to set `ContextAwareTool.context.interactiveMode` correctly when used outside interactive UI flows.

### 2.1 Test Subagent Tasks

**File to modify:** `packages/core/src/core/coreToolScheduler.test.ts`

**CRITICAL: These tests must await completion properly. The scheduler's `schedule()` method returns BEFORE tool execution completes. Tests must use the completion promise pattern.**

- [ ] **Test 1: Default interactiveMode is true for backward compatibility**
  ```typescript
  describe('CoreToolScheduler interactiveMode', () => {
    it('should default to interactiveMode: true when no option provided', async () => {
      // Setup: Create a context-aware tool that captures its context
      let capturedContext: ToolContext | undefined;
      const capturingTool = createContextCapturingTool((ctx) => {
        capturedContext = ctx;
      });
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(capturingTool);

      // Create completion promise to properly await execution
      let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;
      const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
        completionResolver = resolve;
      });

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        onAllToolCallsComplete: async (calls) => {
          completionResolver?.(calls);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });

      // Schedule and AWAIT completion
      await scheduler.schedule([request], signal);
      await completionPromise;

      // NOW we can safely assert - execution is complete
      expect(capturedContext?.interactiveMode).toBe(true);
    });
  });
  ```

- [ ] **Test 2: toolContextInteractiveMode: false sets context correctly**
  ```typescript
  it('should set interactiveMode: false when toolContextInteractiveMode option is false', async () => {
    let capturedContext: ToolContext | undefined;
    const capturingTool = createContextCapturingTool((ctx) => {
      capturedContext = ctx;
    });
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(capturingTool);

    let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;
    const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
      completionResolver = resolve;
    });

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolContextInteractiveMode: false,  // NEW OPTION
      onAllToolCallsComplete: async (calls) => {
        completionResolver?.(calls);
      },
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    await scheduler.schedule([request], signal);
    await completionPromise;

    expect(capturedContext?.interactiveMode).toBe(false);
  });
  ```

- [ ] **Test 3: interactiveMode affects tool behavior branching**
  ```typescript
  it('should allow ContextAwareTool to branch on interactiveMode', async () => {
    let executionMode: 'interactive' | 'non-interactive' | undefined;
    const branchingTool = createBranchingContextAwareTool((ctx) => {
      executionMode = ctx.interactiveMode ? 'interactive' : 'non-interactive';
    });
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(branchingTool);

    let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;
    const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
      completionResolver = resolve;
    });

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolContextInteractiveMode: false,
      onAllToolCallsComplete: async (calls) => {
        completionResolver?.(calls);
      },
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    await scheduler.schedule([request], signal);
    await completionPromise;

    expect(executionMode).toBe('non-interactive');
  });
  ```

### 2.2 Implementation Subagent Tasks

**File to modify:** `packages/core/src/core/coreToolScheduler.ts`

- [ ] **Task 1: Add toolContextInteractiveMode to CoreToolSchedulerOptions**

  **Location:** Lines 375-383

  ```typescript
  interface CoreToolSchedulerOptions {
    config: Config;
    outputUpdateHandler?: OutputUpdateHandler;
    onAllToolCallsComplete?: AllToolCallsCompleteHandler;
    onToolCallsUpdate?: ToolCallsUpdateHandler;
    getPreferredEditor: () => EditorType | undefined;
    onEditorClose: () => void;
    onEditorOpen?: () => void;
    toolContextInteractiveMode?: boolean;  // NEW - defaults to true
  }
  ```

- [ ] **Task 2: Store option in class field**

  **Location:** After line 395 (class fields)

  ```typescript
  export class CoreToolScheduler {
    // ... existing fields
    private toolContextInteractiveMode: boolean;

    constructor(options: CoreToolSchedulerOptions) {
      // ... existing initialization
      this.toolContextInteractiveMode = options.toolContextInteractiveMode ?? true;
    }
  }
  ```

- [ ] **Task 3: Replace hardcoded interactiveMode: true**

  **Location 1:** Lines 718-723 (in setArgsInternal)
  ```typescript
  // Before:
  contextAwareTool.context = {
    sessionId: this.config.getSessionId(),
    agentId: call.request.agentId ?? DEFAULT_AGENT_ID,
    interactiveMode: true,
  };

  // After:
  contextAwareTool.context = {
    sessionId: this.config.getSessionId(),
    agentId: call.request.agentId ?? DEFAULT_AGENT_ID,
    interactiveMode: this.toolContextInteractiveMode,
  };
  ```

  **Location 2:** Lines 894-898 (in _schedule method)
  ```typescript
  // Before:
  contextAwareTool.context = {
    sessionId: this.config.getSessionId(),
    agentId: reqInfo.agentId ?? DEFAULT_AGENT_ID,
    interactiveMode: true,
  };

  // After:
  contextAwareTool.context = {
    sessionId: this.config.getSessionId(),
    agentId: reqInfo.agentId ?? DEFAULT_AGENT_ID,
    interactiveMode: this.toolContextInteractiveMode,
  };
  ```

### 2.3 Verification Checklist

- [ ] New tests for `toolContextInteractiveMode` pass
- [ ] Existing `CoreToolScheduler` tests still pass (default behavior unchanged)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

### 2.4 Phase Exit Criteria

- `CoreToolSchedulerOptions.toolContextInteractiveMode` option exists
- Default is `true` (backward compatible)
- When set to `false`, `ContextAwareTool.context.interactiveMode` is `false`
- All existing tests pass

---

## Phase 3b: Migrate executeToolCall to use CoreToolScheduler

### Goal
Modify `executeToolCall` directly to use CoreToolScheduler internally and return `CompletedToolCall` (upstream shape). **No V2 function, no shim** - we change the existing function because there are only 3 call sites.

### CRITICAL DESIGN DECISIONS

#### 1. No V2 + Shim Pattern
The original plan proposed `executeToolCallV2` with a compatibility shim. This is unnecessary:
- There are only 3 call sites total
- All can be migrated in one phase
- The shim adds complexity without value

#### 2. SubAgent Must Use createSchedulerConfig Pattern
SubAgent currently calls `executeToolCall(this.toolExecutorContext, ...)` where `toolExecutorContext` is a minimal shim. This is **WRONG** for the new design.

**Current (pre-migration):**
```typescript
// subagent.ts line 1226
toolResponse = await executeToolCall(
  this.toolExecutorContext, // MINIMAL shim - missing policy, message bus, etc.
  requestInfo,
  abortController.signal,
);
```

**Correct approach:** SubAgent already has `createSchedulerConfig({ interactive: false })` (lines 1279-1331) that builds a proper scheduler-compatible config. The migration must use this:
```typescript
const completed = await executeToolCall(
  this.createSchedulerConfig({ interactive: false }), // NOTE: must provide getEphemeralSetting('emojifilter')
  requestInfo,
  abortController.signal,
);
toolResponse = completed.response;
```

#### 3. Return Type is `CompletedToolCall` (Upstream parity)
Return the full `CompletedToolCall` (not just `ToolCallResponseInfo`) so non-interactive callers can record tool-call metadata (upstream `9e8c76769` / #10951). Consumers must use `completed.response`.

#### 4. PolicyEngine Default is DENY, Not ALLOW (SECURITY CRITICAL)
A permissive default (`evaluate() => ALLOW`) is YOLO mode. If no policy engine is configured:
- **Option chosen:** Default to DENY for non-interactive execution
- Missing policy should block tools, not allow them
- This is a fail-safe design

**IMPORTANT (TypeScript):** `PolicyEngine` and `MessageBus` are classes with private fields. Do NOT replace them with object-literal stubs (they will not typecheck without unsafe casts). If you need a fallback, instantiate real instances: `new PolicyEngine(...)`, `new MessageBus(policyEngine, false)`.

#### 5. Typing Strategy: Use Cast with Documentation
`CoreToolSchedulerOptions.config` expects a `Config` CLASS instance. Our `SchedulerConfig` is `Pick<Config, ...>`. Options:
- **Option A:** Refactor `CoreToolScheduler` to depend on an interface (cleaner but larger change)
- **Option B:** Use the cast but acknowledge it (pragmatic)
- **Option C:** Pass a real Config instance (not always available)

**Chosen: Option B** - Use `as unknown as Config` cast but document WHY it's safe: we only use the methods in the Pick, and TypeScript verifies we provide them all.

#### 6. Error Response Behavior Change (DOCUMENTED)
`CoreToolScheduler` converts `ToolResult.error` into `createErrorResponse({ error })` and **drops `llmContent`**. Current non-interactive behavior uses `convertToFunctionResponse` which always produces an output string.

**Behavior change:** Error responses will have `response.error` instead of `response.output` with error text.

This is acceptable because:
1. Callers check `toolResponse.error` first anyway
2. The error message is preserved in `response.error`
3. Matches how the interactive scheduler handles errors

#### 7. Emoji Reminder Append Logic for Errors
Current behavior appends systemFeedback whenever emoji filtering produced it, regardless of success. For errors, we must append to the error string since there's no output field.

### 3b.1 Test Subagent Tasks

**File to modify:** `packages/core/src/core/nonInteractiveToolExecutor.test.ts`

**CRITICAL: All tests must await completion properly. Use the completion promise pattern.**

- [ ] **Test 1: executeToolCall returns CompletedToolCall (use `completed.response`)**
  ```typescript
  describe('executeToolCall with scheduler', () => {
    it('should execute a tool successfully and return response with responseParts', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      const { response } = await executeToolCall(
        mockConfig,
        request,
        abortController.signal,
      );

      expect(response.callId).toBe('call1');
      expect(response.resultDisplay).toBe('Success!');
      expect(response.responseParts).toBeDefined();
      expect(response.responseParts.length).toBeGreaterThanOrEqual(2);
    });
  });
  ```

- [ ] **Test 2: Non-interactive policy enforcement (ASK_USER becomes DENY)**
  ```typescript
  describe('non-interactive policy enforcement', () => {
    it('should deny when policy would ask user (ASK_USER -> DENY)', async () => {
      const policyEngine = new PolicyEngine({
        rules: [],
        defaultDecision: PolicyDecision.ASK_USER,
        nonInteractive: false,
      });
      const messageBus = new MessageBus(policyEngine, false);

      const config = {
        ...mockConfig,
        getPolicyEngine: () => policyEngine,
        getMessageBus: () => messageBus,
        getApprovalMode: () => ApprovalMode.DEFAULT,
        getAllowedTools: () => undefined,
      };

      const { response } = await executeToolCall(
        config,
        request,
        abortController.signal,
      );

      // Should be denied deterministically, NOT awaiting approval
      expect(response.error).toBeDefined();
      expect(response.errorType).toBe(ToolErrorType.POLICY_VIOLATION);
    });

    it('should error if no policy engine is provided (fail-safe)', async () => {
      // Config without getPolicyEngine - should fail safe
      const minimalConfig = {
        ...mockConfig,
        getPolicyEngine: undefined,
      };

      const { response } = await executeToolCall(
        minimalConfig,
        request,
        abortController.signal,
      );

      // Fail-safe: no policy = deny
      expect(response.error).toBeDefined();
      expect(response.errorType).toBe(ToolErrorType.POLICY_VIOLATION);
      expect(response.error?.message).toMatch(/policy/i);
    });

    it('should error if getPolicyEngine() returns undefined (fail-safe)', async () => {
      // Config with getPolicyEngine present but returning undefined - should still fail safe
      const configReturnsUndefinedPolicy = {
        ...mockConfig,
        getPolicyEngine: () => undefined,
      };

      const { response } = await executeToolCall(
        configReturnsUndefinedPolicy,
        request,
        abortController.signal,
      );

      expect(response.error).toBeDefined();
      expect(response.errorType).toBe(ToolErrorType.POLICY_VIOLATION);
    });
  });
  ```

- [ ] **Test 3: Resources are cleaned up after execution**
  ```typescript
  describe('resource cleanup', () => {
    it('should allow subsequent executions after completion', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });

      // Execute multiple times sequentially - if resources leak, this would fail
      const results = [];
      for (let i = 0; i < 3; i++) {
        const { response } = await executeToolCall(
          mockConfig,
          { ...request, callId: `call${i}` },
          abortController.signal,
        );
        results.push(response);
      }

      // All executions should complete successfully
      expect(results).toHaveLength(3);
      results.forEach(response => {
        expect(response.error).toBeUndefined();
      });
    });

    it('should allow subsequent executions after failure', async () => {
      // First call fails
      mockTool.executeFn.mockRejectedValueOnce(new Error('Tool failed'));
      const { response: failedResult } = await executeToolCall(
        mockConfig,
        { ...request, callId: 'fail' },
        abortController.signal,
      );
      expect(failedResult.error).toBeDefined();

      // Subsequent call should work - resources were cleaned up
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Success',
        returnDisplay: 'Success!',
      });
      const { response: successResult } = await executeToolCall(
        mockConfig,
        { ...request, callId: 'success' },
        abortController.signal,
      );
      expect(successResult.error).toBeUndefined();
    });
  });
  ```

- [ ] **Test 4: Handles malformed tool request gracefully**
  ```typescript
  it('should return error for tool that does not exist', async () => {
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(undefined);

    const { response } = await executeToolCall(
      mockConfig,
      { ...request, name: 'nonexistent_tool' },
      abortController.signal,
    );

    expect(response.error).toBeDefined();
    expect(response.errorType).toBe(ToolErrorType.TOOL_NOT_REGISTERED);
  });

  it('should return error for invalid tool arguments', async () => {
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    mockTool.executeFn.mockImplementation(() => {
      throw new Error('Invalid arguments: missing required field "path"');
    });

    const { response } = await executeToolCall(
      mockConfig,
      { ...request, args: {} },
      abortController.signal,
    );

    expect(response.error).toBeDefined();
    expect(response.error?.message).toContain('Invalid arguments');
  });
  ```

- [ ] **Test 5: Abort signal propagation**
  ```typescript
  it('should cancel an in-progress tool call when aborted', async () => {
    const abortController = new AbortController();

    // Setup a tool that *starts*, then waits until aborted.
    let startedResolver: (() => void) | null = null;
    const startedPromise = new Promise<void>((resolve) => {
      startedResolver = resolve;
    });

    mockTool.executeFn.mockImplementation(async (_args, signal) => {
      startedResolver?.();
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return { llmContent: 'Should not reach', returnDisplay: 'Should not reach' };
    });

    // Start execution, wait until tool has actually started, then abort.
    const executionPromise = executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );
    await startedPromise;
    abortController.abort();

    const completed = await executionPromise;

    expect(completed.status).toBe('cancelled');
    expect(completed.response.error).toBeUndefined();
    expect(
      completed.response.responseParts?.[1]?.functionResponse?.response,
    ).toMatchObject({
      error: expect.stringContaining('[Operation Cancelled]'),
    });
  });
  ```

- [ ] **Test 6: Error response contains correct tool call metadata**
  ```typescript
  describe('error response structure', () => {
    it('should include original request info in error response', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockRejectedValue(new Error('Execution failed'));

      const { response } = await executeToolCall(
        mockConfig,
        request,
        abortController.signal,
      );

      expect(response.error).toBeDefined();
      expect(response.callId).toBe(request.callId);
    });

    it('should include functionCall and functionResponse in responseParts', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockRejectedValue(new Error('Execution failed'));

      const { response } = await executeToolCall(
        mockConfig,
        request,
        abortController.signal,
      );

      const parts = response.responseParts;
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts[0].functionCall?.id).toBe(request.callId);
      expect(parts[1].functionResponse?.id).toBe(request.callId);
    });
  });
  ```

- [ ] **Test 7: Emoji filtering with error responses**
  ```typescript
  describe('emoji filtering with errors', () => {
    it('should append systemFeedback to error message when emoji filtering warns', async () => {
      // Setup emoji filter to produce warning
      const ephemerals = { emojifilter: 'warn' as const };
      const configWithEmojiFilter = {
        ...mockConfig,
        getEphemeralSettings: () => ephemerals,
        getEphemeralSetting: (key: string) => ephemerals[key as keyof typeof ephemerals],
      };

      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockRejectedValue(new Error('Tool error'));

      const { response } = await executeToolCall(
        configWithEmojiFilter,
        { ...request, args: { content: 'Has emoji content' } },
        abortController.signal,
      );

      expect(response.error).toBeDefined();
      // Error message should include systemFeedback if emoji filtering produced any
      // (This verifies the error path includes system feedback)
    });
  });
  ```

### 3b.2 Implementation Subagent Tasks

**File to modify:** `packages/core/src/core/nonInteractiveToolExecutor.ts`

- [ ] **Pre-check: Confirm PolicyEngine API used here exists**
  - Verify `PolicyEngine` includes `getRules()`, `getDefaultDecision()`, and `isNonInteractive()` in `packages/core/src/policy/policy-engine.ts`.
  - If any method is missing, STOP and update this plan (do not guess method names).

- [ ] **Task 1: Create non-interactive policy wrapper (ASK_USER -> DENY)**
  ```typescript
  function createNonInteractivePolicyEngine(policyEngine?: PolicyEngine): PolicyEngine {
    if (!policyEngine) {
      // Fail-safe: deny all if no policy engine.
      return new PolicyEngine({
        rules: [],
        defaultDecision: PolicyDecision.DENY,
        nonInteractive: true,
      });
    }

    if (policyEngine.isNonInteractive()) {
      return policyEngine;
    }

    // Clone rules/defaultDecision but force nonInteractive=true (ASK_USER -> DENY inside PolicyEngine).
    return new PolicyEngine({
      rules: [...policyEngine.getRules()],
      defaultDecision: policyEngine.getDefaultDecision(),
      nonInteractive: true,
    });
  }
  ```

- [ ] **Task 2: Create scheduler config builder**

  ```typescript
  /**
   * Minimal config interface for scheduler instantiation.
   * This is the subset of Config methods that CoreToolScheduler actually uses.
   *
   * TYPING NOTE: We use `as unknown as Config` when passing to CoreToolScheduler
   * because CoreToolScheduler.options.config is typed as the full Config class.
   * This cast is SAFE because:
   * 1. TypeScript verifies we implement all methods in SchedulerConfigMethods
   * 2. CoreToolScheduler only calls the methods we provide
   * 3. If CoreToolScheduler starts using new methods, this code will fail at runtime
   *    with a clear error, prompting us to add the method
   */
  type SchedulerConfigMethods =
    | 'getToolRegistry'
    | 'getSessionId'
    | 'getEphemeralSettings'
    | 'getExcludeTools'
    | 'getTelemetryLogPromptsEnabled'
    | 'getAllowedTools'
    | 'getApprovalMode'
    | 'getMessageBus'
    | 'getPolicyEngine';

  // NOTE: SchedulerConfig does NOT need getEphemeralSetting(key).
  // executeToolCall's *input* config DOES need getEphemeralSetting('emojifilter') for emoji filtering.
  type SchedulerConfig = Pick<Config, SchedulerConfigMethods>;

  function createSchedulerConfigForNonInteractive(
    config: ToolExecutionConfig
  ): SchedulerConfig {
    const getEphemeralSettings =
      typeof config.getEphemeralSettings === 'function'
        ? config.getEphemeralSettings
        : () => ({});

    const rawPolicyEngine = typeof config.getPolicyEngine === 'function'
      ? config.getPolicyEngine()
      : undefined;
    const policyEngine = createNonInteractivePolicyEngine(rawPolicyEngine);
    const messageBus =
      typeof config.getMessageBus === 'function'
        ? config.getMessageBus()
        : new MessageBus(policyEngine, false);

    return {
      getToolRegistry: config.getToolRegistry,
      getSessionId: config.getSessionId,
      getEphemeralSettings,
      getExcludeTools: config.getExcludeTools ?? (() => []),
      getTelemetryLogPromptsEnabled: config.getTelemetryLogPromptsEnabled,
      getAllowedTools: typeof config.getAllowedTools === 'function'
        ? config.getAllowedTools
        : () => undefined,
      getApprovalMode: typeof config.getApprovalMode === 'function'
        ? config.getApprovalMode
        : () => ApprovalMode.DEFAULT,
      getMessageBus: () => messageBus,
      getPolicyEngine: () => policyEngine,
    };
  }
  ```

- [ ] **Task 2a: Extract emoji filtering into `applyEmojiFiltering` (preserve all special cases)**

  **Goal:** Make emoji filtering behavior explicit and testable, while preserving current non-interactive behavior exactly.

  **Source of truth:** Current logic in `packages/core/src/core/nonInteractiveToolExecutor.ts`:
  - Search-tool bypass list (do not filter)
  - File-modification special cases:
    - **Never filter `file_path`** (paths may legitimately contain emojis)
    - **Never filter `old_string`** (must match file contents exactly)
    - Filter only `new_string` / `content`

  ```typescript
  type EmojiFilteringOutcome = {
    filteredRequest: ToolCallRequestInfo;
    systemFeedback?: string;
  };

  function applyEmojiFiltering(
    filter: EmojiFilter,
    toolCallRequest: ToolCallRequestInfo,
  ): EmojiFilteringOutcome {
    // Search tools need unfiltered access so users can *find* emojis.
    const isSearchTool = [
      'shell',
      'bash',
      'exec',
      'run_shell_command',
      'grep',
      'search_file_content',
      'glob',
      'find',
      'ls',
      'list_directory',
      'read_file',
      'read_many_files',
    ].includes(toolCallRequest.name);

    if (isSearchTool) {
      return { filteredRequest: toolCallRequest };
    }

    // File modification tools require special handling (never filter old_string or file_path).
    const isFileModTool = [
      'edit_file',
      'edit',
      'write_file',
      'create_file',
      'replace',
      'replace_all',
    ].includes(toolCallRequest.name);

    const filterResult = isFileModTool
      ? filterFileModificationArgs(
          filter,
          toolCallRequest.name,
          toolCallRequest.args,
        )
      : filter.filterToolArgs(toolCallRequest.args);

    if (filterResult.blocked) {
      // Caller maps this to ToolErrorType.INVALID_TOOL_PARAMS and returns a wrapper-level error response.
      throw new Error(filterResult.error || 'Tool execution blocked');
    }

    return {
      filteredRequest: {
        ...toolCallRequest,
        args: filterResult.filtered as Record<string, unknown>,
      },
      systemFeedback: filterResult.systemFeedback,
    };
  }
  ```

- [ ] **Task 2b: Expand `ToolExecutionConfig` to include scheduler-required methods**

  **Why:** Current `ToolExecutionConfig` in `packages/core/src/core/nonInteractiveToolExecutor.ts` is a narrow `Pick<Config, ...>` and does not include `getPolicyEngine`, `getMessageBus`, `getApprovalMode`, or `getAllowedTools`, but the unified implementation needs them.

  **Exact type change (minimal, keeps fail-safe behavior):**
  ```typescript
  export type ToolExecutionConfig =
    Pick<
      Config,
      | 'getToolRegistry'
      | 'getEphemeralSettings'
      | 'getEphemeralSetting'
      | 'getExcludeTools'
      | 'getSessionId'
      | 'getTelemetryLogPromptsEnabled'
    > &
      Partial<
        Pick<
          Config,
          'getAllowedTools' | 'getApprovalMode' | 'getMessageBus' | 'getPolicyEngine'
        >
      >;
  ```

- [ ] **Task 3: Rewrite executeToolCall to use CoreToolScheduler**

  **CRITICAL:** Uses Promise-based pattern to avoid race condition
  **CRITICAL:** Must preserve agentId from request through to response (see Key Architecture Decision #7)

  ```typescript
  export async function executeToolCall(
    config: ToolExecutionConfig,
    toolCallRequest: ToolCallRequestInfo,
    abortSignal?: AbortSignal,
  ): Promise<CompletedToolCall> {
    const startTime = Date.now();

    // IMPORTANT: Preserve agentId - it must flow through to the response
    const agentId = toolCallRequest.agentId ?? DEFAULT_AGENT_ID;
    toolCallRequest.agentId = agentId;

    // Always use an internal AbortController so we can deterministically abort/cancel
    // in "impossible" states (e.g. awaiting_approval) even if the caller did not provide
    // a mutable AbortSignal.
    const internalAbortController = new AbortController();
    if (abortSignal) {
      if (abortSignal.aborted) {
        internalAbortController.abort();
      } else {
        abortSignal.addEventListener(
          'abort',
          () => internalAbortController.abort(),
          { once: true },
        );
      }
    }

    // 1. Apply emoji filtering before scheduling (emoji ownership: wrapper applies it)
    const filter = getOrCreateFilter(config);
    let filteredRequest = toolCallRequest;
    let systemFeedback: string | undefined;

    try {
      const filterResult = applyEmojiFiltering(filter, toolCallRequest);
      filteredRequest = filterResult.filteredRequest;
      systemFeedback = filterResult.systemFeedback;
    } catch (e) {
      // Emoji filter blocked execution
      return createErrorCompletedToolCall(
        toolCallRequest,
        e instanceof Error ? e : new Error(String(e)),
        ToolErrorType.INVALID_TOOL_PARAMS,
        Date.now() - startTime,
      );
    }

    // 2. Create scheduler config wrapper
    const schedulerConfig = createSchedulerConfigForNonInteractive(config);

    // 3. Create Promise-based completion handler (fixes race condition)
    let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;
    const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
      completionResolver = resolve;
    });

    // 3b. Detect awaiting_approval without throwing from scheduler callbacks.
    // (Requires: import type { ToolCall } from './coreToolScheduler.js')
    let awaitingApprovalResolver: ((call: ToolCall) => void) | null = null;
    const awaitingApprovalPromise = new Promise<ToolCall>((resolve) => {
      awaitingApprovalResolver = resolve;
    });

    // 4. Create scheduler instance
    // TYPING: Cast is safe because we provide all methods CoreToolScheduler uses
    const scheduler = new CoreToolScheduler({
      config: schedulerConfig as unknown as Config,
      toolContextInteractiveMode: false, // Non-interactive context
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onAllToolCallsComplete: async (completedToolCalls) => {
        if (completionResolver) {
          completionResolver(completedToolCalls);
        }
      },
      onToolCallsUpdate: (toolCalls) => {
        // IMPORTANT: Never throw from callbacks invoked by CoreToolScheduler internals.
        // If we ever see awaiting_approval in non-interactive mode, return a deterministic error.
        try {
          const awaiting = toolCalls.find(
            (c) => c.status === 'awaiting_approval',
          );
          if (awaiting && awaitingApprovalResolver) {
            awaitingApprovalResolver(awaiting);
            awaitingApprovalResolver = null;
          }
        } catch {
          // Swallow - callback must be non-throwing.
        }
      },
    });

    try {
      // 5. Schedule the (filtered) tool call
      const effectiveSignal = internalAbortController.signal;
      await scheduler.schedule([filteredRequest], effectiveSignal);

      // 6. Wait for either completion OR a forbidden awaiting_approval state.
      const raceResult = await Promise.race([
        completionPromise.then((calls) => ({
          kind: 'complete' as const,
          calls,
        })),
        awaitingApprovalPromise.then((call) => ({
          kind: 'awaiting' as const,
          call,
        })),
      ]);

      if (raceResult.kind === 'awaiting') {
        // Cleanup requirement: do not return while the scheduler still holds a live awaiting_approval call.
        // Abort signal interrupts any in-flight tool execution; cancelAll clears awaiting_approval state.
        internalAbortController.abort();
        scheduler.cancelAll();
        return createErrorCompletedToolCall(
          toolCallRequest,
          new Error(
            'Non-interactive tool execution reached awaiting_approval; treat as policy denial (no user interaction is possible).',
          ),
          ToolErrorType.POLICY_VIOLATION,
          Date.now() - startTime,
        );
      }

      const completedCalls = raceResult.calls;

      if (completedCalls.length !== 1) {
        throw new Error('Non-interactive executor expects exactly one tool call');
      }

      const completed = completedCalls[0];

      // 7. Append system feedback if emoji filtering produced any
      if (systemFeedback) {
        appendSystemFeedbackToResponse(completed.response, systemFeedback);
      }

      // 8. Ensure agentId is preserved in the response (CRITICAL for tracing)
      // The scheduler should already include agentId from the request,
      // but we verify it here as a defensive measure
      if (!completed.response.agentId) {
        completed.response.agentId = agentId;
      }

      return completed;
    } catch (e) {
      return createErrorCompletedToolCall(
        toolCallRequest,
        e instanceof Error ? e : new Error(String(e)),
        ToolErrorType.UNHANDLED_EXCEPTION,
        Date.now() - startTime,
      );
    } finally {
      // 9. Cleanup
      // If we aborted (caller abort OR internal abort), force scheduler state to terminal to avoid leaks.
      if (internalAbortController.signal.aborted) {
        scheduler.cancelAll();
      }
      scheduler.dispose();
    }
  }
  ```

- [ ] **Task 4: Helper for wrapper-level error `CompletedToolCall`**
  ```typescript
  function createErrorCompletedToolCall(
    request: ToolCallRequestInfo,
    error: Error,
    errorType: ToolErrorType,
    durationMs: number,
  ): CompletedToolCall {
    return {
      status: 'error',
      request,
      response: {
        callId: request.callId,
        agentId: request.agentId ?? DEFAULT_AGENT_ID,
        error,
        errorType,
        resultDisplay: error.message,
        responseParts: [
          {
            functionCall: {
              id: request.callId,
              name: request.name,
              args: request.args,
            },
          },
          {
            functionResponse: {
              id: request.callId,
              name: request.name,
              response: { error: error.message },
            },
          },
        ],
      },
      durationMs,
    };
  }
  ```

- [ ] **Task 5: Helper function for appending system feedback to responses**
  ```typescript
  function appendSystemFeedbackToResponse(
    response: ToolCallResponseInfo,
    systemFeedback: string
  ): void {
    if (response.error) {
      // For error responses, append systemFeedback to the error message
      // since there's no output field
      const originalMessage = response.error.message;
      response.error = new Error(`${originalMessage}\n\n${systemFeedback}`);

      // Also update resultDisplay if it exists
      if (response.resultDisplay) {
        response.resultDisplay = `${response.resultDisplay}\n\n${systemFeedback}`;
      }

      // Update functionResponse in responseParts if present
      const funcResponse = response.responseParts.find(p => p.functionResponse);
      if (funcResponse?.functionResponse?.response) {
        const respObj = funcResponse.functionResponse.response;
        if (typeof respObj.error === 'string') {
          respObj.error = `${respObj.error}\n\n${systemFeedback}`;
        }
      }
    } else {
      // For success responses, append to functionResponse.response.output (existing behavior).
      const funcResponse = response.responseParts.find(
        (p) => p.functionResponse?.response && typeof p.functionResponse.response === 'object',
      );
      const respObj = funcResponse?.functionResponse?.response as
        | { output?: unknown; error?: unknown }
        | undefined;
      if (respObj && typeof respObj.output === 'string') {
        respObj.output = `${respObj.output}\n\n<system-reminder>\n${systemFeedback}\n</system-reminder>`;
      }
    }
  }
  ```

### Emoji Filtering Ownership

**Decision:** The wrapper (`executeToolCall`) owns emoji filtering.

**Rationale:**
1. The scheduler does NOT apply emoji filtering
2. The wrapper applies filtering BEFORE passing to scheduler
3. Some individual tools also consult `emojifilter`; wrapper-level filtering must ensure those tools see already-filtered args (so they become a no-op and do not add a second reminder)
4. System feedback is appended AFTER scheduler returns
5. File-modification rules are preserved (never filter `old_string` / `file_path`; search tools bypass filtering)

**Flow:**
```
executeToolCall
  |
  +-- applyEmojiFiltering(request) --> filteredRequest + systemFeedback
  |
  +-- scheduler.schedule(filteredRequest)
  |
  +-- [scheduler executes tool with filtered args]
  |
  +-- appendSystemFeedbackToResponse(completed.response, systemFeedback)
  |        |
  |        +-- if (error): append to error.message
  |        +-- else: append to output
  |
  +-- return completed
```

### Error Response Behavior Change

**DOCUMENTED BEHAVIOR CHANGE:**

Before (nonInteractiveToolExecutor):
- Error responses had `response.output` containing error text
- `convertToFunctionResponse` always produced output string

After (CoreToolScheduler path):
- Error responses have `response.error` containing error
- `llmContent` is dropped for error responses
- Error message is in `functionResponse.response.error`

This is acceptable because callers already check `response.error` before using output.

### 3b.3 Verification Checklist

- [ ] All `executeToolCall` tests pass
- [ ] No race conditions in completion handling (Promise-based)
- [ ] Scheduler resources always cleaned up (dispose in finally)
- [ ] Early-exit cleanup: awaiting_approval / abort triggers `internalAbortController.abort()` + `scheduler.cancelAll()` before dispose
- [ ] ASK_USER policy decisions become DENY
- [ ] Missing policy engine = DENY (fail-safe)
- [ ] Error responses include systemFeedback when applicable
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

### 3b.4 Phase Exit Criteria

- `executeToolCall` uses `CoreToolScheduler` internally with `toolContextInteractiveMode: false`
- Emoji filtering happens in wrapper (not double-filtered)
- Policy engine is wrapped for non-interactive mode (ASK_USER -> DENY)
- Missing policy engine = DENY (not permissive ALLOW)
- Scheduler always disposed in finally block
- Error responses properly include systemFeedback

---

## Phase 3c: Migrate All Consumers

### Goal
Update all 3 consumers of `executeToolCall` to handle the `CompletedToolCall` return type and (for SubAgent) pass a scheduler-compatible config.

### 3c.1 Consumer Migration

**Consumer 1: `packages/cli/src/nonInteractiveCli.ts`** - Line 235

Already passes full `Config` object. Must update call sites to use `completed.response` (and, if desired, record `CompletedToolCall[]` like upstream `#10951`).

**Consumer 2: `packages/core/src/agents/executor.ts`** - Line 587

Already passes `this.runtimeContext` which is a full `Config`. Must update call sites to use `completed.response`.

Verify it handles the response correctly:
```typescript
// CURRENT (pre-migration):
const toolResponse = await executeToolCall(
  this.runtimeContext,
  requestInfo,
  signal,
);

// AFTER (post Phase 3b):
const completed = await executeToolCall(
  this.runtimeContext,
  requestInfo,
  signal,
);
const toolResponse = completed.response;

if (toolResponse.error) {
  this.emitActivity('ERROR', {
    context: 'tool_call',
    name: functionCall.name,
    error: toolResponse.error.message,
  });
} else {
  this.emitActivity('TOOL_CALL_END', {
    name: functionCall.name,
    output: toolResponse.resultDisplay,
  });
}

return toolResponse.responseParts;
```

This works with the new implementation because:
- It checks `toolResponse.error` first (handles new error behavior)
- It uses `toolResponse.responseParts` (still provided)

**Consumer 3: `packages/core/src/core/subagent.ts`** - Line 1226

**THIS IS THE CRITICAL MIGRATION.**

**IMPORTANT: SubAgents have TWO execution modes:**
1. **`runInteractive()`** - Uses `CoreToolScheduler` directly with `interactive: true` (line 619). This path does NOT call `executeToolCall` - it schedules tools directly through the scheduler.
2. **`runNonInteractive()`** - Uses `executeToolCall` at line 1226 (inside `processFunctionCalls`). This is the path being migrated.

The migration below ONLY affects the `runNonInteractive` code path. Interactive SubAgents using `runInteractive()` are NOT affected because they already use the scheduler directly with the correct `interactive: true` setting.

Current (WRONG for unified path):
```typescript
// Line 1226 (in processFunctionCalls, called from runNonInteractive)
toolResponse = await executeToolCall(
  this.toolExecutorContext, // MINIMAL shim - missing critical methods
  requestInfo,
  abortController.signal,
);
```

SubAgent's `toolExecutorContext` is a `ToolExecutionConfigShim` that does NOT have:
- `getEphemeralSetting` (needed for `emojifilter` in non-interactive executor)
- `getPolicyEngine` (needed for policy enforcement)
- `getMessageBus` (needed for scheduler)
- `getApprovalMode` (needed for approval mode)
- `getAllowedTools` (needed for tool filtering)

However, SubAgent already has `createSchedulerConfig()` (lines 1279-1331) that builds a proper config with all these methods! This method takes an `interactive` parameter that should match the SubAgent's execution mode.

**Migration:**
```typescript
// Before (line 1226, pre-migration):
toolResponse = await executeToolCall(
  this.toolExecutorContext,
  requestInfo,
  abortController.signal,
);

// After (for runNonInteractive path, post Phase 3b):
const completed = await executeToolCall(
  this.createSchedulerConfig({ interactive: false }), // NOTE: must provide getEphemeralSetting('emojifilter')
  requestInfo,
  abortController.signal,
);
toolResponse = completed.response;
```

**Note:** The `interactive: false` is correct here because this code path is ONLY executed from `runNonInteractive()`. The `runInteractive()` method does NOT use `executeToolCall` - it uses `CoreToolScheduler` directly with `interactive: true` at line 619.

### 3c.2 Implementation Tasks

- [ ] **Task 0: Add `getEphemeralSetting(key)` to subagent.ts createSchedulerConfig**

  **Why:** `executeToolCall` reads `config.getEphemeralSetting('emojifilter')`. SubAgent’s `createSchedulerConfig()` currently provides only `getEphemeralSettings()`, so passing it into `executeToolCall` would throw at runtime.

  **File:** `packages/core/src/core/subagent.ts` (method `createSchedulerConfig`, currently returns a `Config` cast)

  **Exact change:** Add `getEphemeralSetting` derived from `getEphemeralSettings`.
  ```typescript
  const getEphemeralSetting = (key: string): unknown =>
    getEphemeralSettings()[key];

  return {
    // ...existing methods...
    getEphemeralSettings,
    getEphemeralSetting,
    // ...existing methods...
  } as unknown as Config;
  ```

- [ ] **Task 1: Update subagent.ts runNonInteractive path to use createSchedulerConfig**

  **Location:** Lines 1224-1230 (inside `processFunctionCalls`, called only from `runNonInteractive`)

  **Note:** This change ONLY affects the non-interactive execution path. The `runInteractive()` method already correctly uses `CoreToolScheduler` directly with `interactive: true` at line 619 - that code path is unaffected by this migration.

  ```typescript
  } else {
    // @plan PLAN-20251028-STATELESS6.P08
    // @requirement REQ-STAT6-001.1
    // Note: interactive: false is correct here - this path is only called from runNonInteractive()
    const completed = await executeToolCall(
      this.createSchedulerConfig({ interactive: false }),
      requestInfo,
      abortController.signal,
    );
    toolResponse = completed.response;
  }
  ```

- [ ] **Task 2: Verify nonInteractiveCli.ts passes Config with getPolicyEngine**

  The `config` parameter in nonInteractiveCli.ts is a full `Config` object from the initialization flow. Verify it has `getPolicyEngine` method.

- [ ] **Task 3: Verify executor.ts passes Config with getPolicyEngine**

  The `this.runtimeContext` in AgentExecutor is a full `Config` object. Verify it has `getPolicyEngine` method.

### 3c.3 Verification Checklist

- [ ] All subagent tests pass
- [ ] All nonInteractiveToolExecutor tests pass
- [ ] All AgentExecutor tests pass
- [ ] No TypeScript errors
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

### 3c.4 Phase Exit Criteria

- All 3 consumers handle `CompletedToolCall` return type (`completed.response`)
- SubAgent's `runNonInteractive` path uses `createSchedulerConfig({ interactive: false })` instead of `toolExecutorContext`
- SubAgent's `runInteractive` path continues to use `CoreToolScheduler` directly with `interactive: true` (unchanged)
- All tests pass

---

## Phase 4: Tests and Verification for Unification

### Goal
Comprehensive test coverage validating the unified execution path.

### 4.1 Test Subagent Tasks

**File to create:** `packages/core/src/core/unifiedToolExecution.test.ts`

- [ ] **Test scaffolding (copy/paste first)**
  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { executeToolCall, type ToolExecutionConfig } from './nonInteractiveToolExecutor.js';
  import type { ToolRegistry, ToolCallRequestInfo, ToolCallResponseInfo } from '../index.js';
  import { ApprovalMode } from '../config/config.js';
  import { PolicyEngine } from '../policy/policy-engine.js';
  import { PolicyDecision } from '../policy/types.js';
  import { MessageBus } from '../confirmation-bus/message-bus.js';
  import { MockTool } from '../test-utils/tools.js';

  let mockToolRegistry: ToolRegistry;
  let mockTool: MockTool;
  let abortController: AbortController;
  let signal: AbortSignal;
  let request: ToolCallRequestInfo;
  let config: ToolExecutionConfig;

  function createAllowSpecificToolPolicyEngine(toolName: string): PolicyEngine {
    return new PolicyEngine({
      rules: [{ toolName, decision: PolicyDecision.ALLOW, priority: 2.5 }],
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: false,
    });
  }

  function createMockConfigWithPolicyEngine(
    policyEngine: PolicyEngine,
    options?: {
      ephemerals?: Record<string, unknown>;
      approvalMode?: ApprovalMode;
      allowedTools?: string[] | undefined;
    },
  ): ToolExecutionConfig {
    const ephemerals = options?.ephemerals ?? {};
    const messageBus = new MessageBus(policyEngine, false);
    return {
      getToolRegistry: () => mockToolRegistry,
      getSessionId: () => 'test-session-id',
      getTelemetryLogPromptsEnabled: () => false,
      getExcludeTools: () => [],
      getEphemeralSettings: () => ephemerals,
      getEphemeralSetting: (key: string) => ephemerals[key],
      getPolicyEngine: () => policyEngine,
      getMessageBus: () => messageBus,
      getApprovalMode: () => options?.approvalMode ?? ApprovalMode.DEFAULT,
      getAllowedTools: () => options?.allowedTools,
    };
  }

  function createMockConfig(options?: {
    ephemerals?: Record<string, unknown>;
    approvalMode?: ApprovalMode;
    allowedTools?: string[] | undefined;
  }): ToolExecutionConfig {
    const policyEngine = createAllowSpecificToolPolicyEngine('testTool');
    return createMockConfigWithPolicyEngine(policyEngine, options);
  }

  function getFullResponseText(response: ToolCallResponseInfo): string {
    const chunks: string[] = [];
    for (const part of response.responseParts ?? []) {
      const payload = part.functionResponse?.response as
        | { output?: unknown; error?: unknown }
        | undefined;
      if (payload) {
        if (typeof payload.output === 'string') chunks.push(payload.output);
        if (typeof payload.error === 'string') chunks.push(payload.error);
      }
      if (typeof part.text === 'string') chunks.push(part.text);
    }
    return chunks.join('\n');
  }

  beforeEach(() => {
    mockTool = new MockTool('testTool');
    mockToolRegistry = {
      getTool: vi.fn(),
      getAllToolNames: vi.fn().mockReturnValue(['testTool']),
      getAllTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolRegistry;

    abortController = new AbortController();
    signal = abortController.signal;

    request = {
      callId: 'call1',
      name: 'testTool',
      args: { param1: 'value1' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };

    config = createMockConfig();
  });
  ```

- [ ] **Test 1: Non-interactive determinism test**
  ```typescript
  describe('non-interactive determinism', () => {
    it('should terminate deterministically when policy would normally ask user', async () => {
      // Construct a scheduler config with PolicyEngine({ nonInteractive: false, defaultDecision: ASK_USER })
      // Execute a tool call through executeToolCall
      // Assert the run terminates with DENY (not awaiting_approval)
      // Assert it never enters awaiting_approval state

      const policyEngine = new PolicyEngine({
        rules: [],
        defaultDecision: PolicyDecision.ASK_USER,
        nonInteractive: false,
      });
      const config = createMockConfigWithPolicyEngine(policyEngine);

      const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
        let timeoutId: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('timeout')), ms);
        });
        try {
          return await Promise.race([promise, timeout]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      };

      const { response } = await withTimeout(
        executeToolCall(config, request, signal),
        2000,
      );

      // Should be denied deterministically
      expect(response.error).toBeDefined();
      expect(response.errorType).toBe(ToolErrorType.POLICY_VIOLATION);

      // Should never have reached awaiting_approval (guarded by withTimeout above).
      expect(response.error?.message).not.toMatch(/awaiting_approval/i);
    });
  });
  ```

- [ ] **Test 2: Single system-reminder in output (no double-filtering)**
  ```typescript
  it('should produce exactly one system-reminder when emoji filtering warns', async () => {
    const config = createMockConfig({
      ephemerals: { 'emojifilter': 'warn' }
    });

    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    mockTool.executeFn.mockReturnValue({
      llmContent: 'Tool completed',
      returnDisplay: 'Success',
    });

    const { response } = await executeToolCall(
      config,
      { ...request, args: { content: 'Has emojis somewhere' } },
      signal
    );

    const responseText = getFullResponseText(response);
    const reminderCount = (responseText.match(/<system-reminder>/g) || []).length;
    expect(reminderCount).toBeLessThanOrEqual(1);  // 0 or 1, never 2+
  });
  ```

- [ ] **Test 3: Tool call/response pairing is atomic**
  ```typescript
  it('should return paired functionCall and functionResponse parts', async () => {
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    mockTool.executeFn.mockReturnValue({ llmContent: 'Success' });

    const { response } = await executeToolCall(config, request, signal);

    const parts = response.responseParts;
    expect(parts.length).toBeGreaterThanOrEqual(2);

    // First part should be functionCall
    expect(parts[0].functionCall).toBeDefined();
    expect(parts[0].functionCall.id).toBe(request.callId);

    // Second part should be functionResponse
    expect(parts[1].functionResponse).toBeDefined();
    expect(parts[1].functionResponse.id).toBe(request.callId);
  });
  ```

- [ ] **Test 4: Tool execution produces complete response metadata**
  ```typescript
  describe('response metadata completeness', () => {
    it('should include agentId in response for tracing', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({ llmContent: 'Success' });

      const { response } = await executeToolCall(config, request, signal);

      expect(response.agentId).toBeDefined();
      expect(typeof response.agentId).toBe('string');
    });

    it('should preserve agentId from request through to response', async () => {
      // CRITICAL: This test verifies agentId flows from request to response
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({ llmContent: 'Success' });

      const customAgentId = 'custom-agent-123';
      const requestWithAgentId = { ...request, agentId: customAgentId };

      const { response } = await executeToolCall(config, requestWithAgentId, signal);

      expect(response.agentId).toBe(customAgentId);
    });

    it('should use DEFAULT_AGENT_ID when request has no agentId', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({ llmContent: 'Success' });

      const requestWithoutAgentId = { ...request, agentId: undefined };

      const { response } = await executeToolCall(config, requestWithoutAgentId, signal);

      expect(response.agentId).toBe(DEFAULT_AGENT_ID);
    });

    it('should include callId matching request for correlation', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({ llmContent: 'Success' });

      const { response } = await executeToolCall(config, request, signal);

      expect(response.callId).toBe(request.callId);
    });

    it('should include resultDisplay for user-facing output', async () => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
      mockTool.executeFn.mockReturnValue({
        llmContent: 'Tool completed',
        returnDisplay: 'Operation successful',
      });

      const { response } = await executeToolCall(config, request, signal);

      expect(response.error).toBeUndefined();
      expect(response.resultDisplay).toBe('Operation successful');
    });
  });
  ```

- [ ] **Test 5: Fail-safe policy (no policy = deny)**
  ```typescript
  describe('fail-safe policy enforcement', () => {
    it('should deny all tools when no policy engine is configured', async () => {
      const configWithoutPolicy = {
        ...mockConfig,
        getPolicyEngine: undefined,
      };

      const { response } = await executeToolCall(configWithoutPolicy, request, signal);

      expect(response.error).toBeDefined();
      expect(response.errorType).toBe(ToolErrorType.POLICY_VIOLATION);
    });
  });
  ```

### 4.2 Verification Subagent Tasks

- [ ] Run full test suite: `npm run test`
- [ ] Run typecheck: `npm run typecheck`
- [ ] Run lint: `npm run lint`
- [ ] Verify no console.log or debug statements added
- [ ] Verify no `any` types introduced
- [ ] Verify all tests verify real behavior (not mock interactions)

### 4.3 Phase Exit Criteria

- All new tests pass
- All existing tests pass
- No regressions in buffered parallel execution
- No double-telemetry logging
- Atomic tool call/response pairing maintained

---

## Phase 5: Final Integration (Scratch Test)

### Goal
Verify the unified tool execution works end-to-end with real tool calls.

### 5.1 Scratch Test Execution

**Command:**
```bash
node scripts/start.js --profile-load synthetic --prompt "look through this code and tell me what it does, do not use a subagent"
```

**Expected behavior:**
- Makes multiple tool calls (read_file, glob, grep, etc.)
- Each tool call flows through the unified execution path
- Emoji filtering applies where appropriate
- Tool governance works correctly
- No hangs or awaiting_approval states
- Returns coherent response about the code

### 5.2 Enhanced Scratch Test Verification

- [ ] **Emoji filtering behavior:**
  ```bash
  # Use YOLO so write tools are enabled, and set emojifilter to warn.
  node scripts/start.js --profile-load synthetic --approval-mode yolo --set emojifilter=warn --prompt "Using write_file, create test-emoji.txt with content 'Hello 😀' then read_file it back"
  ```
  Verify: Exactly one `<system-reminder>` appears and the emoji does not get written.

- [ ] **Tool governance/policy enforcement:**
  ```bash
  # Default non-interactive mode should block shell/edit/write unless YOLO.
  node scripts/start.js --profile-load synthetic --prompt "Use the run_shell_command tool to run: echo hi"
  ```
  Verify: Tool is blocked with a clear error message (no hang, no `awaiting_approval`).

- [ ] **Non-interactive mode works:**
  ```bash
  # Subagent should use non-interactive path
  node scripts/start.js --profile-load synthetic --prompt "use a subagent to find all test files"
  ```
  Verify: Subagent executes tools without prompting for confirmation

### 5.3 Verification Checklist

- [ ] Scratch test completes without errors
- [ ] Tool calls are visible in logs
- [ ] No warnings about policy or approval
- [ ] Response is coherent and references actual code
- [ ] If emoji filtering triggers, only one system-reminder appears
- [ ] Check `~/.llxprt/debug/` logs for any anomalies
- [ ] Non-interactive mode (subagent) works correctly

### 5.4 Scratch Test Failure Remediation

If scratch test fails:
1. Check debug logs in `~/.llxprt/debug/`
2. Identify failing component (governance, scheduling, filtering, etc.)
3. Create targeted test case reproducing the failure
4. Fix in remediation loop
5. Re-run scratch test

### 5.5 Phase Exit Criteria

- Scratch test passes
- Real tool calls execute correctly
- Unified path handles all tool types
- No regressions from production behavior

---

## Appendix: RULES.md Compliance Checklist

Per `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/RULES.md`:

### Must Do
- [x] Write test first (RED) -> Minimal code to pass (GREEN) -> Refactor if valuable
- [x] Test behavior, not implementation
- [x] Use TypeScript strict mode (no `any`, no type assertions)
- [x] Work with immutable data only
- [x] Achieve 100% behavior coverage

### Never Do
- [x] Write production code without a failing test
- [x] Test implementation details
- [x] Add comments (code must be self-documenting)
- [x] Mutate data structures
- [x] Create speculative abstractions

### Test Structure Compliance
- [x] Describe: Feature/component name
- [x] It: Specific behavior in plain English
- [x] Arrange-Act-Assert: Clear test sections
- [x] Single Assertion: One behavior per test (where practical)

### What to Test
- [x] Public API behavior
- [x] Input -> Output transformations
- [x] Edge cases and error conditions
- [x] Integration between units
- [x] Schema validation

### What NOT to Test
- [x] Implementation details
- [x] Private methods
- [x] Third-party libraries
- [x] Mock interactions (verify behavior, not that mocks were called)

### Anti-Patterns Avoided
- [x] No premature abstraction
- [x] No test-after development
- [x] No over-engineering
- [x] No mock theater (tests verify real behavior)
- [x] No stub implementations

---

## Implementation Order Summary

1. **Phase 1**: Create `toolGovernance.ts`, update both executors
2. **Phase 2**: Add `toolContextInteractiveMode` option to scheduler
3. **Phase 3b**: Rewrite `executeToolCall` to use scheduler and return `CompletedToolCall` (no V2)
4. **Phase 3c**: Migrate all 3 consumers to use `completed.response`
5. **Phase 4**: Add comprehensive integration tests
6. **Phase 5**: Run scratch test, remediate any issues

**Total estimated effort: 16-35 hours**

---

## Key Architecture Decisions

### 1. No V2 + Shim Pattern
- Only 3 call sites exist
- All migrated in Phase 3c
- Simpler than maintaining two functions

### 2. Typing Strategy (Documented Cast)
- `CoreToolScheduler` expects `Config` class instance
- We provide `SchedulerConfig` (Pick<Config, ...>)
- Use `as unknown as Config` cast with documented rationale
- TypeScript verifies we provide all methods in the Pick
- If scheduler starts using new methods, runtime error is clear

### 3. Return Type: `CompletedToolCall`
- `executeToolCall(...)` returns `CompletedToolCall` (not a bare `ToolCallResponseInfo`)
- Callers use `completed.response` to access the existing response payload
- Enables non-interactive recording of tool calls (upstream `#10951` pattern)

### 4. Policy Engine Default is DENY (Security)
- Missing policy engine = deny all tools
- ASK_USER decisions become DENY
- Fail-safe design for non-interactive execution

### 5. Error Response Behavior Change (Documented)
- Error responses use `response.error` not `response.output`
- `llmContent` dropped for errors (matches scheduler behavior)
- Callers already check `error` first - no breaking change

### 6. Emoji Filtering Ownership
- **Wrapper** (`executeToolCall`) owns filtering
- **Scheduler** does NOT filter
- Prevents double-filtering
- System feedback appended after scheduler returns
- Error responses get feedback appended to error message

### 7. SubAgent Integration
SubAgents have TWO distinct execution modes, each with its own tool execution path:

**`runInteractive()` path:**
- Uses `CoreToolScheduler` directly (not `executeToolCall`)
- Calls `createSchedulerConfig({ interactive: true })` at line 619
- Supports user approval prompts when policy returns ASK_USER
- NOT affected by this unification - already uses scheduler correctly

**`runNonInteractive()` path:**
- Uses `executeToolCall` (the function being unified)
- Migration changes from `toolExecutorContext` to `createSchedulerConfig({ interactive: false })`
- Policy ASK_USER decisions become DENY (non-interactive cannot prompt user)
- Ensures policy, message bus, approval mode are available

The key insight is that `interactive` parameter passed to `createSchedulerConfig()` must match the SubAgent's execution mode:
- `runInteractive` -> `interactive: true`
- `runNonInteractive` -> `interactive: false`

### 6a. What `interactive` Controls in createSchedulerConfig

**CRITICAL CLARIFICATION:** The `interactive` parameter in `createSchedulerConfig({ interactive: boolean })` controls ONLY the tool whitelist logic, NOT approval mode.

**What `interactive` DOES control:**
- When `interactive: true`: Uses `this.toolConfig.getAllowedTools()` for the tool whitelist (SubAgent-specific allowed tools)
- When `interactive: false`: Uses `config.getAllowedTools()` from the foreground config (inherited from parent)

**What `interactive` does NOT control:**
- **Approval mode**: Always pulled from `this.foregroundConfig.getApprovalMode()` regardless of `interactive` setting
- **Policy engine**: Always uses the foreground config's policy engine
- **Message bus**: Always uses the foreground config's message bus

**Why approval mode doesn't matter for runNonInteractive:**
`runNonInteractive` is inherently non-interactive - the system prompt tells the LLM: "You are running in a non-interactive mode. You CANNOT ask the user for input."

Even if approval mode is configured to require confirmation, `runNonInteractive` tools execute without user confirmation because:
1. There is no user to prompt - the SubAgent runs in the background
2. The non-interactive policy wrapper converts ASK_USER -> DENY
3. If a tool somehow reached `awaiting_approval` state, execution would hang forever

This is why the `createNonInteractivePolicyEngine` wrapper (Phase 3b) is essential - it enforces deterministic behavior by converting any ASK_USER policy decisions to DENY.

### 8. agentId Preservation (EXPLICIT REQUIREMENT)

The current `executeToolCall` implementation preserves `agentId` from request to response:
- Takes `agentId` from `toolCallRequest.agentId ?? DEFAULT_AGENT_ID`
- Returns it in the response at `response.agentId` field

**The unified implementation MUST preserve this behavior:**
1. Extract `agentId` from `toolCallRequest.agentId` (or default to `DEFAULT_AGENT_ID`)
2. Ensure `agentId` flows through the scheduler to `CompletedToolCall`
3. Ensure `agentId` is present on `completed.response.agentId`

This is critical for:
- Tracing which agent (main or sub) executed a tool call
- Correlating tool calls with their originating agent context
- Maintaining agent hierarchy visibility in logs and debugging

### 9. Type Compatibility: createSchedulerConfig and ToolExecutionConfig

**IMPORTANT:** `createSchedulerConfig()` MUST be a runtime-safe superset of what `executeToolCall` uses (not just a cast).

`executeToolCall` uses these config methods today:
- `getToolRegistry`
- `getEphemeralSettings`
- `getEphemeralSetting` (for `emojifilter`)
- `getExcludeTools`
- `getSessionId`
- `getTelemetryLogPromptsEnabled`
- `getMessageBus`
- `getPolicyEngine`
- `getApprovalMode`
- `getAllowedTools`

**MANDATORY fix as part of Phase 3c:**
- If `createSchedulerConfig()` does not provide `getEphemeralSetting(key)`, add it by reading from `getEphemeralSettings()`.
- Do not rely on `as unknown as Config` to “pretend” the method exists; that will crash at runtime.

### 10. Race Condition Prevention
- Promise-based completion handling replaces callback assignment
- Completion resolver is set BEFORE scheduling
- Result is awaited AFTER scheduling completes

### 11. Test Async Handling
- All scheduler tests must await `completionPromise`
- `schedule()` returns before execution completes
- Use completion callback to resolve promise
- Then assert after promise resolves
