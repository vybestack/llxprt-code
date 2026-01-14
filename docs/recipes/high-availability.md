# High Availability Multi-Provider Recipe

This recipe guides you through setting up LLxprt Code with multiple providers for maximum availability and reliability using the interactive TUI.

## When to Use This Setup

- You need reliable AI assistance for production work
- You want automatic failover when providers are unavailable
- You're building systems that can't afford downtime
- You want to balance cost vs. capability across providers

## Provider Overview

| Provider | Context Limit | Cost Tier | Best For                    |
| -------- | ------------- | --------- | --------------------------- |
| Claude   | 200,000       | Premium   | Complex reasoning, analysis |
| Codex    | 200,000       | Premium   | General tasks, fast         |
| Gemini   | 1,048,576     | Free/Paid | Large context, free tier    |
| Kimi     | 262,144       | Paid      | Deep reasoning, tool use    |

## Setting Up Multi-Provider Failover

### Step 1: Create Individual Model Profiles

First, set up and save profiles for each provider you want in your failover chain:

```bash
# Claude profile
/provider anthropic
/model claude-sonnet-4-5-20250929
/set context-limit 200000
/keyfile ~/.anthropic_key
/profile save model claude-primary

# OpenAI profile (via Codex OAuth or API key)
/provider openai
/model gpt-5.2
/set context-limit 200000
/keyfile ~/.openai_key
/profile save model openai-backup

# Gemini profile (free tier)
/auth gemini enable
/provider gemini
/model gemini-3-flash-preview
/set context-limit 200000
/profile save model gemini-fallback
```

### Step 2: Create Load Balancer Profile

Combine profiles into a failover load balancer:

```bash
/profile save loadbalancer high-availability failover claude-primary openai-backup gemini-fallback
```

### Step 3: Load and Use

```bash
/profile load high-availability
```

Or start directly from command line:

```bash
llxprt --profile-load high-availability
```

## Load Balancer Types

### Failover (Recommended for Reliability)

Tries providers in order, moving to the next only on failure:

```bash
/profile save loadbalancer my-failover failover primary-profile backup-profile emergency-profile
```

**Best for:** Production systems where you want predictable primary provider usage.

### Round Robin

Distributes requests evenly across providers:

```bash
/profile save loadbalancer my-roundrobin roundrobin profile1 profile2 profile3
```

**Best for:** Maximizing throughput when all providers are equally capable.

## Cost-Optimized Configuration

Prioritize free/cheap providers, falling back to premium only when needed:

```bash
# Free tier first
/auth gemini enable
/provider gemini
/model gemini-3-flash-preview
/profile save model free-gemini

# Free Qwen backup
/auth qwen enable
/provider qwen
/model qwen3-coder-pro
/profile save model free-qwen

# Cheap paid fallback
/provider anthropic
/model claude-haiku-4-5-20251001
/keyfile ~/.anthropic_key
/profile save model cheap-claude

# Premium last resort
/model claude-sonnet-4-5-20250929
/profile save model premium-claude

# Combine with failover
/profile save loadbalancer cost-optimized failover free-gemini free-qwen cheap-claude premium-claude
```

## Capability-Optimized Configuration

Use the best model for complex tasks:

```bash
# Best reasoning with thinking
/provider anthropic
/model claude-sonnet-4-5-20250929
/set reasoning.enabled true
/set reasoning.budget_tokens 8192
/keyfile ~/.anthropic_key
/profile save model claude-thinking

# Strong Kimi K2 alternative
/provider kimi
/model kimi-k2-thinking
/keyfile ~/.kimi_key
/profile save model kimi-thinking

# Fast capable backup
/provider openai
/model gpt-5.2
/keyfile ~/.openai_key
/profile save model openai-fast

# Combine with failover
/profile save loadbalancer capability-optimized failover claude-thinking kimi-thinking openai-fast
```

## Setting Up Authentication

### Option 1: Keyfiles (Recommended)

Store API keys in secure files:

```bash
# Create secure keyfiles
echo "sk-ant-..." > ~/.anthropic_key
echo "sk-..." > ~/.openai_key
chmod 600 ~/.anthropic_key ~/.openai_key

# Use in profiles
/keyfile ~/.anthropic_key
/profile save model my-profile
```

### Option 2: OAuth for Subscriptions

Use your existing subscriptions:

```bash
/auth anthropic enable   # Claude Pro/Max
/auth codex enable       # ChatGPT Plus/Pro
/auth gemini enable      # Gemini (free)
/auth qwen enable        # Qwen (free)
/auth kimi enable        # Kimi subscription
```

### Option 3: Multi-Bucket OAuth Failover

If you have multiple accounts (personal + work):

```bash
# Authenticate multiple accounts
/auth anthropic login personal@gmail.com
/auth anthropic login work@company.com

# Save profile with bucket failover
/profile save model claude-ha personal@gmail.com work@company.com
```

## Interactive Commands

### Load High Availability Profile

```bash
/profile load high-availability
```

### Check Current Provider Status

```bash
/provider
/auth
```

### Switch Between Configurations

```bash
# For cost-sensitive work
/profile load cost-optimized

# For complex problems
/profile load capability-optimized

# For general reliability
/profile load high-availability
```

### Set Default Profile

```bash
/profile set-default high-availability
```

## Command Line Usage

```bash
# Start with high availability profile
llxprt --profile-load high-availability

# One-off with a specific profile
llxprt --profile-load cost-optimized "Explain this code"

# Interactive mode with profile
llxprt --profile-load capability-optimized -i "Let's work on this complex problem"
```

## Troubleshooting

### All Providers Failing

Check authentication for each provider:

```bash
# Check status
/auth

# Test individual profiles
/profile load claude-primary
Hello, are you working?

/profile load openai-backup
Hello, are you working?
```

### Unexpected Provider Being Used

Failover uses the first working provider. Check if your primary has issues:

```bash
# Review provider status
/stats lb
```

### Context Limit Mismatch

Ensure your profiles use consistent context limits. The conversation history is always preserved across providers, but provider-side caching may be lost when switching.

## Best Practices

1. **Test all providers**: Verify authentication works before depending on failover
2. **Use keyfiles**: More secure than environment variables, not in shell history
3. **Set consistent context limits**: Use the smallest provider's limit for compatibility
4. **Save profiles in TUI**: Use `/profile save` commands, not hand-written JSON
5. **Monitor costs**: Check `/stats` to track usage across providers
6. **Update regularly**: Provider capabilities and pricing change

## Next Steps

- [Claude Pro Workflow](./claude-pro-workflow.md) - Optimize Claude usage with thinking mode
- [Free Tier Setup](./free-tier-setup.md) - Add free providers to your stack
- [Profiles Documentation](../cli/profiles.md) - Full profile management guide
