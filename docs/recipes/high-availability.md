# High Availability Multi-Provider Recipe

This recipe guides you through setting up LLxprt Code with multiple providers for maximum availability and reliability.

## When to Use This Setup

- You need reliable AI assistance for production work
- You want automatic failover when providers are unavailable
- You're building systems that can't afford downtime
- You want to balance cost vs. capability across providers

## Provider Overview

| Provider | Context Limit | Cost Tier | Best For                    |
| -------- | ------------- | --------- | --------------------------- |
| Claude   | 200,000       | Premium   | Complex reasoning, analysis |
| OpenAI   | 400,000       | Premium   | General tasks, fast         |
| Gemini   | 1,048,576     | Free/Paid | Large context, free tier    |

## Basic Failover Configuration

This configuration tries Claude first, then OpenAI, then Gemini:

### Complete Failover Profile JSON

Save this to `~/.llxprt/profiles/high-availability.json`:

```json
{
  "version": 1,
  "provider": "lb",
  "model": "claude-sonnet-4-5",
  "ephemeralSettings": {
    "context-limit": 200000,
    "lb": {
      "type": "failover",
      "buckets": [
        {
          "provider": "anthropic",
          "model": "claude-sonnet-4-5",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 8192
          }
        },
        {
          "provider": "openai",
          "model": "gpt-5.2",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 8192
          }
        },
        {
          "provider": "gemini",
          "model": "gemini-3-flash-preview",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 8192
          }
        }
      ]
    }
  }
}
```

**Note:** Set `context-limit` to the smallest provider limit (200,000) to ensure all providers can handle requests.

## Load Balancer Types

### Failover (Recommended for Reliability)

Tries providers in order, moving to the next only on failure:

```json
{
  "lb": {
    "type": "failover",
    "buckets": [...]
  }
}
```

**Best for:** Production systems where you want predictable primary provider usage.

### Round Robin

Distributes requests evenly across providers:

```json
{
  "lb": {
    "type": "round-robin",
    "buckets": [...]
  }
}
```

**Best for:** Maximizing throughput when all providers are equally capable.

### Random

Randomly selects a provider for each request:

```json
{
  "lb": {
    "type": "random",
    "buckets": [...]
  }
}
```

**Best for:** Simple load distribution without state.

## Cost-Optimized Configuration

Prioritize free/cheap providers, falling back to premium only when needed:

Save this to `~/.llxprt/profiles/cost-optimized.json`:

```json
{
  "version": 1,
  "provider": "lb",
  "model": "gemini-3-flash-preview",
  "ephemeralSettings": {
    "context-limit": 200000,
    "lb": {
      "type": "failover",
      "buckets": [
        {
          "provider": "gemini",
          "model": "gemini-3-flash-preview",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 8192
          },
          "note": "Free tier - try first"
        },
        {
          "provider": "qwen",
          "model": "qwen3-coder-pro",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 4096
          },
          "note": "Free tier backup"
        },
        {
          "provider": "anthropic",
          "model": "claude-haiku-4-5",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 4096
          },
          "note": "Cheap paid fallback"
        },
        {
          "provider": "anthropic",
          "model": "claude-sonnet-4-5",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 8192
          },
          "note": "Premium last resort"
        }
      ]
    }
  }
}
```

## Capability-Optimized Configuration

Use the best model for complex tasks, with cheaper fallbacks:

Save this to `~/.llxprt/profiles/capability-optimized.json`:

```json
{
  "version": 1,
  "provider": "lb",
  "model": "claude-sonnet-4-5",
  "ephemeralSettings": {
    "context-limit": 200000,
    "lb": {
      "type": "failover",
      "buckets": [
        {
          "provider": "anthropic",
          "model": "claude-sonnet-4-5",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 16384,
            "thinking": {
              "type": "enabled",
              "budget_tokens": 8192
            }
          },
          "note": "Best reasoning with thinking"
        },
        {
          "provider": "openai",
          "model": "o3-pro",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 8192
          },
          "note": "Strong reasoning alternative"
        },
        {
          "provider": "openai",
          "model": "gpt-5.2",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 8192
          },
          "note": "Fast, capable backup"
        },
        {
          "provider": "gemini",
          "model": "gemini-3-pro-preview",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 8192
          },
          "note": "Large context fallback"
        }
      ]
    }
  }
}
```

## Setting Up Authentication

For high availability, configure authentication for all providers:

### API Keys (Environment Variables)

```bash
# Add to ~/.bashrc or ~/.zshrc
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."
```

### OAuth for Free Providers

```bash
# Enable OAuth for free providers
/auth gemini enable
/auth qwen enable
```

### Keyfiles for Security

```bash
# Create secure keyfiles
echo "sk-ant-..." > ~/.keys/anthropic.key
echo "sk-..." > ~/.keys/openai.key
chmod 600 ~/.keys/*.key
```

## Mixed Authentication Profile

Combine OAuth and API keys in a single profile:

```json
{
  "version": 1,
  "provider": "lb",
  "model": "claude-sonnet-4-5",
  "ephemeralSettings": {
    "context-limit": 200000,
    "lb": {
      "type": "failover",
      "buckets": [
        {
          "provider": "anthropic",
          "model": "claude-sonnet-4-5",
          "note": "Uses OAuth or ANTHROPIC_API_KEY env var"
        },
        {
          "provider": "openai",
          "model": "gpt-5.2",
          "key": "sk-...",
          "note": "Explicit API key"
        },
        {
          "provider": "gemini",
          "model": "gemini-3-flash-preview",
          "note": "Uses OAuth (free tier)"
        }
      ]
    }
  }
}
```

## Cost vs. Capability Tradeoffs

| Configuration        | Cost     | Capability | Availability | Use Case            |
| -------------------- | -------- | ---------- | ------------ | ------------------- |
| Cost-Optimized       | Low      | Moderate   | High         | Personal projects   |
| Capability-Optimized | High     | Maximum    | High         | Production code     |
| Basic Failover       | Moderate | High       | Very High    | General development |

### Decision Guide

1. **Personal/Learning**: Use cost-optimized (free tiers first)
2. **Professional Development**: Use basic failover (reliable, balanced)
3. **Production/Critical**: Use capability-optimized (best results)
4. **CI/CD Pipelines**: Use cost-optimized with explicit keys

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

## Command Line Usage

```bash
# Start with high availability
llxprt --profile-load high-availability

# Or with inline profile
llxprt --profile '{"provider":"lb","ephemeralSettings":{"lb":{"type":"failover","buckets":[{"provider":"anthropic","model":"claude-sonnet-4-5"},{"provider":"openai","model":"gpt-5.2"}]}}}'
```

## Troubleshooting

### All Providers Failing

Check authentication for each provider:

```bash
# Check status
/auth

# Test individual providers
/provider anthropic
/model claude-sonnet-4-5
Hello, are you working?

/provider openai
/model gpt-5.2
Hello, are you working?
```

### Unexpected Provider Being Used

Failover uses the first working provider. Check if your primary has issues:

```bash
# Review provider status
/provider

# Check for rate limits or errors in previous responses
```

### Context Limit Mismatch

Ensure your `context-limit` is set to the smallest provider limit:

```bash
/set context-limit 200000
/profile save high-availability
```

## Best Practices

1. **Test all providers**: Verify authentication works before depending on failover
2. **Set conservative context limits**: Use the smallest provider's limit
3. **Monitor costs**: Track usage across providers
4. **Update regularly**: Provider capabilities and pricing change
5. **Keep credentials secure**: Use keyfiles or environment variables
6. **Have a backup plan**: Know how to manually switch if LB fails

## Next Steps

- [CI/CD Automation](./ci-cd-automation.md) - Use HA config in pipelines
- [Claude Pro Workflow](./claude-pro-workflow.md) - Optimize Claude usage
- [Free Tier Setup](./free-tier-setup.md) - Add free providers
