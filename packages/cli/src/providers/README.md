# Multi-Provider Support

This directory contains the implementation of multi-provider support for the Gemini CLI, allowing users to switch between different AI providers (Gemini, OpenAI, Anthropic, etc.) seamlessly.

## Architecture

### Overview

The multi-provider architecture uses a wrapper pattern to adapt different provider APIs to a common interface that's compatible with Gemini's streaming format:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   CLI/UI Layer  │────▶│ ProviderManager  │────▶│ IProvider Interface │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                                                            │
                        ┌───────────────────────────────────┼─────────────────┐
                        │                                   │                 │
                 ┌──────▼────────┐              ┌──────────▼──────┐   ┌──────▼──────┐
                 │ GeminiProvider │              │ OpenAIProvider  │   │ Anthropic   │
                 └───────────────┘              └─────────────────┘   │ (planned)   │
                                                          │            └─────────────┘
                                                          │
                                               ┌──────────▼──────────────┐
                                               │ GeminiCompatibleWrapper │
                                               └─────────────────────────┘
```

### Key Components

1. **IProvider Interface** (`IProvider.ts`): Common interface that all providers must implement
2. **ProviderManager** (`ProviderManager.ts`): Singleton that manages provider registration and switching
3. **GeminiCompatibleWrapper** (`core/src/providers/adapters/GeminiCompatibleWrapper.ts`): Adapts provider-specific formats to Gemini's expected format
4. **Provider Implementations**:
   - `GeminiProvider`: Native Gemini implementation
   - `OpenAIProvider`: OpenAI API integration
   - Additional providers can be added following the same pattern

## Setup and Configuration

### OpenAI Provider

1. **API Key Setup**:

   ```bash
   # Option 1: Create a key file
   echo "your-openai-api-key" > ~/.openai_key

   # Option 2: Use environment variable
   export OPENAI_API_KEY="your-openai-api-key"

   # Option 3: Use /key command (coming in phase 08)
   /key your-openai-api-key
   ```

2. **Custom Base URL** (for OpenAI-compatible endpoints):
   ```bash
   # Coming in phase 08
   /baseurl https://your-custom-endpoint.com/v1
   ```

### Anthropic Provider (Planned)

Similar setup will be available for Anthropic once implemented.

## Commands

### Provider Management

- `/provider` - List available providers and show the active one
- `/provider <name>` - Switch to a different provider (e.g., `/provider openai`)
- `/provider gemini` - Switch back to the default Gemini provider

### Model Management

- `/model` - List available models for the current provider
- `/model <name>` - Switch to a different model within the current provider

### Configuration (Coming in Phase 08)

- `/key <api_key>` - Set the API key for the active provider
- `/keyfile <path>` - Load API key from a file
- `/baseurl <url>` - Set a custom base URL for OpenAI-compatible endpoints

## Implementation Status

### ✅ Completed

1. Core provider architecture and interfaces
2. ProviderManager implementation with singleton pattern
3. OpenAI provider with model listing and chat completion
4. GeminiCompatibleWrapper for adapting streaming formats
5. Integration with `/provider` and `/model` commands
6. Tool call support across providers

### 🚧 In Progress

- Phase 08: API key and base URL configuration commands
- Phase 09-13: Tool formatter implementation
- Phase 14-21: Anthropic provider support

### Current Limitations

- Chat completion is fully integrated and working with all providers
- Tool calls work but require proper formatting for each provider
- Some advanced features may be provider-specific

## Troubleshooting

### Common Issues

1. **"No active provider set" error**:

   - This can occur after using a non-Gemini provider
   - Solution: Run `/provider gemini` to switch back to default

2. **OpenAI 400 error "Missing parameter 'tool_call_id'"**:

   - This happens when tool responses don't include the required ID
   - The system now automatically handles this conversion

3. **Model not found**:

   - Different providers have different model names
   - Use `/model` without arguments to see available models
   - Example: OpenAI uses `gpt-4` while Gemini uses `gemini-pro`

4. **Authentication errors**:

   - Ensure your API key is correctly set up
   - Check file permissions on `~/.openai_key` (should be readable)
   - Verify the API key is valid and has appropriate permissions

5. **Regex errors with search tools**:
   - Some models (like o3) may not escape special regex characters
   - The search tools expect regex patterns, not literal strings
   - Special characters like `(`, `)`, `[`, `]` must be escaped with `\`

### Debug Mode

Enable debug logging to troubleshoot provider issues:

```bash
# Start CLI with debug flag
gemini-cli --debug

# Or set environment variable
export DEBUG=1
gemini-cli
```

## Development Guide

### Adding a New Provider

1. Create a new provider class implementing `IProvider`:

   ```typescript
   export class MyProvider implements IProvider {
     name = 'myprovider';

     async getModels(): Promise<IModel[]> {
       // Implement model listing
     }

     async *generateChatCompletion(
       messages: IMessage[],
       tools?: ITool[],
     ): AsyncIterableIterator<IMessage> {
       // Implement streaming chat completion
     }

     setModel(modelId: string): void {
       // Implement model switching
     }

     getCurrentModel(): string {
       // Return current model
     }
   }
   ```

2. Register the provider in `enhanceConfigWithProviders.ts`
3. Add any necessary authentication setup
4. Test with existing commands

### Testing

Run provider-specific tests:

```bash
# Unit tests
npm test -- --grep "Provider"

# Integration tests
npm run test:integration -- --grep "provider"

# Test specific provider
npm test -- OpenAIProvider
```

## Future Enhancements

1. **Persistent Configuration**: Save provider preferences and API keys securely
2. **Provider-Specific Features**: Expose unique capabilities of each provider
3. **Unified Tool Format**: Automatic conversion between tool formats
4. **Performance Monitoring**: Track token usage and costs per provider
5. **Fallback Providers**: Automatic failover when a provider is unavailable
