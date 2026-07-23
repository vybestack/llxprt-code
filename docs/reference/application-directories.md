# Application Directories

LLxprt Code stores its files in **OS-standard, platform-appropriate locations** organized into four categories. This page is the canonical reference for where files live on Linux, macOS, and Windows, how to override those locations, and how the legacy `~/.llxprt` layout is handled during migration.

If you only read one thing, read the [Quick reference](#quick-reference) table. Everything else is a deeper explanation of those four rows.

## Why this matters

Older versions of LLxprt Code kept every file under `~/.llxprt`. That works on Linux but is wrong elsewhere: macOS users expect preferences in `~/Library/Preferences`, Windows users expect app data under `%LOCALAPPDATA%`, and none of those users expect secrets sitting next to editable config. The current layout follows the conventions each operating system already defines (the same conventions your browser, editor, and shell use), so backups, disk-cleanup tools, and IT policies do the right thing automatically.

The migration is automatic: the first time you start a new version, LLxprt copies your existing `~/.llxprt` files into their new homes. You do not need to move anything by hand.

## Quick reference

LLxprt splits its files across four categories. Each category has an environment variable override and a per-platform default.

| Category      | Holds                                                                                                                                   | Override (env var)   | Fallback override                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------- |
| **Config**    | User-editable settings, profiles, prompts, commands, skills, policies, sandbox profiles, subagents, hooks config, global memory, `.env` | `LLXPRT_CONFIG_HOME` | _(none — uses platform default)_ |
| **Data**      | App-managed durable data: credentials/accounts, OAuth token fallback, conversations, history, todos, user extensions, secure store      | `LLXPRT_DATA_HOME`   | `LLXPRT_CONFIG_HOME`             |
| **Cache**     | Disposable caches and dumps — safe to delete at any time                                                                                | `LLXPRT_CACHE_HOME`  | `LLXPRT_CONFIG_HOME`             |
| **Log/state** | Logs, debug output, temp dirs, checkpoints, shell history, OAuth advisory locks, OTEL telemetry artifacts                               | `LLXPRT_LOG_HOME`    | `LLXPRT_CONFIG_HOME`             |

The data, cache, and log/state categories all fall back to `LLXPRT_CONFIG_HOME` when their own override is unset. This keeps tests and single-root deployments simple: setting `LLXPRT_CONFIG_HOME` alone redirects everything.

### Platform defaults

| Category      | Linux                        | macOS                                       | Windows                            |
| ------------- | ---------------------------- | ------------------------------------------- | ---------------------------------- |
| **Config**    | `~/.config/llxprt-code`      | `~/Library/Preferences/llxprt-code`         | `%APPDATA%\llxprt-code\Config`     |
| **Data**      | `~/.local/share/llxprt-code` | `~/Library/Application Support/llxprt-code` | `%LOCALAPPDATA%\llxprt-code\Data`  |
| **Cache**     | `~/.cache/llxprt-code`       | `~/Library/Caches/llxprt-code`              | `%LOCALAPPDATA%\llxprt-code\Cache` |
| **Log/state** | `~/.local/state/llxprt-code` | `~/Library/Logs/llxprt-code`                | `%LOCALAPPDATA%\llxprt-code\Log`   |

> **Windows note:** Data, cache, and log/state live under `%LOCALAPPDATA%` (machine-local), **not** `%APPDATA%` (roaming). Credentials and logs should not roam between machines. The config category is the one exception — it lives under `%APPDATA%` (roaming) so your preferences follow you across machines, as is conventional for Windows applications.

### Finding your effective paths

Because the effective location depends on both your platform and any environment variables you've set, prefer discovering the path at runtime rather than hard-coding it. From a shell:

```bash
# Print all four category defaults for this platform (ignores overrides)
node -e "import('env-paths').then(m => console.log(m.default('llxprt-code', { suffix: '' })))"

# Print the config directory, honoring LLXPRT_CONFIG_HOME
LLXPRT_CONFIG_HOME="${LLXPRT_CONFIG_HOME:-}" \
  node -e "console.log(process.env.LLXPRT_CONFIG_HOME || (await import('env-paths')).default('llxprt-code', { suffix: '' }).config)"
```

If you're documenting a path inline and need a shorthand, use the category names: `<config>`, `<data>`, `<cache>`, and `<log>`. This page is the single place those shorthands are defined.

## What lives in each category

### Config — things you edit

The config category holds files you are expected to open in a text editor. LLxprt will never overwrite these without your action.

| Path                      | What it is                                                                  |
| ------------------------- | --------------------------------------------------------------------------- |
| `<config>/settings.json`  | User-level settings (themes, model defaults, MCP servers, hooks, etc.)      |
| `<config>/profiles/`      | Saved provider/model profiles (`/profile save`)                             |
| `<config>/prompts/`       | Prompt overrides and installed prompt packs                                 |
| `<config>/commands/`      | Custom slash commands (`/commands` authoring)                               |
| `<config>/skills/`        | Personal agent skills (see [Skills](../cli/skills.md))                      |
| `<config>/policies/`      | TOML policy files (see [Policy Configuration](../policy-configuration.md))  |
| `<config>/sandboxes/`     | Sandbox profiles (see [Sandbox Profiles](../cli/sandbox-profiles.md))       |
| `<config>/subagents/`     | Subagent definitions (see [Subagents](../subagents.md))                     |
| `<config>/LLXPRT.md`      | Global memory / context file                                                |
| `<config>/.LLXPRT_SYSTEM` | Global system memory (added programmatically via `/memory add core.global`) |
| `<config>/.env`           | User-level environment file loaded at startup                               |

> Hooks defined **in** `settings.json` always live in config (because `settings.json` does). Hook **scripts** that those hooks invoke can live anywhere on your system — their path is whatever you put in the `command` field.

### Data — things LLxprt manages

The data category holds durable files LLxprt writes and reads on your behalf. You usually don't edit these directly.

| Path                            | What it is                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `<data>/provider_accounts.json` | Provider account registry                                                                        |
| `<data>/google_accounts.json`   | Google account registry                                                                          |
| `<data>/mcp-oauth-tokens.json`  | MCP server OAuth tokens                                                                          |
| `<data>/oauth_creds.json`       | Legacy OAuth credentials filename (migration input)                                              |
| `<data>/secure-store/`          | Encrypted fallback for secrets when the OS keyring is unavailable                                |
| `<data>/extensions/`            | User-installed extensions                                                                        |
| `<data>/providers/`             | User-defined provider aliases (see [Providers](../cli/providers.md))                             |
| `<data>/conversations/`         | Conversation logs (when conversation logging is enabled)                                         |
| `<data>/history/<hash>/`        | Per-project checkpoint shadow Git repository (used for undo/redo checkpoints, not shell history) |
| `<data>/installation_id`        | Anonymous installation identifier                                                                |
| `<data>/machine_secret`         | Secret used to encrypt the secure-store fallback                                                 |

### Cache — safe to delete

The cache category holds regenerable data. Deleting it frees disk space without losing configuration or credentials.

| Path             | What it is                                                       |
| ---------------- | ---------------------------------------------------------------- |
| `<cache>/cache/` | General-purpose cache                                            |
| `<cache>/dumps/` | Context dumps (see [Context Dumping](../cli/context-dumping.md)) |

### Log/state — ephemeral runtime artifacts

The log/state category holds logs, temp files, and short-lived runtime state.

| Path                                    | What it is                                            |
| --------------------------------------- | ----------------------------------------------------- |
| `<log>/debug/`                          | Debug logs (`LLXPRT_DEBUG`)                           |
| `<log>/tmp/<projectHash>/`              | Per-project temp directory                            |
| `<log>/tmp/<projectHash>/checkpoints/`  | Undo/redo checkpoints                                 |
| `<log>/tmp/<projectHash>/shell_history` | Shell command history (per project)                   |
| `<log>/oauth/locks/`                    | OAuth refresh/advisory locks (contain no credentials) |
| `<log>/tmp/<projectHash>/otel/`         | OpenTelemetry collector artifacts (when enabled)      |

## Credential and token storage

OAuth tokens and API keys use a layered storage model:

1. **OS keyring (primary)** — macOS Keychain, GNOME Keyring / KWallet, or Windows Credential Vault, accessed via `@napi-rs/keyring`. This is encrypted at rest and requires authentication to read.
2. **Encrypted file fallback (secondary)** — if the keyring is unavailable, tokens fall back to encrypted files under `<data>/secure-store/<service>/`. These files are encrypted with a machine-local secret (`<data>/machine_secret`) and are **not** plain JSON.
3. **OAuth advisory locks** — short-lived, credential-free lock files under `<log>/oauth/locks/` that coordinate concurrent refresh attempts. They contain no secrets. Stale locks left behind by a crashed process are reclaimed **only when the owner's PID is verifiably dead** (probed via `process.kill(pid, 0)`); a malformed or tokenless lock carries no verifiable owner identity and is left in place (deferred to manual cleanup) as a conservative safety-over-availability choice. If you encounter a stuck lock, remove it manually only when no LLxprt process is running.

The legacy `oauth_creds.json` plaintext token files (under the old `~/.llxprt` directory, or `~/.gemini/oauth_creds.json` from Gemini CLI) are obsolete. They are read **only** as a one-time migration input; LLxprt never creates them during normal operation.

See [OAuth Setup](../oauth-setup.md) for the user-facing OAuth workflow.

## Override precedence

Each category resolves its directory in this order:

1. Its own environment variable (e.g. `LLXPRT_DATA_HOME`).
2. `LLXPRT_CONFIG_HOME` (for data, cache, and log/state only).
3. The platform default from `envPaths('llxprt-code')`.

Config has no fallback — only `LLXPRT_CONFIG_HOME` or the platform default.

All overrides must be **absolute paths**. Relative paths and empty strings are ignored, so an unset variable behaves the same as one set to `""`.

```bash
# Example: redirect everything to a single portable directory
export LLXPRT_CONFIG_HOME=/srv/llxprt-config
# LLXPRT_DATA_HOME, LLXPRT_CACHE_HOME, LLXPRT_LOG_HOME are unset,
# so all three fall back to /srv/llxprt-config.

# Example: keep config under XDG but move large data elsewhere
export LLXPRT_DATA_HOME=/big-disk/llxprt-data
```

## Workspace-local `.llxprt`

A directory named `.llxprt` **inside your project** is always valid and is unrelated to the legacy global `~/.llxprt`. Workspace-local files override their user-level counterparts and are intended to be committed to version control so a team shares commands, skills, hooks, and project memory.

Workspace paths are produced by `new Storage(projectRoot).<method>` and include:

| Path                              | Scope                                   |
| --------------------------------- | --------------------------------------- |
| `<project>/.llxprt/settings.json` | Workspace settings (highest precedence) |
| `<project>/.llxprt/commands/`     | Workspace custom commands               |
| `<project>/.llxprt/skills/`       | Workspace agent skills                  |
| `<project>/.llxprt/extensions/`   | Workspace extensions                    |
| `<project>/.llxprt/LLXPRT.md`     | Workspace memory / context file         |

These are not affected by `LLXPRT_*_HOME` overrides. They live relative to your project root, period.

## Legacy migration

On startup, LLxprt checks for a legacy `~/.llxprt` directory. If present and not previously migrated, it copies files into the correct categories above and writes a global one-time completion marker (`.migration-complete.json`) so the copy pass runs at most once. For global memory files (`LLXPRT.md`, `.LLXPRT_SYSTEM`), a separate reconciliation pass moves any copies the memory tool previously wrote into the **data** category into the canonical **config** category. This pass writes its own per-file completion marker (`.memory-reconcile-complete.json`) that records each reconciled filename's identity, so late-appearing or changed sources are still picked up while already-reconciled files are skipped.

### Completion marker semantics

The two markers are distinct and serve different purposes:

| Marker                            | Location | Scope                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | -------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.migration-complete.json`        | `<data>` | **Global, one-time**  | Suppresses the entire legacy `~/.llxprt` → canonical copy pass after the first successful run. Once written, the copy pass is skipped on every subsequent startup.                                                                                                                                                                                                                                                                                                                                          |
| `.memory-reconcile-complete.json` | `<data>` | **Per-file identity** | Records which default global memory filenames (`LLXPRT.md`, `.LLXPRT_SYSTEM`) have been reconciled from data to config. Unlike the global migration marker, this marker does NOT suppress a rescan: on every startup, the bounded set of data-side memory source paths is re-scanned, and any source whose per-file identity is not yet recorded (or whose content differs from its archived backup) is reconciled. This handles late-appearing or changed sources while skipping already-reconciled files. |

- **`~/.llxprt` is an input only.** LLxprt reads from it during migration; it never writes new files there during normal operation.
- **Migration is idempotent per file.** Re-running with a file's marker present (and identity unchanged) is a no-op for that file.
- **Nothing is deleted.** Your old files remain in place after migration; you can remove them manually once you've confirmed everything works.
- **Override interaction.** Migration is skipped entirely when `LLXPRT_CONFIG_HOME` is set, on the assumption that you've taken control of your layout. To migrate into a custom location, unset the override for one run, then re-set it.

If you want to import settings or memory from a legacy `~/.llxprt` after migration has already completed (for example, you deleted the new files and want to re-copy), see [Tips for Gemini CLI Users](../gemini-cli-tips.md) for a manual import technique.

## System-level settings (administrators)

Settings and policies can also be placed in system-wide locations that apply to all users on the machine. These are **outside** the four-category user layout:

| Platform | System settings path                                    | Override env var              |
| -------- | ------------------------------------------------------- | ----------------------------- |
| Linux    | `/etc/llxprt-code/settings.json`                        | `LLXPRT_SYSTEM_SETTINGS_PATH` |
| macOS    | `/Library/Application Support/LlxprtCode/settings.json` | `LLXPRT_SYSTEM_SETTINGS_PATH` |
| Windows  | `C:\ProgramData\llxprt-code\settings.json`              | `LLXPRT_SYSTEM_SETTINGS_PATH` |

Both the CLI settings loader and the policy engine resolve the system settings
path through the single canonical `Storage.getSystemSettingsPath()` authority.
The system `policies/` directory always lives beside the resolved settings
path.

A legacy alias `LLXPRT_CODE_SYSTEM_SETTINGS_PATH` is honored as a bounded
backward-compatibility fallback inside Storage when the canonical env var is
unset. Prefer `LLXPRT_SYSTEM_SETTINGS_PATH` for new deployments.

System policies live in a `policies/` directory beside the system settings file.
See [Enterprise Configuration](../cli/enterprise.md) for details.

## Related

- [Configuration](../cli/configuration.md) — the user settings file and its precedence
- [OAuth Setup](../oauth-setup.md) — OAuth workflow and credential storage
- [Memory](../tools/memory.md) — global vs. project memory files
- [Policy Configuration](../policy-configuration.md) — TOML policy file locations
