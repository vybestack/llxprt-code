# Free Tier Setup Recipe

Get started with LLxprt Code completely free using Gemini and Qwen OAuth authentication.

## Overview

Both Google Gemini and Alibaba Qwen offer free tiers accessible via OAuth:

| Provider | Free Tier Limits            | Best For                        |
| -------- | --------------------------- | ------------------------------- |
| Gemini   | Generous daily quota        | General coding, exploration     |
| Qwen     | Free access via device flow | Alternative when Gemini limited |

## Gemini Free Setup

### Interactive Setup

```bash
# 1. Enable Gemini OAuth
/auth gemini enable

# 2. Set provider and model
/provider gemini
/model gemini-2.5-flash

# 3. Configure for coding work
/set context-limit 200000
/set modelparam max_tokens 8192
/set modelparam temperature 0.2

# 4. Save the profile
/profile save gemini-free
```

### Profile JSON (Copy-Paste Ready)

Save this to `~/.llxprt/profiles/gemini-free.json`:

```json
{
  "version": 1,
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "modelParams": {
    "temperature": 0.2,
    "max_tokens": 8192
  },
  "ephemeralSettings": {
    "context-limit": 200000
  }
}
```

### First-Time Authentication

1. Run: `/profile load gemini-free`
2. Send any message to trigger OAuth
3. Browser opens automatically
4. Sign in with your Google account
5. Grant permissions to LLxprt Code
6. Done! Authentication is cached for future sessions

## Qwen Free Setup

### Interactive Setup

```bash
# 1. Enable Qwen OAuth
/auth qwen enable

# 2. Set provider and model
/provider qwen
/model qwen3-coder-480b-a35b-instruct

# 3. Configure for coding work
/set context-limit 200000
/set modelparam max_tokens 8192
/set modelparam temperature 0.2

# 4. Save the profile
/profile save qwen-free
```

### Profile JSON (Copy-Paste Ready)

Save this to `~/.llxprt/profiles/qwen-free.json`:

```json
{
  "version": 1,
  "provider": "qwen",
  "model": "qwen3-coder-480b-a35b-instruct",
  "modelParams": {
    "temperature": 0.2,
    "max_tokens": 8192
  },
  "ephemeralSettings": {
    "context-limit": 200000
  }
}
```

### First-Time Authentication (Device Flow)

1. Run: `/profile load qwen-free`
2. Send any message to trigger OAuth
3. You'll see a device code and URL:
   ```
   Device code: ABC-DEF-123
   Visit: https://oauth.qwen.alibaba.com/device
   Enter code: ABC-DEF-123
   ```
4. Open the URL in your browser
5. Enter the device code
6. Grant permissions
7. Authentication completes automatically

## When to Use Which Provider

### Use Gemini When:

- You need fast responses
- Working on general coding tasks
- You want seamless browser-based OAuth
- Gemini-3-flash offers good speed/quality balance

### Use Qwen When:

- You've hit Gemini's rate limits
- You want a coding-specialized model
- Working on complex code generation
- You prefer device-code authentication flow

## Dual-Provider Setup (Maximum Free Usage)

Set up both providers and switch between them as needed:

### Interactive Setup

```bash
# Enable both OAuth providers
/auth gemini enable
/auth qwen enable

# Create Gemini profile
/provider gemini
/model gemini-2.5-flash
/set context-limit 200000
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/profile save gemini-free

# Create Qwen profile
/provider qwen
/model qwen3-coder-480b-a35b-instruct
/set context-limit 200000
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/profile save qwen-free
```

### Switching Between Free Providers

```bash
# Start with Gemini
/profile load gemini-free

# Switch to Qwen when needed
/profile load qwen-free
```

## Recommended Model Choices

### Gemini Models (Free)

| Model            | Speed | Quality | Use Case               |
| ---------------- | ----- | ------- | ---------------------- |
| gemini-3-flash   | Fast  | Good    | Quick tasks, iteration |
| gemini-2.5-flash | Fast  | Great   | General coding         |

### Qwen Models (Free)

| Model                          | Speed  | Quality   | Use Case           |
| ------------------------------ | ------ | --------- | ------------------ |
| qwen3-coder-480b-a35b-instruct | Medium | Excellent | Complex code tasks |

## Troubleshooting

### OAuth Token Expired

```bash
# Re-authenticate
/auth gemini logout
/auth gemini enable
# Then send a message to trigger re-auth
```

### Rate Limit Hit

Switch to the other free provider:

```bash
/profile load qwen-free  # or gemini-free
```

### Browser Doesn't Open (Gemini)

Copy the URL from the terminal and paste it manually in your browser.

### Device Code Timeout (Qwen)

Complete authentication within 5-15 minutes after the code appears.

## See Also

- [OAuth Setup Guide](../oauth-setup.md) - Complete OAuth documentation
- [Claude Pro Workflow](./claude-pro-workflow.md) - Paid tier with more features
- [High Availability Setup](./high-availability.md) - Multi-provider failover
