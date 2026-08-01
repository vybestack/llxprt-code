# Writing hooks for LLxprt Code

This tutorial walks you through creating hooks — external scripts that LLxprt
Code runs at key points during execution to enforce policies, modify tool
inputs, log activity, and add context. You will go from a minimal logging hook
to advanced patterns that combine multiple hook events.

## Goal and audience

You are a developer, administrator, or power user who wants to extend LLxprt
Code beyond its built-in behavior. After finishing this tutorial you will be
able to write, configure, test, and troubleshoot hook scripts that block
operations, modify tool calls, restrict the available tools, and inject
context into the conversation.

For the complete type definitions, event inputs, output fields, and exit-code
semantics, see the [API Reference](api-reference.md). For security, performance,
and privacy guidance, see [Best Practices](best-practices.md).

## Prerequisites

- **Node.js 24+** — required to run LLxprt Code itself.
- LLxprt Code installed and configured.
- Basic familiarity with shell scripting (bash) or Python.
- Comfort reading and writing JSON.

Hooks are **disabled by default**. Before any hook you configure will run, you
must enable the hook system. Add the following to your
[user `settings.json`](../reference/application-directories.md):

```json
{
  "hooksConfig": {
    "enabled": true
  }
}
```

There is also an experimental gate (`tools.enableHooks`) that defaults to
`true`. Both `hooksConfig.enabled` and `tools.enableHooks` must be `true` for
hooks to execute.

> **Note:** The `hooks.enabled` key is a legacy form. LLxprt Code migrates it
> to `hooksConfig.enabled` automatically, but prefer the canonical key going
> forward.

## Quick start

Create a minimal hook that logs every tool execution. This is the fastest way
to confirm hooks are wired up correctly.

### 1. Write the hook script

Hook scripts can live anywhere on your system — the `command` field accepts
any path. The examples below keep scripts under your project's workspace-local
`.llxprt/hooks/` directory so they are easy to share via version control. You
may equally keep scripts under LLxprt's
[config directory](../reference/application-directories.md) or any other
directory you prefer.

```bash
mkdir -p .llxprt/hooks
cat > .llxprt/hooks/log-tools.sh << 'EOF'
#!/usr/bin/env bash
# Read JSON input from stdin
input=$(cat)

# Extract the tool name
tool_name=$(echo "$input" | jq -r '.tool_name')

# Log to a file
echo "[$(date)] Tool executed: $tool_name" >> .llxprt/tool-log.txt

# Return success (exit 0) — stdout is shown to the user in transcript mode
echo "Logged: $tool_name"
EOF

chmod +x .llxprt/hooks/log-tools.sh
```

### 2. Configure the hook

Add the hook to `.llxprt/settings.json` (project-level) or your user-level
`settings.json`:

```json
{
  "hooks": {
    "AfterTool": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "tool-logger",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/log-tools.sh",
            "description": "Log all tool executions"
          }
        ]
      }
    ]
  }
}
```

### 3. Test the hook

Run LLxprt Code and ask it to perform any tool-based action:

```
> Read the README.md file

[Agent uses the read_file tool]

Logged: read_file
```

Check `.llxprt/tool-log.txt` to see the logged tool executions. If nothing
appears, see [Troubleshooting](#troubleshooting) below.

## How hooks work

Every hook is a command (typically a shell script) that receives JSON input on
**stdin** and returns JSON output on **stdout**. Based on the exit code and the
JSON output, LLxprt Code can block an operation, modify a tool input, inject
context, or simply continue.

### Exit codes

| Exit code | Meaning                                              |
| --------- | ---------------------------------------------------- |
| `0`       | Success — execution continues.                       |
| `1`       | Non-blocking error (warning) — execution continues.  |
| `2`       | Blocking error — the operation is blocked or denied. |

When stdout is not valid JSON, LLxprt Code converts the plain text to a
structured output: exit 0 becomes `{ "decision": "allow", "systemMessage": ... }`,
and exit 2 becomes `{ "decision": "deny", "reason": ... }`.

### The `$LLXPRT_PROJECT_DIR` variable

Hook commands support `$LLXPRT_PROJECT_DIR`, which expands to the current
working directory at runtime. This lets you reference project-relative paths
regardless of where LLxprt Code is launched from:

```json
{
  "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/my-hook.sh"
}
```

### Matcher patterns

Each `HookDefinition` accepts an optional `matcher` field that controls which
invocations the hook applies to:

- For **tool events** (`BeforeTool`, `AfterTool`), the matcher is tested
  against the tool name. It is treated as a regular expression; if the pattern
  is not valid regex, an exact string match is used instead.
- For **session events** (`SessionStart`, `SessionEnd`), the matcher is tested
  against the source or reason (for example, `startup`, `resume`, `clear`,
  `exit`).
- Omitting the matcher, or setting it to `""` or `"*"`, matches everything.

```json
{
  "matcher": "write_file|replace",
  "hooks": [ ... ]
}
```

For the full list of events and their input/output schemas, see the
[API Reference](api-reference.md).

## Step-by-step examples

The following examples cover the most common hook use cases. Each one is
self-contained: write the script, add the configuration block, and test.

### Block writes to sensitive directories

A `BeforeTool` hook that prevents writes to system directories.

**`.llxprt/hooks/block-sensitive-writes.sh`:**

```bash
#!/usr/bin/env bash
#
# BeforeTool hook: block writes to sensitive directories.
#
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty')

# Only check write operations
if [[ "$tool_name" != "write_file" && "$tool_name" != "replace" ]]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# write_file uses "path"; replace uses "file_path"
if [[ "$tool_name" == "write_file" ]]; then
  target_path=$(echo "$input" | jq -r '.tool_input.path // empty')
else
  target_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
fi

# Block writes to system directories
sensitive_dirs=("/etc" "/var" "/usr" "/System" "/Library")
for dir in "${sensitive_dirs[@]}"; do
  if [[ "$target_path" == "$dir"* ]]; then
    echo "{\"decision\": \"deny\", \"reason\": \"Writing to $dir is prohibited by security policy\"}"
    exit 2
  fi
done

echo '{"decision": "allow"}'
exit 0
```

**`.llxprt/settings.json`:**

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "name": "block-sensitive-writes",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/block-sensitive-writes.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

### Prevent committing secrets

A `BeforeTool` hook that scans file content for API keys and passwords before
writes.

**`.llxprt/hooks/block-secrets.sh`:**

```bash
#!/usr/bin/env bash
input=$(cat)

content=$(echo "$input" | jq -r '.tool_input.content // .tool_input.new_string // ""')

if echo "$content" | grep -qE 'api[_-]?key|password|secret'; then
  echo '{"decision":"deny","reason":"Potential secret detected"}' >&2
  exit 2
fi

exit 0
```

**`.llxprt/settings.json`:**

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "name": "secret-scanner",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/block-secrets.sh",
            "description": "Prevent writing files that contain secrets"
          }
        ]
      }
    ]
  }
}
```

> **Note:** For more robust secret-detection patterns (AWS keys, GitHub tokens,
> OpenAI keys), see the [secret-scanning guidance](best-practices.md#scan-for-secrets)
> in Best Practices.

### Audit-log all tool executions

An `AfterTool` hook that records every tool call to a log file.

**`.llxprt/hooks/audit-log.sh`:**

```bash
#!/usr/bin/env bash
#
# AfterTool hook: log all tool executions.
#
input=$(cat)

timestamp=$(echo "$input" | jq -r '.timestamp')
session_id=$(echo "$input" | jq -r '.session_id')
tool_name=$(echo "$input" | jq -r '.tool_name')
tool_input=$(echo "$input" | jq -c '.tool_input')
tool_response=$(echo "$input" | jq -c '.tool_response')

# Write to LLxprt's canonical log/state directory, or choose any path your
# policy requires.
log_dir="${LLXPRT_LOG_HOME:-${LLXPRT_CONFIG_HOME:-$HOME/.local/state/llxprt-code}}"
mkdir -p "$log_dir"
log_file="$log_dir/audit.log"
echo "{\"timestamp\": \"$timestamp\", \"session\": \"$session_id\", \"tool\": \"$tool_name\", \"input\": $tool_input, \"response\": $tool_response}" >> "$log_file"

exit 0
```

**`.llxprt/settings.json`:**

```json
{
  "hooks": {
    "AfterTool": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "audit-log",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/audit-log.sh"
          }
        ]
      }
    ]
  }
}
```

### Modify tool input (add safety flags)

A `BeforeTool` hook that automatically inserts the `-i` flag into `rm`
commands before they execute.

**`.llxprt/hooks/safe-shell.sh`:**

```bash
#!/usr/bin/env bash
#
# BeforeTool hook: add safety flags to dangerous shell commands.
#
input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name')

if [[ "$tool_name" != "run_shell_command" ]]; then
  exit 0
fi

command=$(echo "$input" | jq -r '.tool_input.command')

# Add -i (interactive) to rm if not already present
if [[ "$command" == rm\ * ]]; then
  if [[ "$command" != *"-i"* && "$command" != *"--interactive"* ]]; then
    safe_command=$(echo "$command" | sed 's/^rm /rm -i /')
    echo "{\"decision\": \"allow\", \"hookSpecificOutput\": {\"tool_input\": {\"command\": \"$safe_command\"}}}"
    exit 0
  fi
fi

exit 0
```

**`.llxprt/settings.json`:**

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "run_shell_command",
        "hooks": [
          {
            "name": "safe-shell",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/safe-shell.sh"
          }
        ]
      }
    ]
  }
}
```

### Restrict available tools by directory

A `BeforeToolSelection` hook that limits the model to read-only tools in
production directories.

**`.llxprt/hooks/restrict-tools.sh`:**

```bash
#!/usr/bin/env bash
#
# BeforeToolSelection hook: restrict tools based on working directory.
#
input=$(cat)
cwd=$(echo "$input" | jq -r '.cwd')

# In production directories, only allow read operations
if [[ "$cwd" == */production/* || "$cwd" == */prod/* ]]; then
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

exit 0
```

**`.llxprt/settings.json`:**

```json
{
  "hooks": {
    "BeforeToolSelection": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "restrict-tools",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/restrict-tools.sh"
          }
        ]
      }
    ]
  }
}
```

### Rate-limit model calls

A Python `BeforeModel` hook that enforces a maximum number of LLM calls per
minute.

**`.llxprt/hooks/rate-limit.py`:**

```python
#!/usr/bin/env python3
"""
BeforeModel hook: rate-limit LLM calls.
"""
import json
import sys
import time
from pathlib import Path

MAX_CALLS_PER_MINUTE = 10
STATE_FILE = Path.home() / '.llxprt-rate-limit-state.json'


def load_state():
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {'calls': []}


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f)


def main():
    json.load(sys.stdin)  # read and discard input

    state = load_state()
    now = time.time()

    # Drop calls older than 60 seconds
    state['calls'] = [t for t in state['calls'] if now - t < 60]

    if len(state['calls']) >= MAX_CALLS_PER_MINUTE:
        wait_time = int(60 - (now - state['calls'][0]))
        print(json.dumps({
            'continue': False,
            'stopReason': f'Rate limit exceeded. Please wait {wait_time} seconds.'
        }))
        sys.exit(2)

    state['calls'].append(now)
    save_state(state)

    print(json.dumps({'continue': True}))
    sys.exit(0)


if __name__ == '__main__':
    main()
```

Make it executable:

```bash
chmod +x .llxprt/hooks/rate-limit.py
```

**`.llxprt/settings.json`:**

```json
{
  "hooks": {
    "BeforeModel": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "rate-limit",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/rate-limit.py",
            "timeout": 2000
          }
        ]
      }
    ]
  }
}
```

### Inject dynamic context

A `BeforeAgent` hook that adds recent git history to the conversation before
the model processes the prompt.

**`.llxprt/hooks/inject-context.sh`:**

```bash
#!/usr/bin/env bash

context=$(git log -5 --oneline 2>/dev/null || echo "No git history")

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "BeforeAgent",
    "additionalContext": "Recent commits:\\n$context"
  }
}
EOF
```

**`.llxprt/settings.json`:**

```json
{
  "hooks": {
    "BeforeAgent": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "git-context",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/inject-context.sh",
            "description": "Inject recent git commit history"
          }
        ]
      }
    ]
  }
}
```

### Run tests after code changes

An `AfterTool` hook that automatically runs the test file corresponding to a
source file you just edited.

**`.llxprt/hooks/auto-test.sh`:**

```bash
#!/usr/bin/env bash
input=$(cat)

file_path=$(echo "$input" | jq -r '.tool_input.file_path')

# Only test .ts files
if [[ ! "$file_path" =~ \.ts$ ]]; then
  exit 0
fi

test_file="${file_path%.ts}.test.ts"

if [ ! -f "$test_file" ]; then
  echo "No test file found for $file_path"
  exit 0
fi

if npx vitest run "$test_file" --silent 2>&1 | head -20; then
  echo "Tests passed"
else
  echo "Tests failed"
fi

exit 0
```

**`.llxprt/settings.json`:**

```json
{
  "hooks": {
    "AfterTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "name": "auto-test",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/auto-test.sh",
            "description": "Run tests after code changes"
          }
        ]
      }
    ]
  }
}
```

## Advanced patterns

### Multiple hooks with matchers

You can configure different hooks for different tools within the same event.
Hooks without a matcher run for every invocation.

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "name": "validate-writes",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/validate-writes.sh"
          }
        ]
      },
      {
        "matcher": "run_shell_command",
        "hooks": [
          {
            "name": "validate-shell",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/validate-shell.sh"
          }
        ]
      },
      {
        "hooks": [
          {
            "name": "audit-all",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/audit-all.sh"
          }
        ]
      }
    ]
  }
}
```

In this configuration:

- `validate-writes.sh` runs only for `write_file` and `replace`.
- `validate-shell.sh` runs only for `run_shell_command`.
- `audit-all.sh` runs for every tool (no matcher).

### Sequential hook chaining

Multiple hooks for the same event run in parallel by default. Set
`"sequential": true` on a `HookDefinition` to run its hooks one after another,
where each hook can build on the previous hook's output:

```json
{
  "hooks": {
    "BeforeAgent": [
      {
        "matcher": "*",
        "sequential": true,
        "hooks": [
          {
            "name": "load-memories",
            "type": "command",
            "command": "./hooks/load-memories.sh"
          },
          {
            "name": "analyze-sentiment",
            "type": "command",
            "command": "./hooks/analyze-sentiment.sh"
          }
        ]
      }
    ]
  }
}
```

When `sequential` is `true`, a hook's `hookSpecificOutput` modifications (for
example, `tool_input` on `BeforeTool`, `additionalContext` on `BeforeAgent`,
or `llm_request` on `BeforeModel`) are applied to the input passed to the next
hook in the chain.

> **Note:** If **any** `HookDefinition` in an event has `sequential: true`,
> **all** hooks for that event run sequentially.

### Combining events: a complete workflow

The following configuration wires hooks across the full session lifecycle. This
is a reference for how events fit together — each script would contain your own
logic. See the individual examples above for the script bodies.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "name": "init",
            "type": "command",
            "command": "node $LLXPRT_PROJECT_DIR/.llxprt/hooks/init.js",
            "description": "Initialize session state"
          }
        ]
      }
    ],
    "BeforeAgent": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "inject-context",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/inject-context.sh"
          }
        ]
      }
    ],
    "BeforeToolSelection": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "restrict-tools",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/restrict-tools.sh"
          }
        ]
      }
    ],
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "name": "block-secrets",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/block-secrets.sh"
          }
        ]
      }
    ],
    "AfterTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "name": "auto-test",
            "type": "command",
            "command": "$LLXPRT_PROJECT_DIR/.llxprt/hooks/auto-test.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "exit",
        "hooks": [
          {
            "name": "cleanup",
            "type": "command",
            "command": "node $LLXPRT_PROJECT_DIR/.llxprt/hooks/cleanup.js",
            "description": "Persist session learnings"
          }
        ]
      }
    ]
  }
}
```

## Common patterns

### Allow by default, deny specific

Most policy hooks start by allowing everything and only intervene for specific
tools or conditions:

```bash
case "$tool_name" in
  run_shell_command)
    if is_dangerous_command "$command"; then
      echo '{"decision": "deny", "reason": "Dangerous command blocked"}'
      exit 2
    fi
    ;;
esac

exit 0
```

### Deny by default, allow specific

For high-security environments, deny everything except explicitly allowed
operations:

```bash
case "$tool_name" in
  read_file|list_directory|glob)
    exit 0
    ;;
esac

echo '{"decision": "deny", "reason": "Tool not in allowlist"}'
exit 2
```

## Security and limitations

> **Warning:** Hooks execute with your full user privileges. A malicious or
> misconfigured hook can delete files, exfiltrate data, or compromise your
> system.

Key security points to keep in mind:

- **Project hooks** (in `.llxprt/settings.json`) are **untrusted by default**.
  LLxprt Code warns you the first time it encounters a new project hook and
  requires explicit trust before executing it. If a hook's `command` changes
  (for example, after a `git pull`), LLxprt Code treats it as a new, untrusted
  hook and warns again.
- **Hooks inherit the environment** of the LLxprt Code process, which may
  include API keys. LLxprt Code attempts to sanitize sensitive variables, but
  you should avoid printing environment variables to stdout or stderr.
- **Telemetry**: when telemetry is enabled, hook inputs and outputs are
  included in the `hook_call` telemetry event regardless of the
  `telemetry.logPrompts` setting. Disable telemetry entirely to prevent hook
  I/O from being logged.

For the complete threat model, mitigation strategies (sandboxing, permission
limiting), and privacy guidance, see
[Best Practices](best-practices.md#using-hooks-securely).

## Troubleshooting

### Hook not running

1. **Verify hooks are enabled.** Confirm `hooksConfig.enabled` is `true` in
   your `settings.json` and that `tools.enableHooks` is not set to `false`.
2. **Check the hook panel.** Run `/hooks panel` inside LLxprt Code and confirm
   the hook appears and is enabled.
3. **Check the `disabled` list.** Hooks listed under `hooksConfig.disabled`
   will not execute even if configured.
4. **Verify the script is executable:** `chmod +x .llxprt/hooks/my-hook.sh`
5. **Validate your settings JSON:**
   `jq . .llxprt/settings.json` — a syntax error will prevent all hooks from
   loading.
6. **Verify the matcher pattern** matches the tool name. Remember matchers are
   tested as regular expressions for tool events.

### Hook output not parsed

1. **Ensure stdout is valid JSON** when you want structured output:
   `echo '{"test": 1}' | jq .`
2. **Do not mix logging with JSON output.** Write log messages to a file or to
   stderr, not stdout. Stdout is reserved for hook output.
3. **Check for binary data or control characters** in the output that could
   break JSON parsing.

### Hook times out

The default timeout is **60 seconds** (`60000` ms). You can set a shorter
`timeout` (in milliseconds) per hook.

1. Profile the hook to find the slow part.
2. Set an appropriate timeout in the hook configuration:
   ```json
   {
     "name": "my-hook",
     "timeout": 5000
   }
   ```
3. Avoid slow operations like network calls inside hooks, or wrap them with a
   local timeout (`timeout 1 ./quick-check.sh`).

### Environment variables not available

Only `$LLXPRT_PROJECT_DIR` is expanded in the `command` string. If your hook
script needs other variables, load them from a `.env` file inside the script:

```bash
if [ -f "$LLXPRT_PROJECT_DIR/.env" ]; then
  source "$LLXPRT_PROJECT_DIR/.env"
fi
```

## Related reference

- [Hooks Reference](index.md) — overview, event table, and quick-start
- [API Reference](api-reference.md) — complete type definitions, input/output
  schemas, exit codes, and environment variables
- [Best Practices](best-practices.md) — security, performance, debugging, and
  privacy guidance
- [Application Directories](../reference/application-directories.md) — where
  LLxprt Code stores configuration, logs, and data
