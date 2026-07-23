# Free / Low-Cost Tier Setup Recipe

This recipe guides you through setting up LLxprt Code with low-cost AI providers. Both Gemini and Qwen can be a great way to get started.

> **Important — tier availability changes:** Google removed free consumer "Login with Google" Gemini-CLI access entirely in mid-2026; use a Gemini API key or Vertex AI instead. **Qwen's free OAuth tier ended 2026-04-15** and the OAuth provider has been removed — use a DashScope API key (`DASHSCOPE_API_KEY`) or an OpenRouter API key with the `qwen` alias. See [authentication](../cli/authentication.md) for current details.

## When to Use This Setup

- You're exploring LLxprt Code at low cost
- You want to experiment with different models before committing to premium tiers
- You're building personal projects with moderate usage
- You want backup providers for rate limit situations

## Provider Overview

| Provider | Context Limit       | Auth                        |
| -------- | ------------------- | --------------------------- |
| Gemini   | 1,048,576 (API key) | Gemini API key or Vertex AI |
| Qwen     | 200,000             | DashScope API key           |

> Context windows can differ between API-key and OAuth/subscription access; the figures above reflect API-key access.

## Gemini Setup

Gemini offers the largest context window (1M tokens over API key).

### Step 1: Set Your API Key

Set a Gemini API key:

```bash
/keyfile ~/.gemini_key
```

### Step 2: Set Your Model

```bash
/model gemini-2.5-flash
```

### Step 3: Configure Context Limit

```bash
/set context-limit 1048576
/set modelparam max_tokens 8192
```

### Step 4: Authenticate

Make any request to verify your API key is working:

```bash
Hello, can you help me with a coding task?
```

### Step 5: Save Profile

```bash
/profile save gemini-free
```

### Complete Gemini Free Profile JSON

Save this to `<config>/profiles/gemini-free.json` (see [Application Directories](../reference/application-directories.md)):

```json
{
  "version": 1,
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 8192
  },
  "ephemeralSettings": {
    "context-limit": 1048576
  }
}
```

## Qwen Setup

Qwen offers excellent coding capabilities and is now API-key-only via Alibaba Cloud DashScope.

### Step 1: Set Your API Key

Qwen's free OAuth tier ended 2026-04-15. Use a DashScope API key:

```bash
/keyfile ~/.qwen_key
```

### Step 2: Set Your Model

```bash
/model qwen3-coder-plus
```

### Step 3: Configure Context Limit

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
```

### Step 4: Save Profile

```bash
/profile save qwen-free
```

### Complete Qwen Free Profile JSON

Save this to `<config>/profiles/qwen-free.json`:

```json
{
  "version": 1,
  "provider": "qwen",
  "model": "qwen3-coder-plus",
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 4096
  },
  "ephemeralSettings": {
    "context-limit": 200000
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

Save this to `<config>/profiles/free-tier-lb.json` (see [Application Directories](../reference/application-directories.md)):

```json
{
  "version": 1,
  "provider": "lb",
  "model": "gemini-2.5-flash",
  "ephemeralSettings": {
    "context-limit": 200000,
    "lb": {
      "type": "failover",
      "buckets": [
        {
          "provider": "gemini",
          "model": "gemini-2.5-flash",
          "modelParams": {
            "temperature": 0.7,
            "max_tokens": 8192
          }
        },
        {
          "provider": "qwen",
          "model": "qwen3-coder-plus",
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

**Note:** When using failover, set `context-limit` to the smaller of the two providers (200,000) to ensure compatibility.

## Troubleshooting

### API Key Issues

If you get authentication errors, verify your Gemini API key is set correctly:

```bash
/keyfile ~/.gemini_key
```

Qwen no longer supports OAuth — if you see Qwen auth errors, verify your DashScope API key is set correctly with `/keyfile ~/.qwen_key`.

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

1. **Save both profiles**: Have quick access to both Gemini and Qwen
2. **Use Gemini for large contexts**: Its 1M token limit (API key) handles big codebases
3. **Use Qwen for coding tasks**: Excellent code generation and understanding
4. **Monitor rate limits**: Switch providers when one hits limits
5. **Set a default**: Choose your preferred provider as default for convenience

## Next Steps

- [High Availability Setup](./high-availability.md) - Add paid providers for production use
- [All Recipes](./index.md) - Browse the full recipe collection
- [Settings and Profiles](../settings-and-profiles.md) - Learn more about profile management
