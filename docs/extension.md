# LLxprt Code Extensions

LLxprt Code extensions package prompts, MCP servers, and custom commands into a
familiar and user-friendly format. With extensions, you can expand the
capabilities of LLxprt Code and share those capabilities with others. They are
designed to be easily installable and shareable.

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

LLxprt Code includes several boilerplate templates to help you get started:
`context`, `custom-commands`, `exclude-tools`, and `mcp-server`.

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
`llxprt-extension.json` file. For example:

`<home>/.llxprt/extensions/my-extension/llxprt-extension.json`

### `llxprt-extension.json`

The `llxprt-extension.json` file contains the configuration for the extension.
It has the following structure:

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
