# OpenAIVercel Provider Architecture

Plan ID: PLAN-20251127-OPENAIVERCEL.P01
Requirements: REQ-OAV-001 through REQ-OAV-009, REQ-INT-001

## Overview

The `openaivercel` provider is a standalone provider implementation that uses the Vercel AI SDK (@ai-sdk/openai) to interact with OpenAI-compatible APIs. It sits alongside the existing `openai` provider and can be selected via `--provider openaivercel` CLI argument.

## Design Principles

1. **Standalone Implementation**: Does not share code with the existing OpenAI provider
2. **Vercel AI SDK First**: Uses Vercel AI SDK as the primary integration point
3. **BaseProvider Extension**: Inherits authentication and configuration from BaseProvider
4. **IProvider Contract**: Implements all required IProvider interface methods
5. **Pattern Consistency**: Follows established patterns from OpenAIProvider where applicable

## Class Hierarchy

```text
BaseProvider (abstract)
  ↓
OpenAIVercelProvider (concrete)
  └── implements IProvider
```

## Key Components

### 1. IProvider Interface Implementation

The provider implements the IProvider contract:

- `generateChatCompletion(options: GenerateChatOptions): AsyncIterable<IContent>`
- `getModels(): Promise<IModel[]>` and `getDefaultModel(): string`
- `getToolFormat?(): string` and `getModelParams?(): Record<string, unknown> | undefined`
- `getServerTools(): string[]` and `invokeServerTool(...)`
- `clearAuth?(): void` / `clearAuthCache?(): void`

### 2. BaseProvider Extension

Inherits from BaseProvider to leverage:

- **Authentication Precedence**: Supports keyfile, key, and base-url via AuthPrecedenceResolver
- **Configuration Management**: Uses SettingsService and Config for provider settings
- **Runtime Context**: Uses ProviderRuntimeContext and RuntimeInvocationContext
- **OAuth Support**: Inherits OAuthManager integration
- **Debug Logging**: Inherits DebugLogger integration

### 3. Vercel AI SDK Integration

#### Core Dependencies

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, generateText, CoreMessage, CoreTool } from 'ai';
```

#### Client Creation

The provider will create a Vercel AI SDK client:

```typescript
private createClient(apiKey: string, baseUrl?: string): OpenAI {
  return createOpenAI({
    apiKey,
    baseURL: baseUrl,
    compatibility: 'strict', // OpenAI compatibility mode
  });
}
```

### 4. Message Conversion Strategy

#### IContent → Vercel AI SDK CoreMessage

The provider converts llxprt-code's IContent format to Vercel AI SDK's CoreMessage format:

**IContent Structure:**

```typescript
interface IContent {
  speaker: 'human' | 'ai' | 'tool';
  blocks: ContentBlock[];
  metadata?: { role?: string };
}

type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'media';
      data: string;
      encoding: 'url' | 'base64';
      mimeType?: string;
    }
  | { type: 'tool_call'; id: string; name: string; parameters: unknown }
  | {
      type: 'tool_response';
      callId: string;
      toolName: string;
      result: unknown;
    };
```

**Vercel AI SDK CoreMessage:**

```typescript
type CoreMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Array<TextPart | ImagePart> }
  | {
      role: 'assistant';
      content: string | Array<TextPart | ImagePart | ToolCallPart>;
      toolInvocations?: ToolInvocation[];
    }
  | { role: 'tool'; content: string; toolCallId: string };
```

**Conversion Logic:**

- `speaker: 'human'` → `role: 'user'` with text/media parts
- `speaker: 'ai'` → `role: 'assistant'` with text, tool calls, or images
- `speaker: 'tool'` → `role: 'tool'` with `toolCallId`
- Optional metadata.role of `system` → `role: 'system'`

#### Vercel AI SDK Response → IContent

Converts streaming responses back to IContent:

```typescript
// Text-only response
{ speaker: 'ai', blocks: [{ type: 'text', text: '...' }] }

// Tool call response
{ speaker: 'ai', blocks: [{ type: 'tool_call', id, name, parameters }] }

// Tool result
{ speaker: 'tool', blocks: [{ type: 'tool_response', callId: 'id', toolName: 'name', result }] }
```

### 5. Tool Handling Strategy

#### ProviderToolset → Vercel AI SDK CoreTool

Converts llxprt-code's tool definitions:

**ProviderToolset Structure:**

```typescript
interface ProviderToolset {
  [toolName: string]: {
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}
```

**Vercel AI SDK CoreTool:**

```typescript
interface CoreTool {
  description?: string;
  parameters: JSONSchema;
}
```

**Conversion:**

- Map each tool in ProviderToolset to CoreTool format
- Extract description and parameters
- Preserve JSON schema structure
- Handle required fields

#### Tool Call Execution

1. Provider receives tool calls from Vercel AI SDK
2. Converts to IContent with toolCalls array
3. Returns to framework for execution
4. Receives tool results as IContent with speaker='tool'
5. Converts back to Vercel AI SDK format for next iteration

### 6. Streaming vs Non-Streaming Approach

#### Streaming (Primary Method)

Uses `generateChatCompletion()` with an AsyncIterable that forwards `streamText` chunks:

```typescript
async *generateChatCompletion(
  options: GenerateChatOptions,
): AsyncIterable<IContent> {
  const { textStream } = await streamText({
    model: client(modelName),
    messages,
    tools,
  });

  for await (const delta of textStream) {
    yield { speaker: 'ai', blocks: [{ type: 'text', text: delta }] };
  }
}
```

**Key Points:**

- Uses Vercel AI SDK's `streamText()` function
- Yields IContent chunks as they arrive
- Handles both text and tool call streaming
- Maintains streaming state across yields

#### Non-Streaming (Alternative)

Uses `generateChatCompletion()` with `streaming: false` to collect a single response:

```typescript
const { text, toolCalls } = await generateText({
  model: client(modelName),
  messages,
  tools,
});

return {
  speaker: 'ai',
  blocks: [
    { type: 'text', text },
    ...toolCalls.map((call) => ({
      type: 'tool_call',
      id: call.toolCallId,
      name: call.toolName,
      parameters: call.args,
    })),
  ],
};
```

### 7. Authentication Handling

#### Key Sources (Precedence Order)

1. **keyfile** (`--keyfile ~/.synthetic_key`)
   - Read from file via AuthPrecedenceResolver
   - Most common for synthetic.new usage

2. **key** (`--key sk-...`)
   - Direct API key from command line
   - Used for quick testing

3. **base-url** (`--base-url https://api.synthetic.new/openai/v1`)
   - Custom endpoint URL
   - Required for non-OpenAI endpoints

#### Implementation

```typescript
protected async resolveAuthentication(
  context: RuntimeInvocationContext
): Promise<{ apiKey: string; baseUrl?: string }> {
  const authConfig = this.resolveAuthConfig(context);

  // Get API key from precedence chain
  const apiKey = await this.getAuthToken(authConfig);

  // Get base URL from config
  const baseUrl = this.config?.baseUrl || authConfig.baseUrl;

  return { apiKey, baseUrl };
}
```

**Inherited from BaseProvider:**

- `resolveAuthConfig()` - Builds AuthPrecedenceConfig
- `getAuthToken()` - Resolves token via AuthPrecedenceResolver
- `validateAuthConfig()` - Validates authentication setup

### 8. Error Handling Approach

#### Error Categories

1. **Authentication Errors**
   - Missing API key
   - Invalid API key
   - Keyfile not found

2. **Configuration Errors**
   - Invalid base-url
   - Unsupported model
   - Invalid tool definitions

3. **API Errors**
   - Rate limiting (429)
   - Server errors (500-599)
   - Network errors

4. **Streaming Errors**
   - Connection interruption
   - Malformed stream data
   - Tool execution failures

#### Error Handling Strategy

```typescript
try {
  const { textStream } = await streamText({
    model: client(modelName),
    messages,
    tools,
  });

  for await (const delta of textStream) {
    yield { role: 'assistant', content: delta };
  }
} catch (error) {
  // Log via DebugLogger
  this.debug.error('openaivercel', 'Stream error', { error });

  // Convert to user-friendly error
  if (error.code === 'ENOTFOUND') {
    throw new Error('Network error: Cannot reach API endpoint');
  } else if (error.status === 401) {
    throw new Error('Authentication failed: Invalid API key');
  } else if (error.status === 429) {
    throw new Error('Rate limit exceeded');
  }

  // Re-throw with context
  throw new Error(`OpenAI Vercel provider error: ${error.message}`);
}
```

**Error Propagation:**

- Errors are logged via DebugLogger
- User-friendly messages are generated
- Original errors are preserved in debug logs
- AsyncGenerator handles cleanup automatically

## Model Management

### Default Model

- Default: `gpt-4o`
- Configurable via `--model` CLI argument
- Supports any OpenAI-compatible model

### Model Listing

```typescript
async listModels(): Promise<IModel[]> {
  // For synthetic.new, return common models
  // For OpenAI, could fetch from /v1/models endpoint
  return [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openaivercel' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openaivercel' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openaivercel' },
  ];
}
```

## Configuration

### Provider Config

```typescript
interface OpenAIVercelProviderConfig extends IProviderConfig {
  apiKey?: string; // Direct API key (precedence: low)
  keyfile?: string; // Path to keyfile (precedence: high)
  baseUrl?: string; // Custom endpoint URL
  model?: string; // Model override
  temperature?: number; // Response randomness (0-2)
  maxTokens?: number; // Max response length
}
```

### Settings Integration

Uses SettingsService for persistent configuration:

- Provider defaults
- Model preferences
- Temperature/token limits
- Custom base URLs

## Testing Strategy

### Phase-Specific Testing

Each implementation phase includes specific tests:

- Phase 01: Architecture validation (this document)
- Phase 02-03: Basic instantiation and authentication
- Phase 04-08: Tool handling and conversion
- Phase 09-12: Chat completion (streaming and non-streaming)
- Phase 13-15: Integration with existing framework
- Phase 16-18: Error handling and edge cases
- Phase 19-20: Final integration and validation

### Command-Line Testing

All testing uses CLI arguments (no interactive mode):

```bash
# Basic chat
node scripts/start.js --provider openaivercel --key sk-... --prompt "test"

# With synthetic.new
node scripts/start.js \
  --provider openaivercel \
  --keyfile ~/.synthetic_key \
  --model "hf:zai-org/GLM-4.6" \
  --base-url "https://api.synthetic.new/openai/v1" \
  --prompt "write me a haiku"

# With tools
node scripts/start.js \
  --provider openaivercel \
  --keyfile ~/.synthetic_key \
  --model "hf:zai-org/GLM-4.6" \
  --base-url "https://api.synthetic.new/openai/v1" \
  --prompt "what time is it" \
  --tools
```

## Dependencies

### Required Packages

- `ai` - Vercel AI SDK core
- `@ai-sdk/openai` - OpenAI provider for Vercel AI SDK

### Internal Dependencies

- `BaseProvider` - Base class with authentication
- `IProvider` - Provider interface contract
- `IContent` - Message format
- `ITool` - Tool definition format
- `SettingsService` - Configuration management
- `DebugLogger` - Debug logging
- `AuthPrecedenceResolver` - Authentication resolution

## Future Enhancements

### Phase 20+ Considerations

1. **Response Caching**: Implement caching for model responses
2. **Advanced Tool Features**: Support for parallel tool calling
3. **Custom Headers**: Support for additional API headers
4. **Retry Logic**: Implement exponential backoff for rate limits
5. **Model Discovery**: Auto-discover available models from endpoint
6. **Streaming Events**: Emit events for streaming lifecycle
7. **Token Counting**: Track token usage per request
8. **Cost Tracking**: Estimate costs for API calls

## Implementation Phases

This architecture supports the following implementation phases:

- **Phase 01** (Current): Architecture documentation
- **Phase 02-03**: Provider instantiation and configuration
- **Phase 04-08**: Tool handling and conversion
- **Phase 09-12**: Chat completion implementation
- **Phase 13-15**: Framework integration
- **Phase 16-18**: Error handling and testing
- **Phase 19-20**: Final validation and documentation

Each phase builds incrementally on the previous phase, ensuring testable progress at each step.

## References

- Plan: `/project-plans/20251127openaivercel/PLAN.md`
- IProvider: `/packages/core/src/providers/IProvider.ts`
- BaseProvider: `/packages/core/src/providers/BaseProvider.ts`
- OpenAIProvider: `/packages/core/src/providers/openai/OpenAIProvider.ts`
- Vercel AI SDK: [https://sdk.vercel.ai/docs](https://sdk.vercel.ai/docs)
