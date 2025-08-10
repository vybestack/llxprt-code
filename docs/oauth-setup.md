# OAuth Setup Guide

This guide explains how to set up OAuth authentication for various AI providers in llxprt-code.

## Overview

llxprt-code supports OAuth 2.0 authentication for multiple providers:

- **Gemini** (Google AI)
- **Qwen** (Alibaba Cloud)

OAuth provides secure authentication without requiring API keys, offering better security and user experience.

## Authentication Precedence

The system uses the following authentication precedence (highest to lowest):

1. **Command line API key** (`--key` flag)
2. **Environment variables** (`OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.)
3. **OAuth tokens** (stored securely in `~/.llxprt/oauth/`)

## Setting Up OAuth

### Using the Auth Command

The simplest way to authenticate is using the `/auth` command:

```bash
# Show OAuth authentication menu
/auth

# Authenticate with specific provider
/auth gemini
/auth qwen
```

### Gemini OAuth Setup

1. Run the authentication command:

   ```bash
   /auth gemini
   ```

2. Follow the browser-based OAuth flow
3. Grant permissions to llxprt-code
4. Authentication complete!

### Qwen OAuth Setup

1. Run the authentication command:

   ```bash
   /auth qwen
   ```

2. You'll see a device code and URL:

   ```
   Device code: ABC-DEF-123
   Visit: https://oauth.qwen.alibaba.com/device
   Enter code: ABC-DEF-123
   ```

3. Open the URL in your browser
4. Enter the device code when prompted
5. Grant permissions to llxprt-code
6. Wait for authentication to complete (up to 15 minutes)

## Multi-Provider Authentication

You can authenticate with multiple providers simultaneously:

```bash
/auth gemini  # Set up Gemini OAuth
/auth qwen    # Set up Qwen OAuth
```

Each provider stores tokens separately and securely.

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

OAuth tokens are stored securely at:

- **Location**: `~/.llxprt/oauth/`
- **Format**: `{provider}.json` (e.g., `gemini.json`, `qwen.json`)
- **Permissions**: `0600` (user read/write only)

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

If OAuth authentication times out:

1. **Qwen**: 15-minute timeout for device flow
2. **Solution**: Restart authentication and complete promptly
3. **Check**: Network connectivity and browser access

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

| Command        | Description                    |
| -------------- | ------------------------------ |
| `/auth`        | Show OAuth authentication menu |
| `/auth gemini` | Authenticate with Gemini       |
| `/auth qwen`   | Authenticate with Qwen         |

## File Locations

| File/Directory                | Purpose                       |
| ----------------------------- | ----------------------------- |
| `~/.llxprt/oauth/`            | OAuth token storage directory |
| `~/.llxprt/oauth/gemini.json` | Gemini OAuth token            |
| `~/.llxprt/oauth/qwen.json`   | Qwen OAuth token              |

## Support

For additional help:

1. **Documentation**: Check `/docs` command in llxprt-code
2. **Issues**: Report problems on GitHub
3. **Provider Support**: Contact provider for OAuth service issues
