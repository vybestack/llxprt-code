# Shell Tool (`run_shell_command`)

This document describes the `run_shell_command` tool for the LLxprt Code.

## Description

Use `run_shell_command` to interact with the underlying system, run scripts, or perform command-line operations. When `shouldUseNodePtyShell` is `true` (the **Enable Interactive Shell (node-pty)** toggle in `/settings`), fully interactive programs (such as `vim` or `git rebase -i`) are supported; otherwise the command runs non-interactively. Legacy settings that use `tools.shell.enableInteractiveShell` continue to work and are migrated automatically.

On Windows commands run via `cmd.exe /c`. On macOS/Linux they run via `bash -c`.

### Arguments

`run_shell_command` takes the following arguments:

- `command` (string, required): The exact shell command to execute.
- `description` (string, optional): A brief description of the command's purpose, which will be shown to the user.
- `directory` (string, optional): The directory (relative to the project root) in which to execute the command. If not provided, the command runs in the project root.

## How to use `run_shell_command` with the LLxprt Code

When using `run_shell_command`, the command is executed as a subprocess. `run_shell_command` can start background processes using `&`. The tool returns detailed information about the execution, including:

- `Command`: The command that was executed.
- `Directory`: The directory where the command was run.
- `Stdout`: Output from the standard output stream.
- `Stderr`: Output from the standard error stream.
- `Error`: Any error message reported by the subprocess.
- `Exit Code`: The exit code of the command.
- `Signal`: The signal number if the command was terminated by a signal.
- `Background PIDs`: A list of PIDs for any background processes started.

Usage:

```
run_shell_command(command="Your commands.", description="Your description of the command.", directory="Your execution directory.")
```

## `run_shell_command` examples

List files in the current directory:

```
run_shell_command(command="ls -la")
```

Run a script in a specific directory:

```
run_shell_command(command="./my_script.sh", directory="scripts", description="Run my custom script")
```

Start a background server:

```
run_shell_command(command="npm run dev &", description="Start development server in background")
```

## Configuration

You can tune the `run_shell_command` tool by editing `settings.json` or by using `/settings` inside the LLxprt CLI.

### Enabling Interactive Commands

Set `shouldUseNodePtyShell` to `true` (or flip **Settings → Shell → Enable Interactive Shell (node-pty)**) to run commands inside a `node-pty` session (needed for editors, TUIs, etc.). If `node-pty` cannot be loaded, the CLI automatically falls back to the non-interactive `child_process` implementation. Legacy `tools.shell.enableInteractiveShell` entries in existing settings files are still honored.

```json
{
  "shouldUseNodePtyShell": true
}
```

### Showing Color in Output

Set `tools.shell.showColor` to `true` to stream ANSI color data back to the CLI. This option only takes effect when interactive shell support is enabled.

```json
{
  "tools": {
    "shell": {
      "enableInteractiveShell": true,
      "showColor": true
    }
  }
}
```

### Setting the Pager

You can use a custom pager (default is `cat`) by setting `tools.shell.pager`. This also requires `enableInteractiveShell` to be enabled.

```json
{
  "tools": {
    "shell": {
      "enableInteractiveShell": true,
      "pager": "less"
    }
  }
}
```

## Interactive Commands

With a PTY enabled, `run_shell_command` supports fully interactive programs (for example `vim`, `htop`, or `git rebase -i`). While an interactive session is active you can press `Ctrl+F` to focus the shell pane, and LLxprt will render the TUI output.

## Important notes

- **Security:** Be cautious when executing commands, especially those constructed from user input, to prevent security vulnerabilities.
- **Interactive commands:** Avoid commands that require interactive user input, as this can cause the tool to hang. Use non-interactive flags if available (e.g., `npm init -y`).
- **Output limiting:** In `truncate` mode, `run_shell_command` clips the output by removing the middle to preserve both head and tail. In `warn` and `sample`, it uses the default limiter behavior.
- **Error handling:** Check the `Stderr`, `Error`, and `Exit Code` fields to determine if a command executed successfully.
- **Background processes:** When a command is run in the background with `&`, the tool will return immediately and the process will continue to run in the background. The `Background PIDs` field will contain the process ID of the background process.

## Environment Variables

When `run_shell_command` executes a command, it sets the `LLXPRT_CODE=1` environment variable in the subprocess's environment. This allows scripts or tools to detect if they are being run from within the LLxprt Code CLI.

## Command Restrictions

You can restrict the commands that can be executed by the `run_shell_command` tool by using the `coreTools` and `excludeTools` settings in your configuration file.

- `coreTools`: To restrict `run_shell_command` to a specific set of commands, add entries to the `coreTools` list in the format `run_shell_command(<command>)`. For example, `"coreTools": ["run_shell_command(git)"]` will only allow `git` commands. Including the generic `run_shell_command` acts as a wildcard, allowing any command not explicitly blocked.
- `excludeTools`: To block specific commands, add entries to the `excludeTools` list in the format `run_shell_command(<command>)`. For example, `"excludeTools": ["run_shell_command(rm)"]` will block `rm` commands.

The validation logic is designed to be secure and flexible:

1.  **Command Chaining Disabled**: The tool automatically splits commands chained with `&&`, `||`, or `;` and validates each part separately. If any part of the chain is disallowed, the entire command is blocked.
2.  **Prefix Matching**: The tool uses prefix matching. For example, if you allow `git`, you can run `git status` or `git log`.
3.  **Blocklist Precedence**: The `excludeTools` list is always checked first. If a command matches a blocked prefix, it will be denied, even if it also matches an allowed prefix in `coreTools`.

### Command Restriction Examples

**Allow only specific command prefixes**

To allow only `git` and `npm` commands, and block all others:

```json
{
  "coreTools": ["run_shell_command(git)", "run_shell_command(npm)"]
}
```

- `git status`: Allowed
- `npm install`: Allowed
- `ls -l`: Blocked

**Block specific command prefixes**

To block `rm` and allow all other commands:

```json
{
  "coreTools": ["run_shell_command"],
  "excludeTools": ["run_shell_command(rm)"]
}
```

- `rm -rf /`: Blocked
- `git status`: Allowed
- `npm install`: Allowed

**Blocklist takes precedence**

If a command prefix is in both `coreTools` and `excludeTools`, it will be blocked.

```json
{
  "coreTools": ["run_shell_command(git)"],
  "excludeTools": ["run_shell_command(git push)"]
}
```

- `git push origin main`: Blocked
- `git status`: Allowed

**Block all shell commands**

To block all shell commands, add the `run_shell_command` wildcard to `excludeTools`:

```json
{
  "excludeTools": ["run_shell_command"]
}
```

- `ls -l`: Blocked
- `any other command`: Blocked

## Security Note for `excludeTools`

Command-specific restrictions in
`excludeTools` for `run_shell_command` are based on simple string matching and can be easily bypassed. This feature is **not a security mechanism** and should not be relied upon to safely execute untrusted code. It is recommended to use `coreTools` to explicitly select commands
that can be executed.
