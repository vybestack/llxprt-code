# Fix Plan for Issues #945, #948, #951, #952, #957

**Date**: 2024-12-30
**Branch**: Current working branch

## Overview

This plan addresses five related issues involving tool execution, cancellation, and UI stability.

---

## Issue #945: search_file_content glob include issues

**Problem**: Brace expansion patterns like `**/*.{ts,tsx,js}` don't work with git grep, causing fallback to slow JS glob scan.

**Root Cause**: `grep.ts` lines 516-517 pass the `include` pattern directly to git grep via `--` pathspec, but git grep doesn't support shell-style brace expansion `{...}`.

**Fix Location**: `packages/core/src/tools/grep.ts`

**Solution**:
1. Add a helper function to detect unsupported glob patterns (brace expansion `{...}`)
2. When detected, skip git grep entirely and use the JS glob fallback directly
3. This is simpler and more reliable than trying to convert patterns

**Code Changes**:
```typescript
// Add near top of file, after imports
function hasUnsupportedGitGrepPattern(pattern: string): boolean {
  // Git grep doesn't support brace expansion {a,b,c}
  return /\{[^}]*,[^}]*\}/.test(pattern);
}

// In searchWithGitGrep method, add early bail-out check:
// Before attempting git grep, check if include pattern is unsupported
if (include && hasUnsupportedGitGrepPattern(include)) {
  return null; // Signal to use JS fallback
}
```

---

## Issue #948: Shell cancellation doesn't kill the process

**Problem**: ESC shows "cancelled" but the shell process continues running.

**Root Cause**: `tool-registry.ts` `DiscoveredTool.execute()` (lines 71-149) accepts `_signal: AbortSignal` but ignores it - the underscore prefix indicates it's unused. The spawned child process is never killed on abort.

**Fix Location**: `packages/core/src/tools/tool-registry.ts`

**Solution**:
1. Remove the underscore prefix from `_signal` parameter
2. Add abort signal listener that kills the child process
3. Use the same pattern as `shellExecutionService.ts` (lines 312-330, 535-572)

**Code Changes**:
```typescript
// In DiscoveredTool.execute method:
async execute(signal: AbortSignal): Promise<ToolResult> {
  // ... existing code to spawn child ...
  
  // Add abort handling
  const abortHandler = () => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
  };
  signal.addEventListener('abort', abortHandler);
  
  try {
    // ... existing execution logic ...
  } finally {
    signal.removeEventListener('abort', abortHandler);
  }
}
```

---

## Issue #951: History ID uniqueness/key collisions

**Problem**: React keys can collide when multiple hook instances generate IDs.

**Root Cause**: `useHistoryManager.ts` lines 67-69 generates IDs as `baseTimestamp + messageIdCounterRef.current`. The counter is per-hook instance (useRef), so different hook instances using the same baseTimestamp can generate identical IDs.

**Fix Location**: `packages/cli/src/ui/hooks/useHistoryManager.ts`

**Solution**:
1. Use a module-level counter instead of per-instance ref for the incrementing part
2. Combine with timestamp for monotonically increasing, globally unique IDs

**Code Changes**:
```typescript
// Add at module level (outside component)
let globalMessageIdCounter = 0;

// Modify getNextMessageId function:
const getNextMessageId = useCallback((baseTimestamp: number): number => {
  globalMessageIdCounter += 1;
  return baseTimestamp * 1000 + globalMessageIdCounter;
}, []);

// Remove messageIdCounterRef since we use global counter now
// Update clearItems to NOT reset the global counter (IDs should remain unique)
```

---

## Issues #952/#957: Tool read hangs / "Tool call cancelled while in queue" error

**Problem**: 
- #952: ReadFile shows running but nothing happens
- #957: "Tool call cancelled while in queue" error

**Root Cause**: `coreToolScheduler.ts` has two issues:
1. Line 494 in `handleMessageBusResponse` creates a NEW `AbortController` instead of using the original signal from the queued request. This means confirmation responses lose the original abort context.
2. `publishBufferedResults` (lines 1355-1386) can be called from multiple async completions simultaneously, causing race conditions.

**Fix Location**: `packages/core/src/core/coreToolScheduler.ts`

**Solution**:
1. Store the original signal with the queued request
2. Pass original signal through `handleMessageBusResponse` instead of creating new one
3. Add a reentrancy guard to `publishBufferedResults`

**Code Changes**:

```typescript
// 1. In the queue item type, ensure signal is stored
interface QueuedToolRequest {
  request: ToolCallRequestInfo;
  signal: AbortSignal;  // Store original signal
}

// 2. In handleMessageBusResponse, use stored signal instead of creating new:
// REMOVE: const abortController = new AbortController();
// USE: the signal from the queued request

// 3. Add reentrancy guard to publishBufferedResults:
private isPublishingBufferedResults = false;

private async publishBufferedResults(): Promise<void> {
  if (this.isPublishingBufferedResults) {
    return; // Prevent reentrant calls
  }
  this.isPublishingBufferedResults = true;
  try {
    // ... existing logic ...
  } finally {
    this.isPublishingBufferedResults = false;
  }
}
```

---

## Implementation Order

1. **#951** (useHistoryManager) - Simplest, isolated change
2. **#945** (grep.ts) - Self-contained, low risk
3. **#948** (tool-registry.ts) - Moderate complexity
4. **#952/#957** (coreToolScheduler.ts) - Most complex, affects core scheduling

---

## Verification Steps (per AGENTS.md)

After all fixes:
```bash
npm run format
npm run lint
npm run typecheck
npm run test
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

## Test Considerations

- **#945**: Existing `grep.test.ts` has good coverage; add test for brace expansion pattern detection
- **#948**: Add test verifying abort signal kills child process
- **#951**: `useHistoryManager.test.ts` exists; add test for ID uniqueness across instances
- **#952/#957**: `coreToolScheduler.test.ts` has cancellation tests; verify existing tests still pass

---

## Commit Message Template

```
fix: resolve tool scheduling and cancellation issues

- #945: Skip git grep for unsupported brace expansion patterns
- #948: Kill child process on abort in DiscoveredTool.execute
- #951: Use global counter for history message IDs to prevent collisions
- #952/#957: Pass original abort signal through confirmation flow and
  add reentrancy guard to publishBufferedResults

Fixes #945, #948, #951, #952, #957
```
