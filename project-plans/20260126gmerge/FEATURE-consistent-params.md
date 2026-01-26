# Feature Implementation Plan: Consistent Parameter Names

**Feature:** Standardize tool parameter naming across all core tools  
**Branch:** `20260126gmerge` (continuation)  
**Prerequisites:** None  
**Estimated Complexity:** Medium (many files, but straightforward changes)  
**Upstream Reference:** `f05d937f39`

---

## Overview

Standardize parameter naming across all core tools. The upstream commit ensures tools use consistent naming conventions:
- `file_path` for single file paths (preferred)
- `absolute_path` as alternative accepted name
- Consistent naming for other parameters

### Current State Analysis Needed

Before implementing, we need to audit current parameter names across tools. LLxprt may already support both names in some tools.

---

## START HERE (If you were told to "DO this plan")

### Step 1: Check current state
```bash
git branch --show-current  # Should be 20260126gmerge
git status                 # Should be clean
```

### Step 2: Run the audit
Execute Phase 0 to understand current state before making changes.

### Step 3: Create/check todo list
Call `todo_read()`. If empty or this feature not present, call `todo_write()` with todos from "Todo List" section.

### Step 4: Execute using subagents
- **For audit:** Use `codeanalayzer` subagent
- **For implementation:** Use `typescriptexpert` subagent
- **For review:** Use `reviewer` subagent

### Step 5: Commit after each phase

---

## Todo List

```javascript
todo_write({
  todos: [
    // Phase 0: Audit (understand current state)
    {
      id: "PARAMS-0-audit",
      content: "Audit all core tools for parameter naming - document current names vs upstream names",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-0-report",
      content: "Create audit report in research/param-names-audit.md - list files needing changes",
      status: "pending",
      priority: "high"
    },

    // Phase 1: Read Tools (TDD)
    {
      id: "PARAMS-1-test",
      content: "Write tests for read-file.ts parameter acceptance - both file_path and absolute_path should work",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-1-impl",
      content: "Update read-file.ts to accept both parameter names consistently",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-1-review",
      content: "Review Phase 1: read-file accepts both param names, lint/typecheck/test pass",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-1-commit",
      content: "Commit: 'refactor(tools): consistent param names in read-file'",
      status: "pending",
      priority: "high"
    },

    // Phase 2: Write Tools (TDD)
    {
      id: "PARAMS-2-test",
      content: "Write tests for write-file.ts, edit.ts parameter acceptance",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-2-impl",
      content: "Update write-file.ts, edit.ts to accept both parameter names",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-2-review",
      content: "Review Phase 2: write tools accept both param names, lint/typecheck/test pass",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-2-commit",
      content: "Commit: 'refactor(tools): consistent param names in write-file, edit'",
      status: "pending",
      priority: "high"
    },

    // Phase 3: Directory/Search Tools (TDD)
    {
      id: "PARAMS-3-test",
      content: "Write tests for glob.ts, grep.ts, ls.ts parameter acceptance",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-3-impl",
      content: "Update glob.ts, grep.ts, ls.ts to use consistent parameter names",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-3-review",
      content: "Review Phase 3: directory/search tools use consistent params, lint/typecheck/test pass",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-3-commit",
      content: "Commit: 'refactor(tools): consistent param names in glob, grep, ls'",
      status: "pending",
      priority: "high"
    },

    // Phase 4: Shell & Remaining Tools (TDD)
    {
      id: "PARAMS-4-test",
      content: "Write tests for shell.ts and any remaining tools needing param updates",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-4-impl",
      content: "Update shell.ts and remaining tools for consistent parameter names",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-4-review",
      content: "Review Phase 4: all tools use consistent params, lint/typecheck/test pass",
      status: "pending",
      priority: "high"
    },
    {
      id: "PARAMS-4-commit",
      content: "Commit: 'refactor(tools): consistent param names in shell and remaining tools (upstream f05d937f39)'",
      status: "pending",
      priority: "high"
    },

    // Phase 5: Documentation & Snapshots
    {
      id: "PARAMS-5-docs",
      content: "Update any tool documentation/prompts that reference parameter names",
      status: "pending",
      priority: "medium"
    },
    {
      id: "PARAMS-5-snapshots",
      content: "Update test snapshots if any changed due to parameter naming",
      status: "pending",
      priority: "medium"
    },
    {
      id: "PARAMS-5-commit",
      content: "Commit: 'docs: update tool parameter documentation'",
      status: "pending",
      priority: "medium"
    }
  ]
})
```

---

## Phase Details

### Phase 0: Audit

**Goal:** Understand current state before making changes.

**Subagent prompt (codeanalayzer):**
```
Audit all core tools in LLxprt for parameter naming consistency.

TASK: Document current parameter names vs upstream standard names.

FILES TO EXAMINE:
- packages/core/src/tools/*.ts (all tool files)
- Focus on file path parameters

UPSTREAM STANDARD (from f05d937f39):
- file_path: primary name for file paths
- absolute_path: accepted alternative
- path: for directory paths
- pattern: for glob/regex patterns

FOR EACH TOOL, DOCUMENT:
1. Current parameter names
2. Whether it accepts alternatives (file_path AND absolute_path)
3. What changes are needed to match upstream

COMMANDS TO RUN:
```bash
# List all tool files
ls packages/core/src/tools/*.ts

# Check current parameter names
grep -n "file_path\|absolute_path\|filePath\|absolutePath" packages/core/src/tools/*.ts
```

OUTPUT: Create research/param-names-audit.md with:
- Table of tools and their current params
- List of files needing changes
- Estimated number of changes per file
```

---

### Phase 1: Read Tools

**Files to modify:**
- `packages/core/src/tools/read-file.ts`
- `packages/core/src/tools/read-file.test.ts`

**Test cases (write FIRST):**
```typescript
describe('read-file parameter names', () => {
  it('should accept file_path parameter', async () => {
    const result = await readFileTool.execute({
      file_path: '/path/to/file.txt'
    });
    expect(result.success).toBe(true);
  });

  it('should accept absolute_path parameter', async () => {
    const result = await readFileTool.execute({
      absolute_path: '/path/to/file.txt'
    });
    expect(result.success).toBe(true);
  });

  it('should prefer file_path when both provided', async () => {
    const result = await readFileTool.execute({
      file_path: '/correct/path.txt',
      absolute_path: '/ignored/path.txt'
    });
    // Verify it used file_path
  });

  it('should reject when neither parameter provided', async () => {
    const result = await readFileTool.execute({});
    expect(result.success).toBe(false);
  });
});
```

**Implementation pattern:**
```typescript
// In tool parameter schema
const params = z.object({
  file_path: z.string().optional(),
  absolute_path: z.string().optional(), // Alternative name
}).refine(
  data => data.file_path || data.absolute_path,
  { message: 'Either file_path or absolute_path is required' }
);

// In execute function
const filePath = params.file_path ?? params.absolute_path;
```

**Subagent prompt (typescriptexpert):**
```
Implement Phase 1 of Consistent Parameter Names for LLxprt.

TASK: Update read-file.ts to accept both file_path and absolute_path parameters.

TDD REQUIREMENT: Write tests FIRST, then implement.

FILES TO MODIFY:
- packages/core/src/tools/read-file.ts
- packages/core/src/tools/read-file.test.ts (or create if not exists)

REQUIREMENTS:
1. Accept file_path as primary parameter name
2. Accept absolute_path as alternative (backward compat)
3. Prefer file_path when both provided
4. Reject when neither provided
5. Update tool description to document both names

PATTERN TO FOLLOW:
```typescript
const params = z.object({
  file_path: z.string().optional().describe('The file path to read'),
  absolute_path: z.string().optional().describe('Alternative: absolute path to read'),
}).refine(
  data => data.file_path || data.absolute_path,
  { message: 'Either file_path or absolute_path is required' }
);

// Then in execute:
const filePath = validatedParams.file_path ?? validatedParams.absolute_path;
```

TEST CASES (implement first):
1. Accept file_path parameter
2. Accept absolute_path parameter
3. Prefer file_path when both provided
4. Reject when neither provided
5. Existing tests still pass

AFTER IMPLEMENTATION:
1. npm run lint
2. npm run typecheck
3. npm run test -- read-file

Report: test results and any issues.
```

---

### Phase 2: Write Tools

**Files to modify:**
- `packages/core/src/tools/write-file.ts`
- `packages/core/src/tools/edit.ts`
- Associated test files

**Same pattern as Phase 1**, applied to write and edit tools.

---

### Phase 3: Directory/Search Tools

**Files to modify:**
- `packages/core/src/tools/glob.ts`
- `packages/core/src/tools/grep.ts`
- `packages/core/src/tools/ls.ts`

For these tools, the parameter is typically `path` for directories. Ensure consistency:
- `path` for directory parameters
- `pattern` for glob/regex patterns

---

### Phase 4: Shell & Remaining Tools

**Files to modify:**
- `packages/core/src/tools/shell.ts`
- Any other tools identified in audit

Shell tool may have `directory` or `cwd` parameter - ensure consistent naming.

---

### Phase 5: Documentation & Snapshots

Update any documentation that references old parameter names:
- Tool descriptions in code
- README files
- Test snapshots (prompts.ts, etc.)

---

## Backward Compatibility

**Critical:** Existing tool calls must continue to work.

The implementation MUST:
1. Accept BOTH old and new parameter names
2. Prefer new name when both provided
3. Not break any existing functionality
4. Update tests to cover both names

---

## Success Criteria

- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Tools accept both file_path and absolute_path
- [ ] Existing tool calls still work
- [ ] Tool descriptions document accepted parameters

---

## Rollback Strategy

Each phase has its own commit:
```bash
git log --oneline -10
# Revert specific phase if needed
git revert <commit-hash>
```
