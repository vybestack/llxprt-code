# Free Tier Setup Recipe

This recipe guides you through setting up LLxprt Code with free-tier AI providers. Both Gemini and Qwen offer generous free tiers perfect for getting started.

## When to Use This Setup

- You're exploring LLxprt Code without API costs
- You want to experiment with different models before committing to paid tiers
- You're building personal projects with moderate usage
- You want backup free providers for rate limit situations

## Provider Overview

| Provider | Context Limit | Free Tier Details                  |
| -------- | ------------- | ---------------------------------- |
| Gemini   | 1,048,576     | Free with Google account via OAuth |
| Qwen     | 262,144       | Free with Alibaba Cloud account    |

## Gemini OAuth Setup (Free)

Gemini offers the largest context window (1M tokens) on its free tier.

### Step 1: Enable OAuth

```bash
/auth gemini enable
```

### Step 2: Set Your Model

```bash
/model gemini-3-flash-preview
```

### Step 3: Configure Context Limit

```bash
/set context-limit 1048576
/set modelparam max_tokens 8192
```

### Step 4: Authenticate

Make any request to trigger OAuth:

```bash
Hello, can you help me with a coding task?
```

Your browser will open for Google authentication. Grant permissions and you're set!

### Step 5: Save Profile

```bash
/profile save gemini-free
```

### Complete Gemini Free Profile JSON

Save this to `~/.llxprt/profiles/gemini-free.json`:

```json
{
  "version": 1,
  "provider": "gemini",
  "model": "gemini-3-flash-preview",
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 8192
  },
  "ephemeralSettings": {
    "context-limit": 1048576
  }
}
```

## Qwen OAuth Setup (Free)

Qwen offers excellent coding capabilities on its free tier.

### Step 1: Enable OAuth

```bash
/auth qwen enable
```

### Step 2: Set Your Model

```bash
/model qwen3-coder-pro
```

### Step 3: Configure Context Limit

```bash
/set context-limit 262144
/set modelparam max_tokens 4096
```

### Step 4: Authenticate

Make any request to trigger the device code flow:

```bash
Hello, can you help me with a coding task?
```

You'll see a device code and URL. Visit the URL, enter the code, and grant permissions.

### Step 5: Save Profile

```bash
/profile save qwen-free
```

### Complete Qwen Free Profile JSON

Save this to `~/.llxprt/profiles/qwen-free.json`:

```json
{
  "version": 1,
  "provider": "qwen",
  "model": "qwen3-coder-pro",
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 4096
  },
  "ephemeralSettings": {
    "context-limit": 262144
  }
}
```

## Switching Between Free Providers

### Interactive Switching

```bash
# Switch to Gemini
/profile load gemini-free

# Switch to Qwen
/profile load qwen-free
```

### Command Line Switching

```bash
# Start with Gemini
llxprt --profile-load gemini-free

# Start with Qwen
llxprt --profile-load qwen-free
```

### Set a Default Free Provider

```bash
# Make Gemini your default (loads on every startup)
/profile set-default gemini-free
```

## Combined Free Tier Profile with Failover

For maximum availability, create a profile that uses Gemini as primary with Qwen as backup. This uses LLxprt's load balancer feature:

Save this to `~/.llxprt/profiles/free-tier-lb.json`:

```json
{
  "version": 1,
  "provider": "lb",
  "model": "gemini-3-flash-preview",
  "ephemeralSettings": {
    "context-limit": 262144,
    "lb": {
      "type": "failover",
      "buckets": [
        {
          "provider": "gemini",
          "model": "gemini-3-flash-preview",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 8192
          }
        },
        {
          "provider": "qwen",
          "model": "qwen3-coder-pro",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 4096
          }
        }
      ]
    }
  }
}
```

**Note:** When using failover, set `context-limit` to the smaller of the two providers (262,144) to ensure compatibility.

## Troubleshooting

### OAuth Token Expired

If you get authentication errors:

```bash
# Re-authenticate
/auth gemini logout
/auth gemini enable

# Or for Qwen
/auth qwen logout
/auth qwen enable
```

### Rate Limit Errors

Free tiers have rate limits. If you hit them:

1. Wait a few minutes before retrying
2. Switch to your backup provider
3. Consider the failover profile above

### Context Limit Errors

If you see "context limit exceeded" errors:

```bash
# Start a new conversation to clear history
/clear

# Or compress the current conversation
/compress
```

## Best Practices

1. **Save both profiles**: Have quick access to both free providers
2. **Use Gemini for large contexts**: Its 1M token limit handles big codebases
3. **Use Qwen for coding tasks**: Excellent code generation and understanding
4. **Monitor rate limits**: Switch providers when one hits limits
5. **Set a default**: Choose your preferred provider as default for convenience

## Next Steps

- [High Availability Setup](./high-availability.md) - Add paid providers for production use
- [CI/CD Automation](./ci-cd-automation.md) - Use free tiers in your pipelines
- [Settings and Profiles](../settings-and-profiles.md) - Learn more about profile management
