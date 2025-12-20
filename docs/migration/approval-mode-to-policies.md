# Migrating from Approval Mode to Policies

## Overview

This guide helps users migrate from the legacy ApprovalMode system to the new policy engine. The policy engine provides more flexibility and control while maintaining backward compatibility with existing configurations.

## Why Migrate?

The policy engine offers several advantages over ApprovalMode:

1. **Fine-grained control**: Define rules per tool or argument pattern
2. **Security**: Block dangerous commands at the policy level
3. **Transparency**: Use `/policies` to see exactly what rules are active
4. **Composability**: Combine multiple rule sources seamlessly
5. **Extensibility**: Integrate MCP server trust with tool policies

## Backward Compatibility

**Important:** The policy engine maintains full backward compatibility. Your existing configurations continue to work:

- `--yolo` flag still enables unrestricted mode
- `--approval-mode auto_edit` still auto-approves write tools
- `--allowed-tools` still allows specific tools
- Settings.json `approvalMode` field still works

The message bus and policy engine now power every confirmation. Legacy settings are converted into equivalent policy rules automatically, so behavior remains consistent without any toggles.

## How Legacy Settings Map to Policies

### ApprovalMode.DEFAULT

**Legacy behavior:** Prompt for write tools, auto-approve read-only tools

**Policy equivalent:** Standard policy stack applies

```toml
# Built-in defaults (priority 1.05)
[[rule]]
toolName = "glob"
decision = "allow"
priority = 1.05

[[rule]]
toolName = "grep"
decision = "allow"
priority = 1.05

# ... other read-only tools

# Built-in defaults (priority 1.01)
[[rule]]
toolName = "edit"
decision = "ask_user"
priority = 1.01

[[rule]]
toolName = "write_file"
decision = "ask_user"
priority = 1.01

# ... other write tools
```

**Migration:** No action needed — this is now the default behavior because the policy engine/message bus path is always active.

### ApprovalMode.AUTO_EDIT

**Legacy behavior:** Auto-approve write tools (edit, write_file, shell, memory)

**Policy equivalent:** Allow rules at priority 1.015

```toml
[[rule]]
toolName = "edit"
decision = "allow"
priority = 1.015

[[rule]]
toolName = "write_file"
decision = "allow"
priority = 1.015

[[rule]]
toolName = "shell"
decision = "allow"
priority = 1.015

[[rule]]
toolName = "memory"
decision = "allow"
priority = 1.015
```

**Migration:**

1. Remove `approvalMode: "auto_edit"` from settings
2. Create a custom policy file with write tools allowed at priority 2.5+
3. Restart llxprt-code (or reload settings) so the new policy file is picked up

### ApprovalMode.YOLO

**Legacy behavior:** Auto-approve all tools without confirmation

**Policy equivalent:** Wildcard allow-all at priority 1.999

```toml
[[rule]]
# No toolName = wildcard (matches all tools)
decision = "allow"
priority = 1.999
```

**Migration:**

1. Remove `approvalMode: "yolo"` from settings
2. Create a custom policy file with wildcard allow at priority 2.5+ (if desired)
3. Restart llxprt-code to ensure the new policy stack loads

**Security Note:** YOLO mode disables all safety checks. Consider using selective allow rules instead.

## CLI Flag Mapping

### --allowed-tools

**Legacy usage:**

```bash
llxprt --allowed-tools edit,shell,glob
```

**Policy equivalent:** Individual allow rules at priority 2.3

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

**Migration:**

1. Continue using `--allowed-tools` (it still works with policy engine)
2. Or create permanent policy file with higher priority (2.5+) to override

### --yolo

**Legacy usage:**

```bash
llxprt --yolo
```

**Policy equivalent:** Wildcard allow-all at priority 1.999

```toml
[[rule]]
decision = "allow"
priority = 1.999
```

**Migration:**

1. Continue using `--yolo` flag (it still works)
2. Or create permanent policy file with wildcard allow
3. **Recommended:** Use selective allow rules instead for better security

## Step-by-Step Migration

### Step 1: Test with Default Policies

Restart llxprt-code and verify behavior:

```bash
llxprt
```

Run `/policies` to see active rules:

```
> /policies

Active Policy Rules:

  1.999 │ *                         │ allow    (YOLO mode)
  1.050 │ glob                      │ allow    (read-only default)
  1.010 │ edit                      │ ask_user (write default)

Default decision: ask_user
Non-interactive mode: false
```

Test a few tool executions to confirm expected behavior.

### Step 3: Create Custom Policy File (Optional)

Create `~/.llxprt/my-policy.toml`:

```toml
# My custom policies - override defaults

# Auto-approve read-only tools
[[rule]]
toolName = "glob"
decision = "allow"
priority = 2.5

[[rule]]
toolName = "grep"
decision = "allow"
priority = 2.5

# Require confirmation for write tools
[[rule]]
toolName = "edit"
decision = "ask_user"
priority = 2.5

# Block dangerous shell commands
[[rule]]
toolName = "shell"
argsPattern = "rm\\s+-rf\\s+/"
decision = "deny"
priority = 2.8

# Allow safe shell commands
[[rule]]
toolName = "shell"
argsPattern = "^(ls|pwd|echo)"
decision = "allow"
priority = 2.6

# Default deny for shell
[[rule]]
toolName = "shell"
decision = "deny"
priority = 2.5
```

### Step 4: Configure Policy Path

Add to `~/.llxprt/settings.json`:

```json
{
  "tools": {
    "policyPath": "/Users/yourname/.llxprt/my-policy.toml"
  }
}
```

**Important:** Use absolute paths, not `~` or relative paths.

### Step 5: Verify and Test

Restart llxprt-code and check policies:

```bash
llxprt --command "/policies"
```

Verify your custom rules appear with correct priorities.

### Step 6: Remove Legacy Settings (Optional)

Once satisfied with policy-based configuration, you can remove legacy settings:

```json
{
  // Remove these:
  // "approvalMode": "auto_edit",

  // Keep these:
  "tools": {
    "policyPath": "/Users/yourname/.llxprt/my-policy.toml"
  }
}
```

## Common Migration Scenarios

### Scenario 1: Developer Using AUTO_EDIT

**Current setup:**

```json
{
  "approvalMode": "auto_edit"
}
```

**Migration to policies:**

1. Create `~/.llxprt/dev-policy.toml`:

```toml
# Auto-approve write tools for development
[[rule]]
toolName = "edit"
decision = "allow"
priority = 2.5

[[rule]]
toolName = "write_file"
decision = "allow"
priority = 2.5

# Shell with safety checks
[[rule]]
toolName = "shell"
argsPattern = "rm\\s+-rf\\s+/"
decision = "deny"
priority = 2.8

[[rule]]
toolName = "shell"
decision = "allow"
priority = 2.5

# Memory operations
[[rule]]
toolName = "memory"
decision = "allow"
priority = 2.5
```

2. Update settings:

```json
{
  "tools": {
    "policyPath": "/Users/yourname/.llxprt/dev-policy.toml"
  }
}
```

### Scenario 2: Security-Conscious User

**Current setup:**

```json
{
  "approvalMode": "default"
}
```

**Migration to policies:**

1. Create `~/.llxprt/secure-policy.toml`:

```toml
# Read-only tools allowed
[[rule]]
toolName = "glob"
decision = "allow"
priority = 2.5

[[rule]]
toolName = "grep"
decision = "allow"
priority = 2.5

[[rule]]
toolName = "read_file"
decision = "allow"
priority = 2.5

# Write tools require confirmation
[[rule]]
toolName = "edit"
decision = "ask_user"
priority = 2.5

[[rule]]
toolName = "write_file"
decision = "ask_user"
priority = 2.5

# Shell completely blocked
[[rule]]
toolName = "shell"
decision = "deny"
priority = 2.5

# MCP tools require confirmation
[[rule]]
toolName = "mcp_tool"
decision = "ask_user"
priority = 2.5
```

2. Update settings:

```json
{
  "tools": {
    "policyPath": "/Users/yourname/.llxprt/secure-policy.toml"
  }
}
```

### Scenario 3: Per-Project Policies

**Current setup:** Different `--allowed-tools` for different projects

**Migration to policies:**

1. Create project-specific policy file `.llxprt-policy.toml` in project root:

```toml
# Project-specific policies

# Allow edit only in project directory
[[rule]]
toolName = "edit"
argsPattern = "/path/to/project/"
decision = "allow"
priority = 2.7

# Block edit outside project
[[rule]]
toolName = "edit"
decision = "deny"
priority = 2.5

# Allow safe shell commands in project
[[rule]]
toolName = "shell"
argsPattern = "cd /path/to/project"
decision = "allow"
priority = 2.7

[[rule]]
toolName = "shell"
argsPattern = "npm (install|test|build)"
decision = "allow"
priority = 2.7

# Block other shell commands
[[rule]]
toolName = "shell"
decision = "deny"
priority = 2.5
```

2. Load policy when starting llxprt in project:

```bash
cd /path/to/project
export LLXPRT_POLICY_PATH="$(pwd)/.llxprt-policy.toml"
llxprt
```

Or add to project-specific profile:

```json
{
  "profiles": {
    "myproject": {
      "tools.policyPath": "/path/to/project/.llxprt-policy.toml"
    }
  }
}
```

## Priority Precedence

Understanding priority helps combine legacy and new settings:

```
Higher Priority (wins)
    ↑
    │
3.xxx │ Admin policies (future)
    │
2.95  │ "Always Allow" UI selections
2.9   │ MCP servers excluded
2.5+  │ User TOML policies ← YOUR CUSTOM POLICIES
2.4   │ --exclude-tools
2.3   │ --allowed-tools ← CLI FLAG
2.2   │ MCP trust=true
2.1   │ MCP allowed list
2.0   │ Dangerous command blocks
    │
1.999 │ YOLO mode ← --yolo FLAG
1.05  │ Read-only defaults
1.015 │ AUTO_EDIT mode ← approvalMode setting
1.01  │ Write tool defaults
    │
    ↓
Lower Priority
```

**Key insight:** Your custom policies at 2.5+ override CLI flags and ApprovalMode settings.

## Coexistence Strategy

You can run both systems simultaneously during migration:

### Phase 1: Test with Feature Flag

```json
{
  "approvalMode": "auto_edit" // Keep legacy
}
```

- Legacy settings are still migrated to policy rules automatically
- No breaking changes
- Test new system alongside legacy

### Phase 2: Add Custom Policies

```json
{
  "approvalMode": "auto_edit", // Keep legacy
  "tools": {
    "policyPath": "/path/to/my-policy.toml" // Add custom
  }
}
```

- Custom policies override legacy (due to priority)
- Gradual transition to declarative config

### Phase 3: Remove Legacy

```json
{
  "tools": {
    "policyPath": "/path/to/my-policy.toml" // Only new system
  }
}
```

- Fully migrated to policy engine
- No legacy settings

## Troubleshooting Migration

### Issue: Policies Not Taking Effect

**Symptoms:** Tools still prompt for confirmation despite allow rules

**Solutions:**

1. Restart llxprt-code after changing settings
2. Verify policies loaded: `llxprt --command "/policies"`
3. Check priority - your rules must be higher than defaults (use 2.5+)
4. Ensure policy file path is absolute

### Issue: TOML Parse Errors

**Symptoms:** llxprt-code fails to start or logs TOML errors

**Solutions:**

1. Validate TOML syntax: https://www.toml-lint.com/
2. Check for common mistakes:
   - Missing quotes on `decision = "allow"`
   - Single backslash in regex (use `\\` not `\`)
   - Wrong array syntax (use `[[rule]]` not `[rule]`)
3. Review error message for line number
4. Temporarily remove custom policy path to isolate issue

### Issue: Rules Conflicting

**Symptoms:** Unexpected allow/deny behavior

**Solutions:**

1. Run `/policies` to see all active rules in priority order
2. Check for rules with higher priority overriding your rules
3. Review argsPattern for overly broad matches
4. Remember: highest priority wins
5. Use priority 2.8+ for critical deny rules

### Issue: Legacy Flags Not Working

**Symptoms:** `--allowed-tools` or `--yolo` not working as expected

**Solutions:**

1. Ensure you're running a build that includes the policy engine/message bus stack (20251119gmerge or later)
2. Check for custom policies with higher priority overriding flags
3. Use `/policies` to see how flags translated to rules
4. Remember: CLI flags have priority 2.3, user policies at 2.5+ override them

### Issue: MCP Tools Not Allowed

**Symptoms:** MCP server tools blocked despite trust settings

**Solutions:**

1. Check MCP server name prefix: `serverName__toolName`
2. Create explicit policy rule for MCP server:
   ```toml
   [[rule]]
   toolName = "my-server__"
   decision = "allow"
   priority = 2.2
   ```
3. Verify `mcpServers.*.trust: true` in settings
4. Check for deny rules with higher priority

## Best Practices

### 1. Start Conservative

Begin with restrictive policies and loosen as needed:

```toml
# Start with deny-by-default
[[rule]]
decision = "deny"
priority = 2.5

# Allow only specific tools
[[rule]]
toolName = "read_file"
decision = "allow"
priority = 2.6

[[rule]]
toolName = "edit"
decision = "ask_user"
priority = 2.6
```

### 2. Use Comments Liberally

Document why each rule exists:

```toml
# Allow edit for project files only (2024-11-20)
# Prevents accidental edits to system files
[[rule]]
toolName = "edit"
argsPattern = "/home/user/projects/"
decision = "allow"
priority = 2.6
```

### 3. Version Control Policies

Store policy files in git alongside your project:

```bash
project/
  .llxprt-policy.toml  # Project-specific policies
  .gitignore
  README.md
```

### 4. Test Policies Before Deployment

Create test policy file and verify behavior:

```bash
# Create test policy
cat > /tmp/test-policy.toml << 'EOF'
[[rule]]
toolName = "edit"
decision = "allow"
priority = 2.5
EOF

# Test it
llxprt --config "tools.policyPath=/tmp/test-policy.toml"

# Verify
> /policies
```

### 5. Use Profiles for Different Contexts

Create profiles for different use cases:

```json
{
  "profiles": {
    "dev": {
      "tools.policyPath": "/Users/me/.llxprt/dev-policy.toml"
    },
    "secure": {
      "tools.policyPath": "/Users/me/.llxprt/secure-policy.toml"
    },
    "demo": {
      "tools.policyPath": "/Users/me/.llxprt/demo-policy.toml"
    }
  }
}
```

Switch profiles as needed:

```bash
llxprt --profile dev
llxprt --profile secure
```

## Migration Checklist

- [ ] Backup existing settings.json
- [ ] Test with default policies
- [ ] Run `/policies` to verify rules
- [ ] Create custom policy file (if needed)
- [ ] Configure policy path in settings
- [ ] Restart llxprt-code
- [ ] Verify custom rules loaded
- [ ] Test tool executions
- [ ] Document policy decisions (comments in TOML)
- [ ] Version control policy files
- [ ] Remove legacy settings (optional)

## Rollback Plan

If you need to revert to the previous behavior, remove custom policy files/paths and rely on `approvalMode` plus `--allowed-tools` flags. Message bus integration remains enabled, but without custom policies the behavior mirrors the legacy flow.

## Next Steps

- Read [Message Bus Guide](../message-bus.md) for detailed feature overview
- Read [Policy Configuration Guide](../policy-configuration.md) for TOML syntax and examples
- Review [Architecture Document](../architecture/message-bus-architecture.md) for implementation details
- See [example policies](https://github.com/vybestack/llxprt-code/tree/main/packages/core/src/policy/policies) in the repository
