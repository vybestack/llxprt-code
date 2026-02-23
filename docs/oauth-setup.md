# OAuth Setup

OAuth lets you authenticate with AI providers without managing API keys. Tokens are stored securely in your OS keyring (or an encrypted fallback file) and refresh automatically.

## Supported Providers

| Provider                     | Flow          | What Opens                  |
| ---------------------------- | ------------- | --------------------------- |
| **Gemini** (Google AI)       | Browser-based | Browser opens automatically |
| **Anthropic**                | Browser-based | Browser opens automatically |
| **Codex** (ChatGPT Plus/Pro) | Browser-based | Browser opens automatically |
| **Qwen** (Alibaba Cloud)     | Browser-based | Browser opens automatically |

## Enabling OAuth

Use the `/auth` command inside a session:

```
/auth gemini enable
/auth anthropic enable
/auth codex enable
/auth qwen enable
```

With `/auth <provider> enable`, authentication is **lazy** — nothing happens until you make your first request to that provider. At that point, a browser opens and you complete the login.

If you use `/auth <provider> login` instead, the browser opens immediately.

### What Happens During Login

1. A browser opens to the provider's login page
2. You complete the login and grant permissions
3. Tokens are stored in your keyring and refresh automatically going forward

### No Browser Available?

On remote machines, SSH sessions, or CI environments, LLxprt automatically detects that no browser is available and shows a URL you can copy instead. You can also force manual mode:

```bash
llxprt --nobrowser
```

Or set it persistently:

```
/set auth.noBrowser true
```

In manual mode, you'll see a clickable URL (if your terminal supports it) and a paste box to enter the authorization code.

## Buckets (Multiple Accounts)

You can log in to the same provider with multiple accounts by giving each login a **bucket** name. Buckets are just labels — most people use the email address of the account:

```
/auth anthropic login work@company.com
/auth anthropic login personal@gmail.com
```

Buckets are useful for:

- **Rate limit distribution** — spread requests across accounts
- **Failover** — if one account hits quota, automatically try the next
- **Team vs personal** — separate work and personal usage

Save a profile with multiple buckets for automatic failover:

```
/profile save model claude-ha work@company.com personal@gmail.com
```

See [Profiles](./cli/profiles.md) for more on multi-bucket failover.

## Token Storage

OAuth tokens are stored in your **OS keyring** (macOS Keychain, GNOME Keyring, Windows Credential Vault) via `@napi-rs/keyring`. If the keyring is unavailable, tokens fall back to encrypted files in the OS-standard data directory (via `env-paths`):

- **macOS:** `~/Library/Application Support/llxprt-code/secure-store/`
- **Linux:** `~/.local/share/llxprt-code/secure-store/`
- **Windows:** `%APPDATA%/llxprt-code/secure-store/`

Tokens are **not** stored as plain JSON files. The old `~/.llxprt/oauth/*.json` file locations are obsolete.

Tokens refresh automatically when they approach expiration. You should never need to manage token files directly.

## Authentication Precedence

When multiple credentials exist, LLxprt uses the highest-priority one:

1. **CLI flags** — `--key`, `--keyfile`, `--key-name`
2. **Profile / settings** — values from `/profile save` or `settings.json`
3. **Keyring keys** — from `/key save`
4. **Environment variables** — `GEMINI_API_KEY`, `OPENAI_API_KEY`, etc.
5. **OAuth tokens** — from `/auth enable`

If you have an API key or env var set and OAuth enabled, the key wins. Remove the key (or unset the env var) to use OAuth.

## Managing OAuth

```
/auth                         # Show status for all providers
/auth <provider> status       # Show status and buckets for one provider
/auth <provider> enable       # Enable OAuth for provider
/auth <provider> disable      # Disable OAuth for provider
/auth <provider> login        # Log in (default bucket)
/auth <provider> login <name> # Log in with named bucket
/auth <provider> logout       # Log out (default bucket)
/auth <provider> logout all   # Log out all buckets
```

## Troubleshooting

**Browser doesn't open** — you may be in an SSH session or CI environment. LLxprt auto-detects this and falls back to manual mode. You can also use `--nobrowser` or `/set auth.noBrowser true`.

**Token refresh fails** — run `/auth <provider> logout` then `/auth <provider> login` to re-authenticate.

**"No OAuth token" after login** — check that OAuth is enabled with `/auth <provider> status`. The `enable` step is required before `login`.

**Codex requires subscription** — `/auth codex` only works with an active ChatGPT Plus ($20/month) or Pro subscription. For pay-per-token API access, use an API key instead.

## Related

- [Authentication](./cli/authentication.md) — choosing between OAuth, API keys, and keyring
- [Profiles](./cli/profiles.md) — multi-bucket failover profiles
