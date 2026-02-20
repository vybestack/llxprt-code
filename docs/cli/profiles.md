# Profiles

Profiles save your LLxprt Code configuration so you can switch between setups instantly. There are two kinds:

- **Model profiles** — save a provider, model, key, and settings
- **Load balancer profiles** — combine multiple model profiles with failover or round-robin

> **Note:** LLxprt Code also has [sandbox profiles](./sandboxing.md) for container configuration. This page covers model and load balancer profiles only.

## Model Profiles

A model profile captures your current session state: provider, model, base URL, key reference, and any ephemeral settings.

### Creating a Profile

Set up your session the way you want, then save it:

```
/provider anthropic
/model claude-opus-4-6
/key load anthropic
/profile save model work-claude
```

From the command line:

```bash
llxprt --profile-load work-claude
```

### What Gets Saved

- Provider and model
- API base URL (if custom)
- Key name reference (from `/key load`)
- Session settings (context limits, reasoning, etc.)
- OAuth bucket configuration (if specified)

### Profile with OAuth Buckets

If you use OAuth, you can attach one or more bucket names to a profile. Buckets are just names you give to OAuth logins — most people use the email address of the account (see [Authentication](./authentication.md)):

```
/auth anthropic login work@company.com
/profile save model work-profile work@company.com
```

### Multi-Bucket Failover

Save a profile with multiple OAuth buckets. When one account hits rate limits, LLxprt Code automatically moves to the next — this works with all OAuth providers (Anthropic, Codex, Gemini, Qwen):

```
/auth anthropic login work1@company.com
/auth anthropic login work2@company.com
/auth anthropic login personal@gmail.com

/profile save model claude-ha work1@company.com work2@company.com personal@gmail.com
```

Failover behavior:

- Buckets are tried in order
- **429 (rate limit):** advance to next bucket immediately
- **402 (quota):** advance to next bucket immediately
- **401 (auth failure):** attempt token refresh, retry once, then advance

Multi-bucket failover is the best approach for long conversations — you stay on the same provider, preserving server-side prompt caching, while spreading load across accounts.

## Load Balancer Profiles

Load balancer profiles combine multiple model profiles. There are two policies:

### Failover (Recommended)

Uses the primary backend until it fails, then switches to the next. Best for most use cases — it maximizes provider-side prompt caching and only switches when something actually breaks:

```
/profile save loadbalancer resilient failover primary-claude backup-openai
```

### Round-Robin

Distributes requests evenly across backends, cycling through them. This is useful for providers with low per-minute rate limits (e.g., Cerebras) or when you intentionally want to spread load. **Not recommended for long conversations** — each backend switch loses server-side prompt caching:

```
/profile save loadbalancer spread roundrobin worker1 worker2 worker3
```

### What Triggers Failover

By default, failover occurs on:

- HTTP 429 (rate limit)
- HTTP 500, 502, 503, 504 (server errors)
- Network/TCP errors

### Conversation Context Is Preserved

LLxprt Code maintains conversation history at the application layer, not the provider side. When a load balancer switches backends, the full conversation history is sent to the new backend — **you don't lose context**. What you do lose is provider-side prompt caching (the new backend has to re-process the conversation from scratch), which may add latency.

## Managing Profiles

```
/profile list                  # List all profiles
/profile load <name>           # Load a profile
/profile load                  # Interactive profile picker
/profile delete <name>         # Delete a profile
/profile set-default <name>    # Auto-load on startup
```

From the command line:

```bash
llxprt --profile-load my-profile
```

## Common Setups

### Simple Key-Based Profile

```
/provider xai
/model grok-4
/key load xai
/profile save model grok-daily
/profile set-default grok-daily
```

### High-Availability Across Providers

```
/provider anthropic
/model claude-opus-4-6
/key load anthropic
/profile save model primary-claude

/provider openai
/model gpt-5.2
/key load openai
/profile save model backup-openai

/profile save loadbalancer ha-setup failover primary-claude backup-openai
/profile set-default ha-setup
```

### Multi-Account Rate Limit Handling

```
/auth anthropic login team1@company.com
/auth anthropic login team2@company.com
/auth anthropic login personal@gmail.com

/provider anthropic
/model claude-opus-4-6
/profile save model claude-multi team1@company.com team2@company.com personal@gmail.com
```

## Manual Profile Files

Profiles are stored as JSON in `~/.llxprt/profiles/`. You can edit them directly.

Profiles work with any OpenAI-compatible or Anthropic-compatible endpoint. Here's an example targeting Synthetic:

```json
{
  "version": 1,
  "provider": "openai",
  "model": "hf:moonshotai/Kimi-K2-Thinking",
  "modelParams": {
    "temperature": 1
  },
  "ephemeralSettings": {
    "auth-key-name": "synthetic",
    "context-limit": 190000,
    "base-url": "https://api.synthetic.new/openai/v1",
    "streaming": "enabled",
    "reasoning.enabled": true,
    "reasoning.includeInContext": true,
    "reasoning.includeInResponse": true,
    "reasoning.stripFromContext": "all"
  }
}
```

Load balancer profile:

```json
{
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "backends": ["claude-ha", "openai-ha"],
  "ephemeralSettings": {
    "failover_retry_count": 2,
    "failover_retry_delay_ms": 1000,
    "failover_status_codes": [429, 500, 502, 503, 504],
    "failover_on_network_errors": true
  }
}
```

## Advanced Load Balancer Settings

Configure before saving a load balancer profile with `/set`:

| Setting                         | Default               | Description                               |
| ------------------------------- | --------------------- | ----------------------------------------- |
| `failover_retry_count`          | 1                     | Retries per backend before moving to next |
| `failover_retry_delay_ms`       | 0                     | Delay between retries (ms)                |
| `failover_on_network_errors`    | true                  | Failover on TCP/network errors            |
| `failover_status_codes`         | [429,500,502,503,504] | HTTP codes that trigger failover          |
| `lb_tpm_failover_threshold`     | —                     | Min TPM before triggering failover        |
| `lb_circuit_breaker_threshold`  | —                     | Failures before circuit opens             |
| `lb_circuit_breaker_timeout_ms` | —                     | Time before half-open retry               |

## Viewing Stats

```
/stats lb          # Load balancer request counts per backend
/stats buckets     # OAuth bucket usage
/diagnostics       # Full system status including active profile
```

## Troubleshooting

**Profile not loading** — Check it exists with `/profile list`. Profile names can't contain `/` or `\`.

**OAuth bucket errors** — Check status with `/auth <provider> status`. Re-authenticate with `/auth <provider> login <bucket>`.

**Load balancer not failing over** — Verify `failover_status_codes` includes the error code you're seeing, and that all referenced profiles exist.

## Related

- [Authentication](./authentication.md) — OAuth, keyring, and API key setup
- [Providers](./providers.md) — Provider setup and custom aliases
- [Configuration](./configuration.md) — Full settings reference
