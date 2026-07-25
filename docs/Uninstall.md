# Uninstalling LLxprt Code

Your uninstall method depends on how you installed LLxprt Code.

## Homebrew (macOS)

If you installed via Homebrew:

```bash
brew uninstall llxprt-code
```

You may also remove the tap if you no longer need it:

```bash
brew untap vybestack/homebrew-tap
```

## Global npm installation

If you installed LLxprt Code globally with npm, uninstall it the same way:

```bash
npm uninstall -g @vybestack/llxprt-code
```

This removes the package and the `llxprt` command from your system.

## Verify the removal

```bash
llxprt --version
```

You should see `command not found` (or the equivalent for your shell).

## npx does not permanently install anything

If you ran LLxprt Code via `npx @vybestack/llxprt-code`, there is no permanent
or global installation to remove. `npx` runs packages from a temporary cache
rather than adding a global install or a `llxprt` command to your PATH. It does,
however, download package contents into the npm cache (see below for optional
cache clearing).

## Optional: Remove user data

Uninstalling the package does not delete your settings, conversation logs,
profiles, credentials, or other user data. LLxprt Code stores files across
four OS-standard category directories plus workspace-local `.llxprt`
directories. See [Application Directories](./reference/application-directories.md)
for the exact paths on each platform.

To remove everything:

1. **Config** — user-editable settings, profiles, prompts, commands, skills,
   policies, hooks config, global memory (`.llxprt/LLXPRT.md`):
   - Override: `LLXPRT_CONFIG_HOME`
   - Default: `~/.config/llxprt-code` (Linux),
     `~/Library/Preferences/llxprt-code` (macOS),
     `%APPDATA%\llxprt-code\Config` (Windows)

2. **Data** — credentials/accounts, conversations, history, extensions:
   - Override: `LLXPRT_DATA_HOME` (falls back to `LLXPRT_CONFIG_HOME`)
   - Default: `~/.local/share/llxprt-code` (Linux),
     `~/Library/Application Support/llxprt-code` (macOS),
     `%LOCALAPPDATA%\llxprt-code\Data` (Windows)

3. **Cache** — disposable caches and dumps (safe to delete):
   - Override: `LLXPRT_CACHE_HOME` (falls back to `LLXPRT_CONFIG_HOME`)
   - Default: `~/.cache/llxprt-code` (Linux),
     `~/Library/Caches/llxprt-code` (macOS),
     `%LOCALAPPDATA%\llxprt-code\Cache` (Windows)

4. **Log/state** — logs, debug output, checkpoints, shell history:
   - Override: `LLXPRT_LOG_HOME` (falls back to `LLXPRT_CONFIG_HOME`)
   - Default: `~/.local/state/llxprt-code` (Linux),
     `~/Library/Logs/llxprt-code` (macOS),
     `%LOCALAPPDATA%\llxprt-code\Log` (Windows)

Additionally:

- **Workspace-local `.llxprt/`** — each project may have a `.llxprt/` directory
  containing workspace settings, commands, skills, and project memory. Remove
  these individually from each project.
- **Legacy `~/.llxprt`** — older versions stored everything under `~/.llxprt`.
  If you migrated, the old directory is left in place as a read-only input; you
  can remove it manually once you've confirmed the new locations work.
- **OS keyring credentials** — OAuth tokens and API keys may be stored in the
  OS keyring (macOS Keychain, GNOME Keyring/KWallet, Windows Credential Vault).
  These are not removed by deleting files. Remove them manually if needed.

> **Important:** Deleting a single directory does not remove all data. LLxprt
> Code's files are split across the four category directories above. Check each
> one if you need a complete removal.

## Optional: Clear the npx cache

> [!WARNING]
> Clearing the npx cache deletes **every** package you have ever run with `npx`,
> not just LLxprt Code. Only do this if you understand the consequences.

The npx cache lives in a `_npx` subdirectory inside your npm cache folder. Find
your npm cache path dynamically — do not hard-code it:

**macOS / Linux:**

```bash
rm -rf "$(npm config get cache)/_npx"
```

**Windows (PowerShell):**

```powershell
Remove-Item -Path (Join-Path (npm config get cache) "_npx") -Recurse -Force
```

**Windows (Command Prompt):**

```cmd
for /f "delims=" %i in ('npm config get cache') do rmdir /s /q "%i\_npx"
```
