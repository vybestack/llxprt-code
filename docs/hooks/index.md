# LLxprt Code Hooks

The LLxprt Code hook system allows you to extend and customize the behavior of the CLI by running scripts at key points during execution. Hooks can intercept tool calls, modify LLM requests/responses, enforce security policies, add logging, and much more.

## What Are Hooks?

Hooks are external scripts (bash, Python, or any executable) that LLxprt Code calls at specific points in the execution lifecycle. Your hook receives JSON input on stdin, processes it, and returns JSON output on stdout. Based on the output, LLxprt Code can:

- **Block** operations (e.g., prevent writes to sensitive directories)
- **Modify** tool inputs or LLM requests
- **Add context** to responses
- **Log** activity for auditing
- **Stop** the agent entirely

## Coming from Other Tools?

### From Gemini CLI

LLxprt Code's hook system is similar to Gemini CLI's hook configuration. The key differences:

- Configuration uses the same `settings.json` format under the `hooks` key
- Event names are similar: `BeforeTool`, `AfterTool`, `BeforeModel`, `AfterModel`
- Scripts receive JSON on stdin and return JSON on stdout
- Exit codes have the same semantics (0=success, 1=warning, 2=block)

### From Claude Code

If you're used to Claude Code's permission system:

- Hooks provide more granular control than simple allow/deny rules
- You can implement custom logic (e.g., allow writes only to specific directories)
- Hooks can modify inputs, not just approve/deny them
- Multiple hooks can run for the same event with aggregated results

## Quick Start

### 1. Enable Hooks

Hooks are enabled by default. Verify in your `~/.llxprt/settings.json`:

```json
{
  "enableHooks": true
}
```

### 2. Configure a Hook

Add hooks to your `settings.json`:

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.llxprt/hooks/security-policy.sh"
          }
        ]
      }
    ]
  }
}
```

### 3. Write Your Hook Script

Create `~/.llxprt/hooks/security-policy.sh`:

```bash
#!/bin/bash
# Read JSON input from stdin
INPUT=$(cat)

# Parse the tool name
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

# Parse the path if it's a file operation
PATH_VALUE=$(echo "$INPUT" | jq -r '.tool_input.path // empty')

# Block writes to /etc
if [[ "$TOOL_NAME" == "write_file" && "$PATH_VALUE" == /etc* ]]; then
  echo '{"decision": "deny", "reason": "Writing to /etc is prohibited"}'
  exit 2
fi

# Allow everything else
echo '{"decision": "allow"}'
exit 0
```

Make it executable:

```bash
chmod +x ~/.llxprt/hooks/security-policy.sh
```

### 4. Test It

Now when LLxprt Code tries to write to `/etc/passwd`, your hook will block it!

## Hook Events

LLxprt Code supports these hook events:

| Event                 | When It Fires                 | Common Uses                                        |
| --------------------- | ----------------------------- | -------------------------------------------------- |
| `BeforeTool`          | Before executing any tool     | Security policies, audit logging, input validation |
| `AfterTool`           | After a tool completes        | Result logging, adding context                     |
| `BeforeModel`         | Before sending request to LLM | Request modification, prompt injection defense     |
| `AfterModel`          | After receiving LLM response  | Response filtering, output modification            |
| `BeforeToolSelection` | Before tool selection phase   | Restricting available tools                        |
| `SessionStart`        | When session begins           | Session initialization                             |
| `SessionEnd`          | When session ends             | Cleanup, final logging                             |
| `BeforeAgent`         | Before agent processes prompt | Prompt preprocessing                               |
| `AfterAgent`          | After agent completes         | Response postprocessing                            |

## Next Steps

- **[Architecture Guide](./architecture.md)** - Understand how hooks work internally
- **[Creating Custom Hooks](./creating-custom-hooks.md)** - Step-by-step tutorial with examples
- **[API Reference](./api-reference.md)** - Complete type definitions and interfaces

## Example Use Cases

### Security Policy Enforcement

Block operations on sensitive files or directories:

```bash
# Deny writes to system directories
if [[ "$PATH_VALUE" == /etc* || "$PATH_VALUE" == /var* ]]; then
  echo '{"decision": "deny", "reason": "System directory access denied"}'
  exit 2
fi
```

### Audit Logging

Log all tool calls for compliance:

```bash
# Log to file
echo "$(date) - Tool: $TOOL_NAME, Path: $PATH_VALUE" >> ~/.llxprt/audit.log
echo '{"decision": "allow"}'
exit 0
```

### Cost Control

Limit expensive model calls by estimating content size:

```python
#!/usr/bin/env python3
import json, sys

input_data = json.load(sys.stdin)
request = input_data.get('llm_request', {})

# Estimate token count from contents (rough approximation: ~4 chars per token)
total_chars = 0
for content in request.get('contents', []):
    for part in content.get('parts', []):
        if isinstance(part, str):
            total_chars += len(part)
        elif isinstance(part, dict) and 'text' in part:
            total_chars += len(part['text'])

estimated_tokens = total_chars // 4

if estimated_tokens > 100000:
    print(json.dumps({
        "continue": False,
        "reason": f"Request exceeds token limit (~{estimated_tokens} tokens)"
    }))
    sys.exit(2)

print(json.dumps({"continue": True}))
```

### Project-Specific Rules

Apply rules based on working directory:

```bash
# Only allow certain tools in production directories
CWD=$(echo "$INPUT" | jq -r '.cwd')
if [[ "$CWD" == */production/* && "$TOOL_NAME" != "read_file" ]]; then
  echo '{"decision": "deny", "reason": "Only read operations allowed in production"}'
  exit 2
fi
```
