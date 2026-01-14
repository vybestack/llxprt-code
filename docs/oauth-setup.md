# OAuth Setup Guide

This guide explains how to set up OAuth authentication for various AI providers in llxprt-code.

## Overview

llxprt-code supports OAuth 2.0 authentication for multiple providers:

- **Gemini** (Google AI) - Browser-based OAuth flow
- **Anthropic** - Authorization code via dialog
- **OpenAI** (Codex) - Browser-based OAuth flow for ChatGPT Plus/Pro subscribers
- **Qwen** (Alibaba Cloud) - Device code flow

OAuth provides secure authentication without requiring API keys, offering better security and user experience.

**Important:** All OAuth authentication is lazy - the authentication flow only starts when you make your first API request to the provider, not when you enable OAuth.

## Authentication Precedence

The system uses the following authentication precedence (highest to lowest):

1. **Command line API key** (`--key`/`--keyfile` flags or `--set auth-key=...`)
2. **Profiles / settings files** (values saved via `/profile save` or `settings.json`)
3. **Environment variables** (`OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.)
4. **OAuth tokens** (stored securely in `~/.llxprt/oauth/`)

## Setting Up OAuth

### Using the Auth Command

The `/auth` command manages OAuth authentication for all providers:

```bash
# Show OAuth authentication menu/status
/auth

# Enable OAuth for a provider (authentication happens on first use)
/auth gemini enable
/auth anthropic enable
/auth codex enable
/auth qwen enable

# Disable OAuth for a provider
/auth gemini disable
/auth anthropic disable
/auth codex disable
/auth qwen disable

# Log out from a provider (clears stored tokens)
/auth gemini logout
/auth anthropic logout
/auth codex logout
/auth qwen logout
```

### Gemini OAuth Setup

1. Enable OAuth for Gemini:

   ```bash
   /auth gemini enable
   ```

2. Make your first request to Gemini (e.g., send a message)
3. Browser will open automatically for authentication
4. Grant permissions to llxprt-code
5. Authentication complete!

### Anthropic OAuth Setup

1. Enable OAuth for Anthropic:

   ```bash
   /auth anthropic enable
   ```

2. Make your first request to Anthropic
3. A dialog will appear asking for your authorization code
4. Go to https://console.anthropic.com/settings/oauth to get your code
5. Paste the code into the dialog
6. Authentication complete!

### OpenAI Codex OAuth Setup (ChatGPT Plus/Pro)

If you have a ChatGPT Plus or Pro subscription, you can authenticate using OAuth:

1. Enable OAuth for OpenAI:

   ```bash
   /auth codex enable
   ```

2. Make your first request to OpenAI
3. Browser will open to ChatGPT login page
4. Sign in with your ChatGPT Plus/Pro account
5. Authorize llxprt-code to access your account
6. Authentication complete!

**Note:** This requires an active ChatGPT Plus ($20/month) or Pro subscription. For pay-per-token API access, use API keys instead.

### Qwen OAuth Setup

1. Enable OAuth for Qwen:

   ```bash
   /auth qwen enable
   ```

2. Make your first request to Qwen
3. You'll see a device code and URL (device code flow):

   ```
   Device code: ABC-DEF-123
   Visit: https://oauth.qwen.alibaba.com/device
   Enter code: ABC-DEF-123
   ```

4. Open the URL in your browser
5. Enter the device code when prompted
6. Grant permissions to llxprt-code
7. Authentication completes automatically

## Multi-Provider Authentication

You can enable OAuth for multiple providers simultaneously:

```bash
/auth gemini enable     # Enable Gemini OAuth
/auth anthropic enable  # Enable Anthropic OAuth
/auth codex enable     # Enable OpenAI Codex OAuth
/auth qwen enable       # Enable Qwen OAuth
```

Each provider:

- Stores tokens separately and securely
- Authenticates lazily on first use
- Maintains independent authentication state

## Authentication Status

Check your current authentication status:

```bash
/auth
```

This shows:

- ✓ Authenticated providers with expiry time
- ✗ Unauthenticated providers
- Auth method (oauth, api-key, etc.)

## Token Management

### Token Storage

OAuth tokens are stored as plain JSON files:

- **Location**: `~/.llxprt/oauth/`
- **Files**:
  - `gemini.json` - Gemini OAuth tokens
  - `anthropic.json` - Anthropic OAuth tokens
  - `codex.json` - OpenAI Codex OAuth tokens
  - `qwen.json` - Qwen OAuth tokens
- **Permissions**: `0600` (user read/write only)
- **Note**: Tokens are stored as plain text JSON files. For enhanced security in production environments, consider using system keychains or encrypted storage.

### Automatic Refresh

Tokens are automatically refreshed when:

- They expire within 30 seconds
- An API call is made with an expired token
- The system detects token expiration

### Manual Token Removal

To remove a provider's OAuth token:

```bash
rm ~/.llxprt/oauth/{provider}.json
```

## Troubleshooting

### Authentication Timeout

Different providers have different timeout behaviors:

1. **Gemini**: No timeout - browser flow waits for user
2. **Anthropic**: Dialog waits indefinitely for code input
3. **OpenAI**: No timeout - browser flow waits for user
4. **Qwen**: Device flow has polling timeout (typically 5-15 minutes)
5. **Solution**: Complete authentication promptly after initiating

### Token Refresh Issues

If token refresh fails:

1. **Re-authenticate**: Run `/auth {provider}` again
2. **Check**: Provider service status
3. **Verify**: Network connectivity

### Permission Errors

If you see file permission errors:

```bash
# Fix OAuth directory permissions
chmod 700 ~/.llxprt/oauth/
chmod 600 ~/.llxprt/oauth/*.json
```

### Browser Issues

For browser-related problems:

1. **Manual URL**: Copy the OAuth URL and open manually
2. **Different Browser**: Try a different browser
3. **Private Mode**: Use incognito/private browsing mode

## Security Considerations

### Token Security

- Tokens are stored with `0600` permissions (user-only access)
- No tokens are logged or displayed in plain text
- Automatic refresh minimizes token exposure time

### OAuth vs API Keys

OAuth provides better security than API keys:

- **Scoped Access**: Limited to specific operations
- **Revocable**: Can be revoked from provider console
- **Temporary**: Automatic expiration and refresh
- **No Secrets**: No long-lived credentials in files

### Best Practices

1. **Regular Cleanup**: Remove unused provider tokens
2. **Secure Storage**: Keep `~/.llxprt/` directory secure
3. **Monitor Access**: Review OAuth grants in provider consoles
4. **Use OAuth**: Prefer OAuth over API keys when available

## Migration Guide

### From API Keys to OAuth

If you're currently using API keys:

1. **Current Setup**: API keys continue to work
2. **Add OAuth**: Run `/auth {provider}` for OAuth setup
3. **Precedence**: API keys take precedence over OAuth
4. **Remove API Keys**: Unset environment variables to use OAuth
5. **Test**: Verify functionality with OAuth

Example migration:

```bash
# Before: Using API key
export OPENAI_API_KEY="sk-..."

# Add OAuth (optional)
/auth qwen

# Remove API key to use OAuth
unset OPENAI_API_KEY

# Verify OAuth is working
/auth  # Should show qwen as authenticated
```

### Existing Gemini Users

If you already have Gemini OAuth:

1. **No Changes**: Existing Gemini OAuth continues working
2. **Add Qwen**: Run `/auth qwen` to add Qwen support
3. **Multi-Provider**: Both providers work simultaneously
4. **Cross-Compatible**: Use Qwen content with Gemini tools

## Command Reference

| Command                    | Description                           |
| -------------------------- | ------------------------------------- |
| `/auth`                    | Show OAuth authentication menu/status |
| `/auth <provider> enable`  | Enable OAuth for provider             |
| `/auth <provider> disable` | Disable OAuth for provider            |
| `/auth <provider> logout`  | Clear OAuth tokens for provider       |

Supported providers: `gemini`, `anthropic`, `codex`, `qwen`

## File Locations

| File/Directory                   | Purpose                       |
| -------------------------------- | ----------------------------- |
| `~/.llxprt/oauth/`               | OAuth token storage directory |
| `~/.llxprt/oauth/gemini.json`    | Gemini OAuth tokens           |
| `~/.llxprt/oauth/anthropic.json` | Anthropic OAuth tokens        |
| `~/.llxprt/oauth/codex.json`     | OpenAI Codex OAuth tokens     |
| `~/.llxprt/oauth/qwen.json`      | Qwen OAuth tokens             |

## Support

For additional help:

1. **Documentation**: Check `/docs` command in llxprt-code
2. **Issues**: Report problems on GitHub
3. **Provider Support**: Contact provider for OAuth service issues
