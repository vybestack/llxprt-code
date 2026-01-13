# High Availability Multi-Provider Recipe

Maximum uptime with load balancing across Claude, OpenAI, and Gemini providers.

## Overview

When reliability matters, don't depend on a single provider. This recipe configures:

- Automatic failover between providers
- Load balancing for distributed usage
- Graceful degradation when providers are unavailable

## Provider Comparison

| Provider  | Model                      | Strengths                   | Considerations              |
| --------- | -------------------------- | --------------------------- | --------------------------- |
| Anthropic | claude-sonnet-4-5-20250929 | Best code quality, thinking | Rate limits on Pro          |
| OpenAI    | gpt-5.2                    | Fast, reliable API          | Requires API key            |
| Gemini    | gemini-2.5-flash           | Free tier, fast             | Occasional quality variance |

## Step 1: Create Individual Provider Profiles

First, set up each provider as a separate profile.

### Claude Profile

```bash
# Option A: OAuth (Claude Pro/Max)
/auth anthropic enable
/provider anthropic
/model claude-sonnet-4-5-20250929
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/set context-limit 200000
/profile save anthropic-primary

# Option B: API Key
/provider anthropic
/key sk-ant-your-key
/model claude-sonnet-4-5-20250929
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/set context-limit 200000
/profile save anthropic-primary
```

**Profile JSON** (`~/.llxprt/profiles/anthropic-primary.json`):

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

### OpenAI Profile

```bash
/provider openai
/key sk-your-openai-key
/model gpt-5.2
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/set context-limit 200000
/profile save openai-backup
```

**Profile JSON** (`~/.llxprt/profiles/openai-backup.json`):

```json
{
  "version": 1,
  "provider": "openai",
  "model": "gpt-5.2",
  "modelParams": {
    "temperature": 0.2,
    "max_tokens": 8192
  },
  "ephemeralSettings": {
    "context-limit": 200000
  }
}
```

### Gemini Profile

```bash
# Option A: OAuth (Free)
/auth gemini enable
/provider gemini
/model gemini-2.5-flash
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/set context-limit 200000
/profile save gemini-fallback

# Option B: API Key
/provider gemini
/key your-gemini-key
/model gemini-2.5-flash
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/set context-limit 200000
/profile save gemini-fallback
```

**Profile JSON** (`~/.llxprt/profiles/gemini-fallback.json`):

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

## Step 2: Create Load Balancer Profile

### Failover Mode (Recommended for Reliability)

Uses providers in priority order. Only switches when current provider fails.

```bash
/profile save loadbalancer ha-failover failover anthropic-primary openai-backup gemini-fallback
```

**Profile JSON** (`~/.llxprt/profiles/ha-failover.json`):

```json
{
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["anthropic-primary", "openai-backup", "gemini-fallback"]
}
```

### Round-Robin Mode (For Distributed Load)

Distributes requests across all providers evenly.

```bash
/profile save loadbalancer ha-roundrobin roundrobin anthropic-primary openai-backup gemini-fallback
```

**Profile JSON** (`~/.llxprt/profiles/ha-roundrobin.json`):

```json
{
  "version": 1,
  "type": "loadbalancer",
  "policy": "roundrobin",
  "profiles": ["anthropic-primary", "openai-backup", "gemini-fallback"]
}
```

## Step 3: Load and Use

```bash
# Load the HA profile
/profile load ha-failover

# Set as default for all sessions
/profile set-default ha-failover
```

## Complete Setup Command Sequence

Copy-paste this entire sequence to set up high availability:

```bash
# 1. Enable OAuth for free providers
/auth anthropic enable
/auth gemini enable

# 2. Create Anthropic profile
/provider anthropic
/model claude-sonnet-4-5-20250929
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/set context-limit 200000
/profile save anthropic-primary

# 3. Create OpenAI profile (requires API key)
/provider openai
/key sk-your-openai-key
/model gpt-5.2
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/set context-limit 200000
/profile save openai-backup

# 4. Create Gemini profile
/provider gemini
/model gemini-2.5-flash
/set modelparam max_tokens 8192
/set modelparam temperature 0.2
/set context-limit 200000
/profile save gemini-fallback

# 5. Create load balancer with failover
/profile save loadbalancer ha-failover failover anthropic-primary openai-backup gemini-fallback

# 6. Load and set as default
/profile load ha-failover
/profile set-default ha-failover
```

## Cost vs. Capability Tradeoffs

### Budget-Conscious HA (Free + Paid Backup)

Prioritize free providers, use paid only when necessary:

```json
{
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["gemini-fallback", "qwen-free", "anthropic-primary"]
}
```

**Setup:**

```bash
/auth gemini enable
/auth qwen enable

/provider gemini
/model gemini-2.5-flash
/set modelparam max_tokens 8192
/set context-limit 200000
/profile save gemini-fallback

/provider qwen
/model qwen3-coder-480b-a35b-instruct
/set modelparam max_tokens 8192
/set context-limit 200000
/profile save qwen-free

/auth anthropic enable
/provider anthropic
/model claude-sonnet-4-5-20250929
/set modelparam max_tokens 8192
/set context-limit 200000
/profile save anthropic-primary

/profile save loadbalancer budget-ha failover gemini-fallback qwen-free anthropic-primary
```

### Quality-First HA (Best Models Priority)

Start with highest quality, fall back to faster options:

```json
{
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": [
    "anthropic-opus",
    "anthropic-sonnet",
    "openai-backup",
    "gemini-fallback"
  ]
}
```

### Speed-Optimized HA (Fast Models First)

Prioritize response speed:

```json
{
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["gemini-fallback", "openai-backup", "anthropic-primary"]
}
```

## Monitoring Failover

Check which provider is currently active:

```bash
/stats buckets
```

View provider health and request distribution:

```bash
/auth
```

## Failover Behavior

The load balancer automatically fails over on these errors:

| Error Code | Meaning       | Action                            |
| ---------- | ------------- | --------------------------------- |
| 429        | Rate limit    | Immediate switch to next provider |
| 402        | Payment/quota | Immediate switch to next provider |
| 401        | Auth failure  | Attempt refresh, then switch      |
| 500-503    | Server error  | Immediate switch to next provider |
| Timeout    | Network issue | Switch after configured timeout   |

## Advanced: Weighted Load Balancing

For proportional distribution (e.g., 70% Claude, 20% OpenAI, 10% Gemini):

```json
{
  "version": 1,
  "type": "loadbalancer",
  "policy": "weighted",
  "profiles": [
    { "profile": "anthropic-primary", "weight": 70 },
    { "profile": "openai-backup", "weight": 20 },
    { "profile": "gemini-fallback", "weight": 10 }
  ]
}
```

## Troubleshooting

### All Providers Failing

```bash
# Check individual provider status
/profile load anthropic-primary
# Try a simple request

/profile load openai-backup
# Try a simple request

/profile load gemini-fallback
# Try a simple request
```

### Failover Not Triggering

1. Verify all profiles exist: `/profile list`
2. Check load balancer configuration
3. Ensure error codes are failover-triggering types

### Unexpected Provider Being Used

```bash
# Check current provider status
/stats buckets

# Re-authenticate if needed
/auth anthropic enable
/auth gemini enable
```

### OAuth Tokens Expired

```bash
/auth anthropic logout
/auth anthropic enable

/auth gemini logout
/auth gemini enable
```

## See Also

- [Claude Pro Workflow](./claude-pro-workflow.md) - Single-provider optimization
- [Free Tier Setup](./free-tier-setup.md) - Free provider configuration
- [OAuth Setup Guide](../oauth-setup.md) - Authentication details
- [Settings and Profiles](../settings-and-profiles.md) - Profile management
