/**
 * Tool-specific default prompts
 * These constants contain the default content for tool-related prompts
 */

export const TOOL_DEFAULTS: Record<string, string> = {
  'tools/shell.md': `- Use the '\${ShellTool.Name}' tool for running shell commands, remembering the safety rule to explain modifying commands first.
- **Explain Critical Commands:** Before executing commands with '\${ShellTool.Name}' that modify the file system, codebase, or system state, you *must* provide a brief explanation of the command's purpose and potential impact. Prioritize user understanding and safety. You should not ask permission to use the tool; the user will be presented with a confirmation dialogue upon use (you do not need to tell them this).
- **Command Execution:** Use the '\${ShellTool.Name}' tool for running shell commands, remembering the safety rule to explain modifying commands first.
- **Background Processes:** Use background processes (via \\\`&\\\`) for commands that are unlikely to stop on their own, e.g. \\\`node server.js &\\\`. If unsure, ask the user.
- **Interactive Commands:** Try to avoid shell commands that are likely to require user interaction (e.g. \\\`git rebase -i\\\`). Use non-interactive versions of commands (e.g. \\\`npm init -y\\\` instead of \\\`npm init\\\`) when available, and otherwise remind the user that interactive shell commands are not supported and may cause hangs until canceled by the user.`,

  'tools/read-file.md': `- **File Paths:** Always use absolute paths when referring to files with tools like '\${ReadFileTool.Name}' or '\${WriteFileTool.Name}'. Relative paths are not supported. You must provide an absolute path.
- **Path Construction:** Before using any file system tool (e.g., \${ReadFileTool.Name}' or '\${WriteFileTool.Name}'), you must construct the full absolute path for the file_path argument. Always combine the absolute path of the project's root directory with the file's path relative to the root. For example, if the project root is /path/to/project/ and the file is foo/bar/baz.txt, the final path you must use is /path/to/project/foo/bar/baz.txt. If the user provides a relative path, you must resolve it against the root directory to create an absolute path.
- Use '\${ReadFileTool.Name}' and '\${ReadManyFilesTool.Name}' to understand context and validate any assumptions you may have.
- Never make assumptions about the contents of files; instead use '\${ReadFileTool.Name}' or '\${ReadManyFilesTool.Name}' to ensure you aren't making broad assumptions.`,

  'tools/edit.md': `- Use the available tools (e.g., '\${EditTool.Name}', '\${WriteFileTool.Name}' '\${ShellTool.Name}' ...) to act on the plan, strictly adhering to the project's established conventions (detailed under 'Core Mandates').
- When asked to modify files, use the '\${EditTool.Name}' tool`,

  'tools/write-file.md': `- **File Paths:** Always use absolute paths when referring to files with tools like '\${ReadFileTool.Name}' or '\${WriteFileTool.Name}'. Relative paths are not supported. You must provide an absolute path.
- **Path Construction:** Before using any file system tool (e.g., \${ReadFileTool.Name}' or '\${WriteFileTool.Name}'), you must construct the full absolute path for the file_path argument. Always combine the absolute path of the project's root directory with the file's path relative to the root. For example, if the project root is /path/to/project/ and the file is foo/bar/baz.txt, the final path you must use is /path/to/project/foo/bar/baz.txt. If the user provides a relative path, you must resolve it against the root directory to create an absolute path.
- Some tools you may especially find useful are '\${WriteFileTool.Name}', '\${EditTool.Name}' and '\${ShellTool.Name}'.
- When asked to create files, use the '\${WriteFileTool.Name}' tool`,

  'tools/grep.md': `- Use '\${GrepTool.Name}' and '\${GlobTool.Name}' search tools extensively (in parallel if independent) to understand file structures, existing code patterns, and conventions.
- When asked to search for patterns in files, use the '\${GrepTool.Name}' tool`,

  'tools/glob.md': `- Use '\${GrepTool.Name}' and '\${GlobTool.Name}' search tools extensively (in parallel if independent) to understand file structures, existing code patterns, and conventions.
- When asked to find files by name, use the '\${GlobTool.Name}' tool`,

  'tools/ls.md': `- When asked to list files or directories, use the '\${LSTool.Name}' tool`,

  'tools/memory.md': `- **Remembering Facts:** Use the '\${MemoryTool.Name}' tool to remember specific, *user-related* facts or preferences when the user explicitly asks, or when they state a clear, concise piece of information that would help personalize or streamline *your future interactions with them* (e.g., preferred coding style, common project paths they use, personal tool aliases). This tool is for user-specific information that should persist across sessions. Do *not* use it for general project context or information. If unsure whether to save something, you can ask the user, "Should I remember that for you?"`,

  'tools/read-many-files.md': `- Use '\${ReadFileTool.Name}' and '\${ReadManyFilesTool.Name}' to understand context and validate any assumptions you may have.
- Never make assumptions about the contents of files; instead use '\${ReadFileTool.Name}' or '\${ReadManyFilesTool.Name}' to ensure you aren't making broad assumptions.`,

  'tools/todo-read.md': `# Task Management
You have access to the TodoWrite and TodoRead tools to help you manage and plan tasks. Use these tools VERY frequently to ensure that you are tracking your tasks and giving the user visibility into your progress.`,

  'tools/todo-write.md': `# Task Management
You have access to the TodoWrite and TodoRead tools to help you manage and plan tasks. Use these tools VERY frequently to ensure that you are tracking your tasks and giving the user visibility into your progress.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool
Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States and Management
1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Only have ONE task in_progress at any time
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`,

  'tools/web-fetch.md': `# Web Fetch Tool
Use this tool to fetch content from URLs when needed.`,

  'tools/web-search.md': `# Web Search Tool
Use this tool to search the web when needed.`,
};