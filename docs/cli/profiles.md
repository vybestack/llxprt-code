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

## Cache Considerations

When using load balancers, understanding cache behavior helps optimize performance.

### Conversation History is Always Preserved

**Important:** LLxprt Code maintains conversation history at the application layer (in the HistoryService), not at the provider level. This means:

- **Full conversation history is sent with every request** to whichever backend handles it
- **Switching backends does NOT lose conversation context** - the history travels with the request
- Both round-robin and failover strategies preserve complete conversation continuity

```bash
# With round-robin, each backend receives the FULL conversation history
/profile save loadbalancer multi roundrobin claude-work openai-work gemini-work

# Request 1 → claude-work (receives: [user message 1])
# Request 2 → openai-work (receives: [user message 1, assistant response 1, user message 2])
# Request 3 → gemini-work (receives: [full history including messages 1-3])
# All backends see the complete conversation!
```

### What IS Lost on Backend Switch: Provider-Side Caching

While conversation history is preserved, **provider-side prompt caching** may be lost:

- **Anthropic prompt caching**: Anthropic caches tokenized prefixes server-side for faster responses. Switching to a different backend (or even a different Anthropic bucket) invalidates this cache.
- **OpenAI cached tokens**: Similar server-side optimization that resets on backend switch.
- **Gemini context caching**: Google's cached context feature is tied to specific sessions.

**This means:**

1. **No loss of conversation context** - the new backend receives full history
2. **Potential latency increase** - first request to new backend may be slower (no cached tokens)
3. **Potential cost increase** - provider may charge for re-tokenizing the conversation prefix

### Best Practices for Cache-Optimized Configuration

**1. Prefer failover over round-robin to maximize provider-side caching:**

```bash
# Good for conversations - stays on one backend, maximizes prompt cache hits
/profile save loadbalancer chat-resilient failover primary backup

# Better for stateless batch jobs where caching doesn't matter
/profile save loadbalancer batch-jobs roundrobin worker1 worker2 worker3
```

**2. Use bucket failover within a single profile for rate limit handling:**

```bash
# Multiple buckets on same provider - preserves provider-side cache
/profile save model claude-multi bucket1 bucket2 bucket3

# Same provider = same tokenization = cache may still be valid
```

**3. Set appropriate retry counts to avoid premature failover:**

```bash
# Allow retries before switching backends (preserves cache longer)
/set failover_retry_count 3
/set failover_retry_delay_ms 2000
/profile save loadbalancer patient-lb failover primary backup
```

**4. For long conversations, prefer single-provider setups:**

Single-provider configurations maximize provider-side caching benefits. Load balancers are better suited for high-availability needs rather than routine conversations.

## Failover Behavior

Understanding when and how failover occurs helps you configure resilient setups.

### Default Failover Triggers

By default, these HTTP status codes trigger failover:

| Status Code | Meaning               | Failover Behavior                  |
| ----------- | --------------------- | ---------------------------------- |
| 429         | Rate Limited          | Immediate failover to next backend |
| 500         | Internal Server Error | Retry, then failover               |
| 502         | Bad Gateway           | Retry, then failover               |
| 503         | Service Unavailable   | Retry, then failover               |
| 504         | Gateway Timeout       | Retry, then failover               |

Network errors (TCP connection failures, DNS resolution failures, timeouts) also trigger failover when `failover_on_network_errors` is enabled (default: true).

### Customizing Failover Status Codes

Override the default status codes using `failover_status_codes`:

```bash
# Only failover on rate limits and service unavailable
/set failover_status_codes [429,503]

# Add 400 (bad request) to failover triggers
/set failover_status_codes [400,429,500,502,503,504]

# Failover on any 4xx or 5xx error
/set failover_status_codes [400,401,402,403,404,429,500,501,502,503,504]
```

Save the configuration to a profile:

```bash
/set failover_status_codes [429,500,502,503,504]
/profile save loadbalancer my-lb failover primary backup
```

### Bucket Failover vs Load Balancer Failover

There are two distinct failover mechanisms that can work together:

**Bucket Failover** (within a single model profile):

- Rotates OAuth buckets on the same provider
- Preserves model context and conversation state
- Triggers on: 429 (rate limit), 402 (quota), 401 (auth failure with refresh)

```bash
# Bucket failover within a profile
/profile save model claude-buckets bucket1 bucket2 bucket3
```

**Load Balancer Failover** (across model profiles):

- Switches between entirely different backends (potentially different providers)
- Loses context on switch (see Cache Considerations above)
- Triggers on: configurable status codes (default: 429, 500, 502, 503, 504)

```bash
# LB failover across profiles
/profile save loadbalancer multi-provider failover claude-profile openai-profile
```

**Combined failover chain:**

When both are configured, bucket failover occurs first, then LB failover:

```
Request fails with 429
  → Try bucket2 (same profile)
    → Try bucket3 (same profile)
      → All buckets exhausted, LB failover
        → Try next profile in load balancer
```

### Retry Configuration

Fine-tune retry behavior before failover occurs:

```bash
# Number of retries per backend before moving to next
/set failover_retry_count 3

# Delay between retries (milliseconds)
/set failover_retry_delay_ms 1000

# Disable network error failover (not recommended)
/set failover_on_network_errors false
```

**Example with aggressive retry:**

```bash
/set failover_retry_count 5
/set failover_retry_delay_ms 2000  # 2 seconds between retries
/profile save loadbalancer patient-failover failover primary backup
```

**Example with immediate failover:**

```bash
/set failover_retry_count 0  # No retries, immediate failover
/set failover_retry_delay_ms 0
/profile save loadbalancer fast-failover failover primary backup
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
/model gpt-5.2
/profile save model openai-work

/provider gemini
/model gemini-3-flash-preview
/profile save model gemini-work

# Create round-robin load balancer
/profile save loadbalancer multi-provider roundrobin claude-work openai-work gemini-work
```

### Resilient Multi-Provider Setup with OAuth Buckets

This example demonstrates a complete high-availability configuration combining:

- Multiple providers (Anthropic, OpenAI)
- OAuth bucket failover within each provider
- Load balancer failover across providers
- Custom failover status codes

**Step 1: Set up OAuth buckets for each provider**

```bash
# Anthropic buckets (team accounts)
/auth anthropic login team1@company.com
/auth anthropic login team2@company.com
/auth anthropic login personal@gmail.com

# OpenAI buckets
/auth codex login enterprise@company.com
/auth codex login backup@company.com
```

**Step 2: Create model profiles with bucket chains**

```bash
# Anthropic profile with 3-bucket failover
/provider anthropic
/model claude-sonnet-4-5
/profile save model claude-ha team1@company.com team2@company.com personal@gmail.com

# OpenAI profile with 2-bucket failover
/provider openai
/model gpt-5.2
/profile save model openai-ha enterprise@company.com backup@company.com
```

**Step 3: Configure failover settings**

```bash
# Retry 2 times with 1 second delay before failover
/set failover_retry_count 2
/set failover_retry_delay_ms 1000

# Trigger failover on rate limits and server errors
/set failover_status_codes [429,500,502,503,504]

# Enable network error failover
/set failover_on_network_errors true
```

**Step 4: Create the load balancer**

```bash
# Create failover load balancer: try Anthropic first, fall back to OpenAI
/profile save loadbalancer enterprise-ha failover claude-ha openai-ha

# Set as default
/profile set-default enterprise-ha
```

**Complete failover chain in action:**

```
Request hits 429 (rate limit)
  ↓
Bucket failover: team1@company.com → team2@company.com
  ↓ (still 429)
Bucket failover: team2@company.com → personal@gmail.com
  ↓ (still 429, all Anthropic buckets exhausted)
LB failover: claude-ha profile → openai-ha profile
  ↓
New provider (OpenAI) with fresh bucket chain:
  enterprise@company.com → backup@company.com
  ↓
Request succeeds on OpenAI
```

**Verify the configuration:**

```bash
# Check load balancer stats
/stats lb

# Check bucket usage
/stats buckets

# View full diagnostics
/diagnostics
```

**The complete profile JSON (enterprise-ha.json):**

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
