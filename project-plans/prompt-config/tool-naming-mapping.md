# Tool Naming Mapping

## Overview

This document provides the definitive mapping between tool class names and their corresponding prompt file names in the file-based prompt system. The conversion follows the pattern: `PascalCase` → `kebab-case`.

## Core Tool Mappings

| Tool Class Name | Static Name | Prompt File Path | Description |
|-----------------|-------------|------------------|-------------|
| `ReadFileTool` | `read_file` | `tools/read-file.md` | Reads files from the local filesystem |
| `WriteFileTool` | `write_file` | `tools/write-file.md` | Writes content to files |
| `EditTool` | `replace` | `tools/edit.md` | Replaces text within files |
| `GrepTool` | `search_file_content` | `tools/grep.md` | Searches for patterns in files |
| `GlobTool` | `glob` | `tools/glob.md` | Finds files matching patterns |
| `LSTool` | `list_directory` | `tools/ls.md` | Lists directory contents |
| `ShellTool` | `run_shell_command` | `tools/shell.md` | Executes shell commands |
| `ReadManyFilesTool` | `read_many_files` | `tools/read-many-files.md` | Reads multiple files at once |
| `WebFetchTool` | `web_fetch` | `tools/web-fetch.md` | Fetches content from URLs |
| `WebSearchTool` | `google_web_search` | `tools/web-search.md` | Performs web searches |
| `MemoryTool` | `save_memory` | `tools/memory.md` | Saves information to memory |
| `TodoWrite` | `todo_write` | `tools/todo-write.md` | Manages task lists |
| `TodoRead` | `todo_read` | `tools/todo-read.md` | Reads task lists |

## Dynamic Tool Handling

### Project-Specific Tools
- **Class**: `DiscoveredTool`
- **Prompt Files**: Not applicable (use tool-specific name from configuration)

### MCP Tools
- **Class**: `DiscoveredMCPTool`
- **Prompt Files**: Not applicable (use tool name from MCP server)

## Naming Convention Rules

1. **Remove "Tool" suffix** when converting to kebab-case
   - `ReadFileTool` → `read-file.md` (not `read-file-tool.md`)
   - Exception: When "Tool" is not a suffix (e.g., none currently)

2. **Preserve semantic meaning**
   - `LSTool` → `ls.md` (common abbreviation preserved)
   - `EditTool` → `edit.md` (concise name)

3. **Handle special cases**
   - `TodoWrite` → `todo-write.md` (no "Tool" suffix to remove)
   - `TodoRead` → `todo-read.md` (no "Tool" suffix to remove)

## Implementation Algorithm

```typescript
function getToolFileName(toolClassName: string): string {
  // Remove "Tool" suffix if present
  let name = toolClassName.replace(/Tool$/, '');
  
  // Convert PascalCase to kebab-case
  name = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')  // Handle acronyms
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')      // Handle normal case changes
    .toLowerCase();
  
  return `tools/${name}.md`;
}
```

## Examples

```typescript
getToolFileName('ReadFileTool')      // → 'tools/read-file.md'
getToolFileName('ShellTool')         // → 'tools/shell.md'
getToolFileName('TodoWrite')         // → 'tools/todo-write.md'
getToolFileName('LSTool')            // → 'tools/ls.md'
getToolFileName('ReadManyFilesTool') // → 'tools/read-many-files.md'
```

## Validation

The system should validate that:
1. All enabled tools have corresponding prompt files
2. Tool names in configuration match actual tool class names
3. No duplicate mappings exist

## Migration Notes

When migrating from hardcoded prompts:
1. Extract tool-specific instructions from `getCoreSystemPrompt()`
2. Create individual files for each tool
3. Ensure file names match this mapping exactly
4. Test that tools load their correct prompt files