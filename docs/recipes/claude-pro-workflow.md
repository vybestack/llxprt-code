# Claude Pro/Max Workflow Recipe

This recipe guides you through setting up LLxprt Code with Claude Pro or Claude Max subscription, including thinking mode for complex reasoning tasks.

## When to Use This Setup

- You have a Claude Pro or Claude Max subscription
- You need extended thinking for complex coding and reasoning tasks
- You want to leverage Claude's full capabilities
- You're working on production-level code that benefits from deeper analysis

## Provider Overview

| Feature        | Claude Pro/Max                       |
| -------------- | ------------------------------------ |
| Context Limit  | 200,000 tokens                       |
| Authentication | OAuth (subscription-based)           |
| Thinking Mode  | Available with budget_tokens control |
| Best For       | Complex reasoning, code analysis     |

## Basic Claude OAuth Setup

### Step 1: Enable OAuth

```bash
/auth anthropic enable
```

### Step 2: Set Your Model

```bash
/model claude-sonnet-4-5
```

### Step 3: Configure Context and Tokens

```bash
/set context-limit 200000
/set modelparam max_tokens 8192
```

### Step 4: Authenticate

Make any request to trigger OAuth:

```bash
Hello, can you help me with a coding task?
```

A dialog will prompt you for your authorization code. Visit the Anthropic console to get your code.

### Step 5: Save Profile

```bash
/profile save claude-pro
```

### Complete Basic Claude Profile JSON

Save this to `~/.llxprt/profiles/claude-pro.json`:

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 8192
  },
  "ephemeralSettings": {
    "context-limit": 200000
  }
}
```

## Enabling Thinking Mode

Thinking mode allows Claude to reason through complex problems step-by-step before providing an answer.

### Step 1: Enable Thinking

```bash
/set modelparam thinking {"type":"enabled","budget_tokens":8192}
```

The `budget_tokens` parameter controls how many tokens Claude can use for thinking:

- **4096**: Quick analysis, simple problems
- **8192**: Standard depth, most coding tasks
- **16384**: Deep analysis, complex architecture decisions
- **32768**: Maximum depth, intricate multi-step reasoning

### Step 2: Adjust Max Tokens

When using thinking mode, increase `max_tokens` to accommodate both thinking and response:

```bash
/set modelparam max_tokens 16384
```

### Step 3: Save Thinking Profile

```bash
/profile save claude-thinking
```

### Complete Thinking Mode Profile JSON

Save this to `~/.llxprt/profiles/claude-thinking.json`:

```json
{
  "version": 1,
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
  "ephemeralSettings": {
    "context-limit": 200000
  }
}
```

## Multi-Bucket Failover for Rate Limits

Claude Pro/Max subscriptions have rate limits. Configure multiple authentication buckets to maximize throughput:

### Option 1: Multiple OAuth Sessions

If you have multiple Claude subscriptions (personal + work):

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
          "note": "Primary OAuth account"
        },
        {
          "provider": "anthropic",
          "model": "claude-sonnet-4-5",
          "key": "sk-ant-api03-secondary-key...",
          "note": "Backup API key account"
        }
      ]
    }
  }
}
```

### Option 2: Model Tier Failover

Fall back to faster/cheaper models when rate limited:

Save this to `~/.llxprt/profiles/claude-tiered.json`:

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
          }
        },
        {
          "provider": "anthropic",
          "model": "claude-haiku-4-5",
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

## Interactive Commands Reference

### Quick Thinking Toggle

```bash
# Enable thinking
/set reasoning.enabled true
/set reasoning.budget_tokens 8192

# Disable thinking (for simpler tasks)
/set reasoning.enabled false

# Check current parameters
/set
```

### Adjust Thinking Budget On-the-fly

```bash
# Light thinking for quick tasks
/set reasoning.budget_tokens 4096

# Deep thinking for complex problems
/set reasoning.budget_tokens 32768

# Control reasoning visibility
/set reasoning.includeInContext true
/set reasoning.includeInResponse true
/set reasoning.stripFromContext none  # or: all, allButLast
```

### Quick Profile Switching

```bash
# Simple tasks without thinking
/profile load claude-pro

# Complex tasks with thinking
/profile load claude-thinking
```

## Command Line Usage

### Start with Thinking Enabled

```bash
llxprt --profile-load claude-thinking
```

### One-off with Inline Profile

```bash
llxprt --profile '{"provider":"anthropic","model":"claude-sonnet-4-5","modelParams":{"thinking":{"type":"enabled","budget_tokens":8192}}}' -p "Analyze this code for security issues"
```

## Troubleshooting

### Rate Limit Errors

If you see rate limit errors:

1. Wait a few minutes (limits reset periodically)
2. Switch to tiered failover profile
3. Reduce thinking budget temporarily

```bash
# Quick fix: reduce thinking budget
/set modelparam thinking {"type":"enabled","budget_tokens":4096}
```

### OAuth Token Issues

```bash
# Re-authenticate
/auth anthropic logout
/auth anthropic enable
```

### Thinking Mode Not Working

Ensure you're using a compatible model:

```bash
# Check current model
/model

# Switch to thinking-compatible model
/model claude-sonnet-4-5
```

### Context Limit Exceeded

```bash
# Clear conversation
/clear

# Or compress history
/compress

# Check context usage
/context
```

## Best Practices

1. **Match thinking budget to task complexity**: Don't use 32k tokens for simple questions
2. **Save multiple profiles**: Quick switching between thinking modes
3. **Use failover for production**: Avoid disruptions from rate limits
4. **Monitor token usage**: Thinking tokens count toward your usage
5. **Start with disabled thinking**: Enable only when needed for complex tasks

## Profile Summary

| Profile           | Use Case                        | Thinking    |
| ----------------- | ------------------------------- | ----------- |
| `claude-pro`      | General coding, quick responses | Disabled    |
| `claude-thinking` | Complex analysis, architecture  | 8192 tokens |
| `claude-tiered`   | Production with failover        | On primary  |

## Next Steps

- [High Availability Setup](./high-availability.md) - Multi-provider redundancy
- [CI/CD Automation](./ci-cd-automation.md) - Use Claude in pipelines
- [Free Tier Setup](./free-tier-setup.md) - Add free providers as backup
