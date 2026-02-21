# Tools

Tools are functions the model can call to interact with your system — reading files, running commands, searching the web, and more. You don't call tools directly; the model decides which tools to use based on your request.

## How It Works

1. You give the model a task (e.g., "find all TODO comments in the project")
2. The model picks the right tools (e.g., `search_file_content`)
3. LLxprt Code shows you what the tool wants to do and asks for confirmation (for write operations)
4. The tool runs and the model uses the output to continue

## Built-in Tools

### File System

| Tool                  | What It Does                                           |
| --------------------- | ------------------------------------------------------ |
| `read_file`           | Read a file's contents                                 |
| `read_line_range`     | Read specific lines from a file                        |
| `read_many_files`     | Read multiple files by glob pattern                    |
| `write_file`          | Create or overwrite a file                             |
| `edit` / `replace`    | Replace text in a file                                 |
| `ast_edit`            | AST-aware edit with syntax validation                  |
| `insert_at_line`      | Insert content at a specific line                      |
| `delete_line_range`   | Delete a range of lines                                |
| `apply_patch`         | Apply a unified diff patch                             |
| `glob`                | Find files matching a pattern                          |
| `list_directory`      | List directory contents                                |
| `search_file_content` | Search file contents with regex (ripgrep)              |
| `ast_grep`            | Search code by AST structure                           |
| `structural_analysis` | Multi-hop code analysis (callers, callees, references) |
| `ast_read_file`       | Read file with AST context extraction                  |

### Shell

| Tool                | What It Does            |
| ------------------- | ----------------------- |
| `run_shell_command` | Execute a shell command |

The shell tool is the only tool that can reach **outside your workspace**. All file system tools are constrained to the workspace directory. This is why [sandboxing](../sandbox.md) matters — the shell tool can install packages, modify system files, or do anything your user account can do.

### Web

| Tool                | What It Does                                  |
| ------------------- | --------------------------------------------- |
| `google_web_search` | Search the web via Google                     |
| `exa_web_search`    | Search the web via Exa AI                     |
| `direct_web_fetch`  | Fetch and convert a URL to text/markdown      |
| `google_web_fetch`  | Fetch a URL via Google's infrastructure       |
| `codesearch`        | Search for code snippets, APIs, documentation |

### Memory and Context

| Tool          | What It Does                                       |
| ------------- | -------------------------------------------------- |
| `save_memory` | Save facts to long-term memory (project or global) |

See [Memory](./memory.md) for details on how memory works.

### Agents and Tasks

| Tool                                      | What It Does                           |
| ----------------------------------------- | -------------------------------------- |
| `task`                                    | Launch a subagent to handle a subtask  |
| `list_subagents`                          | List available subagent configurations |
| `check_async_tasks`                       | Check status of background tasks       |
| `todo_read` / `todo_write` / `todo_pause` | Manage structured task lists           |

### MCP (Model Context Protocol)

MCP servers add third-party tools. See [MCP Servers](./mcp-server.md).

## Approvals and Policies

By default, the model must ask permission before:

- Writing, editing, or deleting files
- Running shell commands
- Making web requests

You control this through **policies** (in `settings.json` or `~/.llxprt/policies/`):

```json
{
  "policies": {
    "allow-write": true,
    "allow-shell": true
  }
}
```

Or use `--yolo` at startup to auto-approve everything (not recommended outside sandboxes):

```bash
llxprt --yolo
```

The `/permissions` command shows the current approval state.

## Enabling and Disabling Tools

### Restricting to Specific Tools

Use `coreTools` in `settings.json` to allow only specific tools:

```json
{
  "coreTools": ["read_file", "search_file_content", "glob", "list_directory"]
}
```

When `coreTools` is set, any tool not in the list is disabled. If `coreTools` is not set, all tools are available (the default).

### Shell Command Restrictions

You can restrict the shell tool to specific commands:

```json
{
  "coreTools": ["ShellTool(npm test)", "ShellTool(npm run lint)", "read_file"]
}
```

This allows only `npm test` and `npm run lint` as shell commands.

## Workspace Boundaries

All file system tools (read, write, edit, search, glob) are restricted to your workspace directory. They cannot access files outside the project root.

The **shell tool is the exception** — it can run any command your user account can. If this concerns you:

- Use [sandboxing](../sandbox.md) to run in a container
- Use `coreTools` to restrict shell commands
- Review shell commands when prompted for approval

## Related

- [MCP Servers](./mcp-server.md) — adding third-party tools
- [Memory](./memory.md) — how long-term memory works
- [Sandboxing](../sandbox.md) — running in a container
- [Settings](../settings-and-profiles.md) — configuring tool behavior
