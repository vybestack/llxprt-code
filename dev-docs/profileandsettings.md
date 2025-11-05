# Profile and Settings Management

This document explains how LLxprt manages profiles, settings, CLI arguments, slash commands, and OAuth authentication.

## Core Concepts

### Ephemeral Settings

Ephemeral settings are runtime configuration values that can be changed during a session. These include:

- `context-limit` - Maximum context window size
- `base-url` - Custom API endpoint URL
- `auth-keyfile` - Path to authentication key file
- `streaming` - Streaming mode (enabled/disabled)
- `shell-replacement` - Shell replacement feature
- And other runtime settings set via `/set` or `/context-limit`

**Critical behavior**: Ephemeral settings can "leak" between configurations if not explicitly cleared. To prevent confusion and bugs, they MUST be cleared when switching providers or profiles.

### Profiles

Profiles are JSON files stored in `~/.llxprt/profiles/` that contain:

- `version` - Profile format version
- `provider` - Provider name (e.g., "openai", "anthropic", "gemini")
- `model` - Model identifier
- `modelParams` - Model-specific parameters (e.g., temperature)
- `ephemeralSettings` - All runtime configuration settings

Example profile (`~/.llxprt/profiles/synthetic.json`):

```json
{
  "version": 1,
  "provider": "openai",
  "model": "hf:zai-org/GLM-4.6",
  "modelParams": {
    "temperature": 1
  },
  "ephemeralSettings": {
    "context-limit": 190000,
    "base-url": "https://api.synthetic.new/openai/v1",
    "shell-replacement": true,
    "streaming": "disabled",
    "auth-keyfile": "/Users/acoliver/.synthetic_key"
  }
}
```

## Startup Behavior

### CLI Argument Processing Order

1. **Profile Loading** (`--profile-load <name>`):
   - Loads ALL settings from the specified profile
   - Sets provider, model, modelParams, and all ephemeral settings
   - Acts as the base configuration

2. **CLI Argument Overrides**:
   - Process in order: `--provider`, `--model`, `--key`, `--keyfile`, `--set`
   - These arguments OVERRIDE any profile settings
   - Example: `--profile-load synthetic --model different-model` uses "different-model" instead of profile's model

### Examples

```bash
# Load synthetic profile as-is
llxprt --profile-load synthetic

# Load synthetic profile but override the model
llxprt --profile-load synthetic --model gpt-4

# Load synthetic profile but use different auth
llxprt --profile-load synthetic --key abc123

# Start with provider and explicit settings (no profile)
llxprt --provider openai --model gpt-4 --key abc123
```

## Runtime Commands (Slash Commands)

### Commands That Clear ALL Ephemerals

These commands perform a "clean switch" - they wipe ALL ephemeral settings to prevent leakage:

#### `/provider <name>`

Switches to a different provider and clears all ephemerals.

**Before**:

```
Provider: openai
Model: hf:zai-org/GLM-4.6
Ephemeral Settings:
  - context-limit: 190000
  - base-url: https://api.synthetic.new/openai/v1
  - auth-keyfile: /Users/acoliver/.synthetic_key
```

**After `/provider gemini`**:

```
Provider: gemini
Model: <gemini default>
Ephemeral Settings: <all cleared>
```

#### `/profile load <name>`

Loads a profile and clears all ephemerals before applying the profile's settings.

**Before**:

```
Provider: gemini
Model: gemini-pro
Ephemeral Settings: <any custom settings>
```

**After `/profile load synthetic`**:

```
Provider: openai
Model: hf:zai-org/GLM-4.6
Ephemeral Settings:
  - context-limit: 190000
  - base-url: https://api.synthetic.new/openai/v1
  - shell-replacement: true
  - streaming: disabled
  - auth-keyfile: /Users/acoliver/.synthetic_key
```

### Commands That Preserve Ephemerals

These commands modify specific settings WITHOUT clearing other ephemerals:

- `/key <api-key>` - Sets authentication key, keeps other settings
- `/keyfile <path>` - Sets authentication keyfile, keeps other settings
- `/set <key> <value>` - Sets a specific ephemeral setting, keeps others
- `/context-limit <number>` - Sets context limit, keeps other settings
- `/tools <enabled|disabled>` - Sets tools setting, keeps other settings
- `/model <name>` - Changes model, keeps other settings

**Example**:

```
Initial state after profile load:
  Provider: openai
  Model: gpt-4
  context-limit: 190000
  base-url: https://api.synthetic.new/openai/v1

After `/context-limit 100000`:
  Provider: openai
  Model: gpt-4
  context-limit: 100000           ← Changed
  base-url: https://api.synthetic.new/openai/v1  ← Preserved
```

## OAuth Authentication

OAuth is **lazy-loaded** - it only triggers when actually needed, not at startup.

### OAuth Trigger Conditions

OAuth will ONLY trigger when **ALL** of these conditions are met:

1. **OAuth is enabled** for the current provider
2. **No other authentication is available** (no key, no keyfile) OR `authOnly` is set
3. **User sends a prompt** (not at startup or configuration time)

### OAuth Decision Flow

```
User sends a prompt
  ↓
Is OAuth enabled for this provider?
  ↓ Yes
Is there a key or keyfile configured?
  ↓ No (or authOnly=true)
Trigger OAuth flow
```

### Examples

**Scenario 1: Profile with keyfile**

```bash
llxprt --profile-load synthetic
# OAuth: NOT triggered (auth-keyfile is set in profile)
```

**Scenario 2: Provider switch without auth**

```bash
llxprt --profile-load synthetic  # Has auth-keyfile
/provider gemini                  # Clears all ephemerals including auth-keyfile
# OAuth: NOT triggered yet (no prompt sent)
<user sends prompt>
# OAuth: Triggered now (if enabled for Gemini and no GEMINI_API_KEY env var)
```

**Scenario 3: Explicit key provided**

```bash
llxprt --provider anthropic --key sk-ant-123456
# OAuth: NOT triggered (explicit key provided)
```

**Scenario 4: Environment variable available**

```bash
export GEMINI_API_KEY=my-key
llxprt --provider gemini
# OAuth: NOT triggered (environment variable provides auth)
```

## Common Pitfall: Ephemeral Leakage

**Problem**: Settings from one provider/profile "leak" into another.

**Example of bug**:

```bash
llxprt --profile-load synthetic
# Now: base-url=https://api.synthetic.new/openai/v1

/provider gemini
# Bug: Still has base-url=https://api.synthetic.new/openai/v1
# Gemini requests go to Synthetic's endpoint! 💥
```

**Solution**: `/provider` and `/profile load` MUST clear all ephemerals before applying new configuration.

## Implementation Checklist

When implementing profile/settings management:

- [ ] `--profile-load` loads ALL settings from profile
- [ ] CLI args (`--provider`, `--model`, `--key`, `--keyfile`, `--set`) override profile settings
- [ ] `/provider` clears ALL ephemerals before switching
- [ ] `/profile load` clears ALL ephemerals before loading profile
- [ ] `/key` and `/keyfile` preserve other ephemerals
- [ ] `/set`, `/context-limit`, `/tools`, etc. preserve other ephemerals
- [ ] OAuth is lazy (only triggers on prompt, not at startup)
- [ ] OAuth checks for keyfile/key before triggering
- [ ] OAuth respects `authOnly` flag

## Testing Scenarios

### Test 1: Profile Load at Startup

```bash
llxprt --profile-load synthetic
# Verify: All synthetic.json settings applied
# Verify: OAuth NOT triggered
```

### Test 2: CLI Override

```bash
llxprt --profile-load synthetic --key override-key
# Verify: synthetic profile settings loaded
# Verify: Key is "override-key" not profile's keyfile
```

### Test 3: Provider Switch Clears Ephemerals

```bash
llxprt --profile-load synthetic
/provider gemini
# Verify: No base-url set (cleared from synthetic)
# Verify: No auth-keyfile set (cleared)
# Verify: context-limit reset to default
```

### Test 4: Profile Load Clears Ephemerals

```bash
llxprt --provider gemini --set custom-setting value
/profile load synthetic
# Verify: custom-setting is gone
# Verify: All synthetic.json settings applied
```

### Test 5: Key Command Preserves Ephemerals

```bash
llxprt --profile-load synthetic
/key new-key-value
# Verify: base-url still set (preserved)
# Verify: context-limit still set (preserved)
# Verify: auth-keyfile replaced by key
```

### Test 6: OAuth Lazy Loading

```bash
llxprt --provider anthropic
# Verify: OAuth NOT triggered (no prompt yet)
<user sends prompt>
# Verify: OAuth triggers now (if no key/keyfile)
```

### Test 7: OAuth Not Triggered with Auth

```bash
llxprt --profile-load zai
<user sends prompt>
# Verify: OAuth NOT triggered (profile has auth-keyfile)
```

## Summary

**Clean Switch Commands** (clear all ephemerals):

- `/provider <name>`
- `/profile load <name>`

**Surgical Commands** (preserve ephemerals):

- `/key <value>`
- `/keyfile <path>`
- `/set <key> <value>`
- `/context-limit <number>`
- `/tools <value>`
- `/model <name>`

**OAuth Rules**:

- Lazy (only on prompt)
- Requires: enabled + no auth + prompt sent
- Never triggers at startup or during configuration

**Golden Rule**: Settings should never leak between providers/profiles. Clean switches must wipe the slate clean.

## Provider Authentication Implementation Guide

### Rules for Provider Developers

When implementing or modifying a provider, follow these rules:

#### 1. NEVER read `process.env` directly for API keys

Use `authResolver.resolveAuthentication()` instead.

**Bad**:

```typescript
if (process.env.GEMINI_API_KEY) {
  return process.env.GEMINI_API_KEY;
}
```

**Good**:

```typescript
const auth = await this.authResolver.resolveAuthentication({
  settingsService: this.resolveSettingsService(),
  includeOAuth: false,
});
return auth;
```

#### 2. NEVER cache authentication state

Query fresh state each time.

**Bad**:

```typescript
class Provider {
  private cachedKey: string;
  constructor() {
    this.cachedKey = process.env.API_KEY;
  }
}
```

**Good**:

```typescript
class Provider {
  async getAuthToken() {
    return await this.authResolver.resolveAuthentication();
  }
}
```

#### 3. Use `includeOAuth: false` for checks

Checking if auth exists should never trigger OAuth.

**For checks** (no side effects):

```typescript
async isAuthenticated(): Promise<boolean> {
  const auth = await this.authResolver.resolveAuthentication({
    includeOAuth: false,  // Just checking
  });
  return !!auth;
}
```

**For API calls** (can trigger OAuth):

```typescript
async makeApiCall() {
  const auth = await this.authResolver.resolveAuthentication({
    includeOAuth: true,  // Trigger OAuth if needed
  });
  // Use auth for request
}
```

#### 4. Provider-specific auth is a fallback

Check standard auth first, then provider-specific.

**Example**:

```typescript
async determineBestAuth() {
  // 1. Check standard auth FIRST
  const standardAuth = await this.authResolver.resolveAuthentication({
    settingsService: this.resolveSettingsService(),
    includeOAuth: false,
  });

  if (standardAuth) {
    return { authMode: 'api-key', token: standardAuth };
  }

  // 2. Check provider-specific auth (ADC, Vertex AI, etc.)
  if (this.hasSpecialAuth()) {
    return { authMode: 'special', token: await this.getSpecialToken() };
  }

  // 3. No auth available
  throw new Error('No authentication configured');
}
```

#### 5. OAuth is the user's last resort

- Never trigger automatically during config
- Only trigger on actual API call
- Respect `authOnly` setting

### Authentication Precedence

All providers follow this precedence (enforced by AuthResolver):

1. SettingsService auth-key (from --key, /key, profiles)
2. SettingsService auth-keyfile (from --keyfile, /keyfile, profiles)
3. Constructor apiKey (programmatic usage)
4. Environment variables (OPENAI_API_KEY, etc.)
5. OAuth (only if includeOAuth: true)

When `authOnly` is set: Skip 1-4, go directly to OAuth.

### Environment Variables

Environment variables are supported and encouraged for:

- Development/testing convenience
- CI/CD pipelines
- System-wide defaults

Each provider specifies which env vars to check:

```typescript
constructor(config: ProviderConfig) {
  super({
    ...config,
    envKeyNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  });
}
```

AuthResolver automatically checks these during step 4 of precedence.

**Key principle**: User-provided auth (CLI args, profiles, runtime commands) always overrides environment variables.
