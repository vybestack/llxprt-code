# CLI Commands

LLxprt Code supports three kinds of inline commands: **slash commands** (`/`), **at commands** (`@`), and **shell passthrough** (`!`).

Type `/` at the prompt to see available commands with tab completion.

## Slash Commands

Slash commands control the CLI itself — configuration, navigation, session management, and tools.

### Provider and Model

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `/provider [name]`     | Switch provider (e.g., `/provider kimi`) |
| `/model [name]`        | Switch model (e.g., `/model grok-4`)     |
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

- **`/quit`** (or **`/exit`**)
  - **Description:** Exit LLxprt Code.

- **`/vim`**
  - **Description:** Toggle vim mode on or off. When vim mode is enabled, the input area supports vim-style navigation and editing commands in both NORMAL and INSERT modes.
  - **Features:**
    - **NORMAL mode:** Navigate with `h`, `j`, `k`, `l`; jump by words with `w`, `b`, `e`; go to line start/end with `0`, `$`, `^`; go to specific lines with `G` (or `gg` for first line)
    - **INSERT mode:** Standard text input with escape to return to NORMAL mode
    - **Editing commands:** Delete with `x`, change with `c`, insert with `i`, `a`, `o`, `O`; complex operations like `dd`, `cc`, `dw`, `cw`
    - **Count support:** Prefix commands with numbers (e.g., `3h`, `5w`, `10G`)
    - **Repeat last command:** Use `.` to repeat the last editing operation
    - **Persistent setting:** Vim mode preference is saved to `~/.llxprt/settings.json` and restored between sessions
  - **Status indicator:** When enabled, shows `[NORMAL]` or `[INSERT]` in the footer

- **`/init`**
  - **Description:** To help users easily create a `LLXPRT.md` file, this command analyzes the current directory and generates a tailored context file, making it simpler for them to provide project-specific instructions to the agent.

### Custom Commands

For a quick start, see the [example](#example-a-pure-function-refactoring-command) below.

Custom commands allow you to save and reuse your favorite or most frequently used prompts as personal shortcuts within LLxprt Code. You can create commands that are specific to a single project or commands that are available globally across all your projects, streamlining your workflow and ensuring consistency.

#### File Locations & Precedence

LLxprt Code discovers commands from two locations, loaded in a specific order:

1.  **User Commands (Global):** Located in `~/.llxprt/commands/`. These commands are available in any project you are working on.
2.  **Project Commands (Local):** Located in `<your-project-root>/.llxprt/commands/`. These commands are specific to the current project and can be checked into version control to be shared with your team.

If a command in the project directory has the same name as a command in the user directory, the **project command will always be used.** This allows projects to override global commands with project-specific versions.

#### Naming and Namespacing

The name of a command is determined by its file path relative to its `commands` directory. Subdirectories are used to create namespaced commands, with the path separator (`/` or `\`) being converted to a colon (`:`).

- A file at `~/.llxprt/commands/test.toml` becomes the command `/test`.
- A file at `<project>/.llxprt/commands/git/commit.toml` becomes the namespaced command `/git:commit`.

#### TOML File Format (v1)

Your command definition files must be written in the TOML format and use the `.toml` file extension.

##### Required Fields

- `prompt` (String): The prompt that will be sent to the active model when the command is executed. This can be a single-line or multi-line string.

##### Optional Fields

- `description` (String): A brief, one-line description of what the command does. This text will be displayed next to your command in the `/help` menu. **If you omit this field, a generic description will be generated from the filename.**

#### Handling Arguments

Custom commands support two powerful methods for handling arguments. The CLI automatically chooses the correct method based on the content of your command's `prompt`.

##### 1. Context-Aware Injection with `{{args}}`

If your `prompt` contains the special placeholder `{{args}}`, the CLI will replace that placeholder with the text the user typed after the command name.

The behavior of this injection depends on where it is used:

**A. Raw Injection (Outside Shell Commands)**

When used in the main body of the prompt, the arguments are injected exactly as the user typed them.

**Example (`git/fix.toml`):**

```toml
# Invoked via: /git:fix "Button is misaligned"

description = "Generates a fix for a given issue."
prompt = "Please provide a code fix for the issue described here: {{args}}."
```

The model receives: `Please provide a code fix for the issue described here: "Button is misaligned".`

**B. Using Arguments in Shell Commands (Inside `!{...}` Blocks)**

When you use `{{args}}` inside a shell injection block (`!{...}`), the arguments are automatically **shell-escaped** before replacement. This allows you to safely pass arguments to shell commands, ensuring the resulting command is syntactically correct and secure while preventing command injection vulnerabilities.

<!-- @plan PLAN-20250219-GMERGE021.R9.P03 -->

**Example (custom command TOML):**

```toml
prompt = """
Please summarize the findings for the pattern `{{args}}`.

Search Results:
!{grep -r {{args}} .}
"""
```

When you run `/my-command It's complicated`:

1. The CLI sees `{{args}}` used both outside and inside `!{...}`.
2. Outside: The first `{{args}}` is replaced raw with `It's complicated`.
3. Inside: The second `{{args}}` is replaced with the escaped version (e.g., on Linux: `"It's complicated"`).
4. The command executed is `grep -r "It's complicated" .`.
5. The CLI prompts you to confirm this exact, secure command before execution.
6. The final prompt is sent.

##### 2. Default Argument Handling

If your `prompt` does **not** contain the special placeholder `{{args}}`, the CLI uses a default behavior for handling arguments.

If you provide arguments to the command (e.g., `/mycommand arg1`), the CLI will append the full command you typed to the end of the prompt, separated by two newlines. This allows the model to see both the original instructions and the specific arguments you just provided.

If you do **not** provide any arguments (e.g., `/mycommand`), the prompt is sent to the model exactly as it is, with nothing appended.

**Example (`changelog.toml`):**

This example shows how to create a robust command by defining a role for the model, explaining where to find the user's input, and specifying the expected format and behavior.

```toml
# In: <project>/.llxprt/commands/changelog.toml
# Invoked via: /changelog 1.2.0 added "Support for default argument parsing."

description = "Adds a new entry to the project's CHANGELOG.md file."
prompt = """
# Task: Update Changelog

You are an expert maintainer of this software project. A user has invoked a command to add a new entry to the changelog.

**The user's raw command is appended below your instructions.**

Your task is to parse the `<version>`, `<change_type>`, and `<message>` from their input and use the `write_file` tool to correctly update the `CHANGELOG.md` file.

## Expected Format
The command follows this format: `/changelog <version> <type> <message>`
- `<type>` must be one of: "added", "changed", "fixed", "removed".

## Behavior
1. Read the `CHANGELOG.md` file.
2. Find the section for the specified `<version>`.
3. Add the `<message>` under the correct `<type>` heading.
4. If the version or type section doesn't exist, create it.
5. Adhere strictly to the "Keep a Changelog" format.
"""
```

When you run `/changelog 1.2.0 added "New feature"`, the final text sent to the model will be the original prompt followed by two newlines and the command you typed.

##### 3. Executing Shell Commands with `!{...}`

You can make your commands dynamic by executing shell commands directly within your `prompt` and injecting their output. This is ideal for gathering context from your local environment, like reading file content or checking the status of Git.

When a custom command attempts to execute a shell command, LLxprt Code will now prompt you for confirmation before proceeding. This is a security measure to ensure that only intended commands can be run.

**How It Works:**

1.  **Inject Commands:** Use the `!{...}` syntax.
2.  **Argument Substitution:** If `{{args}}` is present inside the block, it is automatically shell-escaped (see [Context-Aware Injection](#1-context-aware-injection-with-args) above).
3.  **Robust Parsing:** The parser correctly handles complex shell commands that include nested braces, such as JSON payloads.
4.  **Security Check and Confirmation:** The CLI performs a security check on the final, resolved command (after arguments are escaped and substituted). A dialog will appear showing the exact command(s) to be executed.
5.  **Execution and Error Reporting:** The command is executed. If the command fails, the output injected into the prompt will include the error messages (stderr) followed by a status line, e.g., `[Shell command exited with code 1]`. This helps the model understand the context of the failure.

**Example (`git/commit.toml`):**

This command gets the staged git diff and uses it to ask the model to write a commit message.

````toml
# In: <project>/.llxprt/commands/git/commit.toml
# Invoked via: /git:commit

description = "Generates a Git commit message based on staged changes."

# The prompt uses !{...} to execute the command and inject its output.
prompt = """
Please generate a Conventional Commit message based on the following git diff:

```diff
!{git diff --staged}
```

"""

````

When you run `/git:commit`, the CLI first executes `git diff --staged`, then replaces `!{git diff --staged}` with the output of that command before sending the final, complete prompt to the model.

---

#### Example: A "Pure Function" Refactoring Command

Let's create a global command that asks the model to refactor a piece of code.

**1. Create the file and directories:**

First, ensure the user commands directory exists, then create a `refactor` subdirectory for organization and the final TOML file.

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
