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

Dumps are saved to `~/.llxprt/dumps/` as timestamped JSON files.

### /debug

Control the debug logger at runtime — same namespaces as `LLXPRT_DEBUG` but toggled without restarting:

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
- **Windows:** `%APPDATA%/llxprt-code/secure-store/`

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

You're behind a corporate proxy that intercepts TLS. Set:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/your/corporate-ca.crt
```

### OAuth Troubleshooting

OAuth tokens are stored in the OS keyring (same as named keys). If authentication fails:

1. Try logging out and re-authenticating: `/auth gemini logout` then `/auth gemini enable`
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

**`EADDRINUSE` (MCP server)**

Another process is using that port. Stop it or configure a different port in your MCP server settings.

**`Command not found`**

LLxprt isn't in your PATH. If installed globally: check `npm root -g`. If from source: use `node packages/cli/dist/index.js`.

**`MODULE_NOT_FOUND`**

Run `npm install` then `npm run build`.

**`Operation not permitted`**

Sandbox is blocking the operation. See [Sandboxing](./sandbox.md) for how to adjust sandbox profiles.

**CLI not interactive in CI environments**

The `is-in-ci` package detects `CI`, `CONTINUOUS_INTEGRATION`, or any `CI_*` env var and forces non-interactive mode. Workaround: `env -u CI_TOKEN llxprt`

## Exit Codes

| Exit Code | Error Type                 | Description                              |
| --------- | -------------------------- | ---------------------------------------- |
| 41        | `FatalAuthenticationError` | Authentication failed                    |
| 42        | `FatalInputError`          | Invalid input (non-interactive mode)     |
| 44        | `FatalSandboxError`        | Sandbox setup failed                     |
| 52        | `FatalConfigError`         | Invalid settings.json                    |
| 53        | `FatalTurnLimitedError`    | Max turns reached (non-interactive mode) |

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

**Enable sandbox debug output:**

```bash
LLXPRT_DEBUG='*' llxprt --sandbox "your prompt"
```

## FAQs

**How do I update LLxprt Code?**

`npm install -g @vybestack/llxprt-code@latest` (global install) or pull and `npm run build` (from source).

**Where are config files stored?**

`~/.llxprt/settings.json` (user) and `.llxprt/settings.json` (project). See [Configuration](./cli/configuration.md).

**Why don't I see cached token counts in /stats?**

Cache metrics only appear when the provider supports and reports them. OAuth users may not see cache stats if the backend doesn't support cached content creation.

## See Also

- [Authentication](./cli/authentication.md) — key management, keyring, OAuth
- [Sandboxing](./sandbox.md) — container setup, credential proxy, SSH agent
- [Configuration](./cli/configuration.md) — settings.json reference
- [Settings and Profiles](./settings-and-profiles.md) — ephemeral settings, profiles
