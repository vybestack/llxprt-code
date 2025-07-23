# Qwen3-Fireworks Provider

This provider enables support for the Qwen3-235B model through Fireworks AI's OpenAI-compatible API.

## Setup

1. Get a Fireworks AI API key from https://app.fireworks.ai/

2. Set your API key using one of these methods:

   ```bash
   # Environment variable
   export FIREWORKS_API_KEY=your-api-key

   # Or use the CLI
   gemini-cli
   /provider qwen3-fireworks
   /key your-api-key
   ```

3. Switch to the Qwen3-Fireworks provider:
   ```
   /provider qwen3-fireworks
   ```

## Features

- **Model**: Qwen3-235B - A powerful 235 billion parameter model
- **Context Window**: 16,384 tokens
- **Tool Support**: Full OpenAI-compatible function calling
- **Special Token Cleaning**: Automatically removes Qwen3-specific control tokens from responses

## Implementation Details

The provider extends the OpenAI provider with:

- Automatic cleaning of Qwen3 control tokens (`<|im_start|>`, `<|im_end|>`, etc.)
- Removal of special function tokens (`<|reserved_special_token_*|>`)
- Proper handling of multiple newlines in responses

## Pricing

Check Fireworks AI's pricing page for current rates: https://fireworks.ai/pricing

## Troubleshooting

If you see Qwen3 control tokens in responses, ensure you're using the latest version of the provider.
