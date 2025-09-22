# LLxprt Code: Read-only `disabled-tools` Ephemeral Setting

The `disabled-tools` ephemeral setting allows you to disable specific tools for the current session. This setting is particularly useful during debugging, exploration, or when you want to temporarily limit the capabilities available to the AI.

## Setting the Value

You can only set this value using the `/ephemeral` command. For example:

```
# Disable the list_directory and write_file tools for the current session
/ephemeral disabled-tools list_directory write_file
```

This setting **cannot** be configured via `settings.json` or saved/loaded using the Profile system.

## How it Works

When you provide a list of tool names to `disabled-tools`, those tools are excluded from the list of available tools sent to the AI model for the current turn. This means the AI will not be able to request those tools.

## Tool Names

For the built-in core tools, use their internal names (e.g., `list_directory`, `read_file`, `write_file`, `run_shell_command`).

For tools provided by MCP servers, the names are prefixed with the server alias if there is a conflict. For example, if you have two MCP servers and both expose a tool named `get_current_time`, one might be registered as `my_server_alias__get_current_time`.

## Example: Disabling All File System Tools

To disable all built-in file system tools for the session, you could run:

```
/ephemeral disabled-tools list_directory read_file write_file glob search_file_content replace read_many_files
```
