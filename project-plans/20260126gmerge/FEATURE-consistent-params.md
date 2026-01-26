# Feature Implementation Plan: Consistent Parameter Names

**Feature:** Standardize tool parameter naming across all core tools  
**Branch:** `20260126gmerge` (continuation)  
**Prerequisites:** None  
**Estimated Complexity:** Medium (many files, but straightforward changes)  
**Upstream Reference:** `f05d937f39`

---

## Overview

Standardize parameter naming across all core tools:
- `file_path` for single file paths (preferred)
- `absolute_path` as alternative accepted name (backward compatibility)
- Consistent naming for other parameters

---

## START HERE (If you were told to "DO this plan")

### Step 1: Check current state
```bash
git branch --show-current  # Should be 20260126gmerge
git status                 # Should be clean
```

### Step 2: Run the audit FIRST
Phase 0 must complete before implementation begins.

### Step 3: Create/check todo list
Call `todo_read()`. If empty or this feature not present, call `todo_write()` with todos below.

### Step 4: Execute using subagents
- **For audit:** Use `codeanalayzer` subagent
- **For implementation:** Use `typescriptexpert` subagent
- **For review:** Use `reviewer` subagent

---

## Todo List

```javascript
todo_write({
  todos: [
    // Phase 0: Audit
    { id: "PARAMS-0-audit", content: "Audit all tools for param names", status: "pending", priority: "high" },
    
    // Phase 1: Read Tools (TDD)
    { id: "PARAMS-1-test", content: "Write tests for read-file params", status: "pending", priority: "high" },
    { id: "PARAMS-1-impl", content: "Implement read-file params", status: "pending", priority: "high" },
    { id: "PARAMS-1-review", content: "Review Phase 1 (qualitative)", status: "pending", priority: "high" },
    { id: "PARAMS-1-commit", content: "Commit Phase 1", status: "pending", priority: "high" },

    // Phase 2: Write Tools (TDD)
    { id: "PARAMS-2-test", content: "Write tests for write-file, edit params", status: "pending", priority: "high" },
    { id: "PARAMS-2-impl", content: "Implement write-file, edit params", status: "pending", priority: "high" },
    { id: "PARAMS-2-review", content: "Review Phase 2 (qualitative)", status: "pending", priority: "high" },
    { id: "PARAMS-2-commit", content: "Commit Phase 2", status: "pending", priority: "high" },

    // Phase 3: Directory/Search Tools (TDD)
    { id: "PARAMS-3-test", content: "Write tests for glob, grep, ls params", status: "pending", priority: "high" },
    { id: "PARAMS-3-impl", content: "Implement glob, grep, ls params", status: "pending", priority: "high" },
    { id: "PARAMS-3-review", content: "Review Phase 3 (qualitative)", status: "pending", priority: "high" },
    { id: "PARAMS-3-commit", content: "Commit Phase 3", status: "pending", priority: "high" },

    // Phase 4: Shell & Remaining (TDD)
    { id: "PARAMS-4-test", content: "Write tests for shell, remaining tools", status: "pending", priority: "high" },
    { id: "PARAMS-4-impl", content: "Implement shell, remaining tools", status: "pending", priority: "high" },
    { id: "PARAMS-4-review", content: "Review Phase 4 (qualitative)", status: "pending", priority: "high" },
    { id: "PARAMS-4-commit", content: "Commit Phase 4", status: "pending", priority: "high" },

    // Phase 5: Documentation
    { id: "PARAMS-5-docs", content: "Update documentation", status: "pending", priority: "medium" },
    { id: "PARAMS-5-commit", content: "Commit Phase 5", status: "pending", priority: "medium" }
  ]
})
```

---

## Phase 0: Audit

### Subagent prompt (codeanalayzer)
```
Audit all core tools in LLxprt for parameter naming.

TASK: Document current vs desired parameter names.

FILES TO EXAMINE:
packages/core/src/tools/*.ts

COMMANDS TO RUN:
```bash
ls packages/core/src/tools/*.ts
grep -n "file_path\|absolute_path\|filePath\|absolutePath" packages/core/src/tools/*.ts
grep -n "InputSchema\|parameters" packages/core/src/tools/*.ts | head -50
```

FOR EACH TOOL, DOCUMENT:
1. File name
2. Current parameter names for file paths
3. Whether it already accepts both names
4. Changes needed

CREATE REPORT at: project-plans/20260126gmerge/research/param-names-audit.md

FORMAT:
| Tool | File | Current Params | Accepts Both? | Changes Needed |
|------|------|---------------|---------------|----------------|
| read-file | read-file.ts | absolute_path | No | Add file_path |
| ... | ... | ... | ... | ... |
```

---

## Phase 1: Read Tools

### Files to modify
- `packages/core/src/tools/read-file.ts`
- `packages/core/src/tools/read-file.test.ts`

### Test cases (write FIRST)
```typescript
describe('read-file parameter names', () => {
  it('should accept file_path parameter', async () => {
    const result = await readFileTool.execute({ file_path: '/path/to/file.txt' });
    expect(result.success).toBe(true);
  });

  it('should accept absolute_path parameter', async () => {
    const result = await readFileTool.execute({ absolute_path: '/path/to/file.txt' });
    expect(result.success).toBe(true);
  });

  it('should prefer file_path when both provided', async () => {
    // Create two different files, verify file_path is used
  });

  it('should reject when neither parameter provided', async () => {
    const result = await readFileTool.execute({});
    expect(result.success).toBe(false);
  });
});
```

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 1 QUALITATIVE REVIEW for Consistent Parameters - Read Tools.

YOU MUST ACTUALLY READ THE CODE, not just run commands.

PART 1: MECHANICAL CHECKS
1. npm run lint
2. npm run typecheck
3. npm run test -- read-file

PART 2: TEST QUALITY ANALYSIS
Read the test file:

Questions:
- Do tests use REAL file operations or mocks?
- Is there a test that verifies file_path is PREFERRED over absolute_path?
- Is the error message tested when neither provided?
- Are edge cases tested? (empty string, null, relative path)

PART 3: IMPLEMENTATION ANALYSIS
Read read-file.ts:

Questions:
- How is the schema defined? (Zod with refine? Union? Optional fields?)
- What's the ACTUAL code that resolves which parameter to use?
  ```typescript
  // Look for something like:
  const filePath = params.file_path ?? params.absolute_path;
  ```
- Is the precedence correct? (file_path > absolute_path)
- What happens if BOTH are provided but different?
- Is the tool description updated to document both parameters?

PART 4: BACKWARD COMPATIBILITY CHECK
- Will existing code that uses absolute_path still work?
- Are there any callers in the codebase that need updating?
  ```bash
  grep -r "absolute_path" packages/ --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules"
  ```
- Does the schema validation accept old format?

PART 5: BEHAVIORAL TRACE
Trace these scenarios through the code:

1. LLM calls tool with: { file_path: "/foo.txt" }
   - Should work, read /foo.txt

2. LLM calls tool with: { absolute_path: "/bar.txt" }
   - Should work (backward compat), read /bar.txt

3. LLM calls tool with: { file_path: "/foo.txt", absolute_path: "/bar.txt" }
   - Should read /foo.txt (file_path preferred)

4. LLM calls tool with: {}
   - Should fail with clear error message

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { "lint": "...", "typecheck": "...", "tests": "..." },
  "qualitative": {
    "test_quality": {
      "verdict": "PASS/FAIL",
      "real_file_ops": true/false,
      "preference_tested": true/false,
      "error_messages_tested": true/false,
      "edge_cases": [],
      "issues": []
    },
    "implementation_quality": {
      "verdict": "PASS/FAIL",
      "schema_approach": "describe (zod refine, union, etc.)",
      "resolution_code": "paste the actual code that picks the param",
      "precedence_correct": true/false,
      "description_updated": true/false,
      "issues": []
    },
    "backward_compatibility": {
      "verdict": "PASS/FAIL",
      "existing_callers_work": true/false,
      "callers_needing_update": [],
      "issues": []
    },
    "behavioral_trace": {
      "verdict": "PASS/FAIL",
      "scenario_1": "works/fails - explanation",
      "scenario_2": "works/fails - explanation",
      "scenario_3": "works/fails - explanation",
      "scenario_4": "works/fails - explanation"
    }
  },
  "issues_requiring_remediation": []
}
```

---

## Phase 2: Write Tools

### Files to modify
- `packages/core/src/tools/write-file.ts`
- `packages/core/src/tools/edit.ts`

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 2 QUALITATIVE REVIEW for Consistent Parameters - Write Tools.

YOU MUST ACTUALLY READ THE CODE.

PART 1: MECHANICAL CHECKS
npm run lint && npm run typecheck && npm run test -- write-file edit

PART 2: CONSISTENCY CHECK
Compare write-file.ts and edit.ts implementations:
- Do they use the SAME pattern for accepting both parameters?
- Is the precedence (file_path > absolute_path) the same?
- Are the error messages consistent?

PART 3: IMPLEMENTATION ANALYSIS
For EACH tool (write-file.ts, edit.ts):
- Schema definition approach?
- Resolution code?
- Description updated?

PART 4: SECURITY CONSIDERATION
Write tools are dangerous. Verify:
- Path validation still works with both parameter names
- Can't escape sandbox/workspace with either parameter
- Permissions checks apply to both parameters

PART 5: BEHAVIORAL TRACE
For write-file:
1. { file_path: "/foo.txt", content: "..." } - works?
2. { absolute_path: "/foo.txt", content: "..." } - works?
3. { content: "..." } (no path) - fails with good error?

For edit:
1. { file_path: "/foo.txt", old_string: "...", new_string: "..." } - works?
2. { absolute_path: "/foo.txt", old_string: "...", new_string: "..." } - works?

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { ... },
  "qualitative": {
    "consistency": {
      "verdict": "PASS/FAIL",
      "same_pattern": true/false,
      "same_precedence": true/false,
      "same_errors": true/false
    },
    "write_file_analysis": { ... },
    "edit_analysis": { ... },
    "security": {
      "verdict": "PASS/FAIL",
      "path_validation_works": true/false,
      "sandbox_escape_prevented": true/false,
      "issues": []
    },
    "behavioral_trace": { ... }
  },
  "issues_requiring_remediation": []
}
```

---

## Phase 3: Directory/Search Tools

### Files to modify
- `packages/core/src/tools/glob.ts`
- `packages/core/src/tools/grep.ts`
- `packages/core/src/tools/ls.ts`

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 3 QUALITATIVE REVIEW for Consistent Parameters - Directory/Search Tools.

PART 1: MECHANICAL CHECKS
npm run lint && npm run typecheck && npm run test -- glob grep ls

PART 2: PARAMETER SEMANTICS CHECK
These tools use `path` for directories, not files. Verify:
- Is the parameter `path` (not file_path)?
- For glob: is `pattern` parameter named correctly?
- For grep: is `pattern` parameter named correctly?
- Consistency with upstream naming?

PART 3: IMPLEMENTATION ANALYSIS
For EACH tool:
- What parameters does it accept?
- Are there any dual-name parameters here?
- Is directory path handling consistent across all three?

PART 4: BEHAVIORAL TRACE
For glob:
1. { path: "/src", pattern: "**/*.ts" } - works?
2. { pattern: "**/*.ts" } (no path, uses cwd) - works?

For grep:
1. { path: "/src", pattern: "function" } - works?
2. { pattern: "function" } (no path, uses cwd) - works?

For ls:
1. { path: "/src" } - works?
2. {} (no path, uses cwd) - works?

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { ... },
  "qualitative": {
    "parameter_semantics": {
      "verdict": "PASS/FAIL",
      "path_for_directories": true/false,
      "pattern_named_correctly": true/false,
      "consistent_with_upstream": true/false
    },
    "glob_analysis": { ... },
    "grep_analysis": { ... },
    "ls_analysis": { ... },
    "behavioral_trace": { ... }
  },
  "issues_requiring_remediation": []
}
```

---

## Phase 4: Shell & Remaining Tools

### Files to modify
- `packages/core/src/tools/shell.ts`
- Any other tools identified in audit

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 4 QUALITATIVE REVIEW for Consistent Parameters - Shell & Remaining.

PART 1: MECHANICAL CHECKS
npm run lint && npm run typecheck && npm run test

PART 2: SHELL TOOL ANALYSIS
Shell has `directory` or `cwd` parameter. Verify:
- What is the parameter currently named?
- Is it consistent with upstream?
- Does it need dual-name support?

PART 3: COMPLETE TOOL AUDIT
List ALL tools and their current parameter state:
- Which tools were updated in this feature?
- Which tools didn't need changes?
- Are there any tools missed?

PART 4: CROSS-TOOL CONSISTENCY
- Do all file tools use file_path/absolute_path consistently?
- Do all directory tools use path consistently?
- Are error messages consistent across tools?
- Are descriptions consistent across tools?

PART 5: FINAL BEHAVIORAL CHECK
Pick 3 random tools and trace a call through each:
- Does the parameter resolution work?
- Is backward compatibility maintained?

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { ... },
  "qualitative": {
    "shell_analysis": {
      "current_param": "...",
      "needs_change": true/false,
      "changes_made": "..."
    },
    "complete_audit": {
      "tools_updated": ["list"],
      "tools_no_change_needed": ["list"],
      "tools_missed": ["list - should be empty"]
    },
    "cross_tool_consistency": {
      "verdict": "PASS/FAIL",
      "file_tools_consistent": true/false,
      "dir_tools_consistent": true/false,
      "errors_consistent": true/false,
      "descriptions_consistent": true/false
    },
    "behavioral_spot_check": {
      "tool_1": { "name": "...", "works": true/false },
      "tool_2": { "name": "...", "works": true/false },
      "tool_3": { "name": "...", "works": true/false }
    }
  },
  "issues_requiring_remediation": []
}
```

---

## Success Criteria

- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Qualitative review PASS for all phases
- [ ] All file tools accept both file_path and absolute_path
- [ ] Backward compatibility maintained
- [ ] Tool descriptions document accepted parameters
- [ ] Cross-tool consistency verified

---

## Rollback Strategy

Each phase has its own commit:
```bash
git log --oneline -10
git revert <commit-hash>
```
