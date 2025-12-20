# Message Bus and Policy Engine

## Overview

The message bus and policy engine provide a flexible, rule-based system for controlling tool execution in llxprt-code. This modern approach replaces the legacy approval mode system with configurable policies that determine whether tools should execute automatically, require user confirmation, or be blocked.

## Key Concepts

### Message Bus

The message bus is an event-driven communication system that handles tool confirmation requests and responses. It decouples tool execution logic from UI components, enabling:

- Asynchronous tool confirmations
- Policy-based authorization
- Observability through message events
- Flexible UI integration patterns

### Policy Engine

The policy engine evaluates tool execution requests against configurable rules. Each rule can:

- Match specific tools or use wildcards to match all tools
- Match tool arguments using regular expressions
- Specify a decision: `allow`, `deny`, or `ask_user`
- Define a priority to control rule precedence

### Priority Bands

Rules are organized into three priority tiers:

- **Tier 3 (Admin): 3.xxx** - Enterprise admin policies (highest priority)
- **Tier 2 (User): 2.xxx** - User settings and custom policies
- **Tier 1 (Default): 1.xxx** - Built-in default policies (lowest priority)

Within each tier, higher priority numbers win. For example, a rule with priority 2.5 overrides a rule with priority 2.3.

## Benefits Over Legacy Approval Mode

The message bus and policy engine offer several advantages:

1. **Fine-grained Control**: Define rules per tool or per argument pattern, not just blanket approval modes
2. **Declarative Configuration**: Policies are defined in TOML files that can be version-controlled
3. **Composable Rules**: Combine multiple rule sources (defaults, user settings, CLI flags)
4. **Security**: Block dangerous commands (e.g., `rm -rf /`) at the policy level
5. **Extensibility**: MCP server trust settings integrate seamlessly with policies
6. **Observability**: Message bus events provide insight into tool execution flow

## Message Bus Integration

Message bus routing and the policy engine are now always enabled in llxprt-code. No additional settings or profile changes are required.

## How It Works

### Legacy Path (Historical Reference)

```
Tool Request → shouldConfirmExecute() → UI Dialog → Execute
```

### Current Flow

```
Tool Request → Policy Engine → ALLOW/DENY/ASK_USER
                                  ↓
                            Message Bus → UI → Response → Execute
```

The policy engine first evaluates the request against all configured rules. Based on the highest-priority matching rule:

- **ALLOW**: Tool executes immediately
- **DENY**: Tool is blocked with a policy rejection message
- **ASK_USER**: Message bus publishes a confirmation request, waits for UI response

## Using the /policies Command

The `/policies` slash command displays all active policy rules:

```
> /policies

Active Policy Rules:

  2.950 │ *                         │ allow    (Always Allow - runtime)
  2.300 │ edit                      │ allow    (--allowed-tools)
  2.000 │ shell                     │ deny     (args: rm\s+-rf\s+/)
  1.999 │ *                         │ allow    (YOLO mode)
  1.050 │ glob                      │ allow    (read-only default)
  1.010 │ edit                      │ ask_user (write default)

Default decision: ask_user
Non-interactive mode: false
```

This shows:

- Priority order (highest first)
- Tool name (`*` = wildcard matching all tools)
- Decision (allow/deny/ask_user)
- Args pattern (if applicable)

## Default Policies

llxprt-code ships with built-in policies:

### Read-Only Tools (Priority 1.05)

These tools auto-approve by default:

- glob, grep, ls, read_file, read_many_files, ripgrep
- web_search, task, write_todos, list_subagents
- notebook_edit, slash_command, skill

### Write Tools (Priority 1.01)

These tools require confirmation by default:

- edit, write_file
- shell, memory, web_fetch
- mcp_tool

### Dangerous Shell Commands (Priority 2.0)

These patterns are blocked:

- `rm -rf /` - Recursive root deletion
- `chmod 777` - Insecure permissions
- `dd if=` - Disk overwrite
- `mkfs.` - Filesystem formatting
- Fork bombs and other malicious patterns

### YOLO Mode (Priority 1.999)

When `--yolo` flag is used, a wildcard allow-all rule is added at priority 1.999.

## Configuration File Format

See [Policy Configuration Guide](policy-configuration.md) for detailed TOML syntax and examples.

## Legacy Compatibility

The system maintains full backward compatibility:

### ApprovalMode Mapping

Legacy approval modes map to policy rules:

| ApprovalMode | Policy Behavior                     |
| ------------ | ----------------------------------- |
| `DEFAULT`    | Standard policy stack applies       |
| `AUTO_EDIT`  | Allow write tools at priority 1.015 |
| `YOLO`       | Allow all tools at priority 1.999   |

### CLI Flags

- `--allowed-tools`: Each tool becomes an ALLOW rule at priority 2.3
- `--yolo`: Adds wildcard ALLOW rule at priority 1.999

Legacy approval settings are now expressed as policy rules that flow through the message bus; there is no toggle to bypass the new architecture.

## Troubleshooting

### Policy Not Taking Effect

1. Verify your policy file path (`settings.policyFiles`) is correct and readable
2. Restart llxprt-code (or reload settings) after edits
3. Use `/policies` to inspect active rules and priorities
4. Ensure your custom policy has higher priority than defaults

### Tool Blocked Unexpectedly

1. Use `/policies` to see which rule matched
2. Check for DENY rules with higher priority than your ALLOW rules
3. Review args patterns for overly broad matches

### Timeout Errors

If tool confirmations timeout (default 5 minutes):

- Check that UI is responding to confirmation requests
- In non-interactive mode, ASK_USER decisions become DENY
- Consider adding ALLOW rules for trusted tools

### Policy File Errors

If policy loading fails:

- Check TOML syntax (use online validator)
- Verify priority is in range [1.0, 4.0)
- Ensure regex patterns in `argsPattern` are valid
- Check file path in settings

## Security Considerations

### Server Name Spoofing Prevention

MCP tools are validated to prevent spoofing:

- Expected format: `serverName__toolName`
- If serverName doesn't match prefix, tool is denied
- Built-in tools cannot be spoofed via MCP

### Priority Band Enforcement

The policy engine validates that priorities fall within allowed bands:

- Tier 1: 1.0 - 1.999
- Tier 2: 2.0 - 2.999
- Tier 3: 3.0 - 3.999

Custom policies with priorities outside this range will fail to load.

### Non-Interactive Mode

When `--non-interactive` flag is used:

- ASK_USER decisions automatically become DENY
- Prevents tools from hanging waiting for user input
- Recommended for CI/CD environments

## Performance Notes

### Rule Evaluation

- Rules are sorted by priority once at engine initialization
- Evaluation stops at first matching rule (O(n) worst case)
- Stable stringify for args matching adds minimal overhead

### Message Bus Overhead

- EventEmitter-based pub/sub is lightweight
- Correlation IDs use crypto.randomUUID() (fast)
- Timeout cleanup prevents memory leaks

## Next Steps

- Read [Policy Configuration Guide](policy-configuration.md) to create custom policies
- See [Migration Guide](migration/approval-mode-to-policies.md) to migrate from legacy approval modes
- Review [Architecture Document](architecture/message-bus-architecture.md) for implementation details
