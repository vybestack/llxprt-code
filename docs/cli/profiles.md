# Profiles

Profiles save your LLxprt Code configuration for quick switching between providers, models, and settings. There are two types of profiles: **model profiles** and **load balancer profiles**.

## Model Profiles

Model profiles capture your current session configuration including provider, model, and settings.

### Creating a Model Profile

```bash
/profile save model <name> [bucket1] [bucket2] ...
```

**What gets saved:**

- Current provider and model
- API base URL (if custom)
- Session settings (context limits, reasoning settings, etc.)
- OAuth bucket configuration (if specified)

### Basic Example

```bash
/provider anthropic
/model claude-sonnet-4-5
/profile save model work-claude
```

### Profile with OAuth Bucket

```bash
# Authenticate first
/auth anthropic login work@company.com

# Save profile using that bucket
/profile save model work-profile work@company.com
```

### Multi-Bucket Profiles (Automatic Failover)

Save a profile with multiple OAuth buckets for automatic failover when rate limits or quota errors occur:

```bash
# Authenticate to multiple buckets
/auth anthropic login work1@company.com
/auth anthropic login work2@company.com
/auth anthropic login work3@company.com

# Save profile with failover chain
/profile save model high-availability work1@company.com work2@company.com work3@company.com
```

**Failover behavior:**

- Buckets are tried in the order specified
- On 429 (rate limit): advance to next bucket immediately
- On 402 (quota/payment): advance to next bucket immediately
- On 401 (auth failure): attempt token refresh, retry once, then advance

> **Need to create buckets first?** See the [OAuth Setup Guide](../oauth-setup.md#multi-account-failover) for step-by-step bucket creation instructions and practical failover scenarios (team accounts, personal+work, multi-provider).

### OpenAI-Compatible Endpoints

Profiles work with any OpenAI-compatible endpoint. Here's an example using Synthetic with Kimi K2:

```json
{
  "version": 1,
  "provider": "openai",
  "model": "hf:moonshotai/Kimi-K2-Thinking",
  "modelParams": {
    "temperature": 1
  },
  "ephemeralSettings": {
    "auth-keyfile": "/path/to/api_key",
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

Another example with MiniMax M2:

```json
{
  "version": 1,
  "provider": "openai",
  "model": "hf:MiniMaxAI/MiniMax-M2",
  "modelParams": {
    "temperature": 1
  },
  "ephemeralSettings": {
    "auth-keyfile": "/path/to/api_key",
    "context-limit": 190000,
    "base-url": "https://api.synthetic.new/openai/v1",
    "streaming": "enabled",
    "reasoning.enabled": true,
    "reasoning.includeInContext": true,
    "reasoning.includeInResponse": true,
    "reasoning.stripFromContext": "none"
  }
}
```

## Load Balancer Profiles

Load balancer profiles combine multiple model profiles and distribute requests across them.

### Creating a Load Balancer Profile

```bash
/profile save loadbalancer <name> <roundrobin|failover> <profile1> <profile2> [profile3...]
```

Requires at least 2 existing model profiles.

### Policies

**`roundrobin`** - Distributes requests evenly across backends. Each request goes to the next profile in sequence.

```bash
/profile save loadbalancer balanced roundrobin claude-work openai-work gemini-work
```

**`failover`** - Uses primary backend until it fails, then tries the next one.

```bash
/profile save loadbalancer resilient failover primary-claude backup-openai emergency-gemini
```

### What Triggers Failover

By default, failover occurs on:

- HTTP 429 (rate limit)
- HTTP 500, 502, 503, 504 (server errors)
- Network/TCP errors

### Combining Load Balancer with OAuth Buckets

Create profiles with buckets, then reference them in a load balancer:

```bash
# Create bucketed profiles
/profile save model claude-team1 bucket1@company.com
/profile save model claude-team2 bucket2@company.com

# Create load balancer over them
/profile save loadbalancer team-lb roundrobin claude-team1 claude-team2
```

## Managing Profiles

### Loading a Profile

```bash
/profile load <name>
```

Or open interactive selection:

```bash
/profile load
```

### Listing Profiles

```bash
/profile list
```

### Deleting a Profile

```bash
/profile delete <name>
```

### Setting a Default Profile

```bash
/profile set-default <name>
```

The default profile loads automatically on startup.

### Loading via CLI Flag

```bash
llxprt --profile-load my-profile
```

## Advanced Load Balancer Settings

Configure these settings before saving a load balancer profile using `/set`:

| Setting                         | Default               | Description                               |
| ------------------------------- | --------------------- | ----------------------------------------- |
| `failover_retry_count`          | 1                     | Retries per backend before moving to next |
| `failover_retry_delay_ms`       | 0                     | Delay between retries (milliseconds)      |
| `failover_on_network_errors`    | true                  | Failover on TCP/network errors            |
| `failover_status_codes`         | [429,500,502,503,504] | HTTP codes that trigger failover          |
| `lb_tpm_failover_threshold`     | (none)                | Minimum TPM before triggering failover    |
| `lb_circuit_breaker_threshold`  | (none)                | Failures before circuit opens             |
| `lb_circuit_breaker_timeout_ms` | (none)                | Time before half-open retry               |

Example:

```bash
/set failover_retry_count 3
/set failover_retry_delay_ms 1000
/profile save loadbalancer my-lb failover profile1 profile2
```

## Viewing Profile Statistics

```bash
/stats lb          # Load balancer stats (requests per backend)
/stats buckets     # OAuth bucket usage stats
/diagnostics       # Full system status including active profile
```

## Common Workflows

### High-Availability Setup

```bash
# Create primary profile
/provider anthropic
/model claude-opus-4-5
/profile save model primary-claude

# Create backup profile
/provider openai
/model gpt-5.2
/profile save model backup-openai

# Create failover load balancer
/profile save loadbalancer ha-setup failover primary-claude backup-openai

# Set as default
/profile set-default ha-setup
```

### Rate Limit Distribution with Multiple Buckets

```bash
# Authenticate multiple buckets
/auth anthropic login team-bucket1
/auth anthropic login team-bucket2
/auth anthropic login team-bucket3

# Create profile with all buckets
/provider anthropic
/model claude-sonnet-4-5
/profile save model claude-multi team-bucket1 team-bucket2 team-bucket3
```

### Round-Robin Across Providers

```bash
# Create individual profiles
/provider anthropic
/model claude-sonnet-4-5
/profile save model claude-work

/provider openai
/model gpt-5.1-codex
/profile save model openai-work

/provider gemini
/model gemini-2.5-flash
/profile save model gemini-work

# Create round-robin load balancer
/profile save loadbalancer multi-provider roundrobin claude-work openai-work gemini-work
```

## Profile Storage

Profiles are stored as JSON files in `~/.llxprt/profiles/`. You can edit them directly if needed.

## Troubleshooting

### Profile not loading

- Check profile exists: `/profile list`
- Profile names cannot contain path separators (`/` or `\`)

### OAuth bucket errors

- Check bucket is authenticated: `/auth <provider> status`
- Re-authenticate expired bucket: `/auth <provider> login <bucket>`

### Load balancer not failing over

- Check settings: `failover_on_network_errors`, `failover_status_codes`
- Verify all referenced profiles exist: `/profile list`

## See Also

- [Authentication](./authentication.md) - Setting up provider authentication and OAuth buckets
- [Commands](./commands.md) - Complete command reference
- [Configuration](./configuration.md) - Configuration options
