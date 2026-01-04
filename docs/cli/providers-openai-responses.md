# OpenAI Responses API

The OpenAI Responses API is a new endpoint that provides enhanced capabilities for certain models. This document describes how the LLxprt Code integrates with the Responses API, including automatic model detection, streaming support, and tool calling.

**Note:** The Responses API features are now accessible through the `/provider` command. Use `/provider openai-responses` to enable this mode in the CLI.

## Overview

The Responses API (`/v1/responses`) is automatically used for compatible models, providing:

- Enhanced streaming capabilities
- Improved tool calling format
- Future support for stateful conversations
- Better error handling and retry logic

## Supported Models

The following models automatically use the Responses API:

- `o3-pro` (REQUIRES Responses API - will not work with legacy endpoint)
- `o3`
- `o3-mini`
- `o1`
- `o1-mini`
- `gpt-5` (when available)
- `gpt-4.1`
- `gpt-4o`
- `gpt-4o-mini`
- `gpt-4o-realtime`
- `gpt-4-turbo`
- `gpt-4-turbo-preview`

All other models and custom models continue to use the legacy completions endpoint.

## Configuration

### Environment Variables

```bash
# Disable Responses API for all models (force legacy endpoint)
export OPENAI_RESPONSES_DISABLE=true

# Standard OpenAI configuration
export OPENAI_API_KEY=your-api-key
export OPENAI_BASE_URL=https://api.openai.com/v1  # Optional custom endpoint
```

### Automatic Endpoint Selection

The provider automatically selects the appropriate endpoint based on the model:

```typescript
// Example: Automatic selection
const provider = new OpenAIProvider({ model: 'gpt-4.1' });
// Uses: https://api.openai.com/v1/responses

const provider = new OpenAIProvider({ model: 'o3' });
// Uses: https://api.openai.com/v1/responses

const provider = new OpenAIProvider({ model: 'custom-model' });
// Uses: https://api.openai.com/v1/chat/completions
```

## Request Format

The Responses API uses a different request format than the legacy completions endpoint:

### Basic Request

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ],
  "model": "gpt-4.1",
  "stream": true
}
```

### Request with Tools

```json
{
  "messages": [
    {
      "role": "user",
      "content": "What's the weather in San Francisco?"
    }
  ],
  "model": "o3",
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the current weather",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City name"
            }
          },
          "required": ["location"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

## Response Format

### Streaming Responses

The Responses API uses Server-Sent Events (SSE) for streaming:

```
data: {"type":"message_start","message":{"id":"msg_123","role":"assistant"}}

data: {"type":"content_delta","delta":{"text":"Hello"}}

data: {"type":"content_delta","delta":{"text":" there!"}}

data: {"type":"message_stop"}

data: [DONE]
```

### Tool Calls

Tool calls in the Responses API have a specific format:

```
data: {"type":"content_delta","delta":{"text":"I'll check the weather for you.\n\n"}}

data: {"type":"content_delta","delta":{"text":"<tool_call>"}}
data: {"type":"content_delta","delta":{"text":"\n{\"tool_name\": \"get_weather\", \"parameters\": {\"location\": \"San Francisco\"}}\n"}}
data: {"type":"content_delta","delta":{"text":"</tool_call>"}}
```

## Integration Examples

### Basic Usage

```typescript
import { OpenAIProvider } from '@vybestack/llxprt-code';

const provider = new OpenAIProvider({
  model: 'gpt-4.1',
  apiKey: process.env.OPENAI_API_KEY,
});

// Automatically uses Responses API
const response = await provider.generateChatCompletion({
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true,
});
```

### Tool Calling

```typescript
const response = await provider.generateChatCompletion({
  messages: [{ role: 'user', content: 'What is 2+2?' }],
  tools: [calculatorTool],
  tool_choice: 'auto',
  stream: true,
});

// Handle streaming response with tool calls
for await (const chunk of response) {
  if (chunk.type === 'content') {
    console.log(chunk.text);
  } else if (chunk.type === 'tool_calls') {
    for (const toolCall of chunk.tool_calls) {
      console.log(`Tool: ${toolCall.name}`);
      console.log(`Args: ${JSON.stringify(toolCall.arguments)}`);
    }
  }
}
```

### Forcing Legacy Endpoint

```typescript
// Option 1: Environment variable
process.env.OPENAI_RESPONSES_DISABLE = 'true';

// Option 2: Use a custom model (not in the Responses API list)
const provider = new OpenAIProvider({
  model: 'my-custom-model', // Automatically uses legacy endpoint
});
```

## Differences from Legacy API

### Request Differences

| Feature     | Legacy (`/v1/chat/completions`) | Responses (`/v1/responses`) |
| ----------- | ------------------------------- | --------------------------- |
| Endpoint    | `/v1/chat/completions`          | `/v1/responses`             |
| Streaming   | Line-based JSON                 | Server-Sent Events          |
| Tool Format | `functions` array               | `tools` array               |
| Tool Choice | `function_call`                 | `tool_choice`               |

### Response Differences

| Feature       | Legacy                    | Responses                            |
| ------------- | ------------------------- | ------------------------------------ |
| Stream Format | `data: {"choices":[...]}` | `data: {"type":"content_delta",...}` |
| Tool Calls    | In `function_call` field  | Embedded in content with markers     |
| Message IDs   | Not provided              | Included in `message_start`          |

## Error Handling

The Responses API provides enhanced error information:

```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "Invalid tool specification",
    "param": "tools[0].function.parameters",
    "code": "invalid_tool_parameters"
  }
}
```

## Testing

### Unit Tests

```bash
# Run all OpenAI provider tests
npm test OpenAIProvider

# Run specific Responses API tests
npm test OpenAIProvider.responsesIntegration
npm test OpenAIProvider.switch
npm test parseResponsesStream
```

### Integration Tests

```bash
# Test with real API (requires OPENAI_API_KEY)
npm run test:integration -- --grep "Responses API"
```

### Manual Testing

```bash
# Enable OpenAI Responses mode in the CLI
llxprt
> /provider openai-responses
> /model gpt-4.1
> Hello

# Test with gpt-4.1 (uses Responses API)
llxprt --provider openai --model gpt-4.1 "Hello"

# Test with o3 (uses Responses API)
llxprt --provider openai --model o3 "Hello"

# Test with gpt-5 (when available, will use Responses API)
llxprt --provider openai --model gpt-5 "Hello"

# Test with custom model (uses legacy endpoint)
llxprt --provider openai --model my-custom-model "Hello"

# Force legacy endpoint for gpt-4.1
OPENAI_RESPONSES_DISABLE=true llxprt --provider openai --model gpt-4.1 "Hello"
```

## Performance Considerations

The Responses API generally provides:

- Lower latency for first token
- More consistent streaming performance
- Better handling of long responses
- Improved reliability for tool calls

## Future Features

The following features are planned but not yet implemented:

### Stateful Conversations

```typescript
// Future API
const response = await provider.generateChatCompletion({
  messages: [...],
  conversationId: 'conv_123',
  parentId: 'msg_456',
  stateful: true
});
```

### Response Caching

- Automatic caching of responses
- Conversation history management
- Reduced API calls for repeated queries

## Troubleshooting

### Common Issues

1. **Responses API not being used**
   - Check if `OPENAI_RESPONSES_DISABLE` is set
   - Verify the model is in the supported list
   - Check debug logs: `DEBUG=llxprt:* llxprt --provider openai ...`

2. **Tool calls not working**
   - Ensure tools are properly formatted for Responses API
   - Check that `tool_choice` is used instead of `function_call`
   - Verify tool response format matches expected structure (see [Tool output format](../tool-output-format.md))

3. **Streaming issues**
   - Ensure SSE parsing is working correctly
   - Check for proxy/firewall interference with streaming
   - Verify `stream: true` is set in request

### Debug Mode

Enable detailed logging to troubleshoot issues:

```bash
# Show all provider operations
DEBUG=llxprt:provider:* llxprt --provider openai --model gpt-4.1 "Test"

# Show only Responses API operations
DEBUG=llxprt:provider:openai:responses llxprt --provider openai --model o3 "Test"
```

## See Also

- [OpenAI Provider Configuration](./configuration.md#openai-provider)
- [Tool Calling Guide](./tools.md)
- [Streaming Responses](./streaming.md)
