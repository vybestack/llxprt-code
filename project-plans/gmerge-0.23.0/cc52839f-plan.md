# Reimplement Plan: Hooks docs tool name updates (upstream cc52839f19)

## Upstream Change
Updates hooks documentation files to use snake_case tool names (e.g., `write_file`, `replace`, `search_file_content`) instead of PascalCase (e.g., `WriteFile`, `Edit`, `Grep`).

## LLxprt Files to Modify
- docs/hooks/best-practices.md — Update tool name examples from PascalCase to snake_case
- docs/hooks/index.md — Update tool name examples and add tool name reference table
- docs/hooks/writing-hooks.md — Update tool name examples

## Steps

1. **Read all hook documentation files** to understand current state:
   - `docs/hooks/best-practices.md`
   - `docs/hooks/index.md`
   - `docs/hooks/writing-hooks.md`

2. **Update docs/hooks/best-practices.md**:
   - Find: `"matcher": "WriteFile|Edit"` → Replace: `"matcher": "write_file|replace"`
   - Find: `"tool_name": "WriteFile"` → Replace: `"tool_name": "write_file"`
   - Find: `"matcher": "Write.*|Edit"` → Replace: `"matcher": "write_.*|replace"`
   - Find: `echo "WriteFile" | grep -E "Write.*|Edit"` → Replace: `echo "write_file|replace" | grep -E "write_.*|replace"`
   - Update all other PascalCase tool name references to snake_case

3. **Update docs/hooks/index.md**:
   - Find: `"matcher": "WriteFile|Edit"` → Replace: `"matcher": "write_file|replace"`
   - Find: `"ReadFile"` → Replace: `"read_file"`
   - Find: `"Write.*|Edit"` → Replace: `"write_.*|replace"`
   - Find: `"WriteFile"`, `"WriteBinary"` → Replace: `"write_file"`, (remove WriteBinary if present)
   - Find: `"ReadFile"` → Replace: `"read_file"`
   - Find: `"RunShellCommand"` → Replace: `"run_shell_command"`
   - Add tool name reference section near end (before "Learn more" section):
     ```markdown
     ## Tool and Event Matchers Reference

     ### Available tool names for matchers

     The following built-in tools can be used in `BeforeTool` and `AfterTool` hook matchers:

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

4. **Update docs/hooks/writing-hooks.md**:
   - Find: `Logged: ReadFile` → Replace: `Logged: read_file`
   - Find: `[Agent uses ReadFile tool]` → Replace: `[Agent uses read_file tool]`
   - Find: `"matcher": "WriteFile|Edit"` → Replace: `"matcher": "write_file|replace"`
   - Find: `const coreTools = ['ReadFile', 'WriteFile', 'Edit', 'RunShellCommand'];` → Replace: `const coreTools = ['read_file', 'write_file', 'replace', 'run_shell_command'];`
   - Update all other tool name references to snake_case

5. **Verify branding**:
   - Ensure all paths use `.llxprt/` not `.gemini/`
   - Ensure references to `LLXPRT.md` not `GEMINI.md`
   - Check that Claude Code migration section (if present) references correct paths

## Verification
- Read all three modified files to confirm snake_case tool names throughout
- Search for any remaining PascalCase tool names: `rg "WriteFile|ReadFile|Edit(?!or)" docs/hooks/`
- Verify examples are consistent and match LLxprt's actual tool names

## Branding Adaptations
- `.gemini/` → `.llxprt/`
- `GEMINI.md` → `LLXPRT.md`
- `Gemini CLI` → `LLxprt Code` (in prose)
- If migration section exists: update paths to LLxprt equivalents
