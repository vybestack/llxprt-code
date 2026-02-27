# Reimplement Plan: Hooks docs tool name updates (upstream cc52839f19)

## Upstream Change
Updates hooks documentation files to use snake_case tool names (e.g., `write_file`, `replace`, `search_file_content`) instead of PascalCase (e.g., `WriteFile`, `Edit`, `Grep`). Adds comprehensive tool and event matcher reference section to index.md. Adds `transcript_path` field to base hook input documentation.

**Important:** This is a documentation-only change. Per RULES.md, no unit tests are required because no production code is being modified.

## LLxprt Files to Modify
- docs/hooks/best-practices.md — Update tool name examples from PascalCase to snake_case
- docs/hooks/index.md — Update tool name examples, add `transcript_path` field, add tool name reference table and event matcher sections
- docs/hooks/writing-hooks.md — Update tool name examples

## Exhaustive Changes

### 1. docs/hooks/best-practices.md

**Line 222:** Replace matcher pattern in JSON example
```diff
-  "matcher": "WriteFile|Edit",
+  "matcher": "write_file|replace",
```

**Line 301:** Replace tool_name value in JSON example
```diff
-  "tool_name": "WriteFile",
+  "tool_name": "write_file",
```

**Line 440:** Replace matcher pattern in JSON example
```diff
-  "matcher": "WriteFile|Edit",
+  "matcher": "write_file|replace",
```

**Line 487:** Replace bash test command example
```diff
-echo "WriteFile" | grep -E "Write.*|Edit"
+echo "write_file|replace" | grep -E "write_.*|replace"
```

**Line 562:** Replace matcher value in JSON example
```diff
-  "matcher": "WriteFile",
+  "matcher": "write_file",
```

**Line 572:** Replace matcher value in JSON example
```diff
-  "matcher": "WriteFile",
+  "matcher": "write_file",
```

### 2. docs/hooks/index.md

**Line 73:** Replace matcher pattern in BeforeTool example
```diff
-        "matcher": "WriteFile|Edit",
+        "matcher": "write_file|replace",
```

**Line 85:** Replace exact match example
```diff
-- **Exact match:** `"ReadFile"` matches only `ReadFile`
+- **Exact match:** `"read_file"` matches only `read_file`
```

**Line 86:** Replace regex match example
```diff
-- **Regex:** `"Write.*|Edit"` matches `WriteFile`, `WriteBinary`, `Edit`
+- **Regex:** `"write_.*|replace"` matches `write_file`, `replace`
```

**After line 117 (after `"session_id": "abc123",`):** Insert new line with `transcript_path` field
```diff
 {
   "session_id": "abc123",
+  "transcript_path": "/path/to/transcript.jsonl",
   "cwd": "/path/to/project",
```

**Line 133:** Replace tool_name value in BeforeTool example
```diff
-  "tool_name": "WriteFile",
+  "tool_name": "write_file",
```

**Line 162:** Replace tool_name value in AfterTool example
```diff
-  "tool_name": "ReadFile",
+  "tool_name": "read_file",
```

**Line 215:** Replace allowedFunctionNames array in BeforeToolSelection example
```diff
-        "allowedFunctionNames": ["ReadFile", "WriteFile"]
+        "allowedFunctionNames": ["read_file", "write_file"]
```

**Line 319:** Replace allowedFunctionNames array in example output
```diff
-        "allowedFunctionNames": ["ReadFile", "WriteFile", "Edit"]
+        "allowedFunctionNames": ["read_file", "write_file", "replace"]
```

**Line 329:** Replace echo command example
```diff
-echo "ReadFile,WriteFile,Edit"
+echo "read_file,write_file,replace"
```

**Line 527:** Replace tool name translation comment
```diff
-- Translates tool names (`Bash` → `RunShellCommand`, `Edit` → `Edit`)
+- Translates tool names (`Bash` → `run_shell_command`, `replace` → `replace`)
```

**Lines 546-553:** Replace entire tool name mapping table (delete 8 lines, insert 11 lines)
```diff
-| Claude Code | Gemini CLI        |
-| ----------- | ----------------- |
-| `Bash`      | `RunShellCommand` |
-| `Edit`      | `Edit`            |
-| `Read`      | `ReadFile`        |
-| `Write`     | `WriteFile`       |
+| Claude Code | Gemini CLI            |
+| ----------- | --------------------- |
+| `Bash`      | `run_shell_command`   |
+| `Edit`      | `replace`             |
+| `Read`      | `read_file`           |
+| `Write`     | `write_file`          |
+| `Glob`      | `glob`                |
+| `Grep`      | `search_file_content` |
+| `LS`        | `list_directory`      |
```

**After line 553 (after tool name mapping table), before "## Learn more" heading:** Insert new section (109 lines)
```markdown
## Tool and Event Matchers Reference

### Available tool names for matchers

The following built-in tools can be used in `BeforeTool` and `AfterTool` hook
matchers:

#### File operations

- `read_file` - Read a single file
- `read_many_files` - Read multiple files at once
- `write_file` - Create or overwrite a file
- `replace` - Edit file content with find/replace

#### File system

- `list_directory` - List directory contents
- `glob` - Find files matching a pattern
- `search_file_content` - Search within file contents

#### Execution

- `run_shell_command` - Execute shell commands

#### Web and external

- `google_web_search` - Google Search with grounding
- `web_fetch` - Fetch web page content

#### Agent features

- `write_todos` - Manage TODO items
- `save_memory` - Save information to memory
- `delegate_to_agent` - Delegate tasks to sub-agents

#### Example matchers

```json
{
  "matcher": "write_file|replace" // File editing tools
}
```

```json
{
  "matcher": "read_.*" // All read operations
}
```

```json
{
  "matcher": "run_shell_command" // Only shell commands
}
```

```json
{
  "matcher": "*" // All tools
}
```

### Event-specific matchers

#### SessionStart event matchers

- `startup` - Fresh session start
- `resume` - Resuming a previous session
- `clear` - Session cleared

#### SessionEnd event matchers

- `exit` - Normal exit
- `clear` - Session cleared
- `logout` - User logged out
- `prompt_input_exit` - Exit from prompt input
- `other` - Other reasons

#### PreCompress event matchers

- `manual` - Manually triggered compression
- `auto` - Automatically triggered compression

#### Notification event matchers

- `ToolPermission` - Tool permission notifications

```

### 3. docs/hooks/writing-hooks.md

**Line 75:** Replace tool reference in comment
```diff
-[Agent uses ReadFile tool]
+[Agent uses read_file tool]
```

**Line 77:** Replace logged output example
```diff
-Logged: ReadFile
+Logged: read_file
```

**Line 113:** Replace matcher pattern in BeforeTool example
```diff
-        "matcher": "WriteFile|Edit",
+        "matcher": "write_file|replace",
```

**Line 170:** Replace matcher pattern in AfterTool example
```diff
-        "matcher": "WriteFile|Edit",
+        "matcher": "write_file|replace",
```

**Line 382:** Replace matcher pattern in first BeforeTool example
```diff
-        "matcher": "WriteFile|Edit",
+        "matcher": "write_file|replace",
```

**Line 395:** Replace matcher pattern in AfterTool example
```diff
-        "matcher": "WriteFile|Edit",
+        "matcher": "write_file|replace",
```

**Line 604:** Replace coreTools array in JavaScript example
```diff
-  const coreTools = ['ReadFile', 'WriteFile', 'Edit', 'RunShellCommand'];
+  const coreTools = ['read_file', 'write_file', 'replace', 'run_shell_command'];
```

## Branding Verification
All files already use `.llxprt/` and `LLXPRT.md` correctly. No branding changes needed.

## Deterministic Validation

After all changes are complete, run this command to verify no PascalCase tool names remain in tool-name contexts:

```bash
grep -rn '"ReadFile"\|"WriteFile"\|"Edit"\|"RunShellCommand"\|"SearchText"\|"ListDirectory"' docs/hooks/best-practices.md docs/hooks/index.md docs/hooks/writing-hooks.md
```

Expected result: **Zero matches** (exit code 1 from grep, indicating no matches found).

Additional validation for old patterns:

```bash
# Should return zero matches:
grep -rn 'WriteFile|Edit' docs/hooks/
grep -rn '"Write\.\*|Edit"' docs/hooks/
```

Expected result: **Zero matches** for all validation commands.

## Testing Note

**This is a documentation-only change.** Per RULES.md section on behavioral tests:
> "If you are only changing documentation, configuration, or other non-production code, you may skip writing tests."

No unit tests are required for this change. The validation is performed via the grep commands listed above to ensure all PascalCase tool names in JSON examples and code have been replaced with snake_case equivalents.

## Verification Steps

1. **Read all three modified files** to confirm snake_case tool names throughout JSON examples and code
2. **Run deterministic validation** commands listed above to ensure no PascalCase tool names remain in tool-name contexts
3. **Verify branding** is correct (`.llxprt/`, `LLXPRT.md`, etc.)
4. **Check that `transcript_path` field** was added to the base HookInput example in index.md (line 118)
5. **Verify new "Tool and Event Matchers Reference" section** was added to index.md after the tool name mapping table (after line 553, before "## Learn more")
6. **Verify tool name mapping table** in index.md was expanded from 6 rows to 9 rows (added Glob, Grep, LS mappings)
