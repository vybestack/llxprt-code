# LLxprt Code Extensions

LLxprt Code supports extensions that can be used to configure and extend its functionality.

## How it works

On startup, LLxprt Code looks for extensions in two locations:

1.  `<workspace>/.llxprt/extensions`
2.  `<home>/.llxprt/extensions`

LLxprt Code loads all extensions from both locations. If an extension with the same name exists in both locations, the extension in the workspace directory takes precedence.

Within each location, individual extensions exist as a directory that contains a `llxprt-extension.json` file. For example:

`<workspace>/.llxprt/extensions/my-extension/llxprt-extension.json`

### `llxprt-extension.json`

The `llxprt-extension.json` file contains the configuration for the extension. The file has the following structure:

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "mcpServers": {
    "my-server": {
      "command": "node my-server.js"
    }
  },
  "contextFileName": "LLXPRT.md",
  "excludeTools": ["run_shell_command"]
}
```

- `name`: The name of the extension. This is used to uniquely identify the extension and for conflict resolution when extension commands have the same name as user or project commands.
- `version`: The version of the extension.
- `mcpServers`: A map of MCP servers to configure. The key is the name of the server, and the value is the server configuration. These servers will be loaded on startup just like MCP servers configured in a [`settings.json` file](./cli/configuration.md). If both an extension and a `settings.json` file configure an MCP server with the same name, the server defined in the `settings.json` file takes precedence.
- `contextFileName`: The name of the file that contains the context for the extension. This will be used to load the context from the workspace. If this property is not used but a `LLXPRT.md` file is present in your extension directory, then that file will be loaded.
- `excludeTools`: An array of tool names to exclude from the model. You can also specify command-specific restrictions for tools that support it, like the `run_shell_command` tool. For example, `"excludeTools": ["run_shell_command(rm -rf)"]` will block the `rm -rf` command.

When LLxprt Code starts, it loads all the extensions and merges their configurations. If there are any conflicts, the workspace configuration takes precedence.

## Extension Commands

Extensions can provide [custom commands](./cli/commands.md#custom-commands) by placing TOML files in a `commands/` subdirectory within the extension directory. These commands follow the same format as user and project custom commands and use standard naming conventions.

### Example

An extension named `gcp` with the following structure:

```
.llxprt/extensions/gcp/
├── llxprt-extension.json
└── commands/
    ├── deploy.toml
    └── gcs/
        └── sync.toml
```

Would provide these commands:

- `/deploy` - Shows as `[gcp] Custom command from deploy.toml` in help
- `/gcs:sync` - Shows as `[gcp] Custom command from sync.toml` in help

### Conflict Resolution

Extension commands have the lowest precedence. When a conflict occurs with user or project commands:

1. **No conflict**: Extension command uses its natural name (e.g., `/deploy`)
2. **With conflict**: Extension command is renamed with the extension prefix (e.g., `/gcp.deploy`)

For example, if both a user and the `gcp` extension define a `deploy` command:

- `/deploy` - Executes the user's deploy command
- `/gcp.deploy` - Executes the extension's deploy command (marked with `[gcp]` tag)

## Installing extensions with custom transports

LLxprt allows `llxprt extensions install --source sso://example/repo` so enterprise customers can use single-sign-on Git remotes. Git does **not** natively understand the `sso://` protocol — you must provide a [`git-remote-<name>` helper](https://git-scm.com/docs/git-remote-helpers) (for example, `git-remote-sso`) or configure Git to remap the protocol before running the command. If the helper is missing, Git will fail with `fatal: Unable to find remote helper for 'sso'`.

The CLI emits a warning whenever you install from an `sso://` URL to remind you to configure the helper. If you do not control the helper, fall back to `https://` or SSH URLs instead.

# Variables

Gemini CLI extensions allow variable substitution in `gemini-extension.json`. This can be useful if e.g., you need the current directory to run an MCP server using `"cwd": "${extensionPath}${/}run.ts"`.

**Supported variables:**

| variable                   | description                                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `${extensionPath}`         | The fully-qualified path of the extension in the user's filesystem e.g., '/Users/username/.gemini/extensions/example-extension'. This will not unwrap symlinks. |
| `${workspacePath}`         | The fully-qualified path of the current workspace.                                                                                                              |
| `${/} or ${pathSeparator}` | The path separator (differs per OS).                                                                                                                            |
