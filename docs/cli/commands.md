# CLI Commands

LLxprt Code supports three kinds of inline commands: **slash commands** (`/`), **at commands** (`@`), and **shell passthrough** (`!`).

Type `/` at the prompt to see available commands with tab completion.

## Slash Commands

Slash commands control the CLI itself — configuration, navigation, session management, and tools.

### Provider and Model

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `/provider [name]`     | Switch provider (e.g., `/provider kimi`) |
| `/model [name]`        | Switch model (e.g., `/model grok-3`)     |
| `/baseurl [url]`       | Set the API base URL                     |
| `/toolformat [format]` | Set the tool format for the provider     |

### Authentication

| Command                      | Description                        |
| ---------------------------- | ---------------------------------- |
| `/key [value]`               | Set API key for current session    |
| `/key save <name>`           | Save a key to the OS keyring       |
| `/keyfile <path>`            | Load API key from a file           |
| `/toolkey <tool> <key>`      | Set an API key for a specific tool |
| `/toolkeyfile <tool> <path>` | Load a tool API key from a file    |
| `/auth`                      | Manage OAuth authentication        |
| `/logout [provider]`         | Log out of an OAuth provider       |

### Profiles and Settings

| Command                         | Description                               |
| ------------------------------- | ----------------------------------------- |
| `/profile save <name>`          | Save current config as a profile          |
| `/profile load <name>`          | Load a saved profile                      |
| `/profile list`                 | List saved profiles                       |
| `/profile delete <name>`        | Delete a profile                          |
| `/profile set-default <name>`   | Auto-load a profile on startup            |
| `/set <key> <value>`            | Set an ephemeral setting for this session |
| `/set modelparam <key> <value>` | Set a model parameter                     |
| `/set unset <key>`              | Clear an ephemeral setting                |
| `/settings`                     | Open the interactive settings editor      |

### Session

| Command                 | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| `/continue`             | Browse and resume previous sessions                                |
| `/continue <ref>`       | Resume a specific session by ID or index                           |
| `/chat save <tag>`      | Save conversation state with a tag                                 |
| `/chat resume <tag>`    | Restore conversation to a tagged state                             |
| `/chat list`            | List saved conversation tags                                       |
| `/chat delete <tag>`    | Delete a conversation tag                                          |
| `/compress`             | Manually compress conversation history                             |
| `/clear`                | Clear the conversation and start fresh                             |
| `/copy`                 | Copy the last response to clipboard                                |
| `/restore [checkpoint]` | Restore from a checkpointing snapshot (requires `--checkpointing`) |

### Tools and MCP

| Command        | Description                              |
| -------------- | ---------------------------------------- |
| `/tools`       | List available tools and their status    |
| `/mcp`         | Manage MCP server connections            |
| `/tasks`       | View running async subagent tasks        |
| `/subagent`    | Manage subagent configurations           |
| `/permissions` | View and manage tool permission settings |
| `/policies`    | View active policy rules                 |
| `/todo`        | View or manage the current todo list     |

### UI and Display

| Command         | Description                                  |
| --------------- | -------------------------------------------- |
| `/theme [name]` | Switch color theme                           |
| `/vim`          | Toggle vim keybindings                       |
| `/mouse`        | Toggle mouse support                         |
| `/editor`       | Set external editor for multi-line input     |
| `/stats`        | Show session statistics (tokens, cost, time) |
| `/dir`          | Show or change the working directory         |

### IDE

| Command        | Description                         |
| -------------- | ----------------------------------- |
| `/ide install` | Install the IDE companion extension |
| `/ide enable`  | Enable IDE integration              |
| `/ide disable` | Disable IDE integration             |
| `/ide status`  | Show IDE connection status          |

### Extensions

| Command            | Description               |
| ------------------ | ------------------------- |
| `/extensions list` | List installed extensions |

Extensions are managed from the terminal with `llxprt extensions` (not slash commands). See [Extensions](../extension.md).

### Memory and Context

| Command   | Description                             |
| --------- | --------------------------------------- |
| `/memory` | Manage saved memories (LLXPRT.md facts) |
| `/init`   | Create or update a project LLXPRT.md    |

### Information

| Command         | Description                           |
| --------------- | ------------------------------------- |
| `/help` or `/?` | Show available commands               |
| `/about`        | Show version and system information   |
| `/docs`         | Open documentation in the browser     |
| `/bug [title]`  | File a bug report on GitHub           |
| `/diagnostics`  | Run system diagnostics                |
| `/privacy`      | View privacy and data collection info |

### Debug

| Command              | Description                              |
| -------------------- | ---------------------------------------- |
| `/dumpcontext`       | Dump the current model context to a file |
| `/logging [on\|off]` | Toggle debug logging                     |
| `/debug`             | Debug commands (internal)                |

### Session Control

| Command            | Description      |
| ------------------ | ---------------- |
| `/quit` or `/exit` | Exit LLxprt Code |

## Custom Commands

You can create your own slash commands by placing executable files in `~/.llxprt/commands/` or `.llxprt/commands/` in your project.

### How Custom Commands Work

When you type `/mycommand`, LLxprt looks for a matching executable in the commands directories. The command receives arguments and can return text that gets injected into the conversation.

**Execution flow:**

1. User types `/mycommand some arguments`
2. LLxprt finds `~/.llxprt/commands/mycommand` (or `.llxprt/commands/mycommand`)
3. Runs the executable with the arguments
4. The command's stdout is sent to the model as context

### Creating a Command

Create an executable file in your commands directory:

```bash
mkdir -p ~/.llxprt/commands
cat > ~/.llxprt/commands/git-diff << 'EOF'
#!/bin/bash
git diff --stat
EOF
chmod +x ~/.llxprt/commands/git-diff
```

Now `/git-diff` will show your git changes and send the output to the model.

### Command Format

Custom commands must output **valid JSON** with this structure:

```json
{
  "role": "user",
  "parts": [
    {
      "text": "The content to inject into the conversation"
    }
  ]
}
```

For simple text output, the wrapper is straightforward:

```bash
#!/bin/bash
OUTPUT=$(git diff --stat 2>&1)
echo "{\"role\": \"user\", \"parts\": [{\"text\": \"$OUTPUT\"}]}"
```

### Precedence

If a custom command has the same name as a built-in command, the built-in takes precedence. If the same command exists in both project and user directories, the project version wins.

Extension commands use the format `/<extension-name>/<command-name>` to avoid conflicts.

## At Commands (`@`)

At commands include file content in your prompt. Type `@` followed by a file path:

```
@src/main.ts explain this file
@docs/README.md what does this project do?
```

Features:

- **Tab completion** — press Tab after `@` to browse files
- **Glob patterns** — `@src/**/*.test.ts` includes multiple files
- **Directory inclusion** — `@src/utils/` includes all files in the directory
- **Respects .gitignore** — ignored files are excluded from completion and glob expansion

If a file path is invalid or the file doesn't exist, LLxprt shows an error and the content is not included.

## Shell Passthrough (`!`)

Prefix a command with `!` to run it in your shell and include the output in the conversation:

```
!ls -la
!git log --oneline -5
!cat package.json
```

The command runs, its output is displayed, and the output is sent to the model as context. This is useful for giving the model information about your project state without using a tool call.
