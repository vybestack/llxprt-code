# Model Parameters and Profiles - Product Requirements Document

## Executive Summary

Enable users to configure and save model parameters (temperature, max_tokens, etc.) and client settings (context limits, auth) as reusable profiles. This eliminates the need to repeatedly specify parameters for different model configurations.

**Scope for v1**: OpenAI Provider chat completions API only. Other providers and Responses API will be no-op.

## Goals

1. **Reduce friction** for users switching between models/providers
2. **Enable model tuning** by exposing API parameters
3. **Support diverse use cases** (local models, alternative providers, different configs)
4. **Maintain clean architecture** without provider-specific hacks

## Requirements

### Functional Requirements

#### FR1: Model Parameter Commands

- `/set modelparam <key> <value>` - Set any model parameter
- Parameters stored in provider state
- Passed to OpenAI chat completions API
- No validation in v1 (pass through to API)

#### FR2: Ephemeral Settings Commands

- `/set <key> <value>` - Set client-side settings
- `context-limit` - Max tokens before compression
- `compression-threshold` - When to compress (0-1)
- Existing commands (`/key`, `/baseurl`, etc.) continue to work

#### FR3: Profile Management

- `/save "<name>"` - Save current state as profile
- `/load "<name>"` - Load saved profile
- Profiles stored in `~/.llxprt/profiles/<name>.json`
- Profiles include: provider, model, modelParams, ephemeralSettings

#### FR4: CLI Integration

- `--load "<name>"` - Load profile in non-interactive mode
- Model params NOT exposed as individual CLI flags in v1
- Standard overrides still work: `--model`, `--provider`, etc.

### Non-Functional Requirements

#### NFR1: Clean Architecture

- Extend `IProvider` interface, no workarounds
- Model params as optional provider capability
- No breaking changes to existing functionality

#### NFR2: Provider Support

- v1: OpenAI provider chat completions only
- Other providers: commands accepted but no-op
- Responses API: no-op in v1
- Clear path for future provider support

#### NFR3: Security

- API keys in plaintext for v1 (documented limitation)
- Recommend keyfile usage
- Environment variables still work

## Technical Design

### IProvider Interface Extension

```typescript
interface IProvider {
  // Existing methods...

  // New optional methods
  setModelParams?(params: Record<string, any>): void;
  getModelParams?(): Record<string, any> | undefined;
}
```

### OpenAI Provider Implementation

```typescript
class OpenAIProvider implements IProvider {
  private modelParams?: Record<string, any>;

  setModelParams(params: Record<string, any>): void {
    this.modelParams = { ...this.modelParams, ...params };
  }

  getModelParams(): Record<string, any> | undefined {
    return this.modelParams;
  }

  async *generateChatCompletion(...) {
    const stream = await this.openai.chat.completions.create({
      model: this.currentModel,
      messages: messages,
      stream: true,
      stream_options: { include_usage: true },
      tools: formattedTools,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      ...this.modelParams  // Spread model params into API call
    });
  }
}
```

### Profile Schema

```json
{
  "version": 1,
  "provider": "openai",
  "model": "gpt-4",
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 4096,
    "top_p": 0.95,
    "presence_penalty": 0,
    "frequency_penalty": 0,
    "seed": 12345
  },
  "ephemeralSettings": {
    "base-url": "http://localhost:1234/v1",
    "auth-keyfile": "~/.keys/localai",
    "context-limit": 32000,
    "compression-threshold": 0.8,
    "tool-format": "hermes"
  }
}
```

### Command Flow

1. User: `/set modelparam temperature 0.5`
2. CLI: Check if provider supports `setModelParams`
3. If yes: Call `provider.setModelParams({ temperature: 0.5 })`
4. If no: Show warning "Model parameters not supported by current provider"
5. On next API call: Provider includes params in request

## Success Metrics

1. **Adoption**: 20% of users create at least one profile
2. **Retention**: 50% of profile creators use profiles weekly
3. **Support**: Reduction in "how do I set max_tokens" questions
4. **Performance**: No measurable latency increase

## Risks and Mitigations

| Risk                               | Impact | Mitigation                                               |
| ---------------------------------- | ------ | -------------------------------------------------------- |
| Invalid parameters crash API calls | High   | v1: Let API handle validation. v2: Add client validation |
| Profile format changes             | Medium | Version field in profiles, migration logic               |
| Security concerns with API keys    | High   | Document plaintext storage, promote keyfiles             |
| User confusion with many params    | Medium | Documentation, examples, future: presets                 |

## Future Considerations

1. **Provider Extension**: Add support for Anthropic, Google, etc.
2. **Responses API**: Thread params through Responses endpoint
3. **Validation**: Client-side parameter validation
4. **Presets**: Built-in profiles for common scenarios
5. **Encryption**: Secure storage for sensitive data
6. **Import/Export**: Share profiles between users
7. **Auto-detection**: Detect optimal params for models

## Implementation Plan

### Phase 1: Core Implementation (v1)

1. Extend IProvider interface
2. Implement in OpenAIProvider (chat completions only)
3. Add `/set modelparam` command
4. Add `/set` for ephemeral settings
5. Implement `/save` and `/load`
6. Add CLI `--load` support
7. Documentation and examples

### Phase 2: Expansion (Future)

1. Other providers
2. Responses API support
3. Parameter validation
4. Enhanced security
5. Additional features per roadmap

## Definition of Done

- [ ] Model params passed to OpenAI chat completions API
- [ ] Profiles save/load working
- [ ] CLI --load flag functional
- [ ] No regression in existing features
- [ ] Documentation updated
- [ ] Tests for new functionality
- [ ] Other providers show appropriate no-op message
