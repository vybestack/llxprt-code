# Migrating from Approval Mode to Policies

## Status and audience

**Status:** Complete. The policy engine and message bus are always enabled; the
legacy approval-mode and allowed-tools flags have been translated into policy
rules.

**Audience:** Users who previously configured `--approval-mode`, `--yolo`,
`--allowed-tools`, or related settings, and want to adopt TOML policy files for
finer-grained control. If you never used those options, no action is needed —
the default policies already cover the common cases.

## Compatibility impact

Your existing flags and settings continue to work. They are translated into
equivalent policy rules before the engine evaluates any tool call, so the
behavior you are used to is preserved:

| Legacy option                     | What it does now                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `--yolo` / `--approval-mode yolo` | Sets the approval mode to YOLO, activating a wildcard allow-all rule at priority 1.999.       |
| `--approval-mode auto_edit`       | Sets the approval mode to auto-edit, activating allow rules for edit tools at priority 1.015. |
| `--allowed-tools <names>`         | Adds individual allow rules at priority 2.3.                                                  |
| `tools.allowed` setting           | Same as `--allowed-tools` — allow rules at priority 2.3.                                      |
| `tools.exclude` setting           | Adds individual deny rules at priority 2.4.                                                   |

You do not need to change anything to keep using these options. A TOML policy
file is only necessary if you want rules that the flags cannot express — for
example, blocking a tool by argument pattern, or applying different rules per
project.

## Before and after

### Before: flags only

```bash
# Auto-approve edit tools
llxprt --approval-mode auto_edit

# Auto-approve everything
llxprt --yolo

# Allow specific tools without confirmation
llxprt --allowed-tools replace,write_file
```

### After: policy file (optional)

```toml
# ~/.config/llxprt-code/policies/my-rules.toml (Linux)
# See Application Directories for macOS/Windows paths.

# Auto-approve edits
[[rule]]
toolName = "replace"
decision = "allow"
priority = 250

[[rule]]
toolName = "write_file"
decision = "allow"
priority = 250

# Block dangerous shell patterns the built-in guard does not cover
[[rule]]
toolName = "run_shell_command"
argsPattern = "git\\s+push\\s+--force"
decision = "deny"
priority = 280
```

## Migration steps

### 1. Inspect your current rules

Start LLxprt Code with your existing flags and run `/policies`:

```
> /policies
```

This lists every active rule, grouped by tier, in priority order. Note which
rules come from your flags (source labels like `Settings (Tools Allowed)`) so
you know what to reproduce in a policy file.

### 2. Create a policy file (optional)

You only need a policy file if you want rules that go beyond what the flags
offer. Place TOML files in your user policy directory — they are loaded
automatically at tier 2 (priorities 2.000–2.999). See
[Application Directories](../reference/application-directories.md) for the
directory path on each operating system.

For the full TOML schema (fields, decision values, priority integers, pattern
syntax, and `commandPrefix` shorthand), see
[Policy Configuration](../policy-configuration.md).

> **Note on priorities:** In a TOML file, the `priority` field is an integer
> 0–999. The engine transforms it by adding the tier: a file in your user
> directory at `priority = 250` becomes resolved priority **2.250**. To
> override a CLI flag (resolved priority 2.3), use an integer of 301 or higher.

### 3. Stop passing the flags you replaced

Once your policy file reproduces the behavior, you can stop passing the
corresponding flags. For example, if your file allows `replace` and
`write_file`, you no longer need `--allowed-tools replace,write_file`.

You do not have to stop using the flags — they keep working alongside policy
files. But if you want a single source of truth, the policy file replaces them.

### 4. Verify

Restart LLxprt Code and run `/policies` again. Confirm your custom rules appear
in the Tier 2 group with the priorities you expect, and that no unwanted rules
remain from old flags.

## Example: replacing `--approval-mode auto_edit`

Auto-edit mode auto-approves edit tools (replace, write_file, insert_at_line,
delete_line_range, apply_patch, ast_edit) but still confirms shell commands. To
reproduce that as a permanent policy file:

```toml
# Auto-approve edit tools
[[rule]]
toolName = "replace"
decision = "allow"
priority = 250

[[rule]]
toolName = "write_file"
decision = "allow"
priority = 250

[[rule]]
toolName = "insert_at_line"
decision = "allow"
priority = 250

[[rule]]
toolName = "delete_line_range"
decision = "allow"
priority = 250

[[rule]]
toolName = "apply_patch"
decision = "allow"
priority = 250

[[rule]]
toolName = "ast_edit"
decision = "allow"
priority = 250
```

Shell commands remain at the default behavior (`ask_user`) unless you add
explicit rules for them.

## Where policy files are loaded from

Policy files are read from directories, not from an arbitrary path you name in
settings. Three directories are scanned, and the directory a file sits in
determines its tier:

| Directory                                  | Tier        | Resolved priority range |
| ------------------------------------------ | ----------- | ----------------------- |
| Built-in policies shipped with LLxprt Code | 1 (default) | 1.000–1.999             |
| Your user policy directory                 | 2 (user)    | 2.000–2.999             |
| The system policy directory                | 3 (admin)   | 3.000–3.999             |

See [Application Directories](../reference/application-directories.md) for the
user and system directory locations on each operating system.

> **Limitation:** There is no per-project policy directory. Policy files are not
> discovered from your working directory or from a project-local `.llxprt`
> directory, and there is no setting that points the loader at a specific file.
> If you need different rules per project, use the CLI flags described above
> when starting LLxprt Code in that project, or swap the contents of your user
> policy directory.

For worked TOML examples including MCP trust, argument-pattern matching, and
deny-by-default setups, see
[Policy Configuration](../policy-configuration.md).

## Verification

After migrating, confirm the policy stack is correct:

1. **Run `/policies`** — your custom rules should appear under "Tier 2
   (User-defined)" with the correct priorities.
2. **Test a tool call** that your policy is meant to affect — for example,
   trigger an edit to confirm it runs without a prompt, or run a blocked shell
   pattern to confirm it is denied.
3. **Check the default decision** — the last line of `/policies` output shows
   the default decision (`ASK_USER`) and non-interactive mode status.

## Rollback

To revert to flag-based behavior, delete or rename your custom policy files in
the user policy directory and restart LLxprt Code. The default policies and any
flags you pass on the command line take over again.

The policy engine and message bus remain active in all cases — there is no way
to disable them, and no need to. Rollback means removing your custom rules, not
switching to a different authorization system.

## Deprecation timeline

The `--yolo`, `--approval-mode`, and `--allowed-tools` flags are not
deprecated. They are supported indefinitely because they map cleanly to policy
rules and many users rely on them. TOML policy files are the recommended path
for anything the flags cannot express, but you are not required to migrate.

For a deeper look at policy authoring — TOML syntax, priority bands, pattern
matching, security best practices, and troubleshooting — see
[Policy Configuration](../policy-configuration.md). For how the engine
evaluates rules at runtime, see [Controlling Tool Execution](../tool-permissions.md).
