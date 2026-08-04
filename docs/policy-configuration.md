# Policy Configuration

Policies decide what happens when the model asks to use a tool: the tool runs,
you are asked to confirm, or the call is blocked. This page shows you how to
change those decisions — first with the interactive policy manager, then by
writing policy files yourself.

If you want the concepts (tiers, approval modes, dangerous-command blocking)
before the mechanics, read
[Controlling Tool Execution](tool-permissions.md) first.

**Audience:** anyone who wants a tool auto-approved, blocked, or gated
differently than the defaults.

**Prerequisites:** none for the manager. Writing files by hand additionally
needs a text editor and the location of your
[user policy directory](#where-rules-live).

## Quick start: change a rule with the policy manager

The manager is the shortest correct path. It writes the TOML for you, checks
the priority and pattern you type, and applies the change without a restart.

1. Run `/policies menu`.

   The **Policy Manager** opens with your editable rules listed between two
   fixed entries:

   ```
   Policy Manager
   Editable overrides (auto-saved.toml) apply immediately. Default & system
   tiers are read-only.

   ❯ [+] Add new rule
     replace → allow [priority 100]
     [i] View active stack
     [x] Close
   ```

2. Select **[+] Add new rule** and answer four prompts:

   | Prompt     | What to enter                                                             |
   | ---------- | ------------------------------------------------------------------------- |
   | Tool name  | The exact tool name, or leave empty for a wildcard that matches all tools |
   | Decision   | `allow`, `deny`, or `ask_user`                                            |
   | Args regex | Optional regular expression matched against the tool's JSON arguments     |
   | Priority   | An integer from 0 to 999 — higher wins within your tier                   |

3. Press Enter on the priority prompt to save.

   **Expected result:** the manager confirms with a message such as
   `Policy: added replace → allow [priority 100]`, returns to the menu, and the
   rule is active immediately. Nothing needs to be restarted.

To change or remove an existing rule, select it from the menu and choose
**Edit**, **Delete**, or **Duplicate**. **Back** returns to the menu without
acting.

`Esc` steps back one screen; on the menu it closes the manager.

If a priority outside 0–999 or a non-integer is typed, the form refuses it with
`Priority must be an integer between 0 and 999.` and keeps you on the priority
prompt. An args regex that does not compile is refused with
`Invalid regular expression pattern.` and returns you to the args prompt.
Nothing is written until every prompt is answered acceptably.

The form's regex check is only that the expression compiles. Policy files are
held to a little more than that — see [`argsPattern`](#argspattern) — so a
pattern the form accepts can still be rejected when the rule is loaded. The
manager reports that failure rather than hiding it.

### Inspect the configured rules

`/policies list` (or plain `/policies`) prints every configured rule, grouped
by tier and sorted by priority. It is read-only:

```
Configured Policy Rules:

Tier 2 (User-defined):
  Priority 2.950: * → ALLOW [Source: Dynamic (Confirmed)]
  Priority 2.100: replace → ALLOW [Source: User: auto-saved.toml]

Tier 1 (Defaults):
  Priority 1.050: glob → ALLOW [Source: Default: read-only.toml]
  Priority 1.010: replace → ASK_USER [Source: Default: write.toml]

Default Decision: ASK_USER
Non-Interactive Mode: false
```

The same view is available inside the manager as **[i] View active stack**.

Two things about this output:

- The priorities are **resolved** priorities. They are not the numbers you
  type — see [Priorities](#priorities).
- Every configured rule is listed, including rules restricted to an approval
  mode you are not currently in. The listing does not say which rule would win
  a particular call; it shows what is loaded. See [`modes`](#modes).

## Where rules live

Policy files are discovered **by directory**. Three directories are scanned,
and the directory a file sits in determines the tier of every rule in it:

| Directory                                        | Tier        | Resolved priority range | Who writes it                       |
| ------------------------------------------------ | ----------- | ----------------------- | ----------------------------------- |
| Built-in policies shipped with LLxprt Code       | 1 (default) | 1.000 – 1.999           | LLxprt Code                         |
| Your user policy directory, `<config>/policies/` | 2 (user)    | 2.000 – 2.999           | You, and LLxprt Code on your behalf |
| The system policy directory                      | 3 (admin)   | 3.000 – 3.999           | A machine administrator             |

See [Application Directories](reference/application-directories.md) for the
`<config>` and system paths on Linux, macOS, and Windows.

Every `.toml` file in a scanned directory is loaded. File names carry no
meaning beyond appearing in `/policies` output as the rule's source.

> **Limitations.** There is no per-project policy directory: policy files are
> not discovered from your working directory or from a project-local `.llxprt`
> directory. There is also no setting that points the loader at a specific
> file — the directory is the whole discovery mechanism. If you need different
> rules per project, start LLxprt Code with `--allowed-tools` in that project,
> or swap the contents of your user policy directory.

### Three things write files to that directory

| Source                                                   | Lands in                     | Takes effect                             |
| -------------------------------------------------------- | ---------------------------- | ---------------------------------------- |
| The policy manager (`/policies menu`)                    | `auto-saved.toml`            | Immediately on save                      |
| Files you write yourself                                 | Any other `.toml` you create | Next start, or when you open the manager |
| "Allow for all future sessions" at a confirmation prompt | `auto-saved.toml`            | When you pick that option                |

`auto-saved.toml` is the **managed file**: the manager and the confirmation
prompt both own it. Files you create yourself sit beside it and are never
rewritten by LLxprt Code.

Files are not the only source of tier 2 rules. CLI flags such as
`--allowed-tools`, the `tools.allowed`, `tools.exclude`, and MCP settings, and
in-session confirmations all produce tier 2 rules at fixed resolved
priorities without writing anything. Those are listed in
[Controlling Tool Execution](tool-permissions.md#where-each-rule-type-lands).

The "Allow for all future sessions" option (worded "Allow tool for all future
sessions" for an MCP tool) appears at a confirmation prompt only when the
folder is trusted and
[`security.enablePermanentToolApproval`](cli/configuration.md#security) is
`true`. That setting is a user-level boolean, `false` by default, and takes
effect without a restart.

Choosing the option does two things: it allows the tool for the rest of the
session at resolved priority 2.950, and it appends a rule to `auto-saved.toml`
at authored priority 100 (200 for an MCP tool) — resolved 2.100, or 2.200 —
which is what applies from the next start onwards. The saved rule is
deliberately weaker than the in-session one, so a higher-priority rule of your
own still wins later.

### Hand-editing the managed file

Editing `auto-saved.toml` in a text editor works, and the manager stays usable
afterwards: it re-reads the file before every change, so it never writes back a
stale copy. Four things to know before you do it.

- **Comments and formatting are not preserved.** Both the manager and a
  permanent confirmation rewrite the whole file, so hand-written comments in
  `auto-saved.toml` are lost the next time either one saves.
- **A `toolName` array does not survive an edit.** The form holds a single
  tool name, so a rule written as `toolName = ["replace", "write_file"]`
  appears in the menu as the wildcard `*`, and editing it through the manager
  replaces the list with an actual wildcard. That widens the rule to every
  tool, which for a `deny` rule is disruptive and for an `allow` rule is
  dangerous.
- **Other fields the form does not show are preserved.** A rule that carries
  `commandPrefix`, `commandRegex`, `mcpName`, or `modes` keeps those fields
  through an edit. They are still invisible in the form, so adding an args
  pattern to a rule that already has `commandPrefix` produces a combination the
  loader rejects.
- **A file the parser cannot read is replaced, not repaired.** If
  `auto-saved.toml` contains a TOML syntax error, a permanent confirmation
  overwrites it with just the newly approved rule.

Because of all four, keep your own rules — especially anything with an array,
a shorthand field, or a comment explaining it — in a file of your own, and let
`auto-saved.toml` stay managed.

If a file in the directory fails to load, opening the manager reports the
failure instead of silently dropping the rules.

## Priorities

When more than one rule matches a tool call, the highest priority wins.

There are two forms of the same number, and mixing them up is the most common
mistake on this page's subject:

- The **authored** priority is what you write in a file or type in the manager:
  an **integer from 0 to 999**. It is required.
- The **resolved** priority is what the engine compares and what `/policies`
  displays: `tier + authored / 1000`, a decimal.

So `priority = 500` in a file in your user directory resolves to **2.500**. The
same file placed in the built-in directory would resolve to 1.500. A decimal in
a file — `priority = 2.5` — is not a "resolved priority you wrote down", it is
a validation error, and the whole file is rejected.

| You write | In your user directory it resolves to | Beats                      |
| --------- | ------------------------------------- | -------------------------- |
| `0`       | 2.000                                 | Every default-tier rule    |
| `101`     | 2.101                                 | The MCP allowed list (2.1) |
| `301`     | 2.301                                 | `--allowed-tools` (2.3)    |
| `500`     | 2.500                                 | Everything below 2.5       |
| `999`     | 2.999                                 | Every lower user-tier rule |

Because the tier is added, **any** rule you write outranks **every** built-in
default, and **no** rule you write can outrank an administrator's policy. That
is the point of the split.

The fixed resolved priorities that flags, settings, and confirmations occupy
are listed in
[Controlling Tool Execution](tool-permissions.md#where-each-rule-type-lands).
When two rules resolve to the same priority, the first one loaded wins, so
choose a priority above the rule you mean to override rather than equal to it.

## Writing policy files by hand

Use a file of your own when you want rules under version control, a large set
of rules, comments explaining them, or fields the manager's form does not
offer.

Create any `.toml` file in your user policy directory — for example
`<config>/policies/my-rules.toml`:

```toml
# Auto-approve edits, keep confirming shell commands.

[[rule]]
toolName = "replace"
decision = "allow"
priority = 500

[[rule]]
toolName = "write_file"
decision = "allow"
priority = 500
```

Then either restart LLxprt Code or open `/policies menu`, which re-reads the
whole user policy directory. Confirm with `/policies list` that the rules
appear under **Tier 2 (User-defined)** at the resolved priorities you expect.

### Rule fields

Each rule is an entry in the `rule` array, written `[[rule]]`. `decision` and
`priority` are required; everything else is optional.

| Field              | Type             | Meaning                                                             |
| ------------------ | ---------------- | ------------------------------------------------------------------- |
| `decision`         | string           | `"allow"`, `"deny"`, or `"ask_user"`. Required.                     |
| `priority`         | integer 0–999    | Authored priority. Required.                                        |
| `toolName`         | string or array  | Exact tool name to match. Omit to match every tool.                 |
| `argsPattern`      | string           | Regular expression matched against the serialized JSON arguments.   |
| `commandPrefix`    | string or array  | Shorthand: match shell commands starting with this text.            |
| `commandRegex`     | string           | Shorthand: match the shell command against this regular expression. |
| `mcpName`          | string           | Match tool names beginning with `<mcpName>__`.                      |
| `modes`            | array of strings | Restrict the rule to `"default"`, `"autoEdit"`, and/or `"yolo"`.    |
| `allowRedirection` | boolean          | Let an allowed shell command contain a redirection.                 |

#### `toolName`

Matching is **exact** and case-sensitive; there is no prefix or glob matching.
Omit the field entirely for a wildcard.

```toml
# One specific tool.
[[rule]]
toolName = "read_many_files"
decision = "allow"
priority = 500

# Several tools, written once. An array expands to one rule per name.
[[rule]]
toolName = ["glob", "read_file", "search_file_content"]
decision = "allow"
priority = 500

# Every tool: omit toolName.
[[rule]]
decision = "ask_user"
priority = 0
```

`/policies list` prints the name of every tool that already has a rule, which
covers the built-ins below because each one is named by a default policy:

- Read-only, allowed by default: `glob`, `search_file_content`,
  `list_directory`, `read_file`, `read_many_files`, `read_line_range`,
  `exa_web_search`, `task`, `todo_read`, `todo_write`, `todo_pause`,
  `list_subagents`.
- Write and shell, confirmed by default: `replace`, `write_file`,
  `run_shell_command`, `insert_at_line`, `delete_line_range`, `apply_patch`,
  `ast_edit`, `save_memory`, `activate_skill`.

#### `argsPattern`

The tool's arguments are serialized to compact, key-sorted JSON, then the
pattern is tested against that string. A shell call produces:

```text
{"command":"rm -rf /","dir_path":"packages/core"}
```

so a pattern that targets the command has to account for the surrounding JSON:

```toml
[[rule]]
toolName = "run_shell_command"
argsPattern = "\"command\":\"git\\s+push"
decision = "ask_user"
priority = 600
```

Write every regex backslash doubled: TOML's basic strings consume one level of
escaping, so `\\s` in the file reaches the regex engine as `\s`. A single `\s`
is an invalid TOML escape and rejects the file. If that is hard to read, use
`commandPrefix` or `commandRegex` below, which build the JSON part for you.

Patterns are matched anywhere in the serialized string unless you anchor them,
so keep them specific — `"/etc/"` matches any argument mentioning `/etc/`,
including a `dir_path` you did not mean to target.

Two constraints apply to `argsPattern` that ordinary regular expressions do not
have, both to keep a policy file from stalling the engine on a pathological
pattern:

- `.*` is narrowed to "any run of characters that are not a double quote", so a
  wildcard cannot silently run past the end of one JSON value into the next.
  Anything you intend to span fields has to be written out.
- A pattern longer than 1024 characters, or one with two quantifiers directly
  adjacent (`a+*`), is rejected and its rule is skipped.

`commandRegex` is subject to the same length and quantifier limits, but not to
the `.*` narrowing — it is already scoped to the command value.

#### `commandPrefix` and `commandRegex`

Both are shorthands for matching a shell command without writing the JSON
wrapper. They apply only to `toolName = "run_shell_command"` written as a plain
string, and each is mutually exclusive with the other and with `argsPattern`.

```toml
# Auto-approve read-only git commands.
[[rule]]
toolName = "run_shell_command"
commandPrefix = ["git status", "git diff", "git log"]
decision = "allow"
priority = 500

# Always confirm a force push.
[[rule]]
toolName = "run_shell_command"
commandRegex = "git\\s+push\\s+.*--force"
decision = "ask_user"
priority = 600
```

`commandPrefix` matches the beginning of the command and requires whitespace or
the end of the command after it, so `git status` does not match `git statuses`.
An array expands to one rule per prefix.

#### `mcpName`

Policies see an MCP tool as `<server>__<tool>`. `mcpName` is the server name:
on its own it matches every tool from that server, and with `toolName` it
matches one tool exactly.

```toml
# One tool from one server.
[[rule]]
mcpName = "issue-tracker"
toolName = "search"
decision = "allow"
priority = 500

# Everything else from the same server.
[[rule]]
mcpName = "issue-tracker"
decision = "ask_user"
priority = 400
```

> **Note:** the name the model uses for an MCP tool is longer — it carries an
> extra `mcp__` prefix — but that is not the name policies match. Always write
> the server name alone in `mcpName`, and `<server>__<tool>` if you prefer to
> spell the match out in `toolName`.

#### `modes`

A rule with `modes` is active only in the listed approval modes; a rule without
it is always active. The values are `"default"`, `"autoEdit"`, and `"yolo"`.
Switching modes takes effect immediately — nothing is reloaded.

```toml
# Only auto-approve patch application while auto-edit mode is on.
[[rule]]
toolName = "apply_patch"
decision = "allow"
priority = 500
modes = ["autoEdit"]
```

#### `allowRedirection`

When a shell command is allowed by a rule and the command contains a
redirection (`>`, `>>`, and similar), the allow is downgraded to a confirmation
— or to a denial when running non-interactively. Set `allowRedirection = true`
on the rule to permit it.

```toml
[[rule]]
toolName = "run_shell_command"
commandPrefix = "npm test"
decision = "allow"
allowRedirection = true
priority = 500
```

Compound shell commands are split and each part is evaluated on its own, so an
allow rule cannot be used to smuggle a second command through a `&&`.

## Worked examples

### Auto-approve reads, confirm writes, block a directory

```toml
# Read-only tools never prompt.
[[rule]]
toolName = ["glob", "list_directory", "read_file", "search_file_content"]
decision = "allow"
priority = 400

# Edits keep prompting. Stated in your own tier so that a CLI flag such as
# --allowed-tools (resolved 2.3) cannot quietly auto-approve them.
[[rule]]
toolName = ["replace", "write_file"]
decision = "ask_user"
priority = 400

# Nothing may touch system configuration.
[[rule]]
toolName = ["replace", "write_file"]
argsPattern = "/etc/"
decision = "deny"
priority = 700
```

### Deny by default, allow an explicit list

```toml
# Everything is denied unless a higher-priority rule says otherwise.
[[rule]]
decision = "deny"
priority = 300

[[rule]]
toolName = ["read_file", "read_many_files", "glob"]
decision = "allow"
priority = 400
```

Put the wildcard at the lowest priority in the file and every allowance above
it. Remember the wildcard also outranks the built-in defaults, because it is in
your tier.

### Shell: allow a safe set, block a dangerous one

```toml
[[rule]]
toolName = "run_shell_command"
commandPrefix = ["ls", "pwd", "echo", "cat", "git status"]
decision = "allow"
priority = 500

[[rule]]
toolName = "run_shell_command"
commandRegex = "rm\\s+-rf"
decision = "deny"
priority = 800
```

LLxprt Code already hard-blocks irreversibly destructive commands before any
rule is consulted; see
[Dangerous command blocking](tool-permissions.md#dangerous-command-blocking).
A deny rule like the one above is for patterns you want blocked that are not
inherently destructive.

### Govern an MCP server

```toml
# Allow one tool from a server you trust.
[[rule]]
mcpName = "docs-search"
toolName = "query"
decision = "allow"
priority = 500

# Everything else from that server still asks.
[[rule]]
mcpName = "docs-search"
decision = "ask_user"
priority = 400

# Block a server outright.
[[rule]]
mcpName = "untrusted-server"
decision = "deny"
priority = 700
```

### Replace `--allowed-tools`

`--allowed-tools replace,write_file,glob` produces allow rules at resolved
priority 2.3. The file equivalent, at a priority that also outranks the flag:

```toml
[[rule]]
toolName = ["replace", "write_file", "glob"]
decision = "allow"
priority = 350
```

See [Migrating from Approval Mode to Policies](migration/approval-mode-to-policies.md)
for the rest of the legacy flag mapping.

## Troubleshooting

### The file was rejected

Load errors are reported at startup. They always name the file, and a field
error names the offending field; the rule number in the message header is not
reliable, so read the field path instead. How much an error costs you depends
on its kind:

| Problem                                                                       | Effect                                                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| TOML syntax error, or any field that fails validation                         | The **whole file** is discarded — one bad rule takes the rest with it            |
| A pattern that does not compile or exceeds the [pattern limits](#argspattern) | That one rule is skipped; the rest load                                          |
| Shell shorthand used incorrectly                                              | Reported as invalid, but the rule still loads — fix it rather than relying on it |

By far the most common cause is a decimal priority, which discards the file:

```text
# Rejected: priority must be an integer.
priority = 2.5

# Correct: the integer that resolves to 2.500 in your user directory.
priority = 500
```

Other whole-file rejections:

```text
# Rejected: priority is required on every rule.
[[rule]]
toolName = "replace"
decision = "allow"

# Rejected: priority above the authored maximum of 999.
priority = 1500

# Rejected: decision must be quoted.
decision = allow

# Rejected: "allowed" is not a decision. Use allow, deny, or ask_user.
decision = "allowed"

# Rejected: single backslash is not a valid TOML escape.
argsPattern = "\s+"

# Correct.
argsPattern = "\\s+"

# Rejected: [rule] declares a table, not an array entry.
[rule]

# Correct.
[[rule]]
```

And the shorthand misuse, which is reported but not blocked — here
`commandPrefix` is applied to `replace` as well, which can never match a shell
command:

```text
# Invalid: commandPrefix requires toolName to be the plain string
# "run_shell_command".
[[rule]]
toolName = ["run_shell_command", "replace"]
commandPrefix = "git status"
decision = "allow"
priority = 500
```

### The rule loaded but never matches

1. Run `/policies list` and confirm the rule is there with the resolved
   priority you expected.
2. Check the tool name against the name in that output. Matching is exact —
   `shell` does not match `run_shell_command`, and `grep` does not match
   `search_file_content`.
3. If the rule uses `argsPattern`, test it against the serialized JSON rather
   than against the value you have in mind, and remember that `.*` is narrowed
   to "anything but a quote" — see [`argsPattern`](#argspattern).
4. For an MCP tool, the name policies match is `<server>__<tool>`, without the
   longer prefix the model sees — see [`mcpName`](#mcpname).
5. If the rule carries `modes`, check that the listed mode is the one you are
   in. Mode-gated rules are listed by `/policies list` whether or not they
   currently apply.

### The rule matches but loses

A higher-priority rule is winning. `/policies list` is sorted by resolved
priority, so the winner is above yours. Raise your authored integer above the
rule you are trying to beat: 301 or higher to outrank `--allowed-tools`
(resolved 2.3), 951 or higher to outrank the in-session rule a confirmation
creates (resolved 2.95).

### A new file has no effect

Files you write by hand are read when LLxprt Code starts. Restart it, or open
`/policies menu`, which re-reads the whole user policy directory. Changes made
inside the manager never need either.

### Everything is denied in CI

Running non-interactively turns every `ask_user` decision into a denial,
because there is nobody to answer the prompt. Add explicit allow rules for the
tools your automation needs.

## Related documentation

- [Controlling Tool Execution](tool-permissions.md) — tiers, approval modes,
  dangerous-command blocking, and how a decision is reached.
- [Migrating from Approval Mode to Policies](migration/approval-mode-to-policies.md)
  — replacing legacy flags and settings with policy files.
- [Application Directories](reference/application-directories.md) — where the
  user and system policy directories are on each platform.
