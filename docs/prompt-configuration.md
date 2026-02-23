# Prompt Configuration

LLxprt Code builds its system prompt from markdown files organized in a hierarchy. You can customize any part by placing override files in `~/.llxprt/prompts/`.

## How It Works

The system prompt is assembled from three types of files:

- **Core** (`core.md`) — the main system prompt with personality, mandates, and workflows
- **Environment** (`env/*.md`) — context-specific sections (git repo, sandbox, IDE, etc.)
- **Tool** (`tools/*.md`) — per-tool instructions appended to the system prompt

Files are resolved hierarchically — model-specific overrides beat provider-specific, which beat base defaults:

```
providers/<provider>/models/<model>/core.md   ← most specific
providers/<provider>/core.md                  ← provider level
core.md                                       ← base default
```

The same hierarchy applies to `env/` and `tools/` subdirectories.

## Directory Structure

```
~/.llxprt/prompts/
├── core.md                              # Override the main system prompt
├── compression.md                       # Override compression instructions
├── env/
│   ├── git-repository.md               # Added when in a Git repo
│   ├── sandbox.md                      # Added when sandboxed (container)
│   ├── macos-seatbelt.md              # Added when using macOS seatbelt
│   ├── outside-of-sandbox.md          # Added when NOT sandboxed
│   └── ide-mode.md                    # Added when IDE companion is connected
├── tools/
│   ├── shell.md                       # Override shell tool instructions
│   ├── edit.md                        # Override edit tool instructions
│   └── ...                            # Any tool name in kebab-case
├── providers/
│   └── gemini/
│       ├── core.md                    # Gemini-specific core override
│       └── models/
│           └── gemini-2-5-flash/
│               └── core.md           # Flash-specific override
└── subagent-delegation.md             # Subagent delegation directives
```

If a file doesn't exist in your `~/.llxprt/prompts/` directory, the built-in default is used. You only need to create files for things you want to change.

## Tool Prompts

Tool-specific prompt files are **off by default** because most modern models don't perform better with them. Enable them if you find your model needs more explicit tool guidance:

```
/set enable-tool-prompts true
```

When enabled, each tool gets its instructions appended from `tools/<tool-name>.md`. This is useful for local models that need more explicit guidance about how to use tools.

## Subagent Delegation

When subagents are available (the `task` and `list_subagents` tools are enabled), a delegation directive is automatically injected from `subagent-delegation.md`. This tells the model when and how to delegate work to subagents.

Async subagent guidance is additionally injected when both global and profile async settings are enabled.

## Template Variables

Prompt files use `{{VARIABLE_NAME}}` syntax. Available variables:

| Variable                      | Description                                            |
| ----------------------------- | ------------------------------------------------------ |
| `{{MODEL}}`                   | Current model name                                     |
| `{{PROVIDER}}`                | Current provider name                                  |
| `{{PLATFORM}}`                | OS platform (`darwin`, `linux`, `win32`)               |
| `{{WORKSPACE_NAME}}`          | Basename of the workspace directory                    |
| `{{WORKSPACE_ROOT}}`          | Absolute path to workspace root                        |
| `{{WORKSPACE_DIRECTORIES}}`   | Comma-separated list of workspace directories          |
| `{{WORKING_DIRECTORY}}`       | The cwd the CLI started in                             |
| `{{IS_GIT_REPO}}`             | `true` or `false`                                      |
| `{{IS_SANDBOXED}}`            | `true` or `false`                                      |
| `{{SANDBOX_TYPE}}`            | `macos-seatbelt`, `generic`, or `none`                 |
| `{{HAS_IDE}}`                 | `true` or `false`                                      |
| `{{FOLDER_STRUCTURE}}`        | Summarized folder tree (if enabled)                    |
| `{{SESSION_STARTED_AT}}`      | Timestamp of session start                             |
| `{{CURRENT_DATE}}`            | Current date                                           |
| `{{CURRENT_TIME}}`            | Current time                                           |
| `{{CURRENT_DATETIME}}`        | Current date and time                                  |
| `{{INTERACTION_MODE}}`        | `interactive`, `non-interactive`, or `subagent`        |
| `{{INTERACTION_MODE_LABEL}}`  | `an interactive`, `a non-interactive`, or `a subagent` |
| `{{TOOL_NAME}}`               | Current tool name (in tool prompt files only)          |
| `{{SUBAGENT_DELEGATION}}`     | Subagent delegation block (auto-populated)             |
| `{{ASYNC_SUBAGENT_GUIDANCE}}` | Async subagent guidance (auto-populated)               |

## Why Customize Prompts?

The main reason to customize prompts is to **control model behavior for different providers and models**. Some models need different directives — local models often need shorter, more explicit prompts, while larger models benefit from detailed instructions. Provider-specific overrides let you tune this per-model.

Common customizations:

- Shorter core prompts for local models with small context windows
- Explicit tool-use reminders for models that tend to simulate tool output
- Project-specific coding conventions injected via core override
- Different environment instructions for sandboxed vs unsandboxed operation

## Caching Implications

Many providers (Anthropic, Gemini, OpenAI) offer **prefix caching** — if the system prompt is identical across requests, the provider caches the processed prompt and subsequent requests are faster and cheaper. This means anything that changes between requests breaks the cache.

**`{{CURRENT_DATE}}`, `{{CURRENT_TIME}}`, and `{{CURRENT_DATETIME}}` will break prefix caching** because they change every request. If you need a timestamp in your prompt, use `{{SESSION_STARTED_AT}}` instead — it stays constant for the entire session, so the prompt caches properly.

The internal in-memory cache invalidates when prompt files change on disk (via file watcher), but you may need to start a new session for API-level cache benefits to reset cleanly.

## Small / Local Models

If you're running a local model with a constrained context window (e.g., 8K–32K tokens), the default `core.md` may be too large. Create a stripped-down override at `~/.llxprt/prompts/core.md` with just the essentials — shorter instructions, fewer examples, no subagent delegation. Keep `enable-tool-prompts` off (the default) to avoid bloating the prompt further.

## Contributing Prompt Improvements

If you find prompt configurations that work better for mainstream models, please open a [discussion](https://github.com/vybestack/llxprt-code/discussions) — we're always trying to optimize the default prompts and community feedback on what works is valuable.

## Related

- [Configuration](./cli/configuration.md) — general settings
- [Profiles](./cli/profiles.md) — saving configurations
