# Interactive Shell Fix Plan: Ctrl+F Shell Focus for LLM-Invoked Tools

**Goal:** When the LLM invokes the shell tool (e.g., `bash` with no arguments), pressing Ctrl+F should toggle focus to that shell, allowing the user to type commands that are sent to the running PTY.

**Current State:** Ctrl+F only disables the InputPrompt but doesn't enable shell interaction because:
1. `ptyId` is never set on `IndividualToolCallDisplay` for LLM-invoked shell tools
2. No `setPidCallback` mechanism exists to propagate PID from shell tool execution to UI
3. `isThisShellTargeted` check in ToolMessage fails because `ptyId` is undefined

**Upstream Reference:** `./tmp/gemini-cli` contains the working implementation

---

## Architecture Overview

### Current LLxprt State

**shell.ts execute() signature (lines 201-206):**
```typescript
async execute(
  signal: AbortSignal,
  updateOutput?: (output: string | AnsiOutput) => void,
  terminalColumns?: number,
  terminalRows?: number,
): Promise<ToolResult>
```

**coreToolScheduler invocation call (line 1693):**
```typescript
invocation.execute(signal, liveOutputCallback)
```
Only passes 2 arguments! Terminal dimensions and setPidCallback are not passed.

**ExecutingToolCall type (lines 102-110):**
```typescript
export type ExecutingToolCall = {
  status: 'executing';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  liveOutput?: string | AnsiOutput;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};
```
Missing `pid?: number` property.

### Data Flow (What We Need to Implement)

```
ShellExecutionService.execute() returns { pid, result }
         ↓
shell.ts execute() calls setPidCallback(pid) [NEW - 5th param]
         ↓
coreToolScheduler creates setPidCallback, passes to execute() [NEW]
coreToolScheduler updates ExecutingToolCall with pid [NEW]
         ↓
useReactToolScheduler maps TrackedToolCall.pid to IndividualToolCallDisplay.ptyId [NEW]
         ↓
ToolMessage receives ptyId, isThisShellTargeted becomes true
         ↓
ShellInputPrompt renders with correct activeShellPtyId
         ↓
Ctrl+F toggles embeddedShellFocused, keystrokes go to PTY
```

---

## Implementation Plan (Revised per Deepthinker Review)

### Phase 1: Add pid to ExecutingToolCall Type

**File:** `packages/core/src/core/coreToolScheduler.ts`

**Change:** Add `pid?: number` to `ExecutingToolCall` type (around line 102):

```typescript
export type ExecutingToolCall = {
  status: 'executing';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  liveOutput?: string | AnsiOutput;
  pid?: number;  // <-- ADD THIS
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};
```

---

### Phase 2: Add setPidCallback to Shell Tool

**File:** `packages/core/src/tools/shell.ts`

**Change:** Add 5th parameter `setPidCallback` to execute() method:

```typescript
async execute(
  signal: AbortSignal,
  updateOutput?: (output: string | AnsiOutput) => void,
  terminalColumns?: number,
  terminalRows?: number,
  setPidCallback?: (pid: number) => void,  // <-- ADD THIS
): Promise<ToolResult>
```

**Change:** After getting PID from ShellExecutionService, call the callback (around line 367):

```typescript
const executionHandle = ShellExecutionService.execute(...);
const pid = executionHandle.pid;

// ADD THIS: Notify caller of PID for interactive shell support
// Only call for PTY execution - verify pid is in the activePtys map
if (pid && setPidCallback && this.config.getShouldUseNodePtyShell()) {
  // Verify this is actually a PTY pid (not child_process fallback)
  // ShellExecutionService.isActivePty(pid) checks if pid is in the activePtys map
  if (ShellExecutionService.isActivePty(pid)) {
    setPidCallback(pid);
  }
}
```

**Prerequisite:** Add a new static method to `ShellExecutionService`:

```typescript
// In packages/core/src/services/shellExecutionService.ts, add:
static isActivePty(pid: number): boolean {
  return this.activePtys.has(pid);
}
```

**Why this approach:**
- `getLastActivePtyId()` only returns the most recent PTY, which fails for concurrent shells
- `activePtys` is a Map that tracks ALL active PTY processes by pid
- `isActivePty(pid)` correctly handles concurrent shells - each pid is tracked independently
- If PTY fails and falls back to child_process, that pid won't be in activePtys

---

### Phase 3: Create and Pass setPidCallback in CoreToolScheduler

**File:** `packages/core/src/core/coreToolScheduler.ts`

**Change 1:** Create helper method `setPidInternal` (add near other internal methods):

```typescript
private setPidInternal(callId: string, pid: number): void {
  this.toolCalls = this.toolCalls.map((tc) =>
    tc.request.callId === callId && tc.status === 'executing'
      ? { ...tc, pid } as ExecutingToolCall
      : tc,
  );
  this.notifyToolCallsUpdate();
}
```

**Change 2:** Modify the execution call site (around line 1693) to pass all parameters:

```typescript
// Create setPidCallback for this specific call
const setPidCallback = (pid: number) => {
  this.setPidInternal(callId, pid);
};

// Terminal dimensions are optional - shell tool will use defaults if not provided
// These can be passed from UI via config if needed in the future
invocation
  .execute(
    signal,
    liveOutputCallback,
    undefined, // terminalColumns - shell tool uses process.stdout defaults
    undefined, // terminalRows - shell tool uses process.stdout defaults
    setPidCallback,
  )
  .then(async (toolResult: ToolResult) => {
    // ... existing code
  })
```

**Note:** This requires that `AnyToolInvocation.execute()` signature accepts these parameters (see Phase 4).

---

### Phase 4: Update Tool Invocation Interface

**File:** `packages/core/src/tools/tools.ts`

The `ToolInvocation` interface (lines 35-75) defines `execute()` with only 2 parameters:

```typescript
// CURRENT (lines 71-74):
execute(
  signal: AbortSignal,
  updateOutput?: (output: string | AnsiOutput) => void,
): Promise<TResult>;
```

**Changes required (ripple effect):**

1. **ToolInvocation interface (lines 71-74):**
```typescript
execute(
  signal: AbortSignal,
  updateOutput?: (output: string | AnsiOutput) => void,
  terminalColumns?: number,
  terminalRows?: number,
  setPidCallback?: (pid: number) => void,
): Promise<TResult>;
```

2. **BaseToolInvocation abstract class (line ~80+):**
Update any abstract execute() declaration to match.

3. **BaseToolLegacyInvocation (lines 833-838):**
```typescript
async execute(
  signal: AbortSignal,
  updateOutput?: (output: string) => void,
  terminalColumns?: number,
  terminalRows?: number,
  setPidCallback?: (pid: number) => void,
): Promise<TResult> {
  // Note: Legacy tools don't use terminalColumns/terminalRows/setPidCallback
  return this.tool.execute(this.params, signal, updateOutput);
}
```

4. **DeclarativeTool.buildAndExecute (lines 383-390):**
```typescript
async buildAndExecute(
  params: TParams,
  signal: AbortSignal,
  updateOutput?: (output: string | AnsiOutput) => void,
  terminalColumns?: number,
  terminalRows?: number,
  setPidCallback?: (pid: number) => void,
): Promise<TResult> {
  const invocation = this.build(params);
  return invocation.execute(signal, updateOutput, terminalColumns, terminalRows, setPidCallback);
}
```

**Note:** Non-shell tools will ignore the extra parameters. This is a safe addition since all new params are optional.

**Additional implementations to update (these implement ToolInvocation directly, not via BaseToolInvocation):**

5. **ASTEditToolInvocation (line ~1917):**
```typescript
async execute(
  signal: AbortSignal,
  _updateOutput?: (output: string | AnsiOutput) => void,
  _terminalColumns?: number,
  _terminalRows?: number,
  _setPidCallback?: (pid: number) => void,
): Promise<ToolResult>
```

6. **ASTReadFileToolInvocation (line ~2378):**
```typescript
async execute(
  _signal?: AbortSignal,
  _updateOutput?: (output: string | AnsiOutput) => void,
  _terminalColumns?: number,
  _terminalRows?: number,
  _setPidCallback?: (pid: number) => void,
): Promise<ToolResult>
```

All other invocations extend `BaseToolInvocation` and will inherit the updated signature automatically.

**Test file implementations:**

7. **TestToolInvocation in tools.test.ts (line ~17):**
```typescript
// This is a minimal test implementation - update execute signature to match interface:
execute(
  _signal?: AbortSignal,
  _updateOutput?: (output: string | AnsiOutput) => void,
  _terminalColumns?: number,
  _terminalRows?: number,
  _setPidCallback?: (pid: number) => void,
): Promise<ToolResult> {
  return this.executeFn();
}
```

Note: Test implementations don't need to use the new parameters, just accept them to satisfy TypeScript.

---

### Phase 5: Map pid to ptyId in useReactToolScheduler

**File:** `packages/cli/src/ui/hooks/useReactToolScheduler.ts`

**Change:** When converting `TrackedToolCall` to `IndividualToolCallDisplay`, extract pid:

Find the mapping function (likely called `mapToDisplay` or inline in a useMemo/useCallback) and add:

```typescript
// When mapping an executing tool call:
const displayTool: IndividualToolCallDisplay = {
  callId: call.request.callId,
  name: call.tool?.displayName ?? call.request.name,
  description: call.invocation?.getDescription() ?? JSON.stringify(call.request.args),
  status: mapStatus(call.status),
  resultDisplay: call.status === 'executing' ? call.liveOutput : call.response?.resultDisplay,
  confirmationDetails: call.confirmationDetails,
  ptyId: call.status === 'executing' ? (call as ExecutingToolCall).pid : undefined,  // <-- ADD THIS
  // ... other fields
};
```

---

### Phase 6: Verify ToolMessage Uses ptyId

**File:** `packages/cli/src/ui/components/messages/ToolMessage.tsx`

The existing code should already work once ptyId is populated:

```typescript
const lastActivePtyId = ShellExecutionService.getLastActivePtyId();
const isThisShellTargeted =
  ptyId === activeShellPtyId ||
  (activeShellPtyId == null && ptyId === lastActivePtyId);
```

**KEEP the lastActivePtyId fallback** for now. It provides backward compatibility and handles edge cases where ptyId might not propagate correctly. Only remove it after the full implementation is verified working.

The key change is that `ptyId` will now be populated for LLM-invoked shell tools, so the first condition (`ptyId === activeShellPtyId`) will match when both are set, or the fallback (`activeShellPtyId == null && ptyId === lastActivePtyId`) will match for LLM tools where activeShellPtyId remains null.

---

## Test-First Implementation

### Test 1: Shell Tool Accepts setPidCallback

**File:** `packages/core/src/tools/shell.test.ts`

**Note:** The existing test file uses `vi.hoisted` and `vi.mock` pattern with `mockShellExecutionService`. Follow the existing pattern (see lines 17-22, 112-120 of shell.test.ts).

```typescript
// Add this describe block to the existing shell.test.ts file

describe('setPidCallback', () => {
  it('should call setPidCallback with PID when PTY execution and getShouldUseNodePtyShell is true', async () => {
    const setPidCallback = vi.fn();
    
    // Configure mock to use PTY
    (mockConfig.getShouldUseNodePtyShell as Mock).mockReturnValue(true);
    
    // Mock isActivePty to return true for our test pid
    vi.spyOn(ShellExecutionService, 'isActivePty').mockReturnValue(true);
    
    const invocation = shellTool.build({ command: 'echo test' });
    
    // mockShellExecutionService already returns { pid: 12345, result: Promise }
    // per the beforeEach setup on lines 112-120
    
    // Simulate successful execution
    setTimeout(() => {
      resolveExecutionPromise({
        output: 'test',
        rawOutput: Buffer.from('test'),
        exitCode: 0,
        signal: null,
        error: null,
        aborted: false,
        pid: 12345,
        executionMethod: 'lydell-node-pty',
      });
    }, 0);
    
    await invocation.execute(
      new AbortController().signal,
      undefined,
      80,
      24,
      setPidCallback,
    );
    
    expect(setPidCallback).toHaveBeenCalledWith(12345);
  });

  it('should NOT call setPidCallback when getShouldUseNodePtyShell is false', async () => {
    const setPidCallback = vi.fn();
    
    // Configure mock to NOT use PTY
    (mockConfig.getShouldUseNodePtyShell as Mock).mockReturnValue(false);
    
    // isActivePty doesn't matter since we short-circuit on getShouldUseNodePtyShell
    vi.spyOn(ShellExecutionService, 'isActivePty').mockReturnValue(false);
    
    const invocation = shellTool.build({ command: 'echo test' });
    
    setTimeout(() => {
      resolveExecutionPromise({
        output: 'test',
        rawOutput: Buffer.from('test'),
        exitCode: 0,
        signal: null,
        error: null,
        aborted: false,
        pid: 12345,
        executionMethod: 'child_process',
      });
    }, 0);
    
    await invocation.execute(
      new AbortController().signal,
      undefined,
      80,
      24,
      setPidCallback,
    );
    
    expect(setPidCallback).not.toHaveBeenCalled();
  });

  it('should NOT call setPidCallback when pid is undefined', async () => {
    const setPidCallback = vi.fn();
    
    (mockConfig.getShouldUseNodePtyShell as Mock).mockReturnValue(true);
    // isActivePty won't be called since pid is undefined (short-circuit)
    
    // Override mock to return undefined pid
    mockShellExecutionService.mockReturnValueOnce({
      pid: undefined,
      result: Promise.resolve({
        output: 'test',
        rawOutput: Buffer.from('test'),
        exitCode: 0,
        signal: null,
        error: null,
        aborted: false,
        pid: undefined,
        executionMethod: 'lydell-node-pty',
      }),
    });
    
    const invocation = shellTool.build({ command: 'echo test' });
    
    await invocation.execute(
      new AbortController().signal,
      undefined,
      80,
      24,
      setPidCallback,
    );
    
    expect(setPidCallback).not.toHaveBeenCalled();
  });

  it('should NOT call setPidCallback when isActivePty returns false (child_process fallback)', async () => {
    const setPidCallback = vi.fn();
    
    (mockConfig.getShouldUseNodePtyShell as Mock).mockReturnValue(true);
    // Simulate PTY fallback to child_process - pid exists but not in activePtys
    vi.spyOn(ShellExecutionService, 'isActivePty').mockReturnValue(false);
    
    const invocation = shellTool.build({ command: 'echo test' });
    
    setTimeout(() => {
      resolveExecutionPromise({
        output: 'test',
        rawOutput: Buffer.from('test'),
        exitCode: 0,
        signal: null,
        error: null,
        aborted: false,
        pid: 12345,
        executionMethod: 'child_process', // Fallback occurred
      });
    }, 0);
    
    await invocation.execute(
      new AbortController().signal,
      undefined,
      80,
      24,
      setPidCallback,
    );
    
    expect(setPidCallback).not.toHaveBeenCalled();
  });
});
```

### Test 2: CoreToolScheduler Propagates PID

**File:** `packages/core/src/core/coreToolScheduler.test.ts`

**Note:** LLxprt's scheduler uses `onToolCallsUpdate` callback (see lines 381, 394, 442, 1809-1810 of coreToolScheduler.ts). There's no `getToolCalls()` method - use the callback to observe state changes. Follow existing test patterns in the file.

```typescript
describe('coreToolScheduler PID propagation', () => {
  it('should include pid in tool calls update when shell tool reports it', async () => {
    const onToolCallsUpdate = vi.fn();
    
    // Create scheduler with onToolCallsUpdate callback
    const scheduler = new CoreToolScheduler(
      mockConfig,
      mockToolRegistry,
      {
        onToolCallsUpdate,
        // ... other required options
      },
    );
    
    // Mock shell tool to call setPidCallback during execution
    // This requires setting up the mock tool registry to return a shell tool
    // that will receive and call the setPidCallback
    
    await scheduler.schedule(
      [{
        callId: 'test-shell-1',
        name: 'run_shell_command',
        args: { command: 'bash' },
        isClientInitiated: false,
        prompt_id: 'test',
      }],
      new AbortController().signal,
    );
    
    // Assert that onToolCallsUpdate was called with a tool call containing pid
    await vi.waitFor(() => {
      const allCalls = onToolCallsUpdate.mock.calls.flat();
      const executingWithPid = allCalls.find(
        (calls: ToolCall[]) => calls.some(
          (c: ToolCall) => 
            c.request.callId === 'test-shell-1' && 
            c.status === 'executing' && 
            (c as ExecutingToolCall).pid === 12345
        )
      );
      expect(executingWithPid).toBeDefined();
    });
  });

  it('should call notifyToolCallsUpdate when setPidInternal is called', async () => {
    const onToolCallsUpdate = vi.fn();
    
    const scheduler = new CoreToolScheduler(
      mockConfig,
      mockToolRegistry,
      { onToolCallsUpdate },
    );
    
    // Directly test setPidInternal if accessible, or test via integration
    // by scheduling a shell command that triggers setPidCallback
    
    // After setPidInternal is called, onToolCallsUpdate should be invoked
    // with the updated tool calls array
  });
});
```

**Note:** The exact test setup depends on how the existing coreToolScheduler.test.ts file is structured. Examine the file to understand the mock patterns used (tool registry setup, config mocking, etc.).

### Test 3: UI Receives ptyId

**File:** `packages/cli/src/ui/hooks/useReactToolScheduler.test.ts`

**Note:** The actual hook API may differ from what's shown below. Examine `useReactToolScheduler.ts` to understand:
1. How tool calls flow from scheduler to hook
2. What the hook exposes (state, callbacks)
3. How to trigger updates in tests

The key assertion is that when an `ExecutingToolCall` with `pid` flows through, the resulting `IndividualToolCallDisplay` has `ptyId` set.

```typescript
describe('useReactToolScheduler ptyId mapping', () => {
  // Option 1: Test the mapping function directly if it's exported
  it('should map pid to ptyId for executing shell tools', () => {
    const executingCall: ExecutingToolCall = {
      status: 'executing',
      request: {
        callId: 'test-1',
        name: 'run_shell_command',
        args: { command: 'bash' },
        isClientInitiated: false,
        prompt_id: 'test',
      },
      tool: mockShellTool,
      invocation: mockShellInvocation,
      pid: 12345,
      liveOutput: 'bash-4.2$',
    };
    
    // If mapToDisplay is exported:
    const display = mapToDisplay(executingCall);
    expect(display.ptyId).toBe(12345);
    
    // Or test via integration with the hook
  });

  // Option 2: Integration test via hook if mapping function not exported
  it('should expose ptyId in trackedToolCalls for executing shells', () => {
    // Setup and render hook with mock scheduler
    // Trigger scheduler to emit tool calls with pid
    // Assert the hook's exposed state includes ptyId
  });

  it('should not set ptyId for completed tool calls', () => {
    const completedCall: SuccessfulToolCall = {
      status: 'success',
      request: {
        callId: 'test-2',
        name: 'run_shell_command',
        args: { command: 'echo hi' },
        isClientInitiated: false,
        prompt_id: 'test',
      },
      response: { /* ... */ },
      tool: mockShellTool,
      invocation: mockShellInvocation,
    };
    
    const display = mapToDisplay(completedCall);
    expect(display.ptyId).toBeUndefined();
  });
});
```

**Implementation note:** If `mapToDisplay` is not a separate function but inline in the hook, consider extracting it for testability, or test via integration.

---

## Subagent Prompts

### Prompt 1: Implement Core Changes (Phase 1-4)

```
Implement PID propagation for LLM-invoked shell tools in LLxprt core.

**Goal:** When the shell tool executes via the LLM, the PTY PID must propagate to the UI so Ctrl+F enables shell interaction.

**Upstream reference:** ./tmp/gemini-cli shows the working pattern:
- packages/core/src/tools/shell.ts:145 - execute() takes setPidCallback as 5th param (after terminalColumns/terminalRows)
- packages/core/src/tools/shell.ts:273-274 - calls setPidCallback(pid) after getting PID
- packages/core/src/scheduler/tool-executor.ts:81-91 - creates setPidCallback
- packages/core/src/scheduler/state-manager.ts:496 - preserves pid in ExecutingToolCall

**LLxprt files to modify:**

1. `packages/core/src/tools/tools.ts`:
   - Line ~71-74: Update `ToolInvocation.execute()` interface to add optional params:
     ```typescript
     execute(
       signal: AbortSignal,
       updateOutput?: (output: string | AnsiOutput) => void,
       terminalColumns?: number,
       terminalRows?: number,
       setPidCallback?: (pid: number) => void,
     ): Promise<TResult>;
     ```
   - Update `BaseToolInvocation` abstract execute() to match (around line 100+)
   - Update `BaseToolLegacyInvocation` execute() to match (around line 813+)

2. `packages/core/src/core/coreToolScheduler.ts`:
   - Line ~107: Add `pid?: number` to `ExecutingToolCall` type
   - Add new private method `setPidInternal(callId: string, pid: number)` that updates ExecutingToolCall and calls notifyToolCallsUpdate()
   - Line ~1693: Create setPidCallback closure and modify execute() call:
     ```typescript
     const setPidCallback = (pid: number) => {
       this.setPidInternal(callId, pid);
     };
     
     invocation
       .execute(signal, liveOutputCallback, undefined, undefined, setPidCallback)
       .then(...)
     ```

3. `packages/core/src/services/shellExecutionService.ts`:
   - Add new static method `isActivePty(pid: number): boolean` that returns `this.activePtys.has(pid)`
   - Note: This is distinct from `isPtyActive(pid)` which checks if the PTY process is running. `isActivePty` checks if pid is in the activePtys Map (i.e., was created as a PTY, not child_process fallback).

4. `packages/core/src/tools/shell.ts`:
   - Line ~201-206: Add 5th parameter `setPidCallback?: (pid: number) => void` to execute()
   - After getting pid from ShellExecutionService (around line ~367): Add:
     ```typescript
     if (pid && setPidCallback && this.config.getShouldUseNodePtyShell() && ShellExecutionService.isActivePty(pid)) {
       setPidCallback(pid);
     }
     ```

5. `packages/core/src/tools/ast-edit.ts`:
   - Line ~1917: Update `ASTEditToolInvocation.execute()` signature to add optional params (it implements ToolInvocation directly):
     ```typescript
     async execute(
       signal: AbortSignal,
       _updateOutput?: (output: string | AnsiOutput) => void,
       _terminalColumns?: number,
       _terminalRows?: number,
       _setPidCallback?: (pid: number) => void,
     ): Promise<ToolResult>
     ```
   - Line ~2378: Update `ASTReadFileToolInvocation.execute()` signature similarly.

6. `packages/core/src/tools/tools.test.ts`:
   - Line ~17: Update `TestToolInvocation.execute()` signature to accept the new optional params:
     ```typescript
     execute(
       _signal?: AbortSignal,
       _updateOutput?: (output: string | AnsiOutput) => void,
       _terminalColumns?: number,
       _terminalRows?: number,
       _setPidCallback?: (pid: number) => void,
     ): Promise<ToolResult> {
       return this.executeFn();
     }
     ```

**Tests to write first (TDD):**
- shell.test.ts: Test that setPidCallback is called with PID for PTY execution
- shell.test.ts: Test that setPidCallback is NOT called for non-PTY (child_process) execution
- shell.test.ts: Test that setPidCallback is NOT called when pid is undefined
- coreToolScheduler.test.ts: Test that ExecutingToolCall gets pid property set
- coreToolScheduler.test.ts: Test that notifyToolCallsUpdate is called after pid is set

**Build verification:** `npm run typecheck && npm run build` must pass after changes.
```

### Prompt 2: Implement UI Mapping (Phase 5-6)

```
Implement UI-side PID to ptyId mapping for LLM shell tools in LLxprt.

**Prerequisites:** Phase 1-4 must be complete (pid now exists on ExecutingToolCall).

**Goal:** Map `pid` from `ExecutingToolCall` to `ptyId` on `IndividualToolCallDisplay`.

**Files to modify:**

1. `packages/cli/src/ui/hooks/useReactToolScheduler.ts`:
   - Find where TrackedToolCall is mapped to IndividualToolCallDisplay
   - For executing tool calls, extract `pid` and set as `ptyId`:
     ```typescript
     ptyId: call.status === 'executing' ? (call as ExecutingToolCall).pid : undefined,
     ```

2. `packages/cli/src/ui/components/messages/ToolMessage.tsx`:
   - KEEP the existing `isThisShellTargeted` logic with lastActivePtyId fallback
   - DO NOT simplify or remove the fallback - it provides backward compatibility
   - The key is that `ptyId` will now be populated, making the existing logic work

**Tests to write:**
- useReactToolScheduler.test.ts: Verify pid maps to ptyId for executing shell tools
- useReactToolScheduler.test.ts: Verify ptyId is undefined for completed tools

**Verification:** Use DebugLogger or breakpoints to verify ptyId is populated for LLM shell tools. Do not leave console.log statements in code.

**Build verification:** `npm run typecheck && npm run build` must pass after changes.
```

### Prompt 3: Verification/Review Prompt

```
Verify the interactive shell fix implementation in LLxprt.

**Goal:** Pressing Ctrl+F while an LLM-invoked shell tool is executing should toggle focus to that shell, allowing the user to type commands.

**Upstream reference:** ./tmp/gemini-cli contains the working implementation.

**Verification checklist:**

1. **Type safety:**
   - Run `npm run typecheck` - must pass
   - Verify ExecutingToolCall has `pid?: number`
   - Verify IndividualToolCallDisplay has `ptyId?: number`

2. **Unit tests:**
   - Run `npm test` - all must pass
   - Verify shell.test.ts has setPidCallback tests
   - Verify coreToolScheduler.test.ts has pid propagation tests
   - Verify useReactToolScheduler.test.ts has ptyId mapping tests

3. **Data flow audit:** Trace the path manually:
   - [ ] shell.ts execute() has setPidCallback parameter
   - [ ] shell.ts calls setPidCallback(pid) after ShellExecutionService returns pid
   - [ ] shell.ts only calls setPidCallback for PTY execution (getShouldUseNodePtyShell check)
   - [ ] coreToolScheduler creates setPidCallback that calls setPidInternal()
   - [ ] coreToolScheduler passes setPidCallback to invocation.execute()
   - [ ] setPidInternal updates ExecutingToolCall with pid and calls notifyToolCallsUpdate()
   - [ ] useReactToolScheduler maps pid to ptyId in display conversion
   - [ ] ToolMessage receives ptyId and uses it in isThisShellTargeted

4. **Edge cases:**
   - What happens if setPidCallback is called after tool completes? (Should be no-op)
   - What happens for non-shell tools? (setPidCallback ignored)
   - Multiple concurrent shell tools? (Each gets own setPidCallback closure)

5. **Build:** Run `npm run build` - must pass

Report issues with specific file:line references.
```

---

## Success Criteria

1. `npm run typecheck` passes
2. `npm test` passes (including new tests)
3. `npm run build` passes
4. Manual test: Ask LLM to run `bash`, press Ctrl+F, type `ls`, see output
5. No regressions: `!` shell commands still work with Ctrl+F

---

## Files Modified (Summary)

| File | Change |
|------|--------|
| `packages/core/src/core/coreToolScheduler.ts` | Add `pid` to ExecutingToolCall, add `setPidInternal()`, pass setPidCallback to execute() |
| `packages/core/src/services/shellExecutionService.ts` | Add `isActivePty(pid)` static method |
| `packages/core/src/tools/shell.ts` | Add `setPidCallback` parameter, call it with PID after isActivePty check |
| `packages/core/src/tools/shell.test.ts` | Add tests for setPidCallback |
| `packages/core/src/core/coreToolScheduler.test.ts` | Add tests for pid propagation |
| `packages/cli/src/ui/hooks/useReactToolScheduler.ts` | Map pid to ptyId |
| `packages/cli/src/ui/hooks/useReactToolScheduler.test.ts` | Add tests for ptyId mapping |
| `packages/cli/src/ui/components/messages/ToolMessage.tsx` | No changes needed - existing logic handles ptyId |
| `packages/core/src/tools/tools.ts` | Update ToolInvocation.execute() signature, BaseToolInvocation, BaseToolLegacyInvocation |

---

## Rollback Plan

If implementation causes issues:
1. All changes are additive (new optional parameter, new optional property)
2. Shell tool still works without setPidCallback (parameter is optional)
3. `!` commands continue to work via shellCommandProcessor's activeShellPtyId
4. ShellExecutionService.getLastActivePtyId() fallback can be restored if needed

---

## Open Questions Resolved

1. **execute() signature conflict:** Resolved - add setPidCallback as 5th parameter (optional)
2. **Where to create setPidCallback:** In coreToolScheduler at line ~1693, before execute() call
3. **Non-PTY fallback:** Only call setPidCallback when `getShouldUseNodePtyShell()` is true
4. **Multiple concurrent shells:** Each execute() call gets its own setPidCallback closure with captured callId
5. **Active shell selection with multiple shells:** The existing `isThisShellTargeted` logic handles this - each ToolMessage checks if its `ptyId` matches `activeShellPtyId` (set by `!` commands) or falls back to `lastActivePtyId`
6. **pid cleanup on completion:** When tool transitions from 'executing' to 'success'/'error'/'cancelled', the `pid` field is naturally dropped since those types don't include it. The UI mapping only extracts `ptyId` for 'executing' status, so completed tools get `ptyId: undefined`
7. **Late setPidCallback after completion:** The `setPidInternal` method only updates tools with `status === 'executing'`, so late callbacks are no-ops
8. **ToolMessage fallback:** Keep the `lastActivePtyId` fallback for backward compatibility and edge cases
