# Policy Configuration Guide

## Overview

Policies control which tools can execute, which require user confirmation, and which are blocked. This guide covers the TOML policy file syntax, rule structure, and common use cases.

## TOML Policy File Syntax

Policy files use TOML (Tom's Obvious, Minimal Language) format. Each file contains an array of rules:

```toml
# Comment describing this policy file

[[rule]]
toolName = "tool_name"
argsPattern = "regex_pattern"
decision = "allow"
priority = 2.1

[[rule]]
# Another rule...
```

## Rule Structure

Each rule has four fields:

### toolName (optional)

The name of the tool this rule applies to. If omitted or left undefined, the rule matches **all tools** (wildcard).

**Examples:**

```toml
# Match the 'edit' tool specifically
toolName = "edit"

# Match all tools (wildcard) - omit toolName field
# No toolName = matches everything
```

**Built-in tool names:**

- Read-only: `glob`, `grep`, `ls`, `read_file`, `read_many_files`, `ripgrep`, `web_search`
- Write: `edit`, `write_file`, `shell`, `memory`, `web_fetch`
- Other: `task`, `write_todos`, `list_subagents`, `notebook_edit`, `slash_command`, `skill`, `mcp_tool`

**MCP tool names:**

- Format: `serverName__toolName`
- Example: `filesystem__read_file`, `database__query`

### argsPattern (optional)

A regular expression pattern to match against the tool's arguments. The arguments are serialized to stable JSON before matching.

**Examples:**

```toml
# Block 'rm -rf /' commands
toolName = "shell"
argsPattern = "rm\\s+-rf\\s+/"
decision = "deny"

# Block chmod 777 (insecure permissions)
toolName = "shell"
argsPattern = "chmod\\s+777"
decision = "deny"

# Allow edits only to .md files
toolName = "edit"
argsPattern = "\\.md\""
decision = "allow"
```

**Important:** Use double backslashes `\\` to escape regex special characters in TOML.

### decision (required)

The decision to make when this rule matches. Must be one of:

- **`allow`** - Execute the tool immediately without confirmation
- **`deny`** - Block the tool execution with a policy rejection message
- **`ask_user`** - Prompt the user for confirmation

**Examples:**

```toml
decision = "allow"
decision = "deny"
decision = "ask_user"
```

### priority (optional)

A number determining rule precedence. Higher priority rules override lower priority rules. Default is `0`.

**Priority bands:**

- **Tier 3 (Admin): 3.0 - 3.999** - Enterprise/admin policies (highest)
- **Tier 2 (User): 2.0 - 2.999** - User settings and custom policies
- **Tier 1 (Default): 1.0 - 1.999** - Built-in defaults (lowest)

**Examples:**

```toml
priority = 1.05   # Tier 1 - default read-only tools
priority = 2.3    # Tier 2 - user allowed tools
priority = 3.5    # Tier 3 - admin override
```

## Priority Bands Reference

### Tier 1 (Default): 1.0 - 1.999

Built-in defaults provided by llxprt-code:

| Priority | Purpose                             |
| -------- | ----------------------------------- |
| 1.05     | Read-only tools auto-approval       |
| 1.01     | Write tools require confirmation    |
| 1.015    | AUTO_EDIT mode write tool overrides |
| 1.999    | YOLO mode wildcard allow-all        |

### Tier 2 (User): 2.0 - 2.999

User settings and CLI flags:

| Priority | Purpose                                         |
| -------- | ----------------------------------------------- |
| 2.0      | Dangerous command blocks (e.g., `rm -rf /`)     |
| 2.1      | MCP servers in allowed list                     |
| 2.2      | MCP servers with `trust=true`                   |
| 2.3      | `--allowed-tools` CLI flag                      |
| 2.4      | `--exclude-tools` CLI flag                      |
| 2.5      | User TOML policies (recommended range: 2.5-2.9) |
| 2.95     | "Always Allow" UI selections                    |

### Tier 3 (Admin): 3.0 - 3.999

Enterprise administrator policies (future use):

| Priority  | Purpose                                |
| --------- | -------------------------------------- |
| 3.0-3.999 | Reserved for enterprise admin policies |

## Complete Example

```toml
# Custom policy file: ~/.llxprt/my-policy.toml

# Allow all read-only tools (override defaults)
[[rule]]
toolName = "glob"
decision = "allow"
priority = 2.5

[[rule]]
toolName = "grep"
decision = "allow"
priority = 2.5

# Auto-approve edit for markdown files only
[[rule]]
toolName = "edit"
argsPattern = "\\.md\""
decision = "allow"
priority = 2.6

# Block all edit operations on system files
[[rule]]
toolName = "edit"
argsPattern = "/etc/"
decision = "deny"
priority = 2.7

# Require confirmation for shell, except safe commands
[[rule]]
toolName = "shell"
argsPattern = "^(ls|pwd|echo|cat)\\s"
decision = "allow"
priority = 2.6

# Block dangerous shell patterns
[[rule]]
toolName = "shell"
argsPattern = "rm\\s+-rf"
decision = "deny"
priority = 2.8

# Block all other shell commands
[[rule]]
toolName = "shell"
decision = "deny"
priority = 2.5

# Allow trusted MCP server tools
[[rule]]
toolName = "my-mcp-server__"
decision = "allow"
priority = 2.2
```

## Common Use Cases

### 1. Block Dangerous Shell Commands

```toml
# Block recursive deletion from root
[[rule]]
toolName = "shell"
argsPattern = "rm\\s+-rf\\s+/"
decision = "deny"
priority = 2.0

# Block chmod 777 (insecure)
[[rule]]
toolName = "shell"
argsPattern = "chmod\\s+777"
decision = "deny"
priority = 2.0

# Block dd (disk operations)
[[rule]]
toolName = "shell"
argsPattern = "dd\\s+if="
decision = "deny"
priority = 2.0

# Block filesystem formatting
[[rule]]
toolName = "shell"
argsPattern = "mkfs\\."
decision = "deny"
priority = 2.0

# Block fork bombs
[[rule]]
toolName = "shell"
argsPattern = ":(){ :|:& };:"
decision = "deny"
priority = 2.0
```

### 2. Auto-Approve Read-Only Tools

```toml
# Allow all read-only tools without confirmation
[[rule]]
toolName = "glob"
decision = "allow"
priority = 2.5

[[rule]]
toolName = "grep"
decision = "allow"
priority = 2.5

[[rule]]
toolName = "ls"
decision = "allow"
priority = 2.5

[[rule]]
toolName = "read_file"
decision = "allow"
priority = 2.5

[[rule]]
toolName = "read_many_files"
decision = "allow"
priority = 2.5
```

### 3. Confirmation for Write Tools

```toml
# Require user confirmation for all write operations
[[rule]]
toolName = "edit"
decision = "ask_user"
priority = 2.5

[[rule]]
toolName = "write_file"
decision = "ask_user"
priority = 2.5

[[rule]]
toolName = "shell"
decision = "ask_user"
priority = 2.5
```

### 4. Allow Specific MCP Servers

```toml
# Auto-approve all tools from trusted-server
[[rule]]
toolName = "trusted-server__"
decision = "allow"
priority = 2.2

# Require confirmation for experimental-server
[[rule]]
toolName = "experimental-server__"
decision = "ask_user"
priority = 2.2

# Block tools from untrusted-server
[[rule]]
toolName = "untrusted-server__"
decision = "deny"
priority = 2.2
```

### 5. Deny Discovered Tools by Default

```toml
# Block all discovered tools unless explicitly allowed
[[rule]]
toolName = "discovered_tool_"
decision = "deny"
priority = 2.5

# Allow specific discovered tool
[[rule]]
toolName = "discovered_tool_my_extension__safe_tool"
decision = "allow"
priority = 2.6
```

### 6. Project-Specific Policies

```toml
# Allow edit only on project files
[[rule]]
toolName = "edit"
argsPattern = "/home/user/myproject/"
decision = "allow"
priority = 2.6

# Block edit outside project
[[rule]]
toolName = "edit"
decision = "deny"
priority = 2.5

# Allow shell commands in project directory
[[rule]]
toolName = "shell"
argsPattern = "cd /home/user/myproject"
decision = "allow"
priority = 2.6
```

## Creating Custom Policies

### Step 1: Create a TOML file

Create a new file (e.g., `~/.llxprt/my-policy.toml`):

```toml
# My custom policy

[[rule]]
toolName = "edit"
decision = "allow"
priority = 2.5
```

### Step 2: Configure Settings

Add to `~/.llxprt/settings.json`:

```json
{
  "tools": {
    "policyPath": "/absolute/path/to/my-policy.toml"
  }
}
```

**Important:** Use absolute paths, not relative paths or `~`.

### Step 3: Test Your Policy

1. Restart llxprt-code
2. Run `/policies` to verify your rules loaded
3. Test tool execution to confirm behavior

### Step 4: Debug Issues

If rules don't appear in `/policies`:

- Check TOML syntax (use online validator)
- Verify file path is absolute and correct
- Check llxprt-code startup logs for errors

## Legacy --allowed-tools Migration

The `--allowed-tools` CLI flag maps to policy rules at priority 2.3:

**Command:**

```bash
llxprt --allowed-tools edit,shell,glob
```

**Equivalent policy:**

```toml
[[rule]]
toolName = "edit"
decision = "allow"
priority = 2.3

[[rule]]
toolName = "shell"
decision = "allow"
priority = 2.3

[[rule]]
toolName = "glob"
decision = "allow"
priority = 2.3
```

These rules can be overridden by:

- User TOML policies at priority 2.5+ (higher priority)
- Admin policies at priority 3.0+

## Pattern Matching Tips

### Args Serialization

Tool arguments are serialized to stable JSON before pattern matching:

```json
{
  "command": "rm -rf /",
  "cwd": "/home/user"
}
```

Match against this JSON structure:

```toml
# Match command field containing 'rm -rf /'
argsPattern = "\"command\":\\s*\".*rm\\s+-rf\\s+/.*\""
```

### Common Patterns

**Match file extensions:**

```toml
argsPattern = "\\.md\""      # .md files
argsPattern = "\\.(ts|js)\"" # .ts or .js files
```

**Match paths:**

```toml
argsPattern = "/etc/"        # Files in /etc/
argsPattern = "/home/user/"  # Files in user home
```

**Match commands:**

```toml
argsPattern = "^(ls|pwd|echo)" # Safe commands
argsPattern = "git\\s+push"    # Git push
```

### Testing Patterns

Use an online regex tester with sample JSON:

1. Serialize tool args to JSON
2. Test pattern against JSON string
3. Remember to double-escape in TOML (`\\` not `\`)

## Security Best Practices

### 1. Use Least Privilege

Start with `deny` or `ask_user` by default:

```toml
# Block all tools by default
[[rule]]
decision = "deny"
priority = 2.5

# Allow only specific tools
[[rule]]
toolName = "read_file"
decision = "allow"
priority = 2.6
```

### 2. Layer Security

Combine multiple rules for defense in depth:

```toml
# Block dangerous patterns (high priority)
[[rule]]
toolName = "shell"
argsPattern = "rm\\s+-rf"
decision = "deny"
priority = 2.8

# Allow safe commands (medium priority)
[[rule]]
toolName = "shell"
argsPattern = "^(ls|pwd)"
decision = "allow"
priority = 2.6

# Default deny for shell (low priority)
[[rule]]
toolName = "shell"
decision = "deny"
priority = 2.5
```

### 3. Validate MCP Servers

Explicitly list trusted MCP servers:

```toml
# Allow only known trusted servers
[[rule]]
toolName = "filesystem__"
decision = "allow"
priority = 2.2

[[rule]]
toolName = "database__"
decision = "allow"
priority = 2.2

# Block all other MCP tools
[[rule]]
toolName = ".*__"
decision = "deny"
priority = 2.1
```

### 4. Audit Policies

Regularly review active policies:

```bash
llxprt --command "/policies"
```

Check for:

- Overly broad wildcards
- Unintended priority conflicts
- Obsolete rules

## Advanced Topics

### Regex Performance

Keep patterns simple and specific:

- Avoid complex lookaheads/lookbehinds
- Use anchors (`^`, `$`) when possible
- Test patterns on representative data

### Priority Conflicts

When multiple rules match, highest priority wins:

```toml
# This DENY wins (priority 2.8 > 2.5)
[[rule]]
toolName = "edit"
argsPattern = "/etc/"
decision = "deny"
priority = 2.8

[[rule]]
toolName = "edit"
decision = "allow"
priority = 2.5
```

### Dynamic Policies

Policies are loaded at startup. To update:

1. Edit policy file
2. Restart llxprt-code
3. Verify with `/policies`

(Future: dynamic reload via `/reload-policies` command)

## Troubleshooting

### Policy Not Matching

1. Use `/policies` to verify rule exists
2. Check priority is higher than conflicting rules
3. Test argsPattern against actual args JSON
4. Verify toolName matches exactly (case-sensitive)

### TOML Parse Errors

Common syntax issues:

```toml
# ❌ Wrong - missing quotes on decision
decision = allow

# ✅ Correct
decision = "allow"

# ❌ Wrong - single backslash
argsPattern = "\s+"

# ✅ Correct - double backslash
argsPattern = "\\s+"

# ❌ Wrong - array syntax for rule
[rule]

# ✅ Correct - double bracket for array
[[rule]]
```

### Priority Out of Range

```toml
# ❌ Wrong - priority too high
priority = 4.5

# ✅ Correct - within Tier 2
priority = 2.5

# ❌ Wrong - negative priority
priority = -1

# ✅ Correct - default priority
priority = 1.0
```

## Next Steps

- See [Message Bus Guide](message-bus.md) for overview and architecture
- See [Migration Guide](migration/approval-mode-to-policies.md) for migrating from legacy approval modes
- Review [example policies](https://github.com/vybestack/llxprt-code/tree/main/packages/core/src/policy/policies) in the repository
