# Implementation Plan: 4a5ef4d9 - Add expectToolCallSuccess Helper

## Summary of Upstream Changes

Upstream commit `4a5ef4d9` ("fix(infra) - Fix flake for file interactive system (#11019)"):
- Adds `expectToolCallSuccess(toolNames, timeout?)` to TestRig
- Waits for tool call with `success: true`
- Provides clearer error messages when tool calls fail

## Context

The current LLxprt codebase uses the pattern:
```typescript
const foundToolCall = await rig.waitForToolCall('write_file');
expect(foundToolCall).toBeTruthy();
```

This pattern checks if a tool was called but doesn't verify if it succeeded. The new `expectToolCallSuccess` method combines the wait and assertion, and specifically checks for `success: true` in the tool log.

**Note:** The upstream also references `file-system-interactive.test.ts`, which does NOT exist in LLxprt. That test is specific to the upstream gemini-cli repository.

## Implementation Steps

### Step 1: Add expectToolCallSuccess to TestRig Class

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/test-helper.ts`

**Location:** Add the new method after the existing `waitForAnyToolCall` method (after line 637, before the `poll` method at line 639).

**Import verification:** The `expect` function is already imported from 'vitest' in test files that use TestRig, so it needs to be imported in test-helper.ts as well.

**Required import addition at top of file (around line 16):**
```typescript
import { expect } from 'vitest';
```

**Complete method implementation:**
```typescript
  async expectToolCallSuccess(
    toolNames: string | string[],
    timeout?: number,
  ): Promise<void> {
    if (!timeout) {
      timeout = this.getDefaultTimeout();
    }

    const names = Array.isArray(toolNames) ? toolNames : [toolNames];

    await this.waitForTelemetryReady();

    const found = await this.poll(
      () => {
        const toolLogs = this.readToolLogs();
        return toolLogs.some(
          (log) =>
            names.includes(log.toolRequest.name) &&
            log.toolRequest.success === true,
        );
      },
      timeout,
      100,
    );

    expect(found, `Expected successful tool call for: ${names.join(', ')}`).toBe(true);
  }
```

**Class context:** This method should be added to the `TestRig` class as a public async method. It follows the same pattern as existing methods like `waitForToolCall` (line 599) and `waitForAnyToolCall` (line 618), using the helper methods `getDefaultTimeout()`, `waitForTelemetryReady()`, `poll()`, and `readToolLogs()`.

### Step 2: OPTIONAL - Update Integration Tests to Use New Helper

**Status:** This step is OPTIONAL. The old pattern of `waitForToolCall` + `expect` still works correctly and is not deprecated.

**Rationale for refactoring:** The new method provides:
1. More explicit verification of tool success (checks `success: true`)
2. Better error messages when tool calls fail
3. More concise test code (combines wait + assertion)

**Example conversion:**

Old pattern:
```typescript
const foundToolCall = await rig.waitForToolCall('write_file');
expect(foundToolCall).toBeTruthy();
```

New pattern:
```typescript
await rig.expectToolCallSuccess('write_file');
```

**Files that could be refactored (if desired):**
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/write_file.test.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/run_shell_command.test.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/save_memory.test.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/google_web_search.test.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/list_directory.test.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/read_many_files.test.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/file-system.test.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/utf-bom-encoding.test.ts`

**Note:** This refactoring can be done later as a cleanup task. It is not required for the merge.

## Files to Modify

| File | Change | Required |
|------|--------|----------|
| `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/test-helper.ts` | Add `import { expect } from 'vitest'` at top of file | **YES** |
| `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/test-helper.ts` | Add `expectToolCallSuccess` method after line 637 | **YES** |
| Various test files | Update to use new helper (see list above) | **NO** (optional) |

## Implementation Details

**Method behavior:**
1. Accepts single tool name (string) or multiple tool names (string array)
2. Uses environment-appropriate timeout (defaults from `getDefaultTimeout()`)
3. Waits for telemetry to be ready before polling
4. Polls tool logs looking for ANY of the specified tool names with `success === true`
5. Throws clear assertion error if no successful tool call found within timeout
6. Returns Promise<void> (throws on failure, resolves on success)

**Error message format:**
```
Expected successful tool call for: tool_name
```

For multiple tools:
```
Expected successful tool call for: tool_one, tool_two
```

## Acceptance Criteria

- [ ] `expect` is imported from 'vitest' in test-helper.ts
- [ ] `expectToolCallSuccess` method exists in TestRig class
- [ ] Method is positioned after `waitForAnyToolCall` (after line 637)
- [ ] Method accepts string or string[] for tool names
- [ ] Method uses `getDefaultTimeout()` when timeout not provided
- [ ] Method calls `waitForTelemetryReady()` before polling
- [ ] Method checks `log.toolRequest.success === true` in poll predicate
- [ ] Method provides helpful error message: `Expected successful tool call for: ${names.join(', ')}`
- [ ] Existing tests continue to pass without modification
- [ ] Method follows TypeScript typing (no `any` types)
- [ ] Code passes lint, typecheck, and format checks

## Testing Strategy

**Minimal verification:**
1. Add the method to TestRig
2. Run existing integration tests to ensure no regression
3. The method will be tested organically when used in future tests or optional refactoring

**Optional verification:**
1. Convert one test (e.g., `write_file.test.ts`) to use new method
2. Verify test still passes
3. Verify error message is clear when test fails (temporarily break test to check)

## Notes

- This is a low-risk addition - it adds a new method without modifying existing code
- The old `waitForToolCall` pattern remains valid and is not deprecated
- The upstream commit also modified `file-system-interactive.test.ts` which doesn't exist in LLxprt
- This method provides better test diagnostics by explicitly checking for tool success
