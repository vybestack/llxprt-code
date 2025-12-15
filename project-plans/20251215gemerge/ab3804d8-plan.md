# Implementation Plan: ab3804d8 - Web Search Tool-Name Refactor

## Summary of Upstream Changes

Upstream commit `ab3804d8` ("refactor(core): migrate web search tool to tool-names (#10782)"):
- Centralizes tool name constants in `tool-names.ts` module
- Updates web_search tool references to use centralized constants
- **Primary benefit:** Prevents circular dependencies when tool classes need to reference other tool names

## Current State in LLxprt

**Problem Analysis:**

While LLxprt uses the `Class.Name` pattern consistently across tools, there are **CRITICAL ISSUES** with the current implementation:

### Issue 1: Hardcoded String Literals Throughout Codebase

Tool names are scattered as string literals instead of using constants:

**Integration Tests (integration-tests/google_web_search.test.ts):**
```typescript
// Line 37: Hardcoded string literal
const foundToolCall = await rig.waitForToolCall('google_web_search');

// Line 46: Hardcoded string literal
t.toolRequest.name === 'google_web_search' && !t.toolRequest.success

// Line 76: Hardcoded string literal
.filter((t) => t.toolRequest.name === 'google_web_search');
```

**Invocation Class (google-web-search-invocation.ts:73):**
```typescript
override getToolName(): string {
  return 'google_web_search';  // Hardcoded literal, not using GoogleWebSearchTool.Name
}
```

**CLI Config (packages/cli/src/config/config.ts:77):**
```typescript
const TOOL_NAMES = [
  // ... other tools
  'google_web_search',  // Hardcoded literal, not using constant
  // ... more tools
] as const;
```

### Issue 2: Missing Exa Web Search in Critical Locations

- ExaWebSearchTool exists but is NOT in executor.ts allowlist
- ExaWebSearchTool is NOT in CLI config TOOL_NAMES array
- This is an inconsistency that should be addressed

### Issue 3: Circular Dependency Risk

The `Class.Name` pattern FAILS when:
- One tool needs to reference another tool's name
- Config modules need tool names but can't import tool classes (circular deps)
- Test utilities need tool names without importing heavy tool implementations

**Example Circular Dependency:**
```
config.ts imports GoogleWebSearchTool → GoogleWebSearchTool imports Config → CIRCULAR!
```

This is why upstream created `tool-names.ts` - it breaks the circular dependency.

## Decision: IMPLEMENT tool-names.ts Pattern

**Rationale:**

1. **Prevents Circular Dependencies:** Tool names can be imported without importing tool classes
2. **Single Source of Truth:** Consolidates all 23+ tool names in one location
3. **Eliminates String Literals:** Replaces hardcoded strings throughout the codebase
4. **Type Safety:** Export both constants and union types for tool names
5. **Matches Upstream Architecture:** Aligns with gemini-cli's design decisions

**This is NOT a NOP - it's a critical architectural improvement.**

## Implementation Steps

### Step 1: Create tool-names.ts Module
**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/tools/tool-names.ts`

```typescript
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized tool name constants.
 *
 * This module exists to prevent circular dependencies - tool names can be
 * imported without importing tool classes. For example, config modules and
 * tests can reference tool names without creating circular dependency chains.
 */

// Web Search Tools
export const GOOGLE_WEB_SEARCH_TOOL = 'google_web_search';
export const EXA_WEB_SEARCH_TOOL = 'exa_web_search';

// File System Tools
export const READ_FILE_TOOL = 'read_file';
export const WRITE_FILE_TOOL = 'write_file';
export const EDIT_TOOL = 'replace';
export const SMART_EDIT_TOOL = 'smart_edit';
export const INSERT_AT_LINE_TOOL = 'insert_at_line';
export const DELETE_LINE_RANGE_TOOL = 'delete_line_range';
export const READ_LINE_RANGE_TOOL = 'read_line_range';
export const READ_MANY_FILES_TOOL = 'read_many_files';

// Search & Discovery Tools
export const GREP_TOOL = 'search_file_content';
export const RIPGREP_TOOL = 'ripgrep';
export const GLOB_TOOL = 'glob';
export const LS_TOOL = 'ls';
export const LIST_DIRECTORY_TOOL = 'list_directory';
export const CODE_SEARCH_TOOL = 'code_search';

// Web Fetch Tools
export const GOOGLE_WEB_FETCH_TOOL = 'web_fetch';
export const DIRECT_WEB_FETCH_TOOL = 'direct_web_fetch';

// Task & Memory Tools
export const TASK_TOOL = 'task';
export const MEMORY_TOOL = 'memory';
export const TODO_READ_TOOL = 'todo_read';
export const TODO_WRITE_TOOL = 'todo_write';
export const TODO_PAUSE_TOOL = 'todo_pause';

// Agent Tools
export const LIST_SUBAGENTS_TOOL = 'list_subagents';

// Shell Tool
export const SHELL_TOOL = 'shell';

/**
 * Union type of all tool names for type safety
 */
export type ToolName =
  | typeof GOOGLE_WEB_SEARCH_TOOL
  | typeof EXA_WEB_SEARCH_TOOL
  | typeof READ_FILE_TOOL
  | typeof WRITE_FILE_TOOL
  | typeof EDIT_TOOL
  | typeof SMART_EDIT_TOOL
  | typeof INSERT_AT_LINE_TOOL
  | typeof DELETE_LINE_RANGE_TOOL
  | typeof READ_LINE_RANGE_TOOL
  | typeof READ_MANY_FILES_TOOL
  | typeof GREP_TOOL
  | typeof RIPGREP_TOOL
  | typeof GLOB_TOOL
  | typeof LS_TOOL
  | typeof LIST_DIRECTORY_TOOL
  | typeof CODE_SEARCH_TOOL
  | typeof GOOGLE_WEB_FETCH_TOOL
  | typeof DIRECT_WEB_FETCH_TOOL
  | typeof TASK_TOOL
  | typeof MEMORY_TOOL
  | typeof TODO_READ_TOOL
  | typeof TODO_WRITE_TOOL
  | typeof TODO_PAUSE_TOOL
  | typeof LIST_SUBAGENTS_TOOL
  | typeof SHELL_TOOL;
```

### Step 2: Update GoogleWebSearchToolInvocation
**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/tools/google-web-search-invocation.ts`

Replace line 73:
```typescript
return 'google_web_search';
```

With:
```typescript
import { GOOGLE_WEB_SEARCH_TOOL } from './tool-names.js';
// ...
return GOOGLE_WEB_SEARCH_TOOL;
```

### Step 3: Update Integration Tests
**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/google_web_search.test.ts`

Add import at top:
```typescript
import { GOOGLE_WEB_SEARCH_TOOL } from '../packages/core/src/tools/tool-names.js';
```

Replace all string literals:
- Line 37: `waitForToolCall(GOOGLE_WEB_SEARCH_TOOL)`
- Line 46: `t.toolRequest.name === GOOGLE_WEB_SEARCH_TOOL`
- Line 76: `t.toolRequest.name === GOOGLE_WEB_SEARCH_TOOL`

### Step 4: Update CLI Config
**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/cli/src/config/config.ts`

Add import:
```typescript
import {
  GOOGLE_WEB_SEARCH_TOOL,
  EXA_WEB_SEARCH_TOOL,
  // ... import other tool names as needed
} from '../../core/src/tools/tool-names.js';
```

Update TOOL_NAMES array (around line 77):
```typescript
const TOOL_NAMES = [
  // ... existing tools ...
  GOOGLE_WEB_SEARCH_TOOL,
  EXA_WEB_SEARCH_TOOL,  // ADD THIS - was missing!
  // ... more tools
] as const;
```

### Step 5: Update Executor Allowlist
**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/agents/executor.ts`

The executor currently uses `GoogleWebSearchTool.Name` which is good.
Add `ExaWebSearchTool.Name` to the allowlist (line 760-769):

```typescript
const allowlist = new Set([
  LSTool.Name,
  ReadFileTool.Name,
  GrepTool.Name,
  RipGrepTool.Name,
  GlobTool.Name,
  ReadManyFilesTool.Name,
  MemoryTool.Name,
  GoogleWebSearchTool.Name,
  ExaWebSearchTool.Name,  // ADD THIS
]);
```

### Step 6: Keep Class.Name Pattern (Best of Both Worlds)

**DO NOT** remove the `static readonly Name` pattern from tool classes. Instead, have them reference the centralized constants:

**Example for GoogleWebSearchTool:**
```typescript
import { GOOGLE_WEB_SEARCH_TOOL } from './tool-names.js';

export class GoogleWebSearchTool extends BaseDeclarativeTool<...> {
  static readonly Name: string = GOOGLE_WEB_SEARCH_TOOL;

  constructor(...) {
    super(GoogleWebSearchTool.Name, ...);
  }
}
```

This provides:
- Class-based access for code that imports the tool: `GoogleWebSearchTool.Name`
- Direct constant access for code that needs to avoid circular deps: `GOOGLE_WEB_SEARCH_TOOL`

### Step 7: Export from tools/index.ts

Add to `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/tools/index.ts`:
```typescript
export * from './tool-names.js';
```

## Files Modified

1. **NEW:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/tools/tool-names.ts`
2. `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/tools/google-web-search-invocation.ts`
3. `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/google_web_search.test.ts`
4. `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/cli/src/config/config.ts`
5. `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/agents/executor.ts`
6. `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/tools/index.ts`

## Acceptance Criteria

- [ ] **tool-names.ts created** with all tool name constants
- [ ] **google-web-search-invocation.ts** uses `GOOGLE_WEB_SEARCH_TOOL` constant
- [ ] **Integration tests** use constants instead of string literals
- [ ] **CLI config** uses constants and includes `EXA_WEB_SEARCH_TOOL`
- [ ] **Executor allowlist** includes `ExaWebSearchTool.Name`
- [ ] **All tests pass:** `npm test`
- [ ] **Lint passes:** `npm run lint`
- [ ] **Type check passes:** `npm run typecheck`
- [ ] **Build succeeds:** `npm run build`

## Merge Notes

**Upstream Intent:** Centralize tool name constants to prevent typos, ensure consistency, and **prevent circular dependencies**.

**LLxprt Implementation:** Implement the tool-names.ts pattern while keeping the existing Class.Name API for tools.

**Architecture Benefit:** Breaks circular dependency chains:
- Config modules can import tool names without importing tool classes
- Tests can reference tool names without heavy imports
- Tool invocations can use constants without creating circular deps

**Critical Fixes:**
1. Eliminates hardcoded string literals in tests and invocation classes
2. Adds missing ExaWebSearchTool to executor allowlist
3. Adds missing ExaWebSearchTool to CLI config
4. Provides centralized, type-safe tool name management

**Status:** REIMPLEMENT - This is NOT a NOP. This is a critical architectural improvement that addresses real issues in the codebase.
