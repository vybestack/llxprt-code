# Controlling Tool Execution

LLxprt Code decides what happens every time the model wants to use a tool: the
tool runs automatically, the tool asks you to confirm first, or the tool is
blocked. You control those decisions with policies — TOML rules that match a
tool (and optionally its arguments) and specify one of three outcomes:

- **Allow** — the tool runs immediately, no prompt.
- **Ask** — you see the request and choose whether to proceed.
- **Deny** — the tool is blocked before it runs.

Every tool call passes through the same authorization path regardless of how
LLxprt Code was started. There is no toggle to bypass it.

## What you can do

| If you want to…                                     | Do this                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Auto-approve read-only tools, confirm writes        | Use the default approval mode (no configuration needed).                                    |
| Auto-approve edits but still confirm shell commands | Use auto-edit mode: `--approval-mode auto_edit` or press `Shift+Tab` in the interactive UI. |
| Auto-approve everything                             | Use YOLO mode: `--approval-mode yolo` (or `--yolo`) or press `Ctrl+Y`.                      |
| Allow a specific tool without confirmation          | Use `--allowed-tools <name>` on the command line, or write an allow rule in a policy file.  |
| Block a specific tool                               | Write a deny rule in a policy file, or exclude it via settings (`tools.exclude`).           |
| Block dangerous shell commands automatically        | This happens by default — see [Dangerous command blocking](#dangerous-command-blocking).    |
| Inspect which rules are active right now            | Run `/policies` (see [Inspecting active rules](#inspecting-active-rules)).                  |

## How priorities work

Each rule carries a numeric priority; when two rules match the same tool call,
the rule with the higher priority wins. Priorities are divided into three tiers
so that your custom rules always override the built-in defaults:

| Tier    | Range         | Who sets it                                                          | Examples                                                         |
| ------- | ------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Default | 1.000 – 1.999 | Built-in policy files shipped with LLxprt Code                       | Read-only tools allowed; write tools ask; YOLO allow-all.        |
| User    | 2.000 – 2.999 | Your policy files, CLI flags, and interactive "Always Allow" choices | Custom allow/deny rules; `--allowed-tools`; trusted MCP servers. |
| Admin   | 3.000 – 3.999 | System-level policy files                                            | Enterprise-wide blocks.                                          |

Within a tier, higher numbers win. A custom rule at resolved priority 2.500
overrides a default rule at 1.050, but a higher custom rule at 2.800 overrides
it.

In a TOML policy file you write an **integer** from 0 to 999 — not a decimal.
The engine adds the tier base to produce the **resolved** priority it uses
internally and shows in `/policies`. For example, `priority = 500` in a user
policy file resolves to **2.500**; `priority = 800` resolves to **2.800**. The
resolved decimal is what you compare when deciding which rule wins.

### Where each rule type lands

These priorities are fixed by the engine; you cannot change them from a policy
file.

| Priority | Source                                                              | Decision |
| -------- | ------------------------------------------------------------------- | -------- |
| 2.95     | "Always Allow" selections made in the interactive UI                | Allow    |
| 2.9      | MCP servers in the excluded list                                    | Deny     |
| 2.4      | Tools excluded via settings (`tools.exclude`)                       | Deny     |
| 2.3      | `--allowed-tools` flag and `tools.allowed` setting                  | Allow    |
| 2.2      | MCP servers with `trust: true`                                      | Allow    |
| 2.1      | MCP servers in the allowed list                                     | Allow    |
| 1.999    | YOLO allow-all (active only in YOLO mode)                           | Allow    |
| 1.05     | Built-in read-only tools (glob, grep, read_file, etc.)              | Allow    |
| 1.015    | Auto-edit override (active only in auto-edit mode)                  | Allow    |
| 1.01     | Built-in write tools (replace, write_file, run_shell_command, etc.) | Ask      |

Rules you write in a policy file always land in the user tier (2.000–2.999).
To override a default, use any priority integer in that range; to override a
CLI flag (resolved priority 2.3), use an integer of 301 or higher. The values
in the table above are **resolved** priorities — what the engine assigns
internally and shows in `/policies`. In a TOML file you write the integer form
(for example, `priority = 401` produces resolved priority 2.401).

## Dangerous command blocking

Regardless of which rules are active, LLxprt Code hard-denies a set of
irreversibly destructive shell commands before any rule matching happens. This
guard cannot be overridden by an allow rule or by YOLO mode. The blocked
patterns include:

- Recursive deletion of sensitive filesystem roots (`rm -rf /`, `/usr`, `/etc`,
  `/home`, and similar), including `~` and `$HOME` references that resolve to
  the home directory.
- `mkfs` and `mkfs.<type>` — filesystem formatting.
- `dd` writing to block devices (`of=/dev/...`), excluding safe pseudo-devices
  like `/dev/null`.
- Dangerous `chmod` — setuid/setgid assignments and recursive `chmod 777` on
  sensitive roots.
- Fork bombs.
- Writes to credential paths (`.ssh`, `.aws/credentials`, and similar) via
  redirection, `tee`, `truncate`, or `dd`.

The detection is self-contained: it canonicalizes the command (expanding
`$IFS`, stripping quotes, peeling wrapper commands like `sudo`) before
matching, so it cannot be bypassed by quoting tricks or variable splitting.

## Approval modes and mode-specific rules

Three approval modes control which built-in rules are active. You set the mode
with `--approval-mode` (values: `default`, `auto_edit`, `yolo`) or switch at
runtime with `Shift+Tab` (auto-edit) and `Ctrl+Y` (YOLO).

- **`default`** — read-only tools are allowed; write tools ask for confirmation.
- **`auto_edit`** — edit tools (replace, write_file, insert_at_line,
  delete_line_range, apply_patch, ast_edit) are auto-approved; shell commands
  and other tools still follow the normal policy stack.
- **`yolo`** — a wildcard allow-all rule at priority 1.999 becomes active,
  auto-approving every tool call. Dangerous command blocking still applies.

Some built-in rules carry a `modes` filter so they activate only in a specific
mode (for example, the auto-edit overrides are tagged `modes = ["autoEdit"]`).
When you switch modes the engine updates immediately — no restart needed.

> **Warning:** YOLO mode auto-approves every tool except hard-blocked dangerous
> commands. Use it only in trusted environments. If your administrator has
> enabled `disableYoloMode` or `secureModeEnabled`, YOLO is unavailable.

## Legacy flags and settings

The `--yolo` flag, `--approval-mode`, `--allowed-tools`, and the
`approvalMode` / `allowedTools` settings keys all still work. They are
translated into the corresponding rules and priorities listed above before the
engine evaluates any tool call, so the behavior is consistent with policy
files.

## Inspecting active rules

The `/policies` slash command lists every active rule, grouped by tier, in
priority order:

```
> /policies

Configured Policy Rules:

Tier 2 (User-defined):
  Priority 2.950: * → ALLOW [Source: Dynamic (Confirmed)]
  Priority 2.300: replace → ALLOW [Source: Settings (Tools Allowed)]

Tier 1 (Defaults):
  Priority 1.999: * → ALLOW [Source: Default: yolo.toml]
  Priority 1.050: glob → ALLOW [Source: Default: read-only.toml]
  Priority 1.010: replace → ASK_USER [Source: Default: write.toml]

Default Decision: ASK_USER
Non-Interactive Mode: false
```

The output shows the resolved priority, the tool the rule matches (`*` for a
wildcard), the decision, and the rule's source. Use `/policies menu` to open an
interactive editor for the managed overrides file.

## Non-interactive mode

When LLxprt Code runs non-interactively (for example in CI with `-p`), any rule
that would normally ask for confirmation is treated as a denial instead. This
prevents the process from hanging while waiting for a response that will never
come. Add explicit allow rules for tools you need in non-interactive workflows.

## Adding custom policies

Write rules in a TOML file and place it in your user policy directory (see
[Application Directories](reference/application-directories.md) for the path on
each operating system). Files in that directory are loaded automatically at tier 2. For full TOML syntax, examples, and pattern-matching guidance, see
[Policy Configuration](policy-configuration.md).

## Troubleshooting

### A policy rule is not taking effect

1. Run `/policies` to confirm the rule appears in the list.
2. Check that your rule's priority integer is high enough to override the rule
   you expect it to beat. In a TOML file, use `priority = 301` or higher
   (resolved priority 2.301+) to override a CLI flag at resolved 2.3, or any
   integer above 0 to beat a default-tier rule.
3. Restart LLxprt Code after adding a new policy file to the user directory.
4. If the rule uses `argsPattern`, verify the regular expression is valid and
   matches the serialized arguments. Use `/policies` to see the resolved
   priority and source.

### A tool is blocked unexpectedly

1. Run `/policies` and look for a deny rule with a higher priority than your
   allow rule.
2. Check whether the tool call hit the [dangerous command blocking](#dangerous-command-blocking)
   guard — those blocks are not shown as rules.
3. If running non-interactively, remember that ask rules become denials.

### Confirmation requests time out

Confirmation prompts time out after 5 minutes by default. If the timeout fires,
the tool call is treated as denied. In non-interactive mode, ask decisions are
denied immediately rather than waiting.

## Related documentation

- [Policy Configuration](policy-configuration.md) — TOML syntax, examples, and
  pattern-matching reference.
- [Migration: Approval Mode to Policies](migration/approval-mode-to-policies.md)
  — how to move from legacy approval settings to policy files.
- For internal architecture, component diagrams, and the message flow, see
  `dev-docs/architecture/message-bus.md` in a repository checkout.
