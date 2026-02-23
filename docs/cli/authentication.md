# Authentication

LLxprt Code needs credentials to talk to AI providers. How you authenticate depends on what the provider offers.

## Which Method Should I Use?

| Situation                                       | Method  | Setup                     |
| ----------------------------------------------- | ------- | ------------------------- |
| Provider offers OAuth (Gemini, Anthropic, etc.) | OAuth   | `/auth <provider> enable` |
| Provider gives you an API key                   | Keyring | `/key save <name> <key>`  |
| CI / automation (no human to enter codes)       | Keyfile | `--keyfile /path/to/key`  |

Some providers offer OAuth with free tiers (Gemini Code Assist, Qwen) or subscription pricing (Anthropic, OpenAI via Codex). Others only offer API keys. Both OAuth tokens and API keys are stored the same way — in your OS keyring.

## OAuth

Four providers support OAuth login: **Gemini**, **Anthropic**, **Codex** (OpenAI/ChatGPT), and **Qwen**.

```text
/auth gemini enable
/auth anthropic enable
/auth codex enable
/auth qwen enable
```

Gemini uses the Gemini Code Assist login (free tier). Qwen's OAuth is also free. Anthropic and Codex use your existing subscription (Claude Pro, ChatGPT Plus/Pro, etc.) — you get subscription pricing rather than per-token API rates.

Authentication happens lazily — the browser opens when you make your first request, not when you run the command. Once authenticated, tokens are stored in your OS keyring and refresh automatically.

### Headless / Remote Machines

If you're on a machine without a browser (SSH, remote server), use `--nobrowser` to get a URL and code to enter on another device:

```bash
llxprt --nobrowser
```

```text
/set auth.noBrowser true
```

This works for any interactive session where a human can copy the URL and enter the code. For fully unattended environments (CI, automation), use a keyfile instead — see [CLI Key Flags](#cli-key-flags) below.

For details on each provider's OAuth flow, see [OAuth Setup](../oauth-setup.md).

### Multiple Accounts (Buckets)

If you have more than one account with a provider, "buckets" let you name each OAuth login so you can tell them apart. The name is just a label — most people use the email address of the account:

```
/auth anthropic login work@company.com
/auth anthropic login personal@gmail.com
/auth anthropic status
/auth anthropic logout work@company.com
/auth anthropic logout --all
```

Use `logout` with a bucket name to remove a specific account, or `--all` to remove all buckets for that provider.

When combined with [profiles](./profiles.md), multiple buckets enable automatic failover — if one account hits rate limits, LLxprt Code switches to the next.

## API Keys (Keyring)

Use `/key save` to store an API key in your OS keyring (macOS Keychain, Windows Credential Manager, or Linux Secret Service). You only do this once — the key persists across sessions.

```
/key save anthropic sk-ant-***your-key***
/key save openai sk-***your-key***
/key save xai xai-***your-key***
```

Keys are automatically masked when you paste them — the LLM never sees your key.

Then load a saved key in any session:

```
/key load anthropic
```

### CLI Key Flags

From the command line, prefer `--key-name` to load a saved keyring key — it's the most secure option since the key never appears in your command or shell history:

```bash
llxprt --provider anthropic --key-name anthropic
llxprt --provider xai --key-name xai
```

If you haven't saved a key to the keyring, you can also use:

- `--keyfile /path/to/keyfile` — reads the key from a file. The file should contain just the key, nothing else. Set permissions to `600`. This is the best option for CI and automation where no one is present to enter an OAuth code.
- `--key <value>` — passes the key inline (least secure — visible in process listings and shell history).

```bash
# Prefer --key-name when possible
llxprt --provider anthropic --key-name anthropic

# Use --keyfile for CI/automation (no human present)
llxprt --provider anthropic --keyfile /path/to/anthropic.key

# Use --key only when necessary (key is visible in process list)
llxprt --provider anthropic --key sk-ant-***your-key***
```

### One-Time Key (REPL)

If you just want to try a key without saving it:

```
/key sk-ant-***your-key***
```

This sets the key for the current session only.

## How Keys Are Stored

LLxprt Code stores secrets using a two-tier approach:

1. **OS Keyring** (preferred) — Uses your system's native credential store: macOS Keychain, Windows Credential Manager, or Linux Secret Service (via `@napi-rs/keyring`). This is the most secure option.

2. **Encrypted file fallback** — If the keyring is unavailable (e.g., headless Linux without a desktop environment), keys are stored as encrypted `.enc` files in the platform data directory (typically `~/.local/share/llxprt-code/secure-store/` on Linux, `~/Library/Application Support/llxprt-code/secure-store/` on macOS).

You don't need to choose — LLxprt Code tries the keyring first and falls back to encrypted files automatically.

## Why Not Environment Variables?

Environment variables work but have real downsides:

- **Visible to every process** spawned from your shell — any tool, script, or subprocess can read them
- **Logged in shell history** if you use `export KEY=...`
- **Leaked in crash reports** and process listings (`ps -e`)
- **Not scoped** — the key is exposed globally, not just to LLxprt Code

The keyring avoids all of these. If you have existing env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.), they still work — LLxprt Code reads them as a fallback — but `/key save` is the better path.

## Authentication Priority

When multiple auth methods are configured, LLxprt Code uses this priority (highest first):

1. CLI flags (`--key`, `--keyfile`, `--key-name`)
2. Profile settings (from `/profile save`)
3. Keyring keys (from `/key save`)
4. OAuth tokens (from `/auth enable`)
5. Environment variables

## Checking Auth Status

```
/auth                      # Show OAuth status for all providers
/auth anthropic status     # Detailed status for one provider
/stats buckets             # Request counts and timestamps per OAuth bucket
```

## Troubleshooting

**"No authentication configured"** — You need to either `/auth <provider> enable` for OAuth, `/key save <name> <key>` for API keys, or set an environment variable.

**OAuth token expired** — Tokens refresh automatically. If refresh fails, run `/auth <provider> logout` then `/auth <provider> enable` again.

**Keyring not available** — On headless Linux, the encrypted file fallback activates automatically. If you see keyring errors, they're informational — your keys are still stored securely.

**Rate limited (429)** — Use `/stats quota` to check usage. Consider setting up multiple OAuth buckets for failover (see [Profiles](./profiles.md)).

## Google Cloud / Vertex AI

If you need to use Vertex AI, Application Default Credentials (ADC), service accounts, or Google Cloud Shell, see [Google Cloud Authentication](./google-cloud-auth.md).

## Related

- [OAuth Setup](../oauth-setup.md) — Detailed OAuth flows for each provider
- [Providers](./providers.md) — Provider setup and configuration
- [Profiles](./profiles.md) — Save configurations and multi-account failover
