# LLxprt Code: `disabled-tools` Setting

The `disabled-tools` setting allows you to disable specific tools for the current session. This setting is particularly useful during debugging, exploration, or when you want to temporarily limit the capabilities available to the AI.

## Setting the Value

You can set this value using either the `/tools` command or the `/set` command. For example:

### Using the `/tools` command (recommended)

```bash
# Disable the list_directory and write_file tools for the current session
/tools disable list_directory write_file
```

### Using the `/set` command

```bash
# Disable the list_directory and write_file tools for the current session
/set disabled-tools list_directory write_file
```

## How it Works

When you provide a list of tool names to `disabled-tools`, those tools are excluded from the list of available tools sent to the AI model for the current turn. This means the AI will not be able to request those tools.

## Tool Names

For the built-in core tools, use their internal names (e.g., `list_directory`, `read_file`, `write_file`, `glob`). You can use the `/tools list` command to see all available tools and their current status.

## Managing Disabled Tools

The `/tools` command provides several subcommands for managing disabled tools:

### List Tools with Status

```bash
/tools list
```

### Disable a Tool

```bash
/tools disable <tool-name>
```

### Enable a Tool

```bash
/tools enable <tool-name>
```

### List Tools with Descriptions

```bash
/tools desc
# or
/tools descriptions
```

## Profile Integration

The `disabled-tools` setting is an ephemeral setting that can be saved to profiles for reuse. When you save your current configuration to a profile, the disabled tools are included in the saved settings.

### Example Workflow

```bash
# Disable some tools for a specific session
/tools disable list_directory write_file

# Save this configuration to a profile
/profile save minimal-tools

# Load this profile in a future session
/profile load minimal-tools
```

Profiles are stored in `~/.llxprt/profiles/<profile-name>.json` and include your current disabled tools along with other settings like model parameters, provider configuration, and other ephemeral settings.

## Agent Usage

Different agents can use different profiles, which means they can have different tool sets. When an agent is configured with a profile that has specific tools disabled, those tools will not be available to that agent, allowing for:

- Specialized agents with focused capabilities
- Security-conscious configurations with potentially sensitive tools disabled
- Customized agent behaviors based on available tools

## Examples

### Debugging Session

```bash
# Disable potentially disruptive tools during debugging
/tools delete replace delete_line_range

# Save as debug profile
/profile save debug-session
```

### Read-Only Session

```bash
# Disable all write operations
/tools disable write_file replace insert_at_line delete_line_range

# Save as read-only profile
/profile save read-only
```

### Comprehensive Tool Management

```bash
# View current tool status
/tools list

# Disable specific tools
/tools disable search_file_content glob

# Enable previously disabled tools
/tools enable list_directory

# Save configuration
/profile save custom-config
```
