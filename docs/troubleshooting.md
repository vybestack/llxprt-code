# Troubleshooting Guide

## Debugging Tools

LLxprt Code has built-in debugging tools. Start here before digging into logs.

### LLXPRT_DEBUG Environment Variable

Enable debug logging with namespace filtering:

```bash
# All debug output
LLXPRT_DEBUG='*' llxprt

# Specific namespaces
LLXPRT_DEBUG='llxprt:shell' llxprt
LLXPRT_DEBUG='llxprt:core:*' llxprt
LLXPRT_DEBUG='llxprt:tools:*,llxprt:shell' llxprt
```

Available namespaces:

| Namespace                      | What it logs                            |
| ------------------------------ | --------------------------------------- |
| `llxprt:shell`                 | Shell command execution                 |
| `llxprt:scheduler`             | Tool scheduling and dispatch            |
| `llxprt:core:hooks:*`          | Hook system (planner, registry, runner) |
| `llxprt:core:hook-triggers:*`  | Model and tool hook triggers            |
| `llxprt:core:tools:mcp-client` | MCP server communication                |
| `llxprt:tools:modifiable-tool` | Tool modification/interception          |
| `*`                            | Everything                              |

You can also use `DEBUG=llxprt:*` (the legacy form still works if the value contains `llxprt` namespaces), but `LLXPRT_DEBUG` is preferred and doesn't conflict with other tools.

Additional environment variables:

| Variable        | Description                               |
| --------------- | ----------------------------------------- |
| `DEBUG_LEVEL`   | Log level (e.g., `debug`, `info`, `warn`) |
| `DEBUG_OUTPUT`  | Output target (e.g., file path)           |
| `DEBUG_ENABLED` | `true`/`false` to force on/off            |

### /dumpcontext

Dumps the full model context (system prompt, conversation history, tool definitions, context files) to a JSON file so you can inspect exactly what's being sent to the provider:

```
/dumpcontext          # Show status and dump directory
/dumpcontext now      # Dump on next request only
/dumpcontext on       # Dump before every request
/dumpcontext error    # Dump only when errors occur
/dumpcontext off      # Stop dumping
```

Dumps are saved to `<cache>/dumps/` (see [Application Directories](./reference/application-directories.md)) as timestamped JSON files.

### /debug

Control the debug logger at runtime — same namespaces as `LLXPRT_DEBUG` but toggled without restarting. In interactive mode, press **F12** to open the debug console.

```
/debug status                    # Show current debug state
/debug enable                    # Enable all llxprt:* namespaces
/debug enable llxprt:shell       # Enable a specific namespace
/debug disable                   # Disable debug logging
/debug level debug               # Set log level
/debug output /tmp/llxprt.log    # Send debug output to a file
/debug persist                   # Toggle saving debug config across sessions
```

### /logging

Manages **conversation logging** (recording request/response pairs for later review), not debug logging:

```
/logging status                     # Show if conversation logging is on
/logging enable                     # Enable conversation logging
/logging disable                    # Disable conversation logging
/logging show [N]                   # Show last N log entries (default 50)
/logging redaction                  # View redaction settings
/logging redaction --api-keys=true  # Configure what gets redacted
```

### /diagnostics

Run system diagnostics to check your environment:

```
/diagnostics
```

Reports on Node.js version, installed providers, keyring availability, sandbox readiness, and other environment checks.

## Authentication

### Key Storage and the OS Keyring

LLxprt Code stores named keys in the **OS keyring** (macOS Keychain, GNOME Keyring, Windows Credential Manager) via `@napi-rs/keyring`. If the keyring is unavailable, it falls back to encrypted file storage in the OS-standard data directory (via `env-paths`):

- **macOS:** `~/Library/Application Support/llxprt-code/secure-store/`
- **Linux:** `~/.local/share/llxprt-code/secure-store/`
- **Windows:** `%LOCALAPPDATA%\llxprt-code\Data\secure-store` (see [Application Directories](./reference/application-directories.md))

To check which backend is active:

```bash
LLXPRT_DEBUG='*' llxprt 2>&1 | grep -i keyring
```

Look for `@napi-rs/keyring not loaded — unavailable` in the output — that means it's using the encrypted file fallback.

**Named keys (recommended):**

Save a key from inside a session:

```
/key save xai-prod your-api-key-value
```

Then use it at startup:

```bash
llxprt --provider xai --key-name xai-prod
```

**Common keyring issues:**

- **Linux headless/SSH:** No D-Bus session → keyring unavailable → falls back to encrypted files. This is fine — the fallback is secure.
- **Linux containers:** Same situation. Use `--keyfile` or `--key` if the encrypted fallback doesn't work.
- **macOS:** Keychain should work out of the box. If not, check `security list-keychains` in Terminal.

#### macOS: Repeated Keychain Password Prompts (Ad-hoc / Unsigned Bun)

On macOS, the launcher prefers a Bun already on `PATH` when it meets the pinned version floor (so npm re-installs do not unlink a running session — see [#2962](https://github.com/vybestack/llxprt-code/issues/2962)). But on macOS the **code signature** of that binary decides whether it can hold a durable Keychain grant, and a Bun that is ad-hoc signed or otherwise lacks a stable team identity (for example the Homebrew `homebrew/core` formula, which compiles from source and discards Oven's Developer ID) cannot.

The launcher inspects the selected Bun's designated code-signing requirement on startup and prints a single advisory warning to stderr when codesign inspection fails OR when a successful inspection lacks Oven's required team identity (`certificate leaf[subject.OU] = "7FRXF46ZSN"`), for example:

```text
LLxprt Code: the Bun on your PATH is ad-hoc signed or otherwise
lacks a stable team identity, so it cannot hold a persistent macOS
Keychain grant. You will be prompted for your login password on every
credential read, and "Always Allow" will not persist (#3020).
Install the official Bun release signed by Oven:
    brew uninstall bun && brew install oven-sh/bun/bun
    curl -fsSL https://bun.com/install | bash
```

**Why "Always Allow" does not work:** the Keychain ACL stored on each item is identity-based, so it matches any Oven-signed Bun anywhere on disk. A binary that is ad-hoc signed or has no team ID can never satisfy that requirement. Per [#3020](https://github.com/vybestack/llxprt-code/issues/3020), `change_acl` on these items has an empty application list, so clicking **Always Allow** is silently discarded — the prompt recurs on every credential read. Replacing the binary with Oven's signed build is the only durable fix.

**Why it is a warning, not a hard failure:** a Bun that is ad-hoc signed or has no team identity runs LLxprt Code correctly in every respect except Keychain access, and some users keep no credentials in the Keychain at all. Failing closed would break those working setups. Skipping it and falling through to the bundled Bun would silently re-enable the npm-unlink failure mode that #2962 exists to prevent, so the launcher warns and continues to use the selected Bun.

To install an Oven-signed Bun (either remedy clears the warning):

```bash
# Homebrew: use the official oven-sh tap instead of homebrew/core
brew uninstall bun && brew install oven-sh/bun/bun

# Or the official installer
curl -fsSL https://bun.com/install | bash
```

Verify the team identity afterward (it should report `7FRXF46ZSN`):

```bash
codesign -dv --requirements - "$(command -v bun)" 2>&1
```

This check is macOS-only; Linux and Windows never key credential access on code identity.

### Common Authentication Errors

**`Failed to login. Message: Request contains an invalid argument`**

Google Workspace or Google Cloud accounts may not qualify for the free Gemini API tier. Workarounds:

- Set `GOOGLE_CLOUD_PROJECT` to your project ID
- Get an API key from [AI Studio](https://aistudio.google.com/app/apikey)

**`API key not found` / `Invalid API key`**

Your key is missing or revoked. Check:

1. The key is set: `llxprt --provider xai --key-name xai-prod` (does it prompt?)
2. The key works: test it with curl against the provider API
3. The provider dashboard shows the key as active

**`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`**

You may be on a corporate network with a firewall that intercepts and inspects SSL/TLS traffic. This often requires a custom root CA certificate to be trusted by Node.js.

First try setting `NODE_USE_SYSTEM_CA`; if that does not resolve the issue, set `NODE_EXTRA_CA_CERTS`:

```bash
# Try this first - use OS native certificate store
export NODE_USE_SYSTEM_CA=1

# If that doesn't work, point to your corporate CA cert
export NODE_EXTRA_CA_CERTS=/path/to/your/corporate-ca.crt
```

### OAuth Troubleshooting

OAuth tokens are stored in the OS keyring (same as named keys). If authentication fails:

1. Try logging out and re-authenticating: `/auth anthropic logout` then `/auth anthropic enable`
2. If on a headless machine, use `--nobrowser` for manual code entry
3. Check `LLXPRT_DEBUG='*'` output for token refresh errors

See [OAuth Setup](./oauth-setup.md) for detailed OAuth configuration.

## Streaming and Retry Issues

**`stream interrupted, retrying` (attempt 2/6)**

LLxprt detected a transient network issue and is retrying automatically with exponential backoff. Usually no action needed. If persistent:

- Check your network connection
- Look for local proxy/firewall interference
- Increase retry settings: `/set retrywait 5000`

**`Request would exceed the <limit> token context window even after compression`**

The conversation plus system prompt exceeds the model's context limit. Solutions:

- Run `/compress` to compress history
- Shorten your LLXPRT.md files
- Lower max output tokens: `/set modelparam max_tokens 4096`
- Start fresh: `/clear`

## PowerShell @ Symbol Issues

PowerShell's IntelliSense treats `@` as a hashtable literal start, causing lag. LLxprt automatically detects PowerShell and enables `+` as an alternative prefix:

```powershell
# Use + instead of @ in PowerShell
+path/to/file.txt
```

## Common Error Messages

**Image generation is unavailable**

Image generation runs on your Codex account and is independent of the provider
you are chatting with. If it reports that it is unavailable, Codex OAuth is
almost always not set up. Run `/auth codex enable`, then retry — the browser
login opens on that first request. See
[Image Generation](./tools/image-generation.md) for the full guide.

**`EADDRINUSE` (MCP server)**

Another process is using that port. Stop it or configure a different port in your MCP server settings.

**`Command not found`**

LLxprt isn't in your PATH. If installed globally: check `npm root -g`. If from source: use `bun scripts/start.ts` (the dev launcher) or run `bun install` then `bun run start`.

**`MODULE_NOT_FOUND`**

Run `bun install` to restore dependencies. If the error references a `dist/` file, run `bun run build` (or `npm run build`) to recompile the TypeScript sources.

**`Operation not permitted`**

Sandbox is blocking the operation. See [Sandboxing](./sandbox.md) for how to adjust sandbox profiles.

**CLI not interactive in CI environments**

The `is-in-ci` package detects `CI`, `CONTINUOUS_INTEGRATION`, or any `CI_*` env var and forces non-interactive mode. Workaround: `env -u CI_TOKEN llxprt`

## Exit Codes

| Exit Code | Error Type                 | Description                                                                                                                                         |
| --------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 41        | `FatalAuthenticationError` | Authentication failed                                                                                                                               |
| 42        | `FatalInputError`          | Invalid input (non-interactive mode)                                                                                                                |
| 43        | Launcher runtime failure   | Bundled Bun runtime missing, corrupt, wrong platform, or an unrecognized native format — reinstall `@vybestack/llxprt-code` or visit https://bun.sh |
| 44        | `FatalSandboxError`        | Sandbox setup failed                                                                                                                                |
| 52        | `FatalConfigError`         | Invalid settings.json                                                                                                                               |
| 53        | `FatalTurnLimitedError`    | Max turns reached (non-interactive mode)                                                                                                            |

## Sandbox Issues

See [Sandboxing](./sandbox.md) for full sandbox documentation including Docker/Podman setup, credential proxying, SSH agent passthrough, and sandbox profiles.

Quick troubleshooting:

**Docker daemon not running:** Start Docker Desktop (macOS) or `sudo systemctl start docker` (Linux).

**Podman machine not running (macOS):** `podman machine start`. If stuck: `podman machine stop && podman machine rm && podman machine init && podman machine start`.

**Credential proxy not starting:** The proxy needs a working OS keyring. On headless Linux, use `--key` or `--keyfile` instead.

**SSH agent issues in Podman macOS:** Launchd-managed sockets don't work in the VM. Create a dedicated socket:

```bash
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock
ssh-add ~/.ssh/id_ed25519
llxprt --sandbox-engine podman
```

**Podman macOS: exit code 137 / OOM with high memory settings:** The Podman VM memory is lower than the container `--memory` limit. On macOS, Podman containers run inside a VM, and the VM memory is the hard ceiling — LLxprt container flags do not resize the VM. Check with `podman machine inspect --format '{{.Resources.Memory}}'` and resize with `podman machine set --memory <MB>`. See [Sandbox troubleshooting](./sandbox.md#podman-macos-oom-killed-with-exit-code-137) for full details.

**Enable sandbox debug output:**

```bash
LLXPRT_DEBUG='*' llxprt --sandbox "your prompt"
```

## FAQs

**How do I update LLxprt Code?**

- **npm (global install):** `npm install -g @vybestack/llxprt-code@latest`
- **Homebrew:** `brew upgrade llxprt-code`
- **From source:** Pull the latest source, run `bun install`, then `bun run start` (or `bun scripts/start.ts` for the dev launcher).

**Where are config files stored?**

User settings live in LLxprt's [config directory](./reference/application-directories.md) (e.g. `~/.config/llxprt-code/settings.json` on Linux); project settings live at `.llxprt/settings.json` in your project root. See [Configuration](./cli/configuration.md).

**Why don't I see cached token counts in /stats?**

Cache metrics only appear when the provider supports and reports them. OAuth users may not see cache stats if the backend doesn't support cached content creation.

## Building from Source

The CLI's installed command uses platform-native launchers (`packages/cli/bin/llxprt`) that resolve the package-bundled [Bun](https://bun.sh) and execute the TypeScript entrypoint (`packages/cli/index.ts`) directly — no Node process is started on the installed path. No pre-compiled CLI `dist/` artifact or retired `bundle/llxprt.js` artifact is required for the CLI to run.

To build from source:

```bash
git clone https://github.com/vybestack/llxprt-code.git
cd llxprt-code
bun install
bun run start
```

For development, use the dev launcher:

```bash
bun scripts/start.ts
```

Type checking uses `tsc --noEmit` (no JavaScript output is produced):

```bash
bun run typecheck
```

## Platform Caveats

### Windows pty Behavior

On Windows, the `node-pty` module has a known terminal resize race condition (`Cannot resize a pty that has already exited`). The CLI silences this specific error at the process level and uses `@lydell/node-pty` (with `node-pty` as fallback) — **not** the Bun adapter. The `bun-pty` adapter (`packages/core/src/utils/bunPtyAdapter.ts`) is POSIX-only and is not used on Windows. If you encounter terminal sizing or resize issues on Windows, use a compatible terminal emulator; the resize race is in `node-pty` itself, not the Bun runtime.

The `@lydell/node-pty` ConPTY path is verified under Bun on Windows by the nightly native-module smoke. A hosted Windows Server 2025 run passed with Bun 1.3.14, including streamed PTY data and a real zero exit callback, so Bun on Windows continues to use this path. See the [hosted smoke result](https://github.com/vybestack/llxprt-code/actions/runs/29534151672/job/87741315456).

## See Also

- [Authentication](./cli/authentication.md) — key management, keyring, OAuth
- [Sandboxing](./sandbox.md) — container setup, credential proxy, SSH agent
- [Configuration](./cli/configuration.md) — settings.json reference
- [Settings and Profiles](./settings-and-profiles.md) — ephemeral settings, profiles
