# OAuth Setup Guide

This guide explains how to set up OAuth authentication for various AI providers in llxprt-code.

## Overview

llxprt-code supports OAuth 2.0 authentication for multiple providers:

- **Gemini** (Google AI) - Browser-based OAuth flow
- **Anthropic** - Authorization code via dialog
- **Qwen** (Alibaba Cloud) - Device code flow
- **OpenAI Codex** - Browser-based OAuth flow (via ChatGPT subscription)

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
/auth qwen enable
/auth codex enable

# Disable OAuth for a provider
/auth gemini disable
/auth anthropic disable
/auth qwen disable
/auth codex disable

# Log out from a provider (clears stored tokens)
/auth gemini logout
/auth anthropic logout
/auth qwen logout
/auth codex logout
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

### OpenAI Codex OAuth Setup

OpenAI Codex OAuth allows you to use your ChatGPT Plus or Pro subscription with LLxprt Code without managing API keys.

1. Enable OAuth for OpenAI:

   ```bash
   /auth codex enable
   ```

2. Make your first request to OpenAI
3. Browser will open to ChatGPT login
4. Authorize LLxprt Code to access your account
5. Authentication complete!

**Requirements:**

- Active ChatGPT Plus ($20/month) or Pro subscription
- Browser access for OAuth flow

**Note:** Codex OAuth provides access to GPT-5 capabilities through your subscription rather than per-token API billing.

## Multi-Provider Authentication

You can enable OAuth for multiple providers simultaneously:

```bash
/auth gemini enable     # Enable Gemini OAuth
/auth anthropic enable  # Enable Anthropic OAuth
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
3. **Qwen**: Device flow has polling timeout (typically 5-15 minutes)
4. **Solution**: Complete authentication promptly after initiating

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

Supported providers: `gemini`, `anthropic`, `qwen`, `codex`

## File Locations

| File/Directory                   | Purpose                       |
| -------------------------------- | ----------------------------- |
| `~/.llxprt/oauth/`               | OAuth token storage directory |
| `~/.llxprt/oauth/gemini.json`    | Gemini OAuth tokens           |
| `~/.llxprt/oauth/anthropic.json` | Anthropic OAuth tokens        |
| `~/.llxprt/oauth/qwen.json`      | Qwen OAuth tokens             |
| `~/.llxprt/oauth/codex.json`     | OpenAI Codex OAuth tokens     |

## Multi-Account Failover

When you hit rate limits on one OAuth account, llxprt-code can automatically switch to another. This is useful for:

- **Teams sharing multiple Claude Pro accounts** - Pool subscriptions to avoid individual rate limits
- **Personal + work account failover** - Use work account primarily, fall back to personal
- **Multi-provider failover** - Chain different providers (Anthropic, then OpenAI, then Gemini)

### How Failover Works

When llxprt-code receives certain error responses, it automatically switches to the next configured bucket:

| Error Code | Meaning              | Failover Behavior                                   |
| ---------- | -------------------- | --------------------------------------------------- |
| **429**    | Rate limit exceeded  | Immediately switch to next bucket                   |
| **402**    | Payment/quota issue  | Immediately switch to next bucket                   |
| **401**    | Authentication error | Attempt token refresh once, then switch if it fails |

### Step-by-Step: Setting Up Multi-Account Failover

#### Step 1: Create Multiple OAuth Buckets

Authenticate to the same provider with different accounts. Use descriptive bucket names (like email addresses):

```bash
# Authenticate first account
/auth anthropic login work1@company.com

# Authenticate second account
/auth anthropic login work2@company.com

# Authenticate third account (optional)
/auth anthropic login personal@gmail.com
```

Each login creates a separate "bucket" that stores OAuth tokens independently.

#### Step 2: Verify Your Buckets

Check that all buckets are authenticated:

```bash
/auth anthropic status
```

You should see output like:

```
OAuth Buckets for anthropic:
  [ok] work1@company.com (expires in 59 minutes)
  [ok] work2@company.com (expires in 58 minutes)
  [ok] personal@gmail.com (expires in 57 minutes)
```

#### Step 3: Create a Profile with Failover Buckets

Save a profile that includes multiple buckets in priority order:

```bash
# Set up your provider and model
/provider anthropic
/model claude-sonnet-4-5

# Save profile with buckets (first bucket = primary)
/profile save model ha-claude work1@company.com work2@company.com personal@gmail.com
```

#### Step 4: Load and Use the Profile

```bash
/profile load ha-claude
```

Now when you hit rate limits on `work1@company.com`, llxprt-code automatically switches to `work2@company.com`, then to `personal@gmail.com`.

### Example Scenarios

#### Scenario 1: Team with Multiple Claude Pro Accounts

A team of 5 developers shares 3 Claude Pro accounts to maximize throughput:

```bash
# Each team member authenticates to all shared accounts
/auth anthropic login claude-pro-1@company.com
/auth anthropic login claude-pro-2@company.com
/auth anthropic login claude-pro-3@company.com

# Create team profile
/provider anthropic
/model claude-sonnet-4-5
/profile save model team-claude claude-pro-1@company.com claude-pro-2@company.com claude-pro-3@company.com

# Set as default
/profile set-default team-claude
```

When one account hits its rate limit, work continues on the next account seamlessly.

#### Scenario 2: Personal + Work Account Failover

Use your work account during business hours, with personal as backup:

```bash
# Authenticate both accounts
/auth anthropic login work@company.com
/auth anthropic login personal@gmail.com

# Create profile with work as primary
/provider anthropic
/model claude-sonnet-4-5
/profile save model work-with-backup work@company.com personal@gmail.com
```

#### Scenario 3: Multi-Provider Failover (Anthropic, then OpenAI, then Gemini)

For maximum availability, chain different AI providers:

```bash
# Create individual provider profiles first
/provider anthropic
/model claude-sonnet-4-5
/profile save model anthropic-primary

/provider openai
/model gpt-4.1
/profile save model openai-backup

/provider gemini
/model gemini-2.5-pro
/profile save model gemini-emergency

# Create a load balancer with failover policy
/profile save loadbalancer multi-provider failover anthropic-primary openai-backup gemini-emergency
```

This uses Anthropic until it fails, then OpenAI, then Gemini.

### Monitoring Bucket Usage

View request statistics for all buckets:

```bash
/stats buckets
```

Output shows requests per bucket and last-used timestamps:

```
OAuth Bucket Statistics:
  anthropic/work1@company.com: 47 requests (last used: 2 min ago)
  anthropic/work2@company.com: 23 requests (last used: 15 min ago)
  anthropic/personal@gmail.com: 5 requests (last used: 1 hour ago)
```

### Best Practices

1. **Order buckets by priority** - Place your primary/preferred account first
2. **Mix account types** - Combine Pro and Free tier accounts for better coverage
3. **Monitor usage** - Use `/stats buckets` to understand failover patterns
4. **Refresh tokens proactively** - Re-authenticate buckets before tokens expire
5. **Document shared accounts** - If sharing team accounts, document who has access

### Troubleshooting Failover

#### Failover not triggering

- Verify multiple buckets exist: `/auth <provider> status`
- Check profile has buckets: `/profile list` then examine the profile
- Ensure error is a failover-triggering type (429, 402, 401)

#### All buckets exhausted

When all buckets hit rate limits:

```
Error: All OAuth buckets exhausted. Please wait for rate limits to reset.
```

Wait for rate limits to reset, or add more buckets to the profile.

#### Token expired in a bucket

If a bucket's token expires:

```bash
# Re-authenticate the specific bucket
/auth anthropic login work1@company.com
```

The failover chain will skip expired buckets automatically.

## Support

For additional help:

1. **Documentation**: Check `/docs` command in llxprt-code
2. **Issues**: Report problems on GitHub
3. **Provider Support**: Contact provider for OAuth service issues
