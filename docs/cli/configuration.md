# LLxprt Code Configuration

LLxprt Code offers several ways to configure its behavior, including environment variables, command-line arguments, and settings files. This document outlines the different configuration methods and available settings.

## Configuration layers

Configuration is applied in the following order of precedence (lower numbers are overridden by higher numbers):

1.  **Default values:** Hardcoded defaults within the application.
2.  **System defaults file:** System-wide default settings that can be overridden by other settings files.
3.  **User settings file:** Global settings for the current user.
4.  **Project settings file:** Project-specific settings.
5.  **System settings file:** System-wide settings that override all other settings files.
6.  **Environment variables:** System-wide or session-specific variables, potentially loaded from `.env` files.
7.  **Command-line arguments:** Values passed when launching the CLI.

## Settings files

LLxprt Code uses JSON settings files for persistent configuration. There are four locations for these files:

- **System defaults file:**
  - **Location:** `/etc/llxprt-code/system-defaults.json` (Linux), `C:\ProgramData\llxprt-code\system-defaults.json` (Windows) or `/Library/Application Support/LLxprt-Code/system-defaults.json` (macOS). The path can be overridden using the `LLXPRT_CODE_SYSTEM_DEFAULTS_PATH` environment variable.
  - **Scope:** Provides a base layer of system-wide default settings. These settings have the lowest precedence and are intended to be overridden by user, project, or system override settings.
- **User settings file:**
  - **Location:** `~/.llxprt/settings.json` (where `~` is your home directory).
  - **Scope:** Applies to all LLxprt Code sessions for the current user. User settings override system defaults.
- **Project settings file:**
  - **Location:** `.llxprt/settings.json` within your project's root directory.
  - **Scope:** Applies only when running LLxprt Code from that specific project. Project settings override user settings and system defaults.
- **System settings file:**
  - **Location:** `/etc/llxprt-code/settings.json` (Linux), `C:\ProgramData\llxprt-code\settings.json` (Windows) or `/Library/Application Support/LLxprt-Code/settings.json` (macOS). The path can be overridden using the `LLXPRT_CODE_SYSTEM_SETTINGS_PATH` environment variable.
  - **Scope:** Applies to all LLxprt Code sessions on the system, for all users. System settings act as overrides, taking precedence over all other settings files. May be useful for system administrators at enterprises to have controls over users' LLxprt Code setups.

**Note on environment variables in settings:** String values within your `settings.json` files can reference environment variables using either `$VAR_NAME` or `${VAR_NAME}` syntax. These variables will be automatically resolved when the settings are loaded. For example, if you have an environment variable `MY_API_TOKEN`, you could use it in `settings.json` like this: `"apiKey": "$MY_API_TOKEN"`.

> **Note for Enterprise Users:** For guidance on deploying and managing LLxprt Code in a corporate environment, please see the [Enterprise Configuration](./enterprise.md) documentation.

### The `.llxprt` directory in your project

In addition to a project settings file, a project's `.llxprt` directory can contain other project-specific files related to LLxprt Code's operation, such as:

- [Custom sandbox profiles](#sandboxing) (e.g., `.llxprt/sandbox-macos-custom.sb`, `.llxprt/sandbox.Dockerfile`).

### Available settings in `settings.json`:

- **`contextFileName`** (string or array of strings):
  - **Description:** Specifies the filename(s) for context files that contain project instructions and context for the AI. Can be a single filename string or an array of accepted filenames. These files are loaded hierarchically from various locations (global, project root, ancestors, and subdirectories) to provide instructional context to the AI.
  - **Default:** `"LLXPRT.md"`
  - **Single filename example:** `"contextFileName": "AGENTS.md"`
  - **Multiple filenames example:** `"contextFileName": ["AGENTS.md", "CONTEXT.md", "INSTRUCTIONS.md"]`
  - **Usage:** When you prefer different naming conventions (like `AGENTS.md` for AI agent instructions, `CONTEXT.md` for project context, or custom names that match your project's documentation style), you can configure this setting. All specified filenames will be searched for and loaded from the hierarchical memory system.
  - **Note for filename preferences:** Some users prefer `AGENTS.md` as it clearly indicates the file contains instructions for AI agents. To use this convention, simply set `"contextFileName": "AGENTS.md"` in your settings file.

- **`bugCommand`** (object):
  - **Description:** Overrides the default URL for the `/bug` command.
  - **Default:** `"urlTemplate": "https://github.com/vybestack/llxprt-code/issues/new?template=bug_report.yml&title={title}&info={info}"`
  - **Properties:**
    - **`urlTemplate`** (string): A URL that can contain `{title}` and `{info}` placeholders.
  - **Example:**
    ```json
    "bugCommand": {
      "urlTemplate": "https://bug.example.com/new?title={title}&info={info}"
    }
    ```

- **`fileFiltering`** (object):
  - **Description:** Controls git-aware file filtering behavior for @ commands and file discovery tools.
  - **Default:** `"respectGitIgnore": true, "enableRecursiveFileSearch": true`
  - **Properties:**
    - **`respectGitIgnore`** (boolean): Whether to respect .gitignore patterns when discovering files. When set to `true`, git-ignored files (like `node_modules/`, `dist/`, `.env`) are automatically excluded from @ commands and file listing operations.
    - **`enableRecursiveFileSearch`** (boolean): Whether to enable searching recursively for filenames under the current tree when completing @ prefixes in the prompt.
    - **`disableFuzzySearch`** (boolean): When `true`, disables the fuzzy search capabilities when searching for files, which can improve performance on projects with a large number of files.
  - **Example:**
    ```json
    "fileFiltering": {
      "respectGitIgnore": true,
      "enableRecursiveFileSearch": false,
      "disableFuzzySearch": true
    }
    ```

### Troubleshooting File Search Performance

If you are experiencing performance issues with file searching (e.g., with `@` completions), especially in projects with a very large number of files, here are a few things you can try in order of recommendation:

1.  **Use `.geminiignore`:** Create a `.geminiignore` file in your project root to exclude directories that contain a large number of files that you don't need to reference (e.g., build artifacts, logs, `node_modules`). Reducing the total number of files crawled is the most effective way to improve performance.

2.  **Disable Fuzzy Search:** If ignoring files is not enough, you can disable fuzzy search by setting `disableFuzzySearch` to `true` in your `settings.json` file. This will use a simpler, non-fuzzy matching algorithm, which can be faster.

3.  **Disable Recursive File Search:** As a last resort, you can disable recursive file search entirely by setting `enableRecursiveFileSearch` to `false`. This will be the fastest option as it avoids a recursive crawl of your project. However, it means you will need to type the full path to files when using `@` completions.

- **`coreTools`** (array of strings):
  - **Description:** Allows you to specify a list of core tool names that should be made available to the model. This can be used to restrict the set of built-in tools. See [Built-in Tools](../core/tools-api.md#built-in-tools) for a list of core tools. You can also specify command-specific restrictions for tools that support it, like the `ShellTool`. For example, `"coreTools": ["ShellTool(ls -l)"]` will only allow the `ls -l` command to be executed.
  - **Default:** All tools available for use by the Gemini model.
  - **Example:** `"coreTools": ["ReadFileTool", "GlobTool", "ShellTool(ls)"]`.

- **`allowedTools`** (array of strings):
  - **Default:** `undefined`
  - **Description:** A list of tool names that will bypass the confirmation dialog. This is useful for tools that you trust and use frequently. The match semantics are the same as `coreTools`.
  - **Example:** `"allowedTools": ["ShellTool(git status)"]`.

- **`excludeTools`** (array of strings):
  - **Description:** Allows you to specify a list of core tool names that should be excluded from the model. A tool listed in both `excludeTools` and `coreTools` is excluded. You can also specify command-specific restrictions for tools that support it, like the `ShellTool`. For example, `"excludeTools": ["ShellTool(rm -rf)"]` will block the `rm -rf` command.
  - **Default**: No tools excluded.
  - **Example:** `"excludeTools": ["run_shell_command", "findFiles"]`.
  - **Security Note:** Command-specific restrictions in
    `excludeTools` for `run_shell_command` are based on simple string matching and can be easily bypassed. This feature is **not a security mechanism** and should not be relied upon to safely execute untrusted code. It is recommended to use `coreTools` to explicitly select commands
    that can be executed.

- **`allowMCPServers`** (array of strings):
  - **Description:** Allows you to specify a list of MCP server names that should be made available to the model. This can be used to restrict the set of MCP servers to connect to. Note that this will be ignored if `--allowed-mcp-server-names` is set.
  - **Default:** All MCP servers are available for use by the Gemini model.
  - **Example:** `"allowMCPServers": ["myPythonServer"]`.
  - **Security Note:** This uses simple string matching on MCP server names, which can be modified. If you're a system administrator looking to prevent users from bypassing this, consider configuring the `mcpServers` at the system settings level such that the user will not be able to configure any MCP servers of their own. This should not be used as an airtight security mechanism.

- **`excludeMCPServers`** (array of strings):
  - **Description:** Allows you to specify a list of MCP server names that should be excluded from the model. A server listed in both `excludeMCPServers` and `allowMCPServers` is excluded. Note that this will be ignored if `--allowed-mcp-server-names` is set.
  - **Default**: No MCP servers excluded.
  - **Example:** `"excludeMCPServers": ["myNodeServer"]`.
  - **Security Note:** This uses simple string matching on MCP server names, which can be modified. If you're a system administrator looking to prevent users from bypassing this, consider configuring the `mcpServers` at the system settings level such that the user will not be able to configure any MCP servers of their own. This should not be used as an airtight security mechanism.

- **`autoAccept`** (boolean):
  - **Description:** Controls whether the CLI automatically accepts and executes tool calls that are considered safe (e.g., read-only operations) without explicit user confirmation. If set to `true`, the CLI will bypass the confirmation prompt for tools deemed safe.
  - **Default:** `false`
  - **Example:** `"autoAccept": true`

- **`theme`** (string):
  - **Description:** Sets the visual [theme](./themes.md) for LLxprt Code.
  - **Default:** `"Default"`
  - **Example:** `"theme": "GitHub"`

- **`vimMode`** (boolean):
  - **Description:** Enables or disables vim mode for input editing. When enabled, the input area supports vim-style navigation and editing commands with NORMAL and INSERT modes. The vim mode status is displayed in the footer and persists between sessions.
  - **Default:** `false`
  - **Example:** `"vimMode": true`

- **`shellReplacement`** (boolean):
  - **Description:** Allows command substitution patterns (`$()`, `<()`, and backticks) in shell commands. When enabled, you can use nested command execution within shell commands. This setting is disabled by default for security reasons.
  - **Default:** `false`
  - **Example:** `"shellReplacement": true`
  - **Security Note:** Enabling this feature allows execution of nested commands, which can be a security risk if running untrusted commands. Only enable if you understand the implications. See [Shell Command Substitution](../shell-replacement.md) for more details.

- **`sandbox`** (boolean or string):
  - **Description:** Controls whether and how to use sandboxing for tool execution. If set to `true`, LLxprt Code uses a pre-built `gemini-cli-sandbox` Docker image. For more information, see [Sandboxing](#sandboxing).
  - **Default:** `false`
  - **Example:** `"sandbox": "docker"`

- **`toolDiscoveryCommand`** (string):
  - **Description:** Defines a custom shell command for discovering tools from your project. The shell command must return on `stdout` a JSON array of [function declarations](https://ai.google.dev/gemini-api/docs/function-calling#function-declarations). Tool wrappers are optional.
  - **Default:** Empty
  - **Example:** `"toolDiscoveryCommand": "bin/get_tools"`

- **`toolCallCommand`** (string):
  - **Description:** Defines a custom shell command for calling a specific tool that was discovered using `toolDiscoveryCommand`. The shell command must meet the following criteria:
    - It must take function `name` (exactly as in [function declaration](https://ai.google.dev/gemini-api/docs/function-calling#function-declarations)) as first command line argument.
    - It must read function arguments as JSON on `stdin`, analogous to [`functionCall.args`](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#functioncall).
    - It must return function output as JSON on `stdout`, analogous to [`functionResponse.response.content`](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#functionresponse).
  - **Default:** Empty
  - **Example:** `"toolCallCommand": "bin/call_tool"`

- **`ui.theme`** (string):
  - **Description:** The color theme for the UI. See [Themes](./themes.md) for available options.
  - **Default:** `undefined`

- **`ui.customThemes`** (object):
  - **Description:** Custom theme definitions.
  - **Default:** `{}`

- **`ui.hideWindowTitle`** (boolean):
  - **Description:** Hide the window title bar.
  - **Default:** `false`

- **`ui.hideTips`** (boolean):
  - **Description:** Hide helpful tips in the UI.
  - **Default:** `false`

- **`ui.hideBanner`** (boolean):
  - **Description:** Hide the application banner.
  - **Default:** `false`

- **`ui.hideFooter`** (boolean):
  - **Description:** Hide the footer from the UI.
  - **Default:** `false`

- **`ui.showMemoryUsage`** (boolean):
  - **Description:** Display memory usage information in the UI.
  - **Default:** `false`

- **`ui.showLineNumbers`** (boolean):
  - **Description:** Show line numbers in the chat.
  - **Default:** `false`

- **`ui.showCitations`** (boolean):
  - **Description:** Show citations for generated text in the chat.
  - **Default:** `false`

- **`ui.customWittyPhrases`** (array of strings):
  - **Description:** A list of custom phrases to display during loading states. When provided, the CLI will cycle through these phrases instead of the default ones.
  - **Default:** `[]`

#### `ide`

- **`ide.enabled`** (boolean):
  - **Description:** Enable IDE integration mode.
  - **Default:** `false`

- **`ide.hasSeenNudge`** (boolean):
  - **Description:** Whether the user has seen the IDE integration nudge.
  - **Default:** `false`

#### `privacy`

- **`privacy.usageStatisticsEnabled`** (boolean):
  - **Description:** Enable collection of usage statistics.
  - **Default:** `true`

#### `model`

- **`model.name`** (string):
  - **Description:** The Gemini model to use for conversations.
  - **Default:** `undefined`

- **`model.maxSessionTurns`** (number):
  - **Description:** Maximum number of user/model/tool turns to keep in a session. -1 means unlimited.
  - **Default:** `-1`

- **`model.summarizeToolOutput`** (object):
  - **Description:** Settings for summarizing tool output.
  - **Default:** `undefined`

- **`model.chatCompression`** (object):
  - **Description:** Chat compression settings.
  - **Default:** `undefined`

- **`model.skipNextSpeakerCheck`** (boolean):
  - **Description:** Skip the next speaker check.
  - **Default:** `false`

#### `context`

- **`context.fileName`** (string or array of strings):
  - **Description:** The name of the context file(s).
  - **Default:** `undefined`

- **`context.importFormat`** (string):
  - **Description:** The format to use when importing memory.
  - **Default:** `undefined`

- **`context.discoveryMaxDirs`** (number):
  - **Description:** Maximum number of directories to search for memory.
  - **Default:** `200`

- **`context.includeDirectories`** (array):
  - **Description:** Additional directories to include in the workspace context. Missing directories will be skipped with a warning.
  - **Default:** `[]`

- **`context.loadFromIncludeDirectories`** (boolean):
  - **Description:** Whether to load memory files from include directories.
  - **Default:** `false`

- **`context.fileFiltering.respectGitIgnore`** (boolean):
  - **Description:** Respect .gitignore files when searching.
  - **Default:** `true`

- **`context.fileFiltering.respectGeminiIgnore`** (boolean):
  - **Description:** Respect .geminiignore files when searching.
  - **Default:** `true`

- **`context.fileFiltering.enableRecursiveFileSearch`** (boolean):
  - **Description:** Enable recursive file search functionality.
  - **Default:** `true`

#### `shell`

- **`shouldUseNodePtyShell`** (boolean):

  Allow fully interactive shell commands by running tools through `node-pty`. This is the same as the **Enable Interactive Shell (node-pty)** toggle in the `/settings` dialog. Defaults to `false`. Legacy settings written as `tools.shell.enableInteractiveShell` or `tools.usePty` are migrated automatically.

#### `tools`

- **`tools.sandbox`** (boolean or string):
  - **Description:** Sandbox execution environment (can be a boolean or a path string).
  - **Default:** `undefined`

- **`tools.core`** (array of strings):
  - **Description:** Paths to core tool definitions.
  - **Default:** `undefined`

- **`tools.exclude`** (array of strings):
  - **Description:** Tool names to exclude from discovery.
  - **Default:** `undefined`

- **`tools.discoveryCommand`** (string):
  - **Description:** Command to run for tool discovery.
  - **Default:** `undefined`

- **`tools.callCommand`** (string):
  - **Description:** Command to run for tool calls.
  - **Default:** `undefined`

#### `mcp`

- **`mcp.serverCommand`** (string):
  - **Description:** Command to start an MCP server.
  - **Default:** `undefined`

- **`mcp.allowed`** (array of strings):
  - **Description:** An allowlist of MCP servers to allow.
  - **Default:** `undefined`

- **`mcp.excluded`** (array of strings):
  - **Description:** A denylist of MCP servers to exclude.
  - **Default:** `undefined`

#### `security`

- **`security.folderTrust.enabled`** (boolean):
  - **Description:** Setting to track whether Folder trust is enabled.
  - **Default:** `false`

- **`security.auth.selectedType`** (string):
  - **Description:** The currently selected authentication type.
  - **Default:** `undefined`

- **`security.auth.useExternal`** (boolean):
  - **Description:** Whether to use an external authentication flow.
  - **Default:** `undefined`

#### `advanced`

- **`advanced.autoConfigureMemory`** (boolean):
  - **Description:** Automatically configure Node.js memory limits.
  - **Default:** `false`

- **`advanced.dnsResolutionOrder`** (string):
  - **Description:** The DNS resolution order.
  - **Default:** `undefined`

- **`advanced.excludedEnvVars`** (array of strings):
  - **Description:** Environment variables to exclude from project context.
  - **Default:** `["DEBUG","DEBUG_MODE"]`

- **`advanced.bugCommand`** (object):
  - **Description:** Configuration for the bug report command.
  - **Default:** `undefined`

#### Top-Level Settings

The following settings remain at the top level of the `settings.json` file.

- **`mcpServers`** (object):
  - **Description:** Configures connections to one or more Model-Context Protocol (MCP) servers for discovering and using custom tools. LLxprt Code attempts to connect to each configured MCP server to discover available tools. If multiple MCP servers expose a tool with the same name, the tool names will be prefixed with the server alias you defined in the configuration (e.g., `serverAlias__actualToolName`) to avoid conflicts. Note that the system might strip certain schema properties from MCP tool definitions for compatibility. At least one of `command`, `url`, or `httpUrl` must be provided. If multiple are specified, the order of precedence is `httpUrl`, then `url`, then `command`.
  - **Default:** Empty
  - **Properties:**
    - **`<SERVER_NAME>`** (object): The server parameters for the named server.
      - `command` (string, optional): The command to execute to start the MCP server via standard I/O.
      - `args` (array of strings, optional): Arguments to pass to the command.
      - `env` (object, optional): Environment variables to set for the server process.
      - `cwd` (string, optional): The working directory in which to start the server.
      - `url` (string, optional): The URL of an MCP server that uses Server-Sent Events (SSE) for communication.
      - `httpUrl` (string, optional): The URL of an MCP server that uses streamable HTTP for communication.
      - `headers` (object, optional): A map of HTTP headers to send with requests to `url` or `httpUrl`.
      - `timeout` (number, optional): Timeout in milliseconds for requests to this MCP server.
      - `trust` (boolean, optional): Trust this server and bypass all tool call confirmations.
      - `description` (string, optional): A brief description of the server, which may be used for display purposes.
      - `includeTools` (array of strings, optional): List of tool names to include from this MCP server. When specified, only the tools listed here will be available from this server (allowlist behavior). If not specified, all tools from the server are enabled by default.
      - `excludeTools` (array of strings, optional): List of tool names to exclude from this MCP server. Tools listed here will not be available to the model, even if they are exposed by the server. **Note:** `excludeTools` takes precedence over `includeTools` - if a tool is in both lists, it will be excluded.
  - **Example:**
    ```json
    "mcpServers": {
      "myPythonServer": {
        "command": "python",
        "args": ["mcp_server.py", "--port", "8080"],
        "cwd": "./mcp_tools/python",
        "timeout": 5000,
        "includeTools": ["safe_tool", "file_reader"]
      },
      "myNodeServer": {
        "command": "node",
        "args": ["mcp_server.js"],
        "cwd": "./mcp_tools/node",
        "excludeTools": ["dangerous_tool", "file_deleter"]
      },
      "myDockerServer": {
        "command": "docker",
        "args": ["run", "-i", "--rm", "-e", "API_KEY", "ghcr.io/foo/bar"],
        "env": {
          "API_KEY": "$MY_API_TOKEN"
        }
      },
      "mySseServer": {
        "url": "http://localhost:8081/events",
        "headers": {
          "Authorization": "Bearer $MY_SSE_TOKEN"
        },
        "description": "An example SSE-based MCP server."
      },
      "myStreamableHttpServer": {
        "httpUrl": "http://localhost:8082/stream",
        "headers": {
          "X-API-Key": "$MY_HTTP_API_KEY"
        },
        "description": "An example Streamable HTTP-based MCP server."
      }
    }
    ```

- **`checkpointing`** (object):
  - **Description:** Configures the checkpointing feature, which allows you to save and restore conversation and file states. See the [Checkpointing documentation](../checkpointing.md) for more details.
  - **Default:** `{"enabled": false}`
  - **Properties:**
    - **`enabled`** (boolean): When `true`, the `/restore` command is available.

- **`preferredEditor`** (string):
  - **Description:** Specifies the preferred editor to use for viewing diffs.
  - **Default:** `vscode`
  - **Example:** `"preferredEditor": "vscode"`

- **`telemetry`** (object)
  - **Description:** Configures logging and metrics collection for LLxprt Code. For more information, see [Telemetry](../telemetry.md).
  - **Default:** `{"enabled": false, "target": "local", "otlpEndpoint": "http://localhost:4317", "logPrompts": true}`
  - **Properties:**
    - **`enabled`** (boolean): Whether or not telemetry is enabled.
    - **`target`** (string): The destination for collected telemetry. Supported values are `local` and `gcp`.
    - **`otlpEndpoint`** (string): The endpoint for the OTLP Exporter.
    - **`logPrompts`** (boolean): Whether or not to include the content of user prompts in the logs.
  - **Example:**
    ```json
    "telemetry": {
      "enabled": true,
      "target": "local",
      "otlpEndpoint": "http://localhost:16686",
      "logPrompts": false
    }
    ```
- **`usageStatisticsEnabled`** (boolean):
  - **Description:** Enables or disables the collection of usage statistics. See [Usage Statistics](#usage-statistics) for more information.
  - **Default:** `true`
  - **Example:**
    ```json
    "usageStatisticsEnabled": false
    ```

- **`enableTextToolCallParsing`** (boolean):
  - **Description:** Enables or disables text-based tool call parsing for models that output tool calls as formatted text rather than structured JSON.
  - **Default:** `true`
  - **Example:**
    ```json
    "enableTextToolCallParsing": true
    ```

- **`textToolCallModels`** (array of strings):
  - **Description:** Specifies additional model names that require text-based tool call parsing. The system automatically detects common models like gemma-3-12b-it and gemma-2-27b-it, but you can add custom models here.
  - **Default:** `[]`
  - **Example:**
    ```json
    "textToolCallModels": ["my-custom-model", "local-llama-model"]
    ```

- **`hideTips`** (boolean):
  - **Description:** Enables or disables helpful tips in the CLI interface.
  - **Default:** `false`
  - **Example:**

    ```json
    "hideTips": true
    ```

- **`hideBanner`** (boolean):
  - **Description:** Enables or disables the startup banner (ASCII art logo) in the CLI interface.
  - **Default:** `false`
  - **Example:**

    ```json
    "hideBanner": true
    ```

- **`maxSessionTurns`** (number):
  - **Description:** Sets the maximum number of turns for a session. If the session exceeds this limit, the CLI will stop processing and start a new chat.
  - **Default:** `-1` (unlimited)
  - **Example:**
    ```json
    "maxSessionTurns": 10
    ```

- **`summarizeToolOutput`** (object):
  - **Description:** Enables or disables the summarization of tool output. You can specify the token budget for the summarization using the `tokenBudget` setting.
  - Note: Currently only the `run_shell_command` tool is supported.
  - **Default:** `{}` (Disabled by default)
  - **Example:**
    ```json
    "summarizeToolOutput": {
      "run_shell_command": {
        "tokenBudget": 2000
      }
    }
    ```

- **`excludedProjectEnvVars`** (array of strings):
  - **Description:** Specifies environment variables that should be excluded from being loaded from project `.env` files. This prevents project-specific environment variables (like `DEBUG=true`) from interfering with llxprt-code behavior. Variables from `.llxprt/.env` files are never excluded.
  - **Default:** `["DEBUG", "DEBUG_MODE"]`
  - **Example:**
    ```json
    "excludedProjectEnvVars": ["DEBUG", "DEBUG_MODE", "NODE_ENV"]
    ```

- **`includeDirectories`** (array of strings):
  - **Description:** Specifies an array of additional absolute or relative paths to include in the workspace context. Missing directories will be skipped with a warning by default. Paths can use `~` to refer to the user's home directory. This setting can be combined with the `--include-directories` command-line flag.
  - **Default:** `[]`
  - **Example:**
    ```json
    "includeDirectories": [
      "/path/to/another/project",
      "../shared-library",
      "~/common-utils"
    ]
    ```

- **`loadMemoryFromIncludeDirectories`** (boolean):
  - **Description:** Controls the behavior of the `/memory refresh` command. If set to `true`, `GEMINI.md` files should be loaded from all directories that are added. If set to `false`, `GEMINI.md` should only be loaded from the current directory.
  - **Default:** `false`
  - **Example:**
    ```json
    "loadMemoryFromIncludeDirectories": true
    ```

- **`chatCompression`** (object):
  - **Description:** Controls the settings for chat history compression, both automatic and
    when manually invoked through the /compress command.
  - **Properties:**
    - **`contextPercentageThreshold`** (number): A value between 0 and 1 that specifies the token threshold for compression as a percentage of the model's total token limit. For example, a value of `0.6` will trigger compression when the chat history exceeds 60% of the token limit.
  - **Example:**
    ```json
    "chatCompression": {
      "contextPercentageThreshold": 0.6
    }
    ```

- **`showLineNumbers`** (boolean):
  - **Description:** Controls whether line numbers are displayed in code blocks in the CLI output.
  - **Default:** `true`
  - **Example:**
    ```json
    "showLineNumbers": false
    ```

- **`emojiFilter`** (object):
  - **Description:** Controls emoji filtering in LLM responses and file operations. See [Emoji Filter Guide](../EMOJI-FILTER.md) for detailed usage.
  - **Default:** `{"mode": "auto"}`
  - **Properties:**
    - **`mode`** (string): Filtering mode - `allowed`, `auto`, `warn`, or `error`
      - `allowed`: No filtering, emojis pass through
      - `auto`: Silent filtering (default) - converts functional emojis to text, removes decorative ones
      - `warn`: Filter with feedback messages
      - `error`: Block any content with emojis
  - **Example:**
    ```json
    "emojiFilter": {
      "mode": "warn"
    }
    ```
  - **Note:** Can be configured per-session using `/set emojifilter <mode>` command

- **`defaultProfile`** (string):
  - **Description:** Specifies the profile to automatically load on startup. Set via `/profile set-default` command.
  - **Default:** `null`
  - **Example:**
    ```json
    "defaultProfile": "my-development-profile"
    ```
  - **Note:** When set, the specified profile will be loaded automatically each time LLxprt Code starts

- **`accessibility`** (object):
  - **Description:** Configures accessibility features for the CLI.
  - **Properties:**
    - **`screenReader`** (boolean): Enables screen reader mode, which adjusts the TUI for better compatibility with screen readers. This can also be enabled with the `--screen-reader` command-line flag, which will take precedence over the setting.
    - **`disableLoadingPhrases`** (boolean): Disables the display of loading phrases during operations.
  - **Default:** `{"screenReader": false, "disableLoadingPhrases": false}`
  - **Example:**
    ```json
    "accessibility": {
      "screenReader": true,
      "disableLoadingPhrases": true
    }
    ```

#### Additional Dialog Settings

The following settings are available in the `/settings` dialog:

- **`disableAutoUpdate`** (boolean):
  - **Description:** Disable automatic updates of LLxprt Code. When enabled, you will need to manually update the application.
  - **Default:** `false`

- **`enablePromptCompletion`** (boolean):
  - **Description:** Enable AI-powered prompt completion suggestions while typing. Provides intelligent autocomplete based on context and command history.
  - **Default:** `false`

- **`enableFuzzyFiltering`** (boolean):
  - **Description:** Enable fuzzy filtering for command menu completions. When enabled, you can type partial characters (e.g., "prd" to match "production"). When disabled, only exact prefix matches are shown.
  - **Default:** `true`

- **`tools.useRipgrep`** (boolean):
  - **Description:** Use ripgrep for file content search instead of the fallback implementation. Provides significantly faster search performance on large codebases.
  - **Default:** `false`

- **`tools.enableToolOutputTruncation`** (boolean):
  - **Description:** Enable truncation of large tool outputs to prevent overwhelming the context window.
  - **Default:** `true`

- **`tools.truncateToolOutputThreshold`** (number):
  - **Description:** Truncate tool output if it exceeds this many characters. Set to `-1` to disable truncation.
  - **Default:** `30000`

- **`ui.showStatusInTitle`** (boolean):
  - **Description:** Show LLxprt status and AI thoughts in the terminal window title. Useful for monitoring progress when the terminal is in the background.
  - **Default:** `false`

- **`ui.hideContextSummary`** (boolean):
  - **Description:** Hide the context summary (LLXPRT.md files, MCP servers) displayed above the input prompt.
  - **Default:** `false`

- **`ui.footer.hideCWD`** (boolean):
  - **Description:** Hide the current working directory path in the footer.
  - **Default:** `false`

- **`ui.footer.hideSandboxStatus`** (boolean):
  - **Description:** Hide the sandbox status indicator in the footer.
  - **Default:** `false`

- **`ui.footer.hideModelInfo`** (boolean):
  - **Description:** Hide the model name and context usage information in the footer.
  - **Default:** `false`

- **`ui.wittyPhraseStyle`** (enum):
  - **Description:** Choose which collection of witty phrases to display during loading operations.
  - **Default:** `"default"`
  - **Options:** `"default"`, `"llxprt"`, `"gemini-cli"`, `"whimsical"`, `"custom"`

- **`ui.showTodoPanel`** (boolean):
  - **Description:** Show the todo panel in the UI for tracking AI-generated task lists.
  - **Default:** `true`

- **`debugKeystrokeLogging`** (boolean):
  - **Description:** Enable debug logging of keystrokes to the console. Useful for troubleshooting input issues or developing custom keybindings.
  - **Default:** `false`
  - **Warning:** This will log all keystrokes including potentially sensitive input. Only enable for debugging purposes.

### Example `settings.json`:

```json
{
  "theme": "GitHub",
  "sandbox": "docker",
  "defaultProfile": "my-development-profile",
  "emojiFilter": {
    "mode": "warn"
  },
  "ui": {
    "customWittyPhrases": [
      "You forget a thousand things every day. Make sure this is one of 'em",
      "Connecting to AGI"
    ]
  },
  "toolDiscoveryCommand": "bin/get_tools",
  "toolCallCommand": "bin/call_tool",
  "mcpServers": {
    "mainServer": {
      "command": "bin/mcp_server.py"
    },
    "anotherServer": {
      "command": "node",
      "args": ["mcp_server.js", "--verbose"]
    }
  },
  "telemetry": {
    "enabled": true,
    "target": "local",
    "otlpEndpoint": "http://localhost:4317",
    "logPrompts": true
  },
  "usageStatisticsEnabled": true,
  "hideTips": false,
  "hideBanner": false,
  "maxSessionTurns": 10,
  "summarizeToolOutput": {
    "run_shell_command": {
      "tokenBudget": 100
    }
  },
  "excludedProjectEnvVars": ["DEBUG", "DEBUG_MODE", "NODE_ENV"],
  "includeDirectories": ["path/to/dir1", "~/path/to/dir2", "../path/to/dir3"],
  "loadMemoryFromIncludeDirectories": true
}
```

## Shell History

The CLI keeps a history of shell commands you run. To avoid conflicts between different projects, this history is stored in a project-specific directory within your user's home folder.

- **Location:** `~/.llxprt/tmp/<project_hash>/shell_history`
  - `<project_hash>` is a unique identifier generated from your project's root path.
  - The history is stored in a file named `shell_history`.

## Environment Variables & `.env` Files

Environment variables are a common way to configure applications, especially for sensitive information like API keys or for settings that might change between environments.

The CLI automatically loads environment variables from an `.env` file. The loading order is:

1.  `.env` file in the current working directory.
2.  If not found, it searches upwards in parent directories until it finds an `.env` file or reaches the project root (identified by a `.git` folder) or the home directory.
3.  If still not found, it looks for `~/.env` (in the user's home directory).

**Environment Variable Exclusion:** Some environment variables (like `DEBUG` and `DEBUG_MODE`) are automatically excluded from being loaded from project `.env` files to prevent interference with llxprt-code behavior. Variables from `.llxprt/.env` files are never excluded. You can customize this behavior using the `excludedProjectEnvVars` setting in your `settings.json` file.

- **`LLXPRT_DEFAULT_PROVIDER`**:
  - Sets the default LLM provider to use.
  - Example: `export LLXPRT_DEFAULT_PROVIDER="anthropic"`
- **`LLXPRT_DEFAULT_MODEL`**:
  - Sets the default model to use.
  - Example: `export LLXPRT_DEFAULT_MODEL="claude-3-opus-20240229"`
- **`LLXPRT_DEBUG`**:
  - Enable debug logging with specific namespaces.
  - Namespaces follow the pattern `llxprt:<component>:<subcomponent>`
  - Example namespaces:
    - `llxprt:*` - All debug output
    - `llxprt:providers:*` - All provider debug output
    - `llxprt:providers:openai` - OpenAI provider only
    - `llxprt:providers:anthropic` - Anthropic provider only
    - `llxprt:gemini:provider` - Gemini provider
    - `llxprt:core:client` - Core client operations
    - `llxprt:tools:formatter` - Tool formatting
    - `llxprt:zed-integration` - Zed editor integration
  - Example: `export LLXPRT_DEBUG="llxprt:providers:*"` or `export LLXPRT_DEBUG="llxprt:core:*,llxprt:tools:*"`
- **`LLXPRT_CODE_IDE_SERVER_PORT`**:
  - Port for the IDE integration server.
  - Used by VS Code extension.
  - Example: `export LLXPRT_CODE_IDE_SERVER_PORT="3000"`
- **`LLXPRT_CODE_IDE_WORKSPACE_PATH`**:
  - Workspace path for IDE integration.
  - Automatically set by VS Code extension.
- **`LLXPRT_CODE_SYSTEM_SETTINGS_PATH`**:
  - Override the system settings file location.
  - Example: `export LLXPRT_CODE_SYSTEM_SETTINGS_PATH="/custom/path/settings.json"`
- **`LLXPRT_CLI_NO_RELAUNCH`**:
  - Internal flag to prevent CLI relaunching.
  - Automatically set by the CLI.
- **`GEMINI_API_KEY`** (Optional):
  - Your API key for the Gemini API.
  - **Only required if using Google's Gemini provider.** LLxprt Code supports multiple providers.
  - Set this in your shell profile (e.g., `~/.bashrc`, `~/.zshrc`) or an `.env` file.
  - Alternatively, use `/key` command or other provider's API keys.
- **`GEMINI_MODEL`**:
  - Specifies the default Gemini model to use.
  - Overrides the hardcoded default
  - Example: `export GEMINI_MODEL="gemini-2.5-flash"`
- **`GOOGLE_API_KEY`**:
  - Your Google Cloud API key.
  - Required for using Vertex AI in express mode.
  - Ensure you have the necessary permissions.
  - Example: `export GOOGLE_API_KEY="YOUR_GOOGLE_API_KEY"`.
- **`GOOGLE_CLOUD_PROJECT`**:
  - Your Google Cloud Project ID.
  - Required for using Code Assist or Vertex AI.
  - If using Vertex AI, ensure you have the necessary permissions in this project.
  - **Cloud Shell Note:** When running in a Cloud Shell environment, this variable defaults to a special project allocated for Cloud Shell users. If you have `GOOGLE_CLOUD_PROJECT` set in your global environment in Cloud Shell, it will be overridden by this default. To use a different project in Cloud Shell, you must define `GOOGLE_CLOUD_PROJECT` in a `.env` file.
  - Example: `export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"`.
- **`GOOGLE_APPLICATION_CREDENTIALS`** (string):
  - **Description:** The path to your Google Application Credentials JSON file.
  - **Example:** `export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/credentials.json"`
- **`OTLP_GOOGLE_CLOUD_PROJECT`**:
  - Your Google Cloud Project ID for Telemetry in Google Cloud
  - Example: `export OTLP_GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"`.
- **`GOOGLE_CLOUD_LOCATION`**:
  - Your Google Cloud Project Location (e.g., us-central1).
  - Required for using Vertex AI in non express mode.
  - Example: `export GOOGLE_CLOUD_LOCATION="YOUR_PROJECT_LOCATION"`.
- **`LLXPRT_SANDBOX`**:
  - Alternative to the `sandbox` setting in `settings.json`.
  - Accepts `true`, `false`, `docker`, `podman`, or a custom command string.
- **`SEATBELT_PROFILE`** (macOS specific):
  - Switches the Seatbelt (`sandbox-exec`) profile on macOS.
  - `permissive-open`: (Default) Restricts writes to the project folder (and a few other folders, see `packages/cli/src/utils/sandbox-macos-permissive-open.sb`) but allows other operations.
  - `strict`: Uses a strict profile that declines operations by default.
  - `<profile_name>`: Uses a custom profile. To define a custom profile, create a file named `sandbox-macos-<profile_name>.sb` in your project's `.llxprt/` directory (e.g., `my-project/.llxprt/sandbox-macos-custom.sb`).
- **`DEBUG` or `DEBUG_MODE`** (often used by underlying libraries or the CLI itself):
  - Set to `true` or `1` to enable verbose debug logging, which can be helpful for troubleshooting.
  - **Note:** These variables are automatically excluded from project `.env` files by default to prevent interference with llxprt-code behavior. Use `.llxprt/.env` files if you need to set these for llxprt-code specifically.
- **`DEBUG_ENABLED`**:
  - Enable or disable debug logging.
  - Example: `export DEBUG_ENABLED="true"`
- **`DEBUG_LEVEL`**:
  - Set the debug logging level.
  - Example: `export DEBUG_LEVEL="debug"`
- **`NO_COLOR`**:
  - Set to any value to disable all color output in the CLI.
- **`CLI_TITLE`**:
  - Set to a string to customize the title of the CLI.
- **`CODE_ASSIST_ENDPOINT`**:
  - Specifies the endpoint for the code assist server.
  - This is useful for development and testing.
- **`OPENAI_API_KEY`**:
  - Your API key for OpenAI services.
  - Used when provider is set to openai.
  - Example: `export OPENAI_API_KEY="sk-..."`
- **`OPENAI_BASE_URL`**:
  - Custom base URL for OpenAI API.
  - Example: `export OPENAI_BASE_URL="http://localhost:1234/v1/"`
- **`ANTHROPIC_API_KEY`**:
  - Your API key for Anthropic services.
  - Used when provider is set to anthropic.
  - Example: `export ANTHROPIC_API_KEY="sk-ant-..."`
- **`LLXPRT_PROMPTS_DIR`**:
  - Specifies a custom directory for prompt configuration files.
  - Default: `~/.llxprt/prompts`
  - Example: `export LLXPRT_PROMPTS_DIR="/path/to/custom/prompts"`
  - See the [Prompt Configuration Guide](../prompt-configuration.md) for details
- **`QWEN_API_KEY`**:
  - Your API key for Qwen/Alibaba Cloud services.
  - Used when provider is set to qwen.
  - Example: `export QWEN_API_KEY="sk-..."`
- **`GROQ_API_KEY`**:
  - Your API key for Groq services.
  - Used when provider is set to groq.
  - Example: `export GROQ_API_KEY="gsk_..."`
- **`TOGETHER_API_KEY`**:
  - Your API key for Together AI services.
  - Used when provider is set to together.
  - Example: `export TOGETHER_API_KEY="..."`
- **`X_API_KEY`**:
  - Your API key for X.AI (Grok) services.
  - Used when provider is set to xai.
  - Example: `export X_API_KEY="xai-..."`

## Command-Line Arguments

Arguments passed directly when running the CLI can override other configurations for that specific session.

- **`--provider <provider_name>`**:
  - Specifies the LLM provider to use (e.g., `openai`, `anthropic`, `google`, `groq`, etc.).
  - Example: `llxprt --provider anthropic`
- **`--model <model_name>`** (**`-m <model_name>`**):
  - Specifies the model to use for this session.
  - Example: `llxprt --model claude-3-opus-20240229`
- **`--key <api_key>`**:
  - Provides the API key for the current provider directly.
  - Example: `llxprt --key sk-...`
- **`--set key=value`** (repeatable):
  - Apply ephemeral settings at startup (same keys as `/set`). Pass each assignment separately (`--set streaming=disabled --set base-url=https://...`). For model parameters, use the dotted syntax (`--set modelparam.temperature=0.7 --set modelparam.max_tokens=4096`). Values are parsed using the same validation as the interactive command.
  - Precedence: CLI flags take priority over profiles/settings, which in turn override environment variables and finally OAuth tokens.
- **`--keyfile <path>`**:
  - Path to a file containing the API key for the current provider.
  - Example: `llxprt --keyfile ~/.openai_key`
- **`--baseurl <url>`**:
  - Sets a custom base URL for the provider API.
  - Example: `llxprt --baseurl http://localhost:1234/v1/`
- **`--prompt <your_prompt>`** (**`-p <your_prompt>`**):
  - Used to pass a prompt directly to the command. This invokes LLxprt Code in a non-interactive mode.
- **`--prompt-interactive <your_prompt>`** (**`-i <your_prompt>`**):
  - Starts an interactive session with the provided prompt as the initial input.
  - The prompt is processed within the interactive session, not before it.
  - Cannot be used when piping input from stdin.
  - Example: `llxprt -i "explain this code"`
- **`--sandbox`** (**`-s`**):
  - Enables sandbox mode for this session.
- **`--sandbox-image`**:
  - Sets the sandbox image URI.
- **`--debug`** (**`-d`**):
  - Enables debug mode for this session, providing more verbose output.
- **`--all-files`** (**`-a`**):
  - If set, recursively includes all files within the current directory as context for the prompt.
- **`--help`** (or **`-h`**):
  - Displays help information about command-line arguments.
- **`--show-memory-usage`**:
  - Displays the current memory usage.
- **`--yolo`**:
  - Enables YOLO mode, which automatically approves all tool calls.
- **`--approval-mode <mode>`**:
  - Sets the approval mode for tool calls. Available modes:
    - `default`: Prompt for approval on each tool call (default behavior)
    - `auto_edit`: Automatically approve edit tools (replace, write_file) while prompting for others
    - `yolo`: Automatically approve all tool calls (equivalent to `--yolo`)
  - Cannot be used together with `--yolo`. Use `--approval-mode=yolo` instead of `--yolo` for the new unified approach.
  - Example: `llxprt --approval-mode auto_edit`
- **`--allowed-tools <tool1,tool2,...>`**:
  - A comma-separated list of tool names that will bypass the confirmation dialog.
  - Example: `llxprt --allowed-tools "ShellTool(git status)"`
- **`--telemetry`**:
  - Enables [telemetry](../telemetry.md).
- **`--telemetry-target`**:
  - Sets the telemetry target. See [telemetry](../telemetry.md) for more information.
- **`--telemetry-otlp-endpoint`**:
  - Sets the OTLP endpoint for telemetry. See [telemetry](../telemetry.md) for more information.
- **`--telemetry-log-prompts`**:
  - Enables logging of prompts for telemetry. See [telemetry](../telemetry.md) for more information.
- **`--checkpointing`**:
  - Enables [checkpointing](../checkpointing.md).
- **`--extensions <extension_name ...>`** (**`-e <extension_name ...>`**):
  - Specifies a list of extensions to use for the session. If not provided, all available extensions are used.
  - Use the special term `llxprt -e none` to disable all extensions.
  - Example: `llxprt -e my-extension -e my-other-extension`
- **`--list-extensions`** (**`-l`**):
  - Lists all available extensions and exits.
- **`--proxy`**:
  - Sets the proxy for the CLI.
  - Example: `--proxy http://localhost:7890`.
- **`--include-directories <dir1,dir2,...>`**:
  - Includes additional directories in the workspace for multi-directory support.
  - Can be specified multiple times or as comma-separated values.
  - 5 directories can be added at maximum.
  - Example: `--include-directories /path/to/project1,/path/to/project2` or `--include-directories /path/to/project1 --include-directories /path/to/project2`
- **`--profile-load <profile_name>`**:
  - Load a saved profile configuration on startup.
  - Example: `llxprt --profile-load my-project`
- **`--ide-mode <enable|disable>`**:
  - Enable or disable IDE integration mode.
  - Example: `llxprt --ide-mode enable`
- **`--experimental-acp`**:
  - Starts the agent in ACP (Agent Communication Protocol) mode for Zed editor integration.
  - This enables the Zed editor to communicate with llxprt as an AI assistant.
  - Redirects console output to stderr to keep stdout clean for protocol communication.
  - Example: `llxprt --experimental-acp`
  - **Note:** This is an experimental feature primarily used by the Zed editor integration.
- **`--screen-reader`**:
  - Enables screen reader mode for accessibility.
- **`--version`**:
  - Displays the version of the CLI.

## Provider API Keys

The CLI will automatically detect API keys from the following sources in order of priority:

1. **CLI arguments:** `--key` and `--keyfile`
2. **Config file:** `providerApiKeys` field in `~/.llxprt/settings.json`
3. **Environment variables:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.
4. **Key files:** `~/.openai_key`, `~/.anthropic_key`, etc.

## Provider Base URLs

You can set custom base URLs for providers to use local or third-party endpoints. This is useful for:

- Running local LLMs with inference servers like LM Studio or Ollama
- Using third-party providers like OpenRouter or Fireworks
- Testing custom proxy endpoints

Note that when using a custom base URL with the OpenAI provider, some advanced features like the Responses API will be automatically disabled as they are specific to the official OpenAI API.

Set base URLs using:

CLI arguments:

```bash
llxprt --baseurl http://localhost:1234/v1/
# or within the CLI:
/baseurl <url>
```

Config file:

```json
{
  "providerBaseUrls": {
    "openai": "http://localhost:1234/v1/",
    "anthropic": "https://api.proxy.example.com/anthropic/v1/"
  }
}
```

Environment variable:

```bash
export OPENAI_BASE_URL="http://localhost:1234/v1/"
```

## Context Files (Hierarchical Instructional Context)

While not strictly configuration for the CLI's _behavior_, context files (defaulting to `LLXPRT.md` but configurable via the `contextFileName` setting) are crucial for configuring the _instructional context_ (also referred to as "memory") provided to the Gemini model. This powerful feature allows you to give project-specific instructions, coding style guides, or any relevant background information to the AI, making its responses more tailored and accurate to your needs. The CLI includes UI elements, such as an indicator in the footer showing the number of loaded context files, to keep you informed about the active context.

- **Purpose:** These Markdown files contain instructions, guidelines, or context that you want the Gemini model to be aware of during your interactions. The system is designed to manage this instructional context hierarchically.

### Example Context File Content (e.g., `LLXPRT.md`)

Here's a conceptual example of what a context file at the root of a TypeScript project might contain:

```markdown
# Project: My Awesome TypeScript Library

## General Instructions:

- When generating new TypeScript code, please follow the existing coding style.
- Ensure all new functions and classes have JSDoc comments.
- Prefer functional programming paradigms where appropriate.
- All code should be compatible with TypeScript 5.0 and Node.js 20+.

## Coding Style:

- Use 2 spaces for indentation.
- Interface names should be prefixed with `I` (e.g., `IUserService`).
- Private class members should be prefixed with an underscore (`_`).
- Always use strict equality (`===` and `!==`).

## Specific Component: `src/api/client.ts`

- This file handles all outbound API requests.
- When adding new API call functions, ensure they include robust error handling and logging.
- Use the existing `fetchWithRetry` utility for all GET requests.

## Regarding Dependencies:

- Avoid introducing new external dependencies unless absolutely necessary.
- If a new dependency is required, please state the reason.
```

This example demonstrates how you can provide general project context, specific coding conventions, and even notes about particular files or components. The more relevant and precise your context files are, the better the AI can assist you. Project-specific context files are highly encouraged to establish conventions and context.

- **Hierarchical Loading and Precedence:** The CLI implements a sophisticated hierarchical memory system by loading context files (e.g., `LLXPRT.md`) from several locations. Content from files lower in this list (more specific) typically overrides or supplements content from files higher up (more general). The exact concatenation order and final context can be inspected using the `/memory show` command. The typical loading order is:
  1.  **Global Context File:**
      - Location: `~/.llxprt/<contextFileName>` (e.g., `~/.llxprt/LLXPRT.md` in your user home directory).
      - Scope: Provides default instructions for all your projects.
  2.  **Project Root & Ancestors Context Files:**
      - Location: The CLI searches for the configured context file in the current working directory and then in each parent directory up to either the project root (identified by a `.git` folder) or your home directory.
      - Scope: Provides context relevant to the entire project or a significant portion of it.
  3.  **Sub-directory Context Files (Contextual/Local):**
      - Location: The CLI also scans for the configured context file in subdirectories _below_ the current working directory (respecting common ignore patterns like `node_modules`, `.git`, etc.).
      - Scope: Allows for highly specific instructions relevant to a particular component, module, or subsection of your project.
- **Concatenation & UI Indication:** The contents of all found context files are concatenated (with separators indicating their origin and path) and provided as part of the system prompt to the Gemini model. The CLI footer displays the count of loaded context files, giving you a quick visual cue about the active instructional context.
- **Importing Content:** You can modularize your context files by importing other Markdown files using the `@path/to/file.md` syntax. For more details, see the [Memory Import Processor documentation](../core/memport.md).
- **Commands for Memory Management:**
  - Use `/memory refresh` to force a re-scan and reload of all context files from all configured locations. This updates the AI's instructional context.
  - Use `/memory show` to display the combined instructional context currently loaded, allowing you to verify the hierarchy and content being used by the AI.
  - See the [Commands documentation](./commands.md#memory) for full details on the `/memory` command and its sub-commands (`show` and `refresh`).

By understanding and utilizing these configuration layers and the hierarchical nature of context files, you can effectively manage the AI's memory and tailor the LLxprt Code's responses to your specific needs and projects.

## Authentication Command

LLxprt Code provides OAuth authentication for multiple providers through the `/auth` command.

### Command Syntax

```
/auth [provider] [action]
```

- **provider**: `gemini`, `qwen`, or `anthropic`
- **action**: `enable`, `disable`, `logout` (or `signout`)

### Usage Examples

#### Show Auth Dialog

```
/auth
```

Displays the authentication dialog with all available options.

#### Check Provider Status

```
/auth gemini
/auth anthropic
/auth qwen
```

Shows the current OAuth status for the specified provider.

#### Enable OAuth for a Provider

```
/auth gemini enable
/auth anthropic enable
/auth qwen enable
```

#### Disable OAuth for a Provider

```
/auth gemini disable
/auth anthropic disable
/auth qwen disable
```

#### Logout from a Provider

```
/auth gemini logout
/auth anthropic logout
/auth qwen logout
```

### OAuth Flow by Provider

#### Gemini (Google)

- Opens browser for Google OAuth
- Automatically continues after you accept permissions
- Token refreshes automatically

#### Qwen (Alibaba)

- Opens browser for Alibaba Cloud OAuth
- Automatically continues after you accept permissions
- Seamless authentication flow

#### Anthropic (Claude)

- Opens browser to Anthropic Console
- After accepting, you need to:
  1. Copy the API key from the Anthropic Console
  2. Return to the terminal
  3. Paste the API key when prompted
- Note: This is a manual step because Anthropic uses API keys rather than OAuth tokens

### Authentication Priority

Authentication methods are checked in this order:

1. OAuth tokens (if enabled)
2. API keys from `/key` or `--key` commands
3. Environment variables
4. Key files (`~/.openai_key`, etc.)

### Checking Auth Status

Use `/status` to see all active authentications:

```
/status
```

This shows:

- Which providers are authenticated
- Token expiration times
- OAuth enablement status

## Sandboxing

The LLxprt Code can execute potentially unsafe operations (like shell commands and file modifications) within a sandboxed environment to protect your system.

Sandboxing is disabled by default, but you can enable it in a few ways:

- Using `--sandbox` or `-s` flag.
- Setting `LLXPRT_SANDBOX` environment variable.
- Sandbox is enabled when using `--yolo` or `--approval-mode=yolo` by default.

By default, it uses a pre-built `ghcr.io/vybestack/llxprt-code/sandbox:0.7.0` Docker image.

For project-specific sandboxing needs, you can create a custom Dockerfile at `.llxprt/sandbox.Dockerfile` in your project's root directory. This Dockerfile can be based on the base sandbox image:

```dockerfile
FROM ghcr.io/vybestack/llxprt-code/sandbox:0.7.0

# Add your custom dependencies or configurations here
# For example:
# RUN apt-get update && apt-get install -y some-package
# COPY ./my-config /app/my-config
```

When `.llxprt/sandbox.Dockerfile` exists, you can use `BUILD_SANDBOX` environment variable when running LLxprt Code to automatically build the custom sandbox image:

```bash
BUILD_SANDBOX=1 llxprt -s
```

## Zed Editor Integration

LLxprt Code can be integrated with the Zed editor as an AI assistant using the experimental ACP (Agent Communication Protocol) mode.

### Setting up Zed Integration

1. In Zed, open your settings (`cmd+,` on macOS)
2. Add llxprt as an assistant provider:

LLxprt integrates with Zed and is easiest to configure in your `~/.config/zed/settings.json` under "agent_servers" or using Zed's onboarding menu. you need to specify the "whereis llxprt" path to make it work. You also must include `--experimental-acp`. If you want you use any provider except for gemini (or your default profile config) you'll need to supply arguments that are the same as those on the command line. This is an example of using llxprt with a saved profile for Cerebras' Code Max Qwen 3 Coder (480B) model. You could instead do --provider openai --baseurl thebaseurlofyourprovider --key yourkey or --keyfile yourkeyfile but popping open llxprt and saving a profile is usually easier. Don't include the env DEBUG unless you want to generate really big log files in `~/.llxprt/debug/`

zed settings.json example:

```json
"llxprt": {
      "command": "node",
      "args": [
        "/opt/homebrew/bin/llxprt",
        "--experimental-acp",
        "--profile-load",
        "cerebrasqwen3",
        "--yolo"
      ],
      "env": { "DEBUG": "llxprt:*" }
    }
  }
```

This is an example of the Qwen 3 profile (created with /profile save)

```json
{
  "version": 1,
  "provider": "openai",
  "model": "qwen-3-coder-480b",
  "modelParams": {},
  "ephemeralSettings": {
    "context-limit": 120000,
    "auth-keyfile": "~/.cerebras_key",
    "base-url": "https://api.cerebras.ai/v1",
    "custom-headers": "response_format.json_schema.strict true",
    "shell-replacement": true,
    "streaming": "disabled",
    "emojifilter": "warn"
  }
}
```

```json
{
  "assistant": {
    "providers": [
      {
        "name": "llxprt",
        "type": "acp",
        "command": "llxprt",
        "args": ["--experimental-acp"]
      }
    ]
  }
}
```

### Configuring Zed with Different Providers

You can pass additional arguments to customize the provider and authentication:

#### Using a specific provider and model:

```json
{
  "assistant": {
    "providers": [
      {
        "name": "llxprt-claude",
        "type": "acp",
        "command": "llxprt",
        "args": [
          "--experimental-acp",
          "--provider",
          "anthropic",
          "--model",
          "claude-3-opus-20240229"
        ]
      }
    ]
  }
}
```

#### Using a saved profile:

```json
{
  "assistant": {
    "providers": [
      {
        "name": "llxprt",
        "type": "acp",
        "command": "llxprt",
        "args": ["--experimental-acp", "--profile-load", "my-project"]
      }
    ]
  }
}
```

#### Providing an API key directly:

```json
{
  "assistant": {
    "providers": [
      {
        "name": "llxprt-openai",
        "type": "acp",
        "command": "llxprt",
        "args": [
          "--experimental-acp",
          "--provider",
          "openai",
          "--key",
          "sk-..."
        ]
      }
    ]
  }
}
```

### Important Notes for Zed Integration

- **All CLI arguments work**: You can use `--provider`, `--model`, `--key`, `--keyfile`, `--profile-load`, etc.
- **Default provider**: If you don't specify a provider, it will use your default profile (if configured) or the provider specified by LLXPRT_DEFAULT_PROVIDER environment variable, or Gemini as fallback
- **Authentication for Claude/Anthropic**: OAuth authentication for Anthropic in Zed is challenging in the current release because it requires manual API key entry. We recommend either:
  - Using `--key` with your API key directly in the Zed config
  - Setting up a default profile with Anthropic configured
  - Using environment variables
  - This will be improved in a future release
- **Best practice**: Set up your preferred provider as the default profile using `/profile save` and `/profile set-default`, then Zed will automatically use it

When running in ACP mode:

- Console output is redirected to stderr to keep stdout clean for protocol messages
- Authentication happens through the protocol
- The integration supports all llxprt providers (OpenAI, Anthropic, Google, Groq, etc.)

## Privacy and Telemetry

**LLxprt Code does not collect any telemetry or usage statistics by default.** Your privacy is our priority.

All telemetry features have been disabled in LLxprt Code. We do not collect:

- Tool usage statistics
- API request information
- Session data
- File content
- Personal information

**Note about providers:** When using external providers like Google, OpenAI, or Anthropic, those services may collect data according to their own privacy policies. LLxprt Code itself does not send any telemetry data.
