# Profile File Reference

Profiles are JSON files stored in `~/.llxprt/profiles/<name>.json`. They capture your full provider/model/settings configuration so you can switch contexts with one command.

You almost never need to hand-edit these files. Use `/profile save`, `/profile load`, `/provider`, `/model`, `/baseurl`, `/key`, `/keyfile`, `/set`, and `/set modelparam` to build your configuration, then save it. This reference documents the file format for when you need to understand what's inside, troubleshoot, or automate profile creation.

For guidance on which settings to tune and why, see [Settings and Profiles](../settings-and-profiles.md). For the complete list of ephemeral settings, see [Ephemeral Settings Reference](./ephemerals.md).

## Standard Profile

The most common profile type. Configures a single provider and model.

```json
{
  "version": 1,
  "provider": "chutes-ai",
  "model": "zai-org/GLM-5-TEE",
  "modelParams": {},
  "ephemeralSettings": {
    "auth-key-name": "chutes-prod",
    "reasoning.enabled": true,
    "reasoning.effort": "medium",
    "context-limit": 200000
  }
}
```

### Top-Level Fields

| Field               | Type   | Required | Description                                                                                                                                   |
| ------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | number | yes      | Always `1`. Reserved for future format changes.                                                                                               |
| `type`              | string | no       | `"standard"` or omitted. Omitting defaults to standard.                                                                                       |
| `provider`          | string | yes      | Provider name — must match a registered provider or alias (e.g., `"kimi"`, `"chutes-ai"`, `"xAI"`, `"codex"`). This is what `/provider` sets. |
| `model`             | string | yes      | Model identifier (e.g., `"kimi-for-coding"`, `"zai-org/GLM-5-TEE"`, `"grok-3"`, `"gpt-5.3-codex"`). This is what `/model` sets.               |
| `modelParams`       | object | yes      | Parameters passed directly to the provider API. Usually `{}`. This is what `/set modelparam` populates.                                       |
| `ephemeralSettings` | object | yes      | Session settings. This is what `/set` populates. See [Ephemeral Settings Reference](./ephemerals.md) for every key.                           |
| `auth`              | object | no       | OAuth bucket configuration. See [Auth Configuration](#auth-configuration) below.                                                              |
| `loadBalancer`      | object | no       | Inline load balancer configuration for a standard profile. See [Load Balancer Configuration](#load-balancer-configuration).                   |

### Provider and Model

These are set by the `/provider` and `/model` commands. The provider name must match a registered provider alias. The model name is passed to the provider's API — it must be a model that provider supports.

```json
{
  "provider": "xAI",
  "model": "grok-3"
}
```

When a profile is loaded, the provider alias's defaults (base URL, default ephemeral settings, model-specific defaults) are applied first, then the profile's values layer on top.

### Model Parameters

The `modelParams` object is passed directly to the provider API as-is. LLxprt doesn't validate these — if you set an unsupported parameter, you'll get an API error.

```json
{
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 8192,
    "top_p": 0.9
  }
}
```

Set these with `/set modelparam <name> <value>` during a session. Common parameters:

| Parameter           | Description                                             |
| ------------------- | ------------------------------------------------------- |
| `temperature`       | Sampling temperature (0.0–2.0).                         |
| `max_tokens`        | Max tokens to generate per response (OpenAI/Anthropic). |
| `max_output_tokens` | Max output tokens (Gemini).                             |
| `top_p`             | Nucleus sampling threshold.                             |
| `top_k`             | Top-k sampling.                                         |
| `frequency_penalty` | Penalize repeated tokens.                               |
| `presence_penalty`  | Penalize tokens that appeared at all.                   |
| `seed`              | Random seed for deterministic output (OpenAI only).     |

Parameter names are provider-specific. Check your provider's API documentation.

### Ephemeral Settings

The `ephemeralSettings` object contains everything set via `/set` during the session, plus values set by dedicated commands like `/baseurl` and `/toolformat`.

```json
{
  "ephemeralSettings": {
    "auth-key-name": "chutes-prod",
    "base-url": "https://llm.chutes.ai/v1",
    "reasoning.enabled": true,
    "reasoning.effort": "medium",
    "reasoning.includeInResponse": true,
    "reasoning.includeInContext": true,
    "reasoning.stripFromContext": "none",
    "context-limit": 200000,
    "tools.disabled": ["google_web_fetch"]
  }
}
```

**Use `auth-key-name` for authentication.** This stores the name of a key saved in your OS keyring via `/key save <name>`. The actual key never appears in the profile file. Keyfiles (`auth-keyfile`) and raw keys (`auth-key`) also work but are deprecated — they put secrets on disk or directly in the profile JSON.

Settings stored here include:

- **Authentication** — `auth-key-name` (preferred), `auth-key` (deprecated), `auth-keyfile` (deprecated), `base-url`. Set by `/key`, `/keyfile`, `/baseurl` commands, not `/set` directly.
- **Tool format** — `toolFormat`, `toolFormatOverride`. Set by `/toolformat`.
- **Everything else** — reasoning, context limits, compression, timeouts, tool output limits, etc. Set by `/set`. See [Ephemeral Settings Reference](./ephemerals.md) for the complete list.

When a profile loads, the ephemeral settings are applied to the session. They override provider alias defaults but are overridden by CLI flags (`--set`, `--key-name`, etc.).

## Auth Configuration

The optional `auth` block configures OAuth bucket authentication. This is set up via `/auth` commands — you don't typically hand-edit this.

```json
{
  "auth": {
    "type": "oauth",
    "buckets": ["default", "claudius", "vybestack"]
  }
}
```

| Field          | Type                    | Description                                                                                                                                                              |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.type`    | `"oauth"` or `"apikey"` | Authentication method. `"oauth"` uses OAuth tokens from the keyring. `"apikey"` uses an API key.                                                                         |
| `auth.buckets` | string[]                | OAuth bucket names, tried in order. Each bucket is a separate OAuth credential stored in the keyring. Failover happens automatically when a bucket's quota is exhausted. |

When `type` is `"oauth"`, LLxprt tries each bucket in order until one succeeds. This is useful for providers like Anthropic where you might have multiple accounts or token pools.

When `type` is `"apikey"`, the key comes from `auth-key-name` (preferred — looks up a named key in the OS keyring), or the deprecated `auth-key`/`auth-keyfile` settings.

If `auth` is omitted entirely, the profile uses whatever authentication is available (named keyring key, environment variables, or OAuth).

## Load Balancer Profile

A load balancer profile distributes requests across multiple named profiles.

```json
{
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["chutes-primary", "xai-backup", "synthetic-fallback"],
  "provider": "",
  "model": "",
  "modelParams": {},
  "ephemeralSettings": {}
}
```

| Field                                                   | Type                           | Description                                                                                 |
| ------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `type`                                                  | `"loadbalancer"`               | Required — identifies this as a load balancer profile.                                      |
| `policy`                                                | `"roundrobin"` or `"failover"` | `roundrobin` distributes evenly. `failover` tries each in order until one succeeds.         |
| `profiles`                                              | string[]                       | List of profile names to balance across. Each must be a saved standard profile.             |
| `provider`, `model`, `modelParams`, `ephemeralSettings` | —                              | Required but empty for load balancer profiles. The individual member profiles supply these. |

## Inline Load Balancer

A standard profile can include an inline `loadBalancer` block to balance across sub-profiles without creating separate profile files:

```json
{
  "version": 1,
  "provider": "chutes-ai",
  "model": "zai-org/GLM-5-TEE",
  "modelParams": {},
  "ephemeralSettings": {},
  "loadBalancer": {
    "strategy": "round-robin",
    "subProfiles": [
      {
        "name": "primary",
        "provider": "chutes-ai",
        "model": "zai-org/GLM-5-TEE",
        "baseURL": "https://llm.chutes.ai/v1"
      },
      {
        "name": "backup",
        "provider": "chutes-ai",
        "model": "zai-org/GLM-5-TEE",
        "baseURL": "https://backup.chutes.ai/v1"
      }
    ]
  }
}
```

| Field                                 | Type            | Description                                  |
| ------------------------------------- | --------------- | -------------------------------------------- |
| `loadBalancer.strategy`               | `"round-robin"` | Balancing strategy.                          |
| `loadBalancer.subProfiles`            | array           | Inline endpoint configurations.              |
| `loadBalancer.subProfiles[].name`     | string          | Human-readable name for this endpoint.       |
| `loadBalancer.subProfiles[].provider` | string          | Provider name.                               |
| `loadBalancer.subProfiles[].model`    | string          | Model name (optional, inherits from parent). |
| `loadBalancer.subProfiles[].baseURL`  | string          | Endpoint URL (optional).                     |
| `loadBalancer.subProfiles[].apiKey`   | string          | API key for this endpoint (optional).        |

## Precedence

When a profile loads, values are resolved in this order (last wins):

1. **Provider alias defaults** — base URL, default model, default ephemeral settings, model-specific defaults
2. **Profile file** — `provider`, `model`, `modelParams`, `ephemeralSettings`, `auth`
3. **CLI flags** — `--set`, `--key-name`, `--keyfile`, `--model`, `--provider`, `--baseurl`

This means CLI flags always win, so you can do one-off overrides without modifying the saved profile:

```bash
llxprt --profile-load kimi-k2 --key-name synthetic-alt --set context-limit=100000
```

## File Location

Profiles are stored in `~/.llxprt/profiles/`. The filename (minus `.json`) is the profile name:

```
~/.llxprt/profiles/
├── kimi-k2.json
├── opus-thinking.json
├── codex-high.json
└── my-lb-setup.json
```

The default profile (set via `/profile set-default <name>`) is recorded in `~/.llxprt/settings.json` and loads automatically on startup.
