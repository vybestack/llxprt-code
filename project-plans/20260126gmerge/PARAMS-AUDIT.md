# Tool Parameter Audit for CONSISTENT PARAMS Feature

## Overview

Upstream commit `f05d937f39` standardizes tool parameter names to ensure consistency across similar tools. This audit identifies which tools in LLxprt have parameter naming inconsistencies and documents the current vs desired parameter names.

## Upstream Conventions

From `f05d937f39`:
- **file_path** → **absolute_path** (for file path parameters)
- **path** → **absolute_path** (for directory paths)
- Consistency across similar tools (e.g., all file tools use same param names)
- Param names should be descriptive and indicate they accept absolute paths

---

## Tool-by-Tool Audit

### 1. read-file.ts

**Status:** [OK] ALREADY MIGRATED
- **File:** `packages/core/src/tools/read-file.ts`
- **Tool name:** `read_file`

**Current params:**
- `absolute_path` (primary, file path)
- `file_path` (legacy/alias for backward compatibility)
- `offset` (line number to start from)
- `limit` (number of lines to read)
- `showLineNumbers` (prefix lines with numbers)
- `showGitChanges` (prefix lines with git markers)

**Issues:**
- [OK] None - Already uses `absolute_path` as primary parameter
- [OK] Maintains backward compatibility with `file_path` alias
- [OK] Normalizes params to always use `absolute_path` internally

**Code evidence:**
```typescript
export interface ReadFileToolParams {
  absolute_path?: string;  // Primary parameter
  file_path?: string;      // Alternative for compatibility
  // ...
}
```

**Priority:** [OK] **COMPLETE** - No action needed

---

### 2. write-file.ts

**Status:** WARNING: INCONSISTENT (uses file_path as primary)
- **File:** `packages/core/src/tools/write-file.ts`
- **Tool name:** `write_file`

**Current params:**
- `file_path` (primary, file path)
- `absolute_path` (legacy/alias)
- `content` (required, content to write)
- `modified_by_user` (optional)
- `ai_proposed_content` (optional)

**Issues:**
- [ERROR] Uses `file_path` as primary parameter
- [ERROR] `absolute_path` exists but is secondary/legacy
- [OK] Has backward compatibility support

**Code evidence:**
```typescript
export interface WriteFileToolParams {
  file_path?: string;           // Currently primary
  absolute_path?: string;       // Alternative for compatibility
  content: string;              // Required
  // ...
}
```

**Desired state:**
- Make `absolute_path` primary
- Make `file_path` secondary/legacy alias
- Update schema description to match

**Priority:**  **HIGH** - Core file modification tool, frequently used

---

### 3. edit.ts

**Status:** WARNING: INCONSISTENT (uses file_path only)
- **File:** `packages/core/src/tools/edit.ts`
- **Tool name:** `edit`

**Current params:**
- `file_path` (required, file path) - **NO absolute_path alias**
- `old_string` (required, text to replace)
- `new_string` (required, text to replace with)
- `expected_replacements` (optional, defaults to 1)
- `modified_by_user` (optional)
- `ai_proposed_content` (optional)

**Issues:**
- [ERROR] Uses `file_path` with NO `absolute_path` alias
- [ERROR] No backward compatibility mechanism
- [ERROR] Breaking change required

**Code evidence:**
```typescript
export interface EditToolParams {
  file_path: string;  // Required, NO alias available
  old_string: string;
  new_string: string;
  expected_replacements?: number;
  // ...
}
```

**Desired state:**
- Add `absolute_path` as primary required parameter
- Keep `file_path` as secondary alias for backward compatibility
- Update schema and validation

**Priority:**  **HIGH** - Core editing tool, frequently used

---

### 4. glob.ts

**Status:**  INCONSISTENT (uses path for directory)
- **File:** `packages/core/src/tools/glob.ts`
- **Tool name:** `glob`

**Current params:**
- `pattern` (required, glob pattern)
- `path` (optional, directory to search in)
- `case_sensitive` (optional)
- `respect_git_ignore` (optional)

**Issues:**
- WARNING: Uses `path` for directory (convention says should be `directory` or `search_path`)
- WARNING: `path` is optional and resolves relative paths internally
- WARNING: No explicit `absolute_path` parameter

**Code evidence:**
```typescript
export interface GlobToolParams {
  pattern: string;
  path?: string;  // Resolves internally: path.resolve(config.getTargetDir(), params.path || '.')
  case_sensitive?: boolean;
  respect_git_ignore?: boolean;
}
```

**Desired state (to match upstream):**
- Option A: Keep `path` but clarify it accepts absolute paths (low impact)
- Option B: Rename to `directory_path` or `search_directory` (higher impact)
- Upstream convention: `path` → `directory_path` for directory parameters

**Priority:**  **MEDIUM** - Search tool, less frequently edited

---

### 5. grep.ts (search_file_content)

**Status:**  INCONSISTENT (uses path for directory)
- **File:** `packages/core/src/tools/grep.ts`
- **Tool name:** `search_file_content`

**Current params:**
- `pattern` (required, regex pattern)
- `path` (optional, directory to search in)
- `include` (optional, file filter pattern)
- `max_results` (optional)
- `max_files` (optional)
- `max_per_file` (optional)
- `timeout_ms` (optional)

**Issues:**
- WARNING: Uses `path` for directory (same as glob)
- WARNING: `path` is optional and resolves relative paths internally
- WARNING: No explicit `absolute_path` parameter

**Code evidence:**
```typescript
export interface GrepToolParams {
  pattern: string;
  path?: string;  // Resolves internally: path.resolve(config.getTargetDir(), relativePath)
  include?: string;
  // ...
}
```

**Desired state (to match upstream):**
- Should align with glob.ts changes
- Either keep `path` with clarified documentation or rename to `directory_path`

**Priority:**  **MEDIUM** - Search tool, less frequently edited

---

### 6. ls.ts (list_directory)

**Status:** WARNING: INCONSISTENT (uses path for directory)
- **File:** `packages/core/src/tools/ls.ts`
- **Tool name:** `list_directory`

**Current params:**
- `path` (required, directory to list)
- `ignore` (optional, array of glob patterns)
- `file_filtering_options` (optional, respect_git_ignore, respect_llxprt_ignore)

**Issues:**
- [ERROR] Uses `path` as required parameter
- [ERROR] Must be absolute path (validates this)
- [ERROR] No `absolute_path` naming to clarify this requirement
- [OK] At least enforces absolute paths in validation

**Code evidence:**
```typescript
export interface LSToolParams {
  path: string;  // Required, validated: path.isAbsolute(params.path)
  ignore?: string[];
  file_filtering_options?: { /* ... */ };
}
```

**Desired state:**
- Rename `path` → `directory_path` for clarity
- Or rename to `absolute_path` if treating consistently with file tools

**Priority:**  **MEDIUM** - Listing tool, moderately used

---

### 7. shell.ts

**Status:** WARNING: INCONSISTENT (uses directory parameter)
- **File:** `packages/core/src/tools/shell.ts`
- **Tool name:** `run_shell_command`

**Current params:**
- `command` (required, shell command)
- `description` (optional, for confirmation prompts)
- `directory` (optional, directory to execute in)
- `head_lines` (optional)
- `tail_lines` (optional)
- `grep_pattern` (optional)
- `grep_flags` (optional)
- `timeout_seconds` (optional)

**Issues:**
- WARNING: Uses `directory` (different naming than `path` used elsewhere)
- WARNING: Can be workspace directory name OR absolute path (inconsistent)
- [OK] At least has clear parameter name

**Code evidence:**
```typescript
export interface ShellToolParams {
  command: string;
  description?: string;
  directory?: string;  // Can be directory name (e.g., "packages") or absolute path
  head_lines?: number;
  tail_lines?: number;
  grep_pattern?: string;
  grep_flags?: string[];
  timeout_seconds?: number;
}
```

**Desired state:**
- Consider renaming to `execution_directory` or `working_directory` for clarity
- Or align with other tools and use `directory_path`
- Keep dual functionality (workspace dir name OR absolute path)

**Priority:**  **LOW** - Shell tool, different semantic purpose

---

### 8. mcp-tool.ts

**Status:** [OK] NOT APPLICABLE
- **File:** `packages/core/src/tools/mcp-tool.ts`
- **Tool names:** Dynamic (discovered from MCP servers)

**Current params:**
- Dynamic - parameter schemas come from MCP server tool definitions

**Issues:**
- [OK] Not applicable - parameters are defined by MCP servers, not by LLxprt
- [OK] No action needed

**Priority:** [OK] **NONE** - Tools are discovered dynamically

---

### 9. read-many-files.ts

**Status:** [OK] ALREADY MIGRATED
- **File:** `packages/core/src/tools/read-many-files.ts`
- **Tool name:** `read_many_files`

**Current params:**
- `paths` (required, array of file paths)

**Issues:**
- [OK] Uses `paths` (plural) which is appropriate for multiple files
- [OK] No individual file path parameter to migrate
- [OK] Consistent with bulk operation semantics

**Priority:** [OK] **NONE** - Already correctly named

---

## Summary Table

| Tool | File | Current Param | Desired Param | Breaking Change? | Priority |
|------|------|---------------|---------------|------------------|----------|
| read-file | [OK] | `absolute_path` | `absolute_path` | No | Complete |
| write-file | WARNING: | `file_path` | `absolute_path` | Yes (with compat) |  HIGH |
| edit | WARNING: | `file_path` | `absolute_path` | Yes (with compat) |  HIGH |
| glob | WARNING: | `path` | `directory_path` | Yes (with docs) |  MEDIUM |
| grep | WARNING: | `path` | `directory_path` | Yes (with docs) |  MEDIUM |
| ls | WARNING: | `path` | `directory_path` | Yes |  MEDIUM |
| shell | WARNING: | `directory` | `execution_directory` | Yes (with docs) |  LOW |
| mcp-tool | [OK] | Dynamic | Dynamic | N/A | None |
| read-many-files | [OK] | `paths` | `paths` | No | None |

---

## Recommended Phasing Strategy

### Phase 1: Core File Operations (High Priority)
**Tools:** `write-file`, `edit`

1. **Write migration approach:**
   - Add `absolute_path` as primary parameter
   - Keep `file_path` as legacy alias (maintain in interface and schema)
   - Add normalization logic in `validateToolParamValues()` and `createInvocation()`
   - Update tool description to prefer `absolute_path`
   - Follow pattern from `read-file.ts`

2. **Edit migration approach:**
   - Add `absolute_path` as primary required parameter
   - Add `file_path` as legacy alias (make optional)
   - Update validation to accept either
   - Add normalization logic
   - Follow pattern from `read-file.ts`

**Risk:**
- Moderate - requires interface changes
- Mitigated by backward compatibility aliases
- Well-tested pattern exists in `read-file.ts`

**Estimated effort:** 2-4 hours

---

### Phase 2: Directory/Search Tools (Medium Priority)
**Tools:** `glob`, `grep`, `ls`

**Decision needed:** Rename `path` → `directory_path` vs clarify docs only?

**Approach A: Rename parameters (cleaner, more breaking)**
1. Rename param in interface: `path` → `directory_path`
2. Keep `path` as optional alias for backward compatibility
3. Update all references in tool implementation
4. Update tool descriptions

**Approach B: Documentation only (less breaking)**
1. Keep current param names
2. Update description to explicitly state "must be absolute path"
3. Add validation error messages that clarify this

**Recommendation:** Approach A (rename with backward compat)
- Aligns with upstream conventions better
- `directory_path` is clearer than `path` anyway
- Can add aliases to maintain compatibility

**Risk:**
- Low-Medium - interface changes but with aliases
- These tools are used frequently but parameter is usually explicit

**Estimated effort:** 2-3 hours

---

### Phase 3: Shell Tool (Low Priority)
**Tool:** `shell`

1. Rename `directory` → `execution_directory`
2. Keep `directory` as alias backward compatibility
3. Update validation to accept either
4. Update documentation to clarify dual functionality

**Risk:**
- Low - Shell tool has different semantics
- Many users may not even specify the parameter

**Estimated effort:** 1 hour

---

### Phase 4: Cleanup and Verification

1. Update all tool descriptions to consistently reference new parameter names
2. Run tool tests to ensure backward compatibility works
3. Update any internal code that references old parameter names
4. Update user-facing documentation
5. Consider deprecation warnings for legacy parameter names

**Estimated effort:** 2-3 hours

---

## Detailed Implementation Notes

### Migration Pattern (from read-file.ts)

The correct pattern to follow for adding backward compatibility:

```typescript
// 1. Interface - new param primary, legacy optional
export interface ToolParams {
  absolute_path?: string;    // Primary
  file_path?: string;        // Legacy alias
}

// 2. Validation - accept either param name
protected override validateToolParamValues(params: ToolParams): string | null {
  const filePath = params.absolute_path || params.file_path || '';
  if (filePath.trim() === '') {
    return "Either 'absolute_path' or 'file_path' parameter must be provided and non-empty.";
  }
  // ... rest of validation
}

// 3. Invocation creation - normalize to primary param
protected override createInvocation(
  params: ToolParams,
  _messageBus?: MessageBus,
): ToolInvocation<ToolParams, ToolResult> {
  const normalizedParams = { ...params };
  if (!normalizedParams.absolute_path && normalizedParams.file_path) {
    normalizedParams.absolute_path = normalizedParams.file_path;
  }
  return new ToolInvocation(this.config, normalizedParams);
}
```

### Schema Documentation

When updating tool schemas, follow this pattern:

```typescript
{
  properties: {
    absolute_path: {
      description:
        process.platform === 'win32'
          ? "The absolute path to the file (e.g., 'C:\\Users\\project\\file.txt'). Relative paths are not supported."
          : "The absolute path to the file (e.g., '/home/user/project/file.txt'). Relative paths are not supported.",
      type: 'string',
    },
    file_path: {
      description:
        'Alternative parameter name for absolute_path (for backward compatibility). The absolute path to the file.',
      type: 'string',
    },
  },
  required: [], // Don't require either in schema - validation handles this
  type: 'object',
}
```

---

## Testing Strategy

Before merging:

1. **Unit tests:**
   - Test that `absolute_path` works
   - Test that legacy param names still work
   - Test validation accepts both param names
   - Test normalization logic

2. **Integration tests:**
   - Run full tool invocation with new param names
   - Run with legacy param names
   - Verify both produce same results

3. **Backward compatibility:**
   - Test existing prompts/code that uses old param names
   - Ensure no breaking changes for users

4. **Edge cases:**
   - Both params provided (should prefer primary)
   - Neither param provided (should fail validation)
   - Empty strings (should fail validation)
   - Relative paths (should fail validation)

---

## Conclusion

**Summary:**
- 2 tools need immediate attention (write-file, edit)
- 3 directory tools need parameter renaming (glob, grep, ls)
- 1 shell tool needs consistency (shell)
- 2 tools are already migrated (read-file, read-many-files)
- 1 tool is dynamic and not applicable (mcp-tool)

**Total estimated effort:** 7-11 hours

**Recommendation:** Start with Phase 1 (write-file, edit) as they are the highest-impact tools and have a clear migration pattern to follow from read-file.ts.
