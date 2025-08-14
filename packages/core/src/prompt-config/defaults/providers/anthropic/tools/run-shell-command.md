# run_shell_command Tool

**Parameters**:

- `command`: The shell command to execute (required)
- `description`: Brief explanation of what the command does (optional but recommended)

## Usage Guidelines

**Before destructive operations**: Briefly explain what the command will do (delete files, modify system state, etc.)

**Background processes**: Add `&` for long-running processes:

```
command: "npm start &"
```

**Non-interactive**: Use non-interactive flags when available:

- `npm init -y` instead of `npm init`
- `apt-get install -y` instead of `apt-get install`

## Output Handling

The tool returns:

- Stdout: Command output
- Stderr: Error output
- Exit Code: Process exit code
- Signal: If terminated by signal

Check exit codes to verify success before proceeding with dependent operations.
