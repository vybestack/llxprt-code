# Authentication

LLxprt Code needs credentials to talk to AI providers. There are three ways to authenticate, and which you should use depends on your situation.

## Which Method Should I Use?

| Situation                                  | Method  | Setup                     |
| ------------------------------------------ | ------- | ------------------------- |
| You have a ChatGPT Plus/Pro subscription   | OAuth   | `/auth codex enable`      |
| You have an Anthropic/Google/Qwen account  | OAuth   | `/auth <provider> enable` |
| You have an API key from any provider      | Keyring | `/key save <name> <key>`  |
| You're running in CI/headless environments | Keyfile | `--keyfile /path/to/key`  |

**Use OAuth if you can.** It's the easiest setup and you don't manage any secrets. Use the keyring for API keys — it's secure and persistent. Avoid environment variables.

## OAuth (Subscriptions)

If you already pay for a subscription to Anthropic, OpenAI (ChatGPT Plus/Pro), Google, or Qwen, OAuth lets you use that subscription directly. No API key needed.

```
/auth anthropic enable
/auth codex enable
/auth gemini enable
/auth qwen enable
```

Authentication happens lazily — the browser opens when you make your first request, not when you run the command. Once authenticated, tokens are stored securely and refresh automatically.

If you don't want the browser to open automatically (e.g., you're on a remote machine), use `--nobrowser` or the `auth.noBrowser` setting to get a manual code entry prompt instead:

```bash
llxprt --nobrowser
```

```
/set auth.noBrowser true
```

For details on each provider's OAuth flow, see [OAuth Setup](../oauth-setup.md).

### Multiple Accounts (Buckets)

If you have more than one account with a provider, "buckets" let you name each OAuth login so you can tell them apart. The name is just a label — most people use the email address of the account:

```
/auth anthropic login work@company.com
/auth anthropic login personal@gmail.com
/auth anthropic status
/auth anthropic switch work@company.com
```

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

- `--keyfile /path/to/keyfile` — reads the key from a file (good for CI/headless). The file should contain just the key, nothing else. Set permissions to `600`.
- `--key <value>` — passes the key inline (least secure — visible in process listings and shell history).

```bash
# Prefer --key-name when possible
llxprt --provider anthropic --key-name anthropic

# Use --keyfile for CI or when keyring isn't available
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
