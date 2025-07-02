# Claude 4 Model Selection Guide

## Overview

The Anthropic provider now supports Claude 4 models with automatic latest version selection. This ensures your application always uses the most recent Claude 4 model without breaking when new versions are released.

## Model Naming Convention

Anthropic uses a structured naming convention for Claude models:

### Specific Version Names

- Format: `claude-{tier}-{version}-{snapshot_date}`
- Example: `claude-sonnet-4-20250514`
- These models are stable and do not change

### Latest Aliases

- Format: `claude-{tier}-{version}-latest`
- Example: `claude-sonnet-4-latest`
- Automatically points to the most recent snapshot
- Updated within a week of new releases

## Available Claude 4 Models

### Latest Aliases (Recommended for Development)

- `claude-opus-4-latest` - Claude Opus 4 (Latest)
  - Context Window: 500,000 tokens
  - Max Output: 32,000 tokens
- `claude-sonnet-4-latest` - Claude Sonnet 4 (Latest) **[Default]**
  - Context Window: 400,000 tokens
  - Max Output: 64,000 tokens

### Specific Versions (Recommended for Production)

- `claude-opus-4-20250514` - Claude Opus 4 (2025-05-14)
- `claude-sonnet-4-20250301` - Claude Sonnet 4 (2025-03-01)

## Usage Examples

### Using the Default (Latest Sonnet 4)

```typescript
const provider = new AnthropicProvider(apiKey);
// Uses claude-sonnet-4-latest by default
```

### Selecting a Specific Model

```typescript
const provider = new AnthropicProvider(apiKey);
provider.setModel('claude-opus-4-latest'); // Use latest Opus 4
```

### Using the Helper Method

```typescript
const provider = new AnthropicProvider(apiKey);
const latestSonnet = provider.getLatestClaude4Model('sonnet');
provider.setModel(latestSonnet);
```

### Listing Available Models

```typescript
const models = await provider.getModels();
// Returns both latest aliases and specific versions
```

## Best Practices

1. **Development**: Use latest aliases (e.g., `claude-sonnet-4-latest`) for flexibility
2. **Production**: Use specific versions (e.g., `claude-sonnet-4-20250301`) for stability
3. **Testing**: Test with both latest aliases and specific versions
4. **Migration**: When updating to newer snapshots, test thoroughly before switching

## Implementation Details

The provider automatically:

- Adds latest aliases to the model list
- Handles context window and token limits for each model
- Falls back to a default list if the API is unavailable
- Supports dynamic model selection without hardcoding dates

## Future Compatibility

The implementation is designed to handle future Claude 4 models:

- New snapshots will automatically work with the latest aliases
- Model patterns recognize any `claude-*-4-*` format
- Context windows and token limits are dynamically determined
