# Tips for Gemini CLI Users

If you're coming from Gemini CLI, this guide highlights the key differences and shows you how to get productive quickly.

## Command Name Differences

| Gemini CLI            | LLxprt Code       | Notes                                |
| --------------------- | ----------------- | ------------------------------------ |
| `gemini`              | `llxprt`          | CLI binary name                      |
| `@resume`             | `/continue`       | Resume a previous session            |
| `%` (shell escape)    | `!` or shell tool | Run shell commands                   |
| `/auth` (Google-only) | `/auth`           | Multiple providers: anthropic, codex |

## Authentication: Use the Keyring

Gemini CLI uses environment variables (`GEMINI_API_KEY`) or OAuth for Google only. LLxprt Code supports multiple providers and stores credentials in your OS keyring, which is more secure than environment variables.

**Why keyring over env vars?** Environment variables can leak through process listings (`ps`), child process inheritance, shell history, and CI logs. The OS keyring is encrypted at rest and requires authentication to access.

Save a key to the OS keyring from inside a session:

```
/key save xai-prod your-api-key-value
```

Then use it in future sessions — the key never appears in shell history:

```bash
llxprt --provider xai --key-name xai-prod
```

Or use a keyfile for CI/automation:

```bash
llxprt --provider xai --keyfile ~/.llxprt/keys/.xai_key
```

For OAuth providers (Anthropic, Codex), enable any of them:

```
/auth anthropic enable
/auth codex enable
```

With `/auth <provider> enable`, authentication is lazy — a browser opens automatically when you make your first request. Use `/auth <provider> login` to open the browser immediately.

> **Gemini is now API-key-only.** Google removed the free consumer "Login with Google" access for Gemini CLI in mid-2026. Use a Gemini API key (`GEMINI_API_KEY` or `/keyfile`) or Vertex AI credentials instead.

See [Authentication](./cli/authentication.md) for full details.

## Profiles Replace Manual Configuration

Instead of setting provider/model/parameters every session, save a profile:

```
/provider xai
/model grok-4
/set reasoning.enabled true
/profile save grok
/profile set-default grok
```

Load at startup:

```bash
llxprt --profile-load grok
```

This is the recommended way to manage configuration. See [Profiles](./cli/profiles.md).

## Sandboxing

LLxprt Code supports running in sandboxed containers (Docker/Podman) for safety. You can even create sandbox-specific profiles that automatically run in a container:

```bash
# Run sandboxed
llxprt --sandbox docker
```

Create a sandbox profile from inside a session:

```
/set sandbox docker
/set sandbox-engine podman
/profile save sandboxed
```

See [Sandboxing](./sandbox.md).

## Syncing Configurations with Gemini CLI

If you're migrating from Gemini CLI, you may want to import existing configuration. LLxprt Code stores its files in [OS-standard directories](./reference/application-directories.md) rather than `~/.llxprt`, so **don't symlink into `~/.llxprt`** — copy your Gemini CLI files into LLxprt's config directory once instead.

### One-time legacy import

```bash
# Resolve LLxprt's config directory for your platform (see Application Directories)
# Example on Linux: CONFIG_DIR="${LLXPRT_CONFIG_HOME:-$HOME/.config/llxprt-code}"

# Import your global memory/context file
cp ~/.gemini/GEMINI.md "$CONFIG_DIR/LLXPRT.md"

# Import settings (review first — not 100% compatible; see caveats below)
cp ~/.gemini/settings.json "$CONFIG_DIR/settings.json"
```

After importing, review the settings file: LLxprt Code has multi-provider auth, profiles, and settings that Gemini CLI doesn't, so some keys may be ignored or need adjustment.

### What Transfers Well

- MCP server configurations (if paths are absolute)
- Context/memory files (GEMINI.md → LLXPRT.md)
- `.env` files (though keyring is preferred over env vars)

### What Doesn't Transfer

- Authentication (different auth systems)
- Model configuration (profiles vs single default)
- Provider-specific settings

## Migration Tips

**Recommended approach:** Start fresh rather than symlinking everything.

1. Install LLxprt Code and run it without symlinks
2. Set up auth: `/auth <provider> enable` for OAuth providers, or `--key-name` for API keys
3. Configure your preferred setup and save a profile
4. Optionally symlink your LLXPRT.md / GEMINI.md context file

## Related

- [Getting Started](./getting-started.md)
- [Authentication](./cli/authentication.md)
- [Profiles](./cli/profiles.md)
- [Sandboxing](./sandbox.md)
- [Commands](./cli/commands.md)
