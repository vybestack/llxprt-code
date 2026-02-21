# LLxprt Code Configuration

This page covers `settings.json` — the persistent configuration file. You can also edit settings interactively with the `/settings` command during a session.

For session-level settings (the `/set` command), profiles, and reasoning configuration, see [Settings and Profiles](../settings-and-profiles.md).

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

<!-- SETTINGS-AUTOGEN:START -->

#### `accessibility`

- **`accessibility.disableLoadingPhrases`** (boolean):
  - **Description:** Disable loading phrases for accessibility
  - **Default:** `false`
  - **Requires restart:** Yes

- **`accessibility.screenReader`** (boolean):
  - **Description:** Render output in plain-text to be more screen reader accessible
  - **Default:** `false`
  - **Requires restart:** Yes

#### `checkpointing`

- **`checkpointing.enabled`** (boolean):
  - **Description:** Enable session checkpointing for recovery
  - **Default:** `false`
  - **Requires restart:** Yes

#### `lsp`

- **`lsp`** (boolean):
  - **Description:** Enable experimental Language Server Protocol integration for real-time type-error diagnostics after file edits.
  - **Default:** `false`
  - **Requires restart:** Yes

#### `emojifilter`

- **`emojifilter`** (string):
  - **Description:** Filter emojis from AI-generated content and file operations. Options: allowed (no filtering), auto (silent filtering), warn (filter with warnings to AI), error (block operations with emojis).
  - **Default:** `"auto"`

#### `fileFiltering`

- **`fileFiltering.respectGitIgnore`** (boolean):
  - **Description:** Respect .gitignore files when searching
  - **Default:** `true`
  - **Requires restart:** Yes

- **`fileFiltering.respectLlxprtIgnore`** (boolean):
  - **Description:** Respect .llxprtignore files when searching
  - **Default:** `true`
  - **Requires restart:** Yes

- **`fileFiltering.enableRecursiveFileSearch`** (boolean):
  - **Description:** Enable recursive file search functionality
  - **Default:** `true`
  - **Requires restart:** Yes

- **`fileFiltering.disableFuzzySearch`** (boolean):
  - **Description:** Disable fuzzy search when searching for files.
  - **Default:** `false`
  - **Requires restart:** Yes

#### `disableAutoUpdate`

- **`disableAutoUpdate`** (boolean):
  - **Description:** Disable automatic updates
  - **Default:** `false`

#### `shouldUseNodePtyShell`

- **`shouldUseNodePtyShell`** (boolean):
  - **Description:** Allow fully interactive shell commands (vim, git rebase -i, etc.) by running tools through node-pty. Falls back to child_process when disabled.
  - **Default:** `false`
  - **Requires restart:** Yes

#### `allowPtyThemeOverride`

- **`allowPtyThemeOverride`** (boolean):
  - **Description:** Allow ANSI colors from PTY output to override the UI theme. When disabled, PTY output uses the current theme colors.
  - **Default:** `false`
  - **Requires restart:** Yes

#### `ptyScrollbackLimit`

- **`ptyScrollbackLimit`** (number):
  - **Description:** Maximum number of lines to keep in the PTY scrollback buffer for interactive shell output.
  - **Default:** `600000`
  - **Requires restart:** Yes

#### `useExternalAuth`

- **`useExternalAuth`** (boolean):
  - **Description:** Whether to use an external authentication flow.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `sandbox`

- **`sandbox`** (object):
  - **Description:** Sandbox execution environment (can be a boolean or a path string).
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `coreTools`

- **`coreTools`** (array):
  - **Description:** Paths to core tool definitions.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `allowedTools`

- **`allowedTools`** (array):
  - **Description:** A list of tool names that will bypass the confirmation dialog.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `excludeTools`

- **`excludeTools`** (array):
  - **Description:** Tool names to exclude from discovery.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `defaultDisabledTools`

- **`defaultDisabledTools`** (array):
  - **Description:** Tool names disabled by default. Users can re-enable them with /tools enable.
  - **Default:**

    ```json
    ["google_web_fetch"]
    ```

  - **Requires restart:** Yes

#### `coreToolSettings`

- **`coreToolSettings`** (object):
  - **Description:** Manage core tool availability
  - **Default:** `{}`
  - **Requires restart:** Yes

#### `toolDiscoveryCommand`

- **`toolDiscoveryCommand`** (string):
  - **Description:** Command to run for tool discovery.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `toolCallCommand`

- **`toolCallCommand`** (string):
  - **Description:** Command to run for tool calls.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `toolCallProcessingMode`

- **`toolCallProcessingMode`** (enum):
  - **Description:** Mode for processing tool calls. Pipeline mode is optimized, legacy mode uses older implementation.
  - **Default:** `"legacy"`
  - **Values:** `"legacy"`, `"pipeline"`
  - **Requires restart:** Yes

#### `mcpServerCommand`

- **`mcpServerCommand`** (string):
  - **Description:** Command to start an MCP server.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `sessionRetention`

- **`sessionRetention`** (object):
  - **Description:** Settings for automatic session cleanup.
  - **Default:** `undefined`

#### `output`

- **`output.format`** (enum):
  - **Description:** The format of the CLI output.
  - **Default:** `"text"`
  - **Values:** `"text"`, `"json"`

#### `ui`

- **`ui.theme`** (string):
  - **Description:** The color theme for the UI.
  - **Default:** `undefined`

- **`ui.customThemes`** (object):
  - **Description:** Custom theme definitions.
  - **Default:** `{}`

- **`ui.hideWindowTitle`** (boolean):
  - **Description:** Hide the window title bar
  - **Default:** `false`
  - **Requires restart:** Yes

- **`ui.showStatusInTitle`** (boolean):
  - **Description:** Show Gemini CLI status and thoughts in the terminal window title
  - **Default:** `false`

- **`ui.hideTips`** (boolean):
  - **Description:** Hide helpful tips in the UI
  - **Default:** `false`

- **`ui.hideBanner`** (boolean):
  - **Description:** Hide the application banner
  - **Default:** `false`

- **`ui.hideContextSummary`** (boolean):
  - **Description:** Hide the context summary (LLXPRT.md, MCP servers) above the input.
  - **Default:** `false`

- **`ui.footer.hideCWD`** (boolean):
  - **Description:** Hide the current working directory path in the footer.
  - **Default:** `false`

- **`ui.footer.hideSandboxStatus`** (boolean):
  - **Description:** Hide the sandbox status indicator in the footer.
  - **Default:** `false`

- **`ui.footer.hideModelInfo`** (boolean):
  - **Description:** Hide the model name and context usage in the footer.
  - **Default:** `false`

- **`ui.hideFooter`** (boolean):
  - **Description:** Hide the footer from the UI
  - **Default:** `false`

- **`ui.useAlternateBuffer`** (boolean):
  - **Description:** Use an alternate screen buffer for the UI, preserving shell history.
  - **Default:** `true`
  - **Requires restart:** Yes

- **`ui.incrementalRendering`** (boolean):
  - **Description:** Enable incremental rendering for the UI. Only supported when useAlternateBuffer is enabled.
  - **Default:** `true`
  - **Requires restart:** Yes

- **`ui.enableMouseEvents`** (boolean):
  - **Description:** Enable mouse event tracking for in-app scrolling. Disables terminal text selection and clickable links while active.
  - **Default:** `true`
  - **Requires restart:** Yes

- **`ui.showMemoryUsage`** (boolean):
  - **Description:** Display memory usage information in the UI
  - **Default:** `false`

- **`ui.showLineNumbers`** (boolean):
  - **Description:** Show line numbers in the chat.
  - **Default:** `false`

- **`ui.showCitations`** (boolean):
  - **Description:** Show citations for generated text in the chat.
  - **Default:** `false`

- **`ui.customWittyPhrases`** (array):
  - **Description:** Custom witty phrases to display during loading.
  - **Default:** `[]`

- **`ui.wittyPhraseStyle`** (enum):
  - **Description:** Choose which collection of witty phrases to display during loading.
  - **Default:** `"default"`
  - **Values:** `"default"`, `"llxprt"`, `"gemini-cli"`, `"whimsical"`, `"custom"`

- **`ui.vimMode`** (boolean):
  - **Description:** Enable Vim keybindings in the input field.
  - **Default:** `false`

- **`ui.ideMode`** (boolean):
  - **Description:** Enable IDE integration mode.
  - **Default:** `false`

- **`ui.preferredEditor`** (string):
  - **Description:** The preferred code editor for opening files.
  - **Default:** `undefined`

- **`ui.autoConfigureMaxOldSpaceSize`** (boolean):
  - **Description:** Automatically configure Node.js max old space size based on system memory.
  - **Default:** `true`
  - **Requires restart:** Yes

- **`ui.historyMaxItems`** (number):
  - **Description:** Maximum number of history items to keep.
  - **Default:** `100`

- **`ui.historyMaxBytes`** (number):
  - **Description:** Maximum size of history in bytes.
  - **Default:** `1048576`

- **`ui.memoryImportFormat`** (string):
  - **Description:** Format for importing memory files (tree or flat).
  - **Default:** `"tree"`

- **`ui.memoryDiscoveryMaxDirs`** (number):
  - **Description:** Maximum number of directories to scan for memory files.
  - **Default:** `undefined`

- **`ui.memoryDiscoveryMaxDepth`** (number):
  - **Description:** Maximum directory depth for downward LLXPRT.md search from the current working directory. Does not affect upward traversal or global memory. When unset, searches all depths.
  - **Default:** `undefined`

- **`ui.jitContextEnabled`** (boolean):
  - **Description:** Enable Just-In-Time (JIT) loading of subdirectory-specific context (LLXPRT.md files) on demand when tools access files. When enabled, the system automatically loads context from subdirectories as needed.
  - **Default:** `true`

- **`ui.contextFileName`** (string | string[]):
  - **Description:** The name of the context file or files to load into memory. Accepts either a single string or an array of strings.
  - **Default:** `undefined`

- **`ui.usageStatisticsEnabled`** (boolean):
  - **Description:** Enable anonymous usage statistics collection.
  - **Default:** `true`

- **`ui.maxSessionTurns`** (number):
  - **Description:** Maximum number of turns in a session (-1 for unlimited).
  - **Default:** `-1`

- **`ui.showTodoPanel`** (boolean):
  - **Description:** Show the todo panel in the UI.
  - **Default:** `true`

- **`ui.useFullWidth`** (boolean):
  - **Description:** Use the entire width of the terminal for output.
  - **Default:** `true`

- **`ui.disableLoadingPhrases`** (boolean):
  - **Description:** Disable loading phrases for accessibility.
  - **Default:** `false`
  - **Requires restart:** Yes

- **`ui.screenReader`** (boolean):
  - **Description:** Render output in plain-text to be more screen reader accessible.
  - **Default:** `false`
  - **Requires restart:** Yes

#### `ide`

- **`ide`** (object):
  - **Description:** IDE integration settings.
  - **Default:** `{}`
  - **Requires restart:** Yes

#### `showStatusInTitle`

- **`showStatusInTitle`** (boolean):
  - **Description:** Show LLxprt status and thoughts in the terminal window title
  - **Default:** `false`

#### `hideCWD`

- **`hideCWD`** (boolean):
  - **Description:** Hide the current working directory path in the footer.
  - **Default:** `false`

#### `hideSandboxStatus`

- **`hideSandboxStatus`** (boolean):
  - **Description:** Hide the sandbox status indicator in the footer.
  - **Default:** `false`

#### `hideModelInfo`

- **`hideModelInfo`** (boolean):
  - **Description:** Hide the model name and context usage in the footer.
  - **Default:** `false`

#### `allowMCPServers`

- **`allowMCPServers`** (array):
  - **Description:** A whitelist of MCP servers to allow.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `excludeMCPServers`

- **`excludeMCPServers`** (array):
  - **Description:** A blacklist of MCP servers to exclude.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `bugCommand`

- **`bugCommand`** (object):
  - **Description:** Configuration for the bug report command.
  - **Default:** `undefined`

#### `summarizeToolOutput`

- **`summarizeToolOutput`** (object):
  - **Description:** Enables or disables summarization of tool output. Configure per-tool token budgets (for example {"run_shell_command": {"tokenBudget": 2000}}). Currently only the run_shell_command tool supports summarization.
  - **Default:** `undefined`

#### `dnsResolutionOrder`

- **`dnsResolutionOrder`** (string):
  - **Description:** The DNS resolution order.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `tools`

- **`tools.sandbox`** (boolean | string):
  - **Description:** Sandbox execution environment. Set to a boolean to enable or disable the sandbox, or provide a string path to a sandbox profile.
  - **Default:** `undefined`
  - **Requires restart:** Yes

- **`tools.autoAccept`** (boolean):
  - **Description:** Automatically accept and execute tool calls that are considered safe (e.g., read-only operations).
  - **Default:** `false`

- **`tools.core`** (array):
  - **Description:** Paths to core tool definitions.
  - **Default:** `undefined`
  - **Requires restart:** Yes

- **`tools.allowed`** (array):
  - **Description:** A list of tool names that will bypass the confirmation dialog.
  - **Default:** `undefined`
  - **Requires restart:** Yes

- **`tools.exclude`** (array):
  - **Description:** Tool names to exclude from discovery.
  - **Default:** `undefined`
  - **Requires restart:** Yes

- **`tools.discoveryCommand`** (string):
  - **Description:** Command to run for tool discovery.
  - **Default:** `undefined`
  - **Requires restart:** Yes

- **`tools.callCommand`** (string):
  - **Description:** Command to run for tool calls.
  - **Default:** `undefined`
  - **Requires restart:** Yes

- **`tools.useRipgrep`** (boolean):
  - **Description:** Use ripgrep for file content search instead of the fallback implementation. When unset, ripgrep is auto-enabled if detected.
  - **Default:** `undefined`

- **`tools.enableToolOutputTruncation`** (boolean):
  - **Description:** Enable truncation of large tool outputs.
  - **Default:** `true`
  - **Requires restart:** Yes

- **`tools.truncateToolOutputThreshold`** (number):
  - **Description:** Truncate tool output if it is larger than this many characters. Set to -1 to disable.
  - **Default:** `4000000`
  - **Requires restart:** Yes

- **`tools.truncateToolOutputLines`** (number):
  - **Description:** The number of lines to keep when truncating tool output.
  - **Default:** `1000`
  - **Requires restart:** Yes

- **`tools.policyPath`** (string):
  - **Description:** Absolute path to a TOML policy file that augments the built-in policy rules.
  - **Default:** `undefined`

- **`tools.enableHooks`** (boolean):
  - **Description:** Enable the hooks system for intercepting and customizing LLxprt CLI behavior. When enabled, hooks configured in settings will execute at appropriate lifecycle events (BeforeTool, AfterTool, BeforeModel, etc.). Requires MessageBus integration.
  - **Default:** `false`
  - **Requires restart:** Yes

#### `mcp`

- **`mcp.serverCommand`** (string):
  - **Description:** Command to start an MCP server.
  - **Default:** `undefined`
  - **Requires restart:** Yes

- **`mcp.allowed`** (array):
  - **Description:** A list of MCP servers to allow.
  - **Default:** `undefined`
  - **Requires restart:** Yes

- **`mcp.excluded`** (array):
  - **Description:** A list of MCP servers to exclude.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `subagents`

- **`subagents.asyncEnabled`** (boolean):
  - **Description:** Globally allow background subagent runs. If off, async=true launches are blocked even if a profile enables them.
  - **Default:** `true`

- **`subagents.maxAsync`** (number):
  - **Description:** Maximum concurrent async tasks. Profile setting (task-max-async) can limit but not exceed this value. Use -1 for unlimited.
  - **Default:** `5`

#### `security`

- **`security.disableYoloMode`** (boolean):
  - **Description:** Disable YOLO mode, even if enabled by a flag.
  - **Default:** `false`
  - **Requires restart:** Yes

- **`security.blockGitExtensions`** (boolean):
  - **Description:** Blocks installing and loading extensions from Git.
  - **Default:** `false`
  - **Requires restart:** Yes

- **`security.folderTrust.enabled`** (boolean):
  - **Description:** Setting to track whether Folder trust is enabled.
  - **Default:** `false`
  - **Requires restart:** Yes

- **`security.auth.selectedType`** (string):
  - **Description:** The currently selected authentication type.
  - **Default:** `undefined`
  - **Requires restart:** Yes

- **`security.auth.useExternal`** (boolean):
  - **Description:** Whether to use an external authentication flow.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `excludedProjectEnvVars`

- **`excludedProjectEnvVars`** (array):
  - **Description:** Environment variables to exclude from project context.
  - **Default:**

    ```json
    ["DEBUG", "DEBUG_MODE"]
    ```

#### `disableUpdateNag`

- **`disableUpdateNag`** (boolean):
  - **Description:** Disable update notification prompts.
  - **Default:** `false`

#### `includeDirectories`

- **`includeDirectories`** (array):
  - **Description:** Additional directories to include in the workspace context. Missing directories will be skipped with a warning.
  - **Default:** `[]`

#### `loadMemoryFromIncludeDirectories`

- **`loadMemoryFromIncludeDirectories`** (boolean):
  - **Description:** Whether to load memory files from include directories.
  - **Default:** `false`

#### `model`

- **`model`** (string):
  - **Description:** The Gemini model to use for conversations.
  - **Default:** `undefined`

#### `hasSeenIdeIntegrationNudge`

- **`hasSeenIdeIntegrationNudge`** (boolean):
  - **Description:** Whether the user has seen the IDE integration nudge.
  - **Default:** `false`

#### `folderTrustFeature`

- **`folderTrustFeature`** (boolean):
  - **Description:** Enable folder trust feature for enhanced security.
  - **Default:** `false`
  - **Requires restart:** Yes

#### `folderTrust`

- **`folderTrust`** (boolean):
  - **Description:** Setting to track whether Folder trust is enabled.
  - **Default:** `false`
  - **Requires restart:** Yes

#### `chatCompression`

- **`chatCompression`** (object):
  - **Description:** Chat compression settings.
  - **Default:** `undefined`

#### `experimental`

- **`experimental.extensionReloading`** (boolean):
  - **Description:** Enables extension loading/unloading within the CLI session.
  - **Default:** `false`
  - **Requires restart:** Yes

#### `defaultProfile`

- **`defaultProfile`** (string):
  - **Description:** Default provider profile to use.
  - **Default:** `undefined`
  - **Requires restart:** Yes

#### `providerApiKeys`

- **`providerApiKeys`** (object):
  - **Description:** API keys for different providers.
  - **Default:** `{}`
  - **Requires restart:** Yes

#### `providerBaseUrls`

- **`providerBaseUrls`** (object):
  - **Description:** Base URLs for different providers.
  - **Default:** `{}`
  - **Requires restart:** Yes

#### `providerToolFormatOverrides`

- **`providerToolFormatOverrides`** (object):
  - **Description:** Tool format overrides for different providers.
  - **Default:** `{}`
  - **Requires restart:** Yes

#### `providerKeyfiles`

- **`providerKeyfiles`** (object):
  - **Description:** Keyfile paths for different providers.
  - **Default:** `{}`
  - **Requires restart:** Yes

#### `extensionManagement`

- **`extensionManagement`** (boolean):
  - **Description:** Enable extension management features.
  - **Default:** `true`
  - **Requires restart:** Yes

#### `enableTextToolCallParsing`

- **`enableTextToolCallParsing`** (boolean):
  - **Description:** Enable parsing of tool calls from text responses.
  - **Default:** `false`

#### `textToolCallModels`

- **`textToolCallModels`** (array):
  - **Description:** Models that support text-based tool call parsing.
  - **Default:** `[]`

#### `openaiResponsesEnabled`

- **`openaiResponsesEnabled`** (boolean):
  - **Description:** Enable OpenAI Responses API compatibility.
  - **Default:** `false`

#### `shellReplacement`

- **`shellReplacement`** (enum):
  - **Description:** Control command substitution in shell commands: "allowlist" (validate inner commands against coreTools), "all" (allow all), "none" (block all).
  - **Default:** `"allowlist"`
  - **Values:** `"allowlist"`, `"all"`, `"none"`

#### `oauthEnabledProviders`

- **`oauthEnabledProviders`** (object):
  - **Description:** OAuth enablement configuration per provider.
  - **Default:** `{}`
  - **Requires restart:** Yes

#### `useRipgrep`

- **`useRipgrep`** (boolean):
  - **Description:** Use ripgrep for file content search instead of the fallback implementation. When unset, ripgrep is auto-enabled if detected.
  - **Default:** `undefined`

#### `enablePromptCompletion`

- **`enablePromptCompletion`** (boolean):
  - **Description:** Enable AI-powered prompt completion suggestions while typing.
  - **Default:** `false`
  - **Requires restart:** Yes

#### `showProfileChangeInChat`

- **`showProfileChangeInChat`** (boolean):
  - **Description:** Show a message in chat when the active profile changes.
  - **Default:** `true`

#### `enableFuzzyFiltering`

- **`enableFuzzyFiltering`** (boolean):
  - **Description:** Enable fuzzy filtering for command menu completions. When enabled, you can type partial characters (e.g., "prd" to match "production"). When disabled, only exact prefix matches are shown.
  - **Default:** `true`

#### `customWittyPhrases`

- **`customWittyPhrases`** (array):
  - **Description:** Custom witty phrases to display during loading. When provided, the CLI cycles through these instead of the defaults.
  - **Default:** `[]`

#### `wittyPhraseStyle`

- **`wittyPhraseStyle`** (enum):
  - **Description:** Choose which collection of witty phrases to display during loading.
  - **Default:** `"default"`
  - **Values:** `"default"`, `"llxprt"`, `"gemini-cli"`, `"whimsical"`, `"custom"`

#### `hooks`

- **`hooks`** (object):
  - **Description:** Hook configurations for intercepting and customizing agent behavior.
  - **Default:** `{}`
  <!-- SETTINGS-AUTOGEN:END -->

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
  - **Description:** Configures the checkpointing feature, which allows you to save and restore conversation and file states. See the [Continuation and Checkpointing documentation](../checkpointing.md) for more details.
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
  - **Description:** Use ripgrep for file content search instead of the fallback implementation. When unset, ripgrep is auto-enabled if detected.
  - **Default:** `auto` (enabled when ripgrep is available)

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

## Using /settings

The `/settings` command opens an interactive settings editor inside your session. You can browse, search, and modify settings without editing JSON files manually.

```
/settings
```

## Environment Variables and .env Files

The CLI automatically loads environment variables from `.env` files. The loading order is:

1. `.env` in the current directory
2. `.env` in parent directories (up to filesystem root)
3. `~/.llxprt/.env` (user-level)

String values in `settings.json` can reference environment variables using `$VAR_NAME` or `${VAR_NAME}` syntax.

## Shell History

Shell command history is stored per-project at `~/.llxprt/tmp/<project_hash>/shell_history`.

## See Also

These topics have dedicated documentation pages:

- [Settings and Profiles](../settings-and-profiles.md) — ephemeral settings, profiles, reasoning config, timeouts
- [Ephemeral Settings Reference](../reference/ephemerals.md) — complete reference for every `/set` setting
- [Profile File Reference](../reference/profiles.md) — profile JSON format, auth config, load balancers
- [Authentication](./authentication.md) — API keys, keyring, OAuth, provider setup
- [Providers](./providers.md) — supported providers and configuration
- [Profiles](./profiles.md) — profile management, multi-bucket failover
- [Sandboxing](../sandbox.md) — Docker, Podman, Seatbelt sandbox configuration
- [VS Code Integration](../ide-integration.md) — companion extension setup
- [Zed Integration](../zed-integration.md) — Zed editor integration
- [Prompt Configuration](../prompt-configuration.md) — system prompts, context files, LLXPRT.md
- [Continuation and Checkpointing](../checkpointing.md) — session recording, --continue, /chat
- [Extensions](../extension.md) — extension management and Gemini CLI compatibility
