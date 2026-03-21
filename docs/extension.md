# LLxprt Code Extensions

LLxprt Code extensions package prompts, MCP servers, and custom commands into a
familiar and user-friendly format. With extensions, you can expand the
capabilities of LLxprt Code and share those capabilities with others. They are
designed to be easily installable and shareable.

**Gemini CLI compatible:** LLxprt Code extensions use the same format as Gemini CLI extensions. Extensions built for Gemini CLI work in LLxprt Code — we look for `llxprt-extension.json` first, then fall back to `gemini-extension.json`. You can install Gemini CLI extensions directly from their repositories. Browse community extensions in the [Gemini CLI extensions topic on GitHub](https://github.com/topics/gemini-cli-extension).

## Extension Management

LLxprt Code provides a suite of extension management commands via
`llxprt extensions`. These commands are run from your terminal (not from within
an interactive LLxprt session), although you can list installed extensions using
the `/extensions list` slash command inside a session.

Changes made by these commands (installs, updates, enable/disable) take effect
on the next LLxprt session — active sessions are not affected until restarted.

### Installing an extension

Install an extension from a GitHub URL or a local path:

```
llxprt extensions install <source> [--ref <ref>] [--auto-update] [--pre-release] [--consent]
```

- `<source>`: The GitHub URL or local path of the extension to install.
- `--ref`: The git ref (branch, tag, or commit) to install from.
- `--auto-update`: Enable auto-update for this extension.
- `--pre-release`: Enable pre-release versions for this extension.
- `--consent`: Acknowledge the security risks of installing an extension and
  skip the confirmation prompt.

A copy of the extension is created during installation, so you'll need to run
`llxprt extensions update` to pull in subsequent changes from the source.

> **Note:** If you are installing an extension from GitHub, you'll need to have
> `git` installed on your machine. See
> [git installation instructions](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
> for help.

**Examples:**

```bash
# Install from GitHub
llxprt extensions install https://github.com/example/my-extension

# Install a specific tag with auto-update
llxprt extensions install https://github.com/example/my-extension --ref v2.0.0 --auto-update

# Install from a local directory
llxprt extensions install /path/to/my-extension
```

### Uninstalling extensions

Uninstall one or more extensions by name:

```
llxprt extensions uninstall <name...>
```

You can specify multiple extension names to uninstall them in a single command:

```bash
llxprt extensions uninstall my-security-ext my-other-extension
```

### Disabling an extension

Extensions are enabled across all workspaces by default. You can disable an
extension entirely or for a specific workspace:

```
llxprt extensions disable <name> [--scope <scope>]
```

- `<name>`: The name of the extension to disable.
- `--scope`: The scope to disable the extension in (`user` or `workspace`).

**Examples:**

```bash
# Disable globally (for all workspaces)
llxprt extensions disable my-extension

# Disable only for the current workspace
llxprt extensions disable my-extension --scope workspace
```

### Enabling an extension

Re-enable a previously disabled extension:

```
llxprt extensions enable <name> [--scope <scope>]
```

- `<name>`: The name of the extension to enable.
- `--scope`: The scope to enable the extension in (`user` or `workspace`).

**Examples:**

```bash
# Enable globally
llxprt extensions enable my-extension

# Enable only for the current workspace
llxprt extensions enable my-extension --scope workspace
```

### Updating extensions

Update an extension to the latest version (as reflected in its
`llxprt-extension.json` `version` field):

```
llxprt extensions update <name>
```

Or update all installed extensions at once:

```
llxprt extensions update --all
```

### Creating a new extension

<!-- @plan PLAN-20250219-GMERGE021.R9.P03 -->

LLxprt Code includes several boilerplate templates to help you get started:
`context`, `exclude-tools`, and `mcp-server`.

```
llxprt extensions new <path> [template]
```

- `<path>`: The directory to create the extension in.
- `[template]`: The boilerplate template to use.

**Example:**

```bash
# Create an extension with the mcp-server template
llxprt extensions new ./my-new-extension mcp-server
```

### Linking a local extension

The `link` command creates a symbolic link from the extension installation
directory to a local development path. This is useful during development so you
don't have to run `llxprt extensions update` every time you make changes.

```
llxprt extensions link <path>
```

- `<path>`: The path of the extension to link.

**Example:**

```bash
llxprt extensions link ./my-extension-dev
```

### Listing installed extensions

View all installed extensions and their status:

```
llxprt extensions list
```

You can also list extensions from within an interactive session using the
`/extensions list` slash command.

### Validating an extension

Check that an extension's structure and configuration are correct:

```
llxprt extensions validate <path>
```

- `<path>`: The path of the extension to validate.

**Example:**

```bash
llxprt extensions validate ./my-extension
```

## How It Works

On startup, LLxprt Code looks for extensions in two locations:

1. `<workspace>/.llxprt/extensions`
2. `<home>/.llxprt/extensions`

LLxprt Code loads all extensions from both locations. If an extension with the
same name exists in both locations, the extension in the workspace directory
takes precedence.

Within each location, individual extensions exist as a directory containing a
`llxprt-extension.json` file (or `gemini-extension.json` for Gemini CLI
extensions). For example:

`<home>/.llxprt/extensions/my-extension/llxprt-extension.json`

### `llxprt-extension.json`

The `llxprt-extension.json` file contains the configuration for the extension.
LLxprt Code also accepts `gemini-extension.json` as a fallback — if no
`llxprt-extension.json` is found, it looks for `gemini-extension.json`
automatically. The format is identical.

The file has the following structure:

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "description": "My awesome extension",
  "mcpServers": {
    "my-server": {
      "command": "node my-server.js"
    }
  },
  "contextFileName": "LLXPRT.md",
  "excludeTools": ["run_shell_command"]
}
```

- `name`: The name of the extension. This is used to uniquely identify the
  extension and for conflict resolution when extension commands have the same
  name as user or project commands. The name should be lowercase or numbers and
  use dashes instead of underscores or spaces. This is how users will refer to
  your extension in the CLI. Note that we expect this name to match the
  extension directory name.
- `version`: The version of the extension.
- `description`: A short description of the extension.
- `mcpServers`: A map of MCP servers to configure. The key is the name of the
  server, and the value is the server configuration. These servers will be
  loaded on startup just like MCP servers configured in a
  [`settings.json` file](./cli/configuration.md). If both an extension and a
  `settings.json` file configure an MCP server with the same name, the server
  defined in the `settings.json` file takes precedence.
  - Note that all MCP server configuration options are supported except for
    `trust`.
- `contextFileName`: The name of the file that contains the context for the
  extension. This will be used to load the context from the extension directory.
  If this property is not used but a `LLXPRT.md` file is present in your
  extension directory, then that file will be loaded.
- `excludeTools`: An array of tool names to exclude from the model. You can also
  specify command-specific restrictions for tools that support it, like the
  `run_shell_command` tool. For example,
  `"excludeTools": ["run_shell_command(rm -rf)"]` will block the `rm -rf`
  command. Note that this differs from the MCP server `excludeTools`
  functionality, which can be listed in the MCP server config.

When LLxprt Code starts, it loads all the extensions and merges their
configurations. If there are any conflicts, the workspace configuration takes
precedence.

### Settings

Extensions can define settings that the user will be prompted to provide upon
installation. This is useful for things like API keys, URLs, or other
configuration that the extension needs to function.

To define settings, add a `settings` array to your `llxprt-extension.json` file.
Each object in the array should have the following properties:

- `name`: A user-friendly name for the setting.
- `description`: A description of the setting and what it's used for.
- `envVar`: The name of the environment variable that the setting will be stored
  as.
- `sensitive`: Optional boolean. If true, obfuscates the input the user provides
  and stores the secret in keychain storage.

**Example:**

```json
{
  "name": "my-api-extension",
  "version": "1.0.0",
  "settings": [
    {
      "name": "API Key",
      "description": "Your API key for the service.",
      "envVar": "MY_API_KEY"
    }
  ]
}
```

When a user installs this extension, they will be prompted to enter their API
key. The value will be saved to a `.env` file in the extension's directory
(e.g., `<home>/.llxprt/extensions/my-api-extension/.env`).

## Extension Commands

Extensions can provide [custom commands](./cli/commands.md#custom-commands) by
placing TOML files in a `commands/` subdirectory within the extension directory.
These commands follow the same format as user and project custom commands and use
standard naming conventions.

### Example

An extension named `devops` with the following structure:

```
.llxprt/extensions/devops/
├── llxprt-extension.json
└── commands/
    ├── deploy.toml
    └── k8s/
        └── status.toml
```

Would provide these commands:

- `/deploy` — Shows as `[devops] Custom command from deploy.toml` in help
- `/k8s:status` — Shows as `[devops] Custom command from status.toml` in help

### Conflict Resolution

Extension commands have the lowest precedence. When a conflict occurs with user
or project commands:

1. **No conflict**: Extension command uses its natural name (e.g., `/deploy`)
2. **With conflict**: Extension command is renamed with the extension prefix
   (e.g., `/devops.deploy`)

For example, if both a user and the `devops` extension define a `deploy`
command:

- `/deploy` — Executes the user's deploy command
- `/devops.deploy` — Executes the extension's deploy command (marked with
  `[devops]` tag)

## Installing Extensions with Custom Transports

LLxprt Code allows
`llxprt extensions install sso://example/repo` so enterprise
users can use single-sign-on Git remotes. Git does **not** natively understand
the `sso://` protocol — you must provide a
[`git-remote-<name>` helper](https://git-scm.com/docs/git-remote-helpers) (for
example, `git-remote-sso`) or configure Git to remap the protocol before running
the command. If the helper is missing, Git will fail with
`fatal: Unable to find remote helper for 'sso'`.

A warning is emitted whenever you install from an `sso://` URL to remind you to
configure the helper. If you do not control the helper, fall back to `https://`
or SSH URLs instead.

## Hooks in Extensions

Extensions can bundle [hooks](./hooks/index.md) alongside MCP servers, prompts, and custom commands. When you install an extension that includes hooks, those hooks are loaded automatically when the extension is enabled.

### How Extension Hooks Work

An extension's `llxprt-extension.json` (or `gemini-extension.json`) can include a `hooks` key with hook definitions that follow the same schema as hooks in [`settings.json`](./cli/configuration.md):

```json
{
  "name": "my-security-extension",
  "version": "1.0.0",
  "description": "Adds security policy enforcement",
  "hooks": {
    "BeforeTool": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${extensionPath}${/}hooks${/}validate-tool.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

**Note:** Use the `${extensionPath}` variable to reference scripts within your extension directory. See [Variables](#variables) below.

### Hook Scope and Precedence

When multiple hooks are configured across different scopes, LLxprt Code applies them in this order:

1. **System hooks** (configured by system administrators)
2. **User hooks** (in `~/.llxprt/settings.json`)
3. **Extension hooks** (from enabled extensions)
4. **Project hooks** (in `.llxprt/settings.json`)

Hooks at each level are executed in sequence. If any hook blocks an operation (e.g., returns `"decision": "deny"`), the operation is blocked regardless of subsequent hooks.

For more details on hook precedence and execution flow, see [Hooks Best Practices](./hooks/best-practices.md).

### Security Considerations for Extension Hooks

> [!WARNING] **Extension hooks execute with your user privileges.**

Extension hooks have the same capabilities as any other hook — they can read files, execute commands, modify tool inputs, and interact with external services. When installing an extension that includes hooks:

- **Review the hooks** before installation. Check the `hooks` section in the extension's `llxprt-extension.json` and examine any referenced scripts.
- **Verify the source.** Install extensions only from authors and repositories you trust.
- **Understand what the hooks do.** Read the extension's documentation and inspect the hook scripts to understand their behavior.
- **Check for consent prompts.** When an extension with new or modified hooks is first loaded, LLxprt Code will prompt you to trust those hooks (same as project-level hooks). Review the details carefully before approving.

Extension hooks are particularly useful for:

- **Organization-wide security policies**: Deploy a security extension across your team that enforces consistent rules.
- **Compliance and auditing**: Automatically log all tool calls for regulatory compliance.
- **Custom workflows**: Add project-specific automation that travels with the extension.

However, malicious extension hooks can:

- **Exfiltrate data**: Read sensitive files (`.env`, SSH keys) and send them to remote servers.
- **Modify operations**: Change tool inputs to perform unintended actions.
- **Consume resources**: Run expensive operations or create infinite loops.

See [Using Hooks Securely](./hooks/best-practices.md#using-hooks-securely) for a detailed threat model and mitigation strategies.

### Enabling and Disabling Extension Hooks

Extension hooks are active when the extension is enabled and inactive when the extension is disabled. You can control this with the `llxprt extensions` commands:

```bash
# Disable an extension globally (hooks will not run)
llxprt extensions disable my-security-extension

# Re-enable the extension (hooks will run again)
llxprt extensions enable my-security-extension

# Disable only for the current workspace
llxprt extensions disable my-security-extension --scope workspace
```

Disabling an extension immediately stops its hooks from running (takes effect on the next LLxprt session).

### Hook Consent and Trust

When LLxprt Code loads an extension with hooks for the first time (or detects that the hooks have changed), it will:

1. **Identify the hooks** by generating a unique identity based on the hook's `name` and `command`.
2. **Check trust status.** If the hooks are not yet trusted, LLxprt Code will prompt you to review and approve them.
3. **Require explicit approval.** Extension hooks are **not auto-trusted** — you must explicitly approve them before they will run.

This consent flow is identical to the one used for project-level hooks. Once you trust an extension's hooks, they will run automatically whenever the extension is enabled. If the extension updates its hooks, you will be prompted again.

For more details on hook consent and trust, see [Hooks Best Practices](./hooks/best-practices.md#project-hook-security).


## Variables

LLxprt Code extensions allow variable substitution in `llxprt-extension.json`.
This can be useful if, for example, you need the current directory to run an MCP
server using an argument like
`"args": ["${extensionPath}${/}dist${/}server.js"]`.

**Supported variables:**

| Variable                     | Description                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `${extensionPath}`           | The fully-qualified path of the extension in the user's filesystem, e.g., `/Users/username/.llxprt/extensions/example-extension`. This will not unwrap symlinks. |
| `${workspacePath}`           | The fully-qualified path of the current workspace.                                                                                                               |
| `${/}` or `${pathSeparator}` | The path separator (differs per OS).                                                                                                                             |
