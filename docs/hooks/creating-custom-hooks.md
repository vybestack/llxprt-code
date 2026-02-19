# Creating Custom Hooks

This tutorial walks you through creating custom hooks for LLxprt Code, from simple scripts to advanced use cases.

## Prerequisites

- LLxprt Code installed and configured
- Basic knowledge of bash or Python scripting
- Understanding of JSON

## Tutorial 1: Your First Hook - Security Policy

Let's create a hook that blocks writes to sensitive directories.

### Step 1: Create the Hook Directory

```bash
mkdir -p ~/.llxprt/hooks
```

### Step 2: Write the Hook Script

Create `~/.llxprt/hooks/block-sensitive-writes.sh`:

```bash
#!/bin/bash
#
# BeforeTool hook: Block writes to sensitive directories
#
# Input: JSON with tool_name, tool_input, session_id, etc.
# Output: JSON with decision and optional reason
#

# Read all input from stdin
INPUT=$(cat)

# Parse the tool name
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only check write operations
if [[ "$TOOL_NAME" != "write_file" && "$TOOL_NAME" != "edit" ]]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Get the target path
if [[ "$TOOL_NAME" == "write_file" ]]; then
  TARGET_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // empty')
else
  TARGET_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
fi

# Define sensitive directories
SENSITIVE_DIRS=("/etc" "/var" "/usr" "/System" "/Library")

# Check if path is in a sensitive directory
for DIR in "${SENSITIVE_DIRS[@]}"; do
  if [[ "$TARGET_PATH" == "$DIR"* ]]; then
    echo "{\"decision\": \"deny\", \"reason\": \"Writing to $DIR is prohibited by security policy\"}"
    exit 2
  fi
done

# Allow all other writes
echo '{"decision": "allow"}'
exit 0
```

Make it executable:

```bash
chmod +x ~/.llxprt/hooks/block-sensitive-writes.sh
```

### Step 3: Configure the Hook

Add to `~/.llxprt/settings.json`:

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.llxprt/hooks/block-sensitive-writes.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

### Step 4: Test It

Run LLxprt Code and try to write to a sensitive directory:

```
You: Write "test" to /etc/test.txt

LLxprt: I cannot complete this request. The security policy blocks writes to /etc.
```

## Tutorial 2: Audit Logging Hook

Create a hook that logs all tool executions.

### Create the Script

`~/.llxprt/hooks/audit-log.sh`:

```bash
#!/bin/bash
#
# AfterTool hook: Log all tool executions
#

INPUT=$(cat)

# Extract relevant fields
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input')
TOOL_RESPONSE=$(echo "$INPUT" | jq -c '.tool_response')

# Log to file
LOG_FILE="${HOME}/.llxprt/audit.log"
echo "{\"timestamp\": \"$TIMESTAMP\", \"session\": \"$SESSION_ID\", \"tool\": \"$TOOL_NAME\", \"input\": $TOOL_INPUT, \"response\": $TOOL_RESPONSE}" >> "$LOG_FILE"

# Always allow - this is just logging
echo '{"decision": "allow"}'
exit 0
```

### Configure It

```json
{
  "hooks": {
    "AfterTool": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.llxprt/hooks/audit-log.sh"
          }
        ]
      }
    ]
  }
}
```

## Tutorial 3: Tool Input Modification

Create a hook that automatically adds safety flags to shell commands.

### Create the Script

`~/.llxprt/hooks/safe-shell.sh`:

```bash
#!/bin/bash
#
# BeforeTool hook: Add safety flags to dangerous commands
#

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

# Only modify shell commands
if [[ "$TOOL_NAME" != "run_shell_command" ]]; then
  echo '{"decision": "allow"}'
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Add safety flags for rm commands
if [[ "$COMMAND" == rm\ * ]]; then
  # Add -i (interactive) flag if not present
  if [[ "$COMMAND" != *"-i"* && "$COMMAND" != *"--interactive"* ]]; then
    SAFE_COMMAND=$(echo "$COMMAND" | sed 's/^rm /rm -i /')
    echo "{\"decision\": \"allow\", \"hookSpecificOutput\": {\"tool_input\": {\"command\": \"$SAFE_COMMAND\"}}}"
    exit 0
  fi
fi

# Add --dry-run for rsync if not present
if [[ "$COMMAND" == rsync\ * && "$COMMAND" != *"--dry-run"* ]]; then
  SAFE_COMMAND=$(echo "$COMMAND" | sed 's/^rsync /rsync --dry-run /')
  echo "{\"decision\": \"allow\", \"hookSpecificOutput\": {\"tool_input\": {\"command\": \"$SAFE_COMMAND\"}}}"
  exit 0
fi

echo '{"decision": "allow"}'
exit 0
```

## Tutorial 4: Python Hook - Rate Limiting

Create a Python hook that implements rate limiting for API calls.

### Create the Script

`~/.llxprt/hooks/rate-limit.py`:

```python
#!/usr/bin/env python3
"""
BeforeModel hook: Rate limit LLM calls
"""
import json
import sys
import os
import time
from pathlib import Path

# Rate limit config
MAX_CALLS_PER_MINUTE = 10
STATE_FILE = Path.home() / '.llxprt' / '.rate-limit-state.json'

def load_state():
    """Load call history from state file."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {'calls': []}

def save_state(state):
    """Save call history to state file."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f)

def main():
    # Read input
    input_data = json.load(sys.stdin)

    # Load state
    state = load_state()
    now = time.time()

    # Remove calls older than 1 minute
    state['calls'] = [t for t in state['calls'] if now - t < 60]

    # Check rate limit
    if len(state['calls']) >= MAX_CALLS_PER_MINUTE:
        wait_time = int(60 - (now - state['calls'][0]))
        print(json.dumps({
            'continue': False,
            'reason': f'Rate limit exceeded. Please wait {wait_time} seconds.'
        }))
        sys.exit(2)

    # Record this call
    state['calls'].append(now)
    save_state(state)

    # Allow
    print(json.dumps({'continue': True}))
    sys.exit(0)

if __name__ == '__main__':
    main()
```

Make it executable:

```bash
chmod +x ~/.llxprt/hooks/rate-limit.py
```

### Configure It

```json
{
  "hooks": {
    "BeforeModel": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.llxprt/hooks/rate-limit.py",
            "timeout": 2000
          }
        ]
      }
    ]
  }
}
```

## Tutorial 5: Tool Selection Restriction

Limit which tools are available based on context.

### Create the Script

`~/.llxprt/hooks/restrict-tools.sh`:

```bash
#!/bin/bash
#
# BeforeToolSelection hook: Restrict tools based on directory
#

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd')

# In production directories, only allow read operations
if [[ "$CWD" == */production/* || "$CWD" == */prod/* ]]; then
  echo '{
    "hookSpecificOutput": {
      "toolConfig": {
        "mode": "AUTO",
        "allowedFunctionNames": ["read_file", "read_many_files", "glob", "search_file_content", "list_directory"]
      }
    }
  }'
  exit 0
fi

# In test directories, allow everything
echo '{"decision": "allow"}'
exit 0
```

### Configure It

```json
{
  "hooks": {
    "BeforeToolSelection": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.llxprt/hooks/restrict-tools.sh"
          }
        ]
      }
    ]
  }
}
```

## Tutorial 6: Multiple Hooks with Matchers

Configure different hooks for different tools.

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.llxprt/hooks/validate-writes.sh"
          }
        ]
      },
      {
        "matcher": "run_shell_command",
        "hooks": [
          {
            "type": "command",
            "command": "~/.llxprt/hooks/validate-shell.sh"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.llxprt/hooks/audit-all.sh"
          }
        ]
      }
    ]
  }
}
```

In this configuration:

- `validate-writes.sh` runs only for `write_file`, `write_many_files`, etc.
- `validate-shell.sh` runs only for shell commands
- `audit-all.sh` runs for ALL tools (no matcher)

## Best Practices

### 1. Keep Hooks Fast

Hooks run synchronously. Slow hooks delay the entire operation.

```bash
# BAD: Slow network call
curl https://api.example.com/validate ...

# GOOD: Local check with timeout
timeout 1 ./quick-check.sh
```

### 2. Exit Early

Don't do unnecessary work:

```bash
# Check if we care about this tool first
if [[ "$TOOL_NAME" != "write_file" ]]; then
  echo '{"decision": "allow"}'
  exit 0  # Early exit
fi

# Now do the expensive check
```

### 3. Handle Errors Gracefully

```bash
# Validate input
if ! echo "$INPUT" | jq empty 2>/dev/null; then
  echo '{"decision": "allow"}'  # Default to allow on parse error
  exit 0
fi
```

### 4. Use Structured Logging

```python
import logging
import sys
import os

logging.basicConfig(
    filename=os.path.expanduser('~/.llxprt/hooks/debug.log'),
    level=logging.DEBUG
)

# Log to file, not stdout (stdout is for hook output)
logging.info(f"Processing {input_data.get('tool_name')}")
```

### 5. Test Your Hooks

Create a test script:

```bash
#!/bin/bash
# test-hook.sh

echo '{"tool_name": "write_file", "tool_input": {"path": "/etc/test"}}' | \
  ~/.llxprt/hooks/block-sensitive-writes.sh

echo "Exit code: $?"
```

## Common Patterns

### Allow by Default, Deny Specific

```bash
# Deny list approach
case "$TOOL_NAME" in
  run_shell_command)
    # Extra scrutiny for shell
    if is_dangerous_command "$COMMAND"; then
      exit 2
    fi
    ;;
esac

echo '{"decision": "allow"}'
exit 0
```

### Deny by Default, Allow Specific

```bash
# Allow list approach
case "$TOOL_NAME" in
  read_file|list_directory|glob)
    echo '{"decision": "allow"}'
    exit 0
    ;;
esac

echo '{"decision": "deny", "reason": "Tool not in allowlist"}'
exit 2
```

### Conditional Based on Session

```python
import os

# Check if running in CI
if os.environ.get('CI'):
    # More permissive in CI
    print('{"decision": "allow"}')
else:
    # Stricter locally
    # ... validation logic
```

## Troubleshooting

### Hook Not Running

1. Check the hook is executable: `ls -la ~/.llxprt/hooks/`
2. Check settings.json syntax: `jq . ~/.llxprt/settings.json`
3. Enable debug: `DEBUG=llxprt:core:hooks:* llxprt`

### Hook Output Not Parsed

1. Ensure output is valid JSON: `echo '{"test": 1}' | jq .`
2. Don't mix stdout logging with JSON output
3. Check for stderr output that might confuse parsing

### Hook Times Out

1. Check timeout setting in config
2. Profile your hook to find slow parts
3. Consider async patterns for slow operations
   operations
