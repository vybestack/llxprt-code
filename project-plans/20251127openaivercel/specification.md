# Feature Specification: OpenAI Vercel Provider

## Purpose

Implement a new standalone provider called `openaivercel` that uses the Vercel AI SDK to interact with OpenAI-compatible APIs. This provider addresses the maintenance burden of handling model-specific quirks and provider variations by leveraging Vercel's well-maintained SDK that automatically handles these issues.

**Problem Statement**: Every new model or provider introduces quirks requiring custom handling. The Vercel AI SDK is designed to abstract these provider-specific issues, reducing maintenance overhead.

**User Value**: Users gain access to a more reliable, consistently-updated provider interface that handles model geometry heuristics, provider quirks, and API variations automatically.

## Architectural Decisions

- **Pattern**: Provider Pattern - implements IProvider interface like existing providers
- **Technology Stack**: TypeScript strict mode, Vercel AI SDK (ai, @ai-sdk/openai)
- **Data Flow**: User Input → CLI Commands → Provider Interface → Vercel AI SDK → OpenAI API
- **Integration Points**: 
  - ProviderManager for registration
  - HistoryService for message format
  - ToolScheduler for tool execution

### Key Design Decisions

1. **Standalone Provider**: Sits alongside existing `openai` provider, not a replacement
2. **No OAuth**: Only standard API key authentication (via `/key` and `/keyfile`)
3. **Streaming by Default**: Uses Vercel AI SDK streaming patterns
4. **Tool ID Normalization**: Bidirectional conversion between hist_tool_ and call_ formats

## Project Structure

```
packages/core/src/providers/openai-vercel/
  OpenAIVercelProvider.ts  # Main provider implementation
  utils.ts                 # Tool ID normalization utilities
  errors.ts               # Custom error classes
  index.ts                # Module exports
  __tests__/
    providerRegistration.test.ts
    toolIdNormalization.test.ts
    messageConversion.test.ts
    authentication.test.ts
    nonStreamingGeneration.test.ts
    streamingGeneration.test.ts
    errorHandling.test.ts
    modelListing.test.ts
```

## Technical Environment

- **Type**: CLI Tool Provider
- **Runtime**: Node.js 20.x
- **Dependencies**:
  - `ai@^3.x.x` - Vercel AI SDK core
  - `@ai-sdk/openai@^0.x.x` - OpenAI provider for Vercel SDK

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature

- `packages/core/src/providers/ProviderManager.ts` - Will register and instantiate OpenAIVercelProvider
- `packages/cli/src/ui/commands/providerCommand.ts` - `/provider openaivercel` will select this provider
- `packages/cli/src/ui/commands/keyCommand.ts` - `/key` will set API key via setKey()
- `packages/cli/src/ui/commands/keyfileCommand.ts` - `/keyfile` will set key via setKeyFile()
- `packages/cli/src/ui/commands/baseurlCommand.ts` - `/baseurl` will configure endpoint
- `packages/cli/src/ui/commands/modelCommand.ts` - `/model` will list models via getModels()
- `packages/core/src/runtime/chatRuntime.ts` - Will call generateChatCompletion()

### Existing Code To Be Replaced

- None - this is an additive feature, not a replacement
- Existing `openai` provider remains unchanged

### User Access Points

- CLI: `/provider openaivercel` - Switch to this provider
- CLI: `/key sk-...` - Set API key
- CLI: `/keyfile path/to/key` - Set API key from file
- CLI: `/baseurl https://api.example.com` - Set custom endpoint
- CLI: `/model gpt-4o` - Select model
- CLI: `/models` - List available models

### Migration Requirements

- None required - new provider with no existing state to migrate
- Users explicitly opt-in via `/provider openaivercel`

## Formal Requirements

```
[REQ-OAV-001] Provider Registration
  [REQ-OAV-001.1] Provider MUST be selectable via `/provider openaivercel`
  [REQ-OAV-001.2] Provider MUST implement IProvider interface
  [REQ-OAV-001.3] Provider MUST be registered in ProviderManager

[REQ-OAV-002] Standard Authentication
  [REQ-OAV-002.1] MUST support `/key` command for API key input
  [REQ-OAV-002.2] MUST support `/keyfile` command for file-based key
  [REQ-OAV-002.3] MUST validate key presence before API calls

[REQ-OAV-003] BaseURL Configuration
  [REQ-OAV-003.1] MUST support `/baseurl` command for custom endpoints
  [REQ-OAV-003.2] MUST normalize URLs (trailing slash removal)
  [REQ-OAV-003.3] MUST use custom URL in Vercel SDK client creation

[REQ-OAV-004] Tool ID Normalization
  [REQ-OAV-004.1] MUST convert hist_tool_ IDs to call_ for API
  [REQ-OAV-004.2] MUST convert call_ IDs to hist_tool_ from API
  [REQ-OAV-004.3] MUST handle toolu_ (Anthropic) format
  [REQ-OAV-004.4] MUST preserve round-trip ID integrity

[REQ-OAV-005] Message Format Conversion
  [REQ-OAV-005.1] MUST convert IContent to CoreMessage format
  [REQ-OAV-005.2] MUST handle user text messages
  [REQ-OAV-005.3] MUST handle user messages with images
  [REQ-OAV-005.4] MUST handle assistant text messages
  [REQ-OAV-005.5] MUST handle assistant tool call messages
  [REQ-OAV-005.6] MUST handle tool result messages
  [REQ-OAV-005.7] MUST handle system messages

[REQ-OAV-006] Chat Completion Generation
  [REQ-OAV-006.1] MUST use Vercel AI SDK generateText for non-streaming
  [REQ-OAV-006.2] MUST yield IContent blocks from response
  [REQ-OAV-006.3] MUST include usage metadata (tokens)
  [REQ-OAV-006.4] MUST pass temperature/maxTokens parameters
  [REQ-OAV-006.5] MUST handle tool calls in response

[REQ-OAV-007] Streaming Support
  [REQ-OAV-007.1] MUST use Vercel AI SDK streamText for streaming
  [REQ-OAV-007.2] MUST yield text chunks as they arrive
  [REQ-OAV-007.3] MUST yield tool calls after stream completes
  [REQ-OAV-007.4] MUST yield usage metadata at end
  [REQ-OAV-007.5] Streaming SHOULD be the default mode

[REQ-OAV-008] Error Handling
  [REQ-OAV-008.1] MUST wrap API errors in ProviderError
  [REQ-OAV-008.2] MUST identify rate limit errors (429) as RateLimitError
  [REQ-OAV-008.3] MUST identify auth errors (401) as AuthenticationError
  [REQ-OAV-008.4] MUST preserve retry-after information
  [REQ-OAV-008.5] MUST include provider name in errors

[REQ-OAV-009] Model Listing
  [REQ-OAV-009.1] MUST return static list of common OpenAI models
  [REQ-OAV-009.2] MUST include GPT-4, GPT-3.5, and O1 models
  [REQ-OAV-009.3] MUST include correct context window sizes
  [REQ-OAV-009.4] MUST set provider field to 'openaivercel'

[REQ-INT-001] Integration Requirements
  [REQ-INT-001.1] Provider MUST be registered in ProviderManager
  [REQ-INT-001.2] Provider MUST work with existing CLI commands
  [REQ-INT-001.3] Provider MUST interoperate with HistoryService
  [REQ-INT-001.4] Provider MUST work with ToolScheduler
```

## Data Schemas

### IContent (input from history)

```typescript
interface IContent {
  speaker: 'human' | 'ai' | 'tool';
  blocks: Array<TextBlock | ToolCallBlock | ToolResponseBlock>;
  metadata?: ContentMetadata;
}

interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolCallBlock {
  type: 'tool_call';
  id: string;  // hist_tool_<uuid>
  name: string;
  parameters: unknown;
}

interface ToolResponseBlock {
  type: 'tool_response';
  callId: string;  // must match tool_call id
  toolName: string;
  result?: string;
  error?: string;
  status?: 'success' | 'error';
}
```

### CoreMessage (Vercel AI SDK format)

```typescript
type CoreMessage = 
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | AssistantContentPart[] }
  | { role: 'tool'; content: ToolResultPart[] };

interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;  // call_<uuid>
  result: string;
  isError?: boolean;
}
```

## Example Data

```json
{
  "validApiKey": "sk-test-key-123",
  "validBaseUrl": "https://api.openai.com/v1",
  "historyToolId": "hist_tool_abc123",
  "openaiToolId": "call_abc123",
  "sampleMessage": {
    "speaker": "human",
    "blocks": [{"type": "text", "text": "Hello"}]
  },
  "sampleToolCall": {
    "speaker": "ai",
    "blocks": [{
      "type": "tool_call",
      "id": "hist_tool_abc123",
      "name": "read_file",
      "parameters": {"path": "/tmp/test.txt"}
    }]
  }
}
```

## Constraints

- No external HTTP calls in unit tests (mock Vercel SDK)
- All async operations must properly handle errors
- TypeScript strict mode required (no `any`, no type assertions)
- Tool ID normalization must be bidirectional and lossless
- Must follow existing provider patterns (extend BaseProvider if applicable)

## Performance Requirements

- Streaming latency: First chunk within 500ms of API response
- Non-streaming: Response within 5s for typical queries
- Model listing: Synchronous (static list)

## Non-Goals

- OAuth support (Qwen or otherwise)
- Migration from existing openai provider
- Provider selection mechanism changes
- Backward compatibility layers for old formats
- Deprecation of existing OpenAI provider
