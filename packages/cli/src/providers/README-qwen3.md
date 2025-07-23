# Qwen3-Fireworks Provider Implementation

## Overview

The Qwen3-Fireworks provider enables the Gemini CLI to use the Qwen3-235B model through Fireworks AI's OpenAI-compatible API. This implementation addresses the specific needs of Qwen3, including handling its unique control tokens and ensuring smooth operation with tool calls.

## Key Features

1. **Automatic Token Cleaning**: Removes Qwen3-specific control tokens (`<|im_start|>`, `<|im_end|>`, `<|reserved_special_token_*|>`) from both input and output
2. **Model Lock**: Ensures the correct Qwen3 model is always used
3. **OpenAI Compatibility**: Leverages the existing OpenAI provider infrastructure
4. **Multiple API Key Sources**: Supports environment variables, saved keys, and fallback to OpenAI keys

## Implementation Details

### Provider Class: `Qwen3FireworksProvider`

Located at: `packages/core/src/providers/openai/Qwen3FireworksProvider.ts`

Key methods:

- `cleanQwen3Content()`: Removes control tokens and normalizes whitespace
- `generateChatCompletion()`: Wraps the parent method to clean content
- `getModels()`: Returns the Qwen3-235B model configuration
- `setModel()`: Ensures only Qwen3 models can be set

### Registration

The provider is registered in `providerManagerInstance.ts` with the following priority for API keys:

1. Saved key for 'qwen3-fireworks'
2. `FIREWORKS_API_KEY` environment variable
3. OpenAI API key (as fallback)

## Usage

```bash
# Set API key
export FIREWORKS_API_KEY=your-api-key

# Or use in the CLI
/provider qwen3-fireworks
/key your-api-key
```

## Testing

Tests are included in `Qwen3FireworksProvider.test.ts` covering:

- Provider initialization
- Model listing
- Token cleaning functionality
- Model setting behavior

## Benefits

1. **Seamless Integration**: Works with existing tool calling infrastructure
2. **Clean Output**: No Qwen3 control tokens leak into user-visible content
3. **Reliable Tool Calling**: Handles the model's tendency to exit after tool calls
4. **Cost Effective**: Uses Fireworks AI's competitive pricing for the powerful 235B model
