# Claude Pro Workflow Recipe

Maximize your Claude Pro/Max subscription with thinking mode and multi-account failover for rate limits.

## Overview

Claude Pro/Max subscribers get access to:

- Higher rate limits than free tier
- Access to claude-opus-4-5-20251101 (most capable)
- Thinking mode for complex reasoning
- Priority access during peak times

This recipe shows you how to configure LLxprt Code to get the most out of your subscription.

## Basic Claude Pro Setup

### Interactive Setup

```bash
# 1. Enable Anthropic OAuth
/auth anthropic enable

# 2. Set provider and model
/provider anthropic
/model claude-sonnet-4-5-20250929

# 3. Configure for coding work
/set context-limit 200000
/set modelparam max_tokens 8192
/set modelparam temperature 0.2

# 4. Save the profile
/profile save claude-pro
```

### Profile JSON (Copy-Paste Ready)

Save this to `~/.llxprt/profiles/claude-pro.json`:

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
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

1. Run: `/profile load claude-pro`
2. Send any message to trigger OAuth
3. A dialog appears asking for your authorization code
4. Go to: https://console.anthropic.com/settings/oauth
5. Copy the authorization code
6. Paste it into the dialog
7. Done! Token is cached for future sessions

## Thinking Mode Setup

Claude's thinking mode enables step-by-step reasoning for complex tasks. Use it for:

- Architecture decisions
- Debugging complex issues
- Multi-step refactoring
- Code review with detailed analysis

### Interactive Setup with Thinking

```bash
# 1. Enable Anthropic OAuth
/auth anthropic enable

# 2. Set provider and model (Sonnet or Opus)
/provider anthropic
/model claude-sonnet-4-5-20250929

# 3. Enable thinking mode with budget
/set modelparam thinking {"type":"enabled","budget_tokens":16384}

# 4. Increase max_tokens to accommodate thinking + response
/set modelparam max_tokens 32768
/set context-limit 200000
/set modelparam temperature 1

# 5. Save the profile
/profile save claude-thinking
```

### Profile JSON with Thinking (Copy-Paste Ready)

Save this to `~/.llxprt/profiles/claude-thinking.json`:

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
  "modelParams": {
    "temperature": 1,
    "max_tokens": 32768,
    "thinking": {
      "type": "enabled",
      "budget_tokens": 16384
    }
  },
  "ephemeralSettings": {
    "context-limit": 200000
  }
}
```

### Thinking Budget Guidelines

| Budget Tokens | Use Case                          |
| ------------- | --------------------------------- |
| 4096          | Quick reasoning, simple decisions |
| 8192          | Medium complexity analysis        |
| 16384         | Complex debugging, architecture   |
| 32768         | Deep analysis, major refactoring  |

**Note:** `temperature` must be set to `1` when thinking mode is enabled.

## Opus for Maximum Capability

For the most complex tasks, use claude-opus-4-5-20251101:

### Interactive Setup

```bash
# 1. Enable Anthropic OAuth
/auth anthropic enable

# 2. Set Opus model
/provider anthropic
/model claude-opus-4-5-20251101

# 3. Enable thinking with larger budget
/set modelparam thinking {"type":"enabled","budget_tokens":32768}
/set modelparam max_tokens 65536
/set context-limit 200000
/set modelparam temperature 1

# 4. Save the profile
/profile save claude-opus-thinking
```

### Profile JSON (Copy-Paste Ready)

Save this to `~/.llxprt/profiles/claude-opus-thinking.json`:

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-4-5-20251101",
  "modelParams": {
    "temperature": 1,
    "max_tokens": 65536,
    "thinking": {
      "type": "enabled",
      "budget_tokens": 32768
    }
  },
  "ephemeralSettings": {
    "context-limit": 200000
  }
}
```

## Multi-Bucket Failover for Rate Limits

When you hit rate limits on one Claude account, automatically switch to another.

### Step 1: Authenticate Multiple Accounts

```bash
# Authenticate first account
/auth anthropic login work@company.com

# Authenticate second account
/auth anthropic login personal@gmail.com

# Verify both are authenticated
/auth anthropic status
```

### Step 2: Create Failover Profile

```bash
# Set up provider and model
/provider anthropic
/model claude-sonnet-4-5-20250929
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/set context-limit 200000

# Save profile with multiple buckets (first = primary)
/profile save model claude-ha work@company.com personal@gmail.com
```

### Profile JSON with Multi-Bucket (Copy-Paste Ready)

Save this to `~/.llxprt/profiles/claude-ha.json`:

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
  "modelParams": {
    "temperature": 0.2,
    "max_tokens": 8192
  },
  "ephemeralSettings": {
    "context-limit": 200000
  },
  "buckets": ["work@company.com", "personal@gmail.com"]
}
```

### How Failover Works

| Error Code | Meaning             | Behavior                           |
| ---------- | ------------------- | ---------------------------------- |
| 429        | Rate limit exceeded | Immediately switch to next bucket  |
| 402        | Payment/quota issue | Immediately switch to next bucket  |
| 401        | Auth error          | Refresh once, then switch if fails |

## Profile Selection Guide

| Profile              | Model  | Thinking | Use Case                       |
| -------------------- | ------ | -------- | ------------------------------ |
| claude-pro           | Sonnet | Off      | Fast coding, simple tasks      |
| claude-thinking      | Sonnet | 16k      | Complex debugging, refactoring |
| claude-opus-thinking | Opus   | 32k      | Architecture, major decisions  |
| claude-ha            | Sonnet | Off      | Rate-limit-sensitive workflows |

## Switching Between Profiles

```bash
# Quick tasks - use standard profile
/profile load claude-pro

# Complex problem - enable thinking
/profile load claude-thinking

# Mission critical - use Opus
/profile load claude-opus-thinking

# Heavy usage day - use failover
/profile load claude-ha
```

## Set Default Profile

```bash
# Use claude-pro as default
/profile set-default claude-pro

# Clear default
/profile set-default none
```

## Troubleshooting

### OAuth Token Expired

```bash
/auth anthropic logout
/auth anthropic enable
# Send a message to re-authenticate
```

### Thinking Mode Not Working

1. Ensure `temperature` is set to `1`
2. Increase `max_tokens` to accommodate thinking + response
3. Verify `thinking.type` is `"enabled"`

### Rate Limits Still Hitting

1. Add more buckets to your failover profile
2. Consider mixing in OpenAI/Gemini (see [High Availability](./high-availability.md))

### Bucket Authentication Failed

```bash
# Re-authenticate specific bucket
/auth anthropic login work@company.com
```

## See Also

- [OAuth Setup Guide](../oauth-setup.md) - Complete OAuth documentation
- [Free Tier Setup](./free-tier-setup.md) - Free alternatives
- [High Availability Setup](./high-availability.md) - Multi-provider failover
- [Settings and Profiles](../settings-and-profiles.md) - Profile management
