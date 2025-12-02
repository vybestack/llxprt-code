# Phase 1: Architecture Documentation & Analysis

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P01`

## Prerequisites

- Required: Phase 0.5 completed
- Verification: `ls packages/core/src/providers/openai-vercel/`
- Expected files from previous phase: Directory exists
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Analysis Phase Content

### Existing Code Analysis

Before designing the new provider, analyze existing implementations:

```bash
# Analyze existing provider patterns
cat packages/core/src/providers/anthropic/AnthropicProvider.ts | head -100
cat packages/core/src/providers/openai/OpenAIProvider.ts | head -100

# Check IProvider interface requirements
cat packages/core/src/providers/IProvider.ts

# Check message types
grep -A 20 "interface IMessage" packages/core/src/types.ts
grep -A 30 "type IContent" packages/core/src/types.ts
```

### Key Patterns Discovered

| Pattern | Location | How OpenAIVercelProvider Will Use |
|---------|----------|-----------------------------------|
| **BaseProvider Extension** | `BaseProvider` class | Extend `BaseProvider` and implement `IProvider`. Override `generateChatCompletionWithOptions()`. |
| **Authentication** | `BaseProvider.resolveAuth()` | Use `resolveAuth()` method from BaseProvider. No OAuth support (standard PAT only). |
| **Client Instantiation** | All providers | Create fresh `openai()` client per operation (stateless). No client caching. |
| **Message Conversion** | `AnthropicProvider` ~line 850, `OpenAIProvider` ~line 800 | Convert `IContent[]` to Vercel SDK `CoreMessage[]`. Handle text/tool_call/tool_response blocks. |
| **Tool Handling** | `OpenAIProvider` ~line 800 | Convert `ITool[]` to Vercel SDK tool format. Extract tool calls/responses from IContent blocks. |
| **Streaming** | `AnthropicProvider` ~line 750-1300 | Use Vercel SDK's `streamText()` with async iteration over `textStream`. Yield IContent blocks. |
| **Non-Streaming** | `AnthropicProvider` ~line 1600 | Use Vercel SDK's `generateText()` for non-streaming. Extract text and usage from response. |
| **Error Handling** | `packages/core/src/providers/errors.ts` | Use `AuthenticationRequiredError`, `MissingProviderRuntimeError`. Wrap SDK errors. |
| **Model Listing** | `listModels()` in providers | Return hardcoded list of supported OpenAI models (gpt-4, gpt-3.5-turbo, etc.). |
| **System Prompts** | `getCoreSystemPromptAsync()` | Prepend system message to CoreMessage[] array as first message. |
| **Retry Logic** | `AnthropicProvider` via util | Use existing `retryWithBackoff` utility with exponential backoff. |
| **Rate Limiting** | `AnthropicProvider` ~line 1300 | Extract rate limit info from response headers if available. Use BaseProvider tracking. |
| **Tool ID Normalization** | `AnthropicProvider` | Handle `hist_tool_` ↔ `call_` prefix conversions for tool IDs. |
| **Debug Logging** | All providers | Use `DebugLogger` from `this.getLogger()` for detailed operation logging. |

### Dependencies Analysis

| Package | Version | Purpose | Alternative If Missing |
|---------|---------|---------|------------------------|
| ai | ^3.x | Vercel AI SDK core | None - required |
| @ai-sdk/openai | ^0.x | OpenAI model provider | None - required |

## Requirements Implemented (Expanded)

### REQ-OAV-001: Provider Registration

**Full Text**: Provider must be selectable via `--provider openaivercel` CLI argument
**Behavior**:
- GIVEN: The application is running
- WHEN: User starts with `--provider openaivercel` argument
- THEN: The OpenAIVercelProvider is activated and ready for configuration
**Why This Matters**: Users need to explicitly choose this provider to use the Vercel AI SDK implementation

### REQ-OAV-002: Standard Authentication

**Full Text**: Must support standard API key authentication methods
**Behavior**:
- GIVEN: OpenAIVercelProvider is active
- WHEN: User sets API key via any of:
  - `/key <key>` command (interactive mode)
  - `/keyfile <path>` command (interactive mode)
  - `--key <key>` CLI argument
  - `--keyfile <path>` CLI argument
- THEN: The API key is stored and used for subsequent requests
**Why This Matters**: API keys are required for OpenAI API access

**Testing Note**: Automated tests use CLI arguments only (`--key`, `--keyfile`) because slash commands require interactive mode.

### REQ-OAV-003: BaseURL Configuration

**Full Text**: Must support `--base-url` CLI argument for custom endpoints
**Behavior**:
- GIVEN: OpenAIVercelProvider is active
- WHEN: User starts with `--base-url https://custom.endpoint.com`
- THEN: All API requests use the custom endpoint
**Why This Matters**: Enables use with OpenAI-compatible APIs (Azure, local models, etc.)

## Architecture Overview

### Component Structure

```
packages/core/src/providers/openai-vercel/
├── OpenAIVercelProvider.ts    # Main provider implementation
├── types.ts                   # Provider-specific types
├── utils.ts                   # Utility functions (tool ID normalization)
├── index.ts                   # Module exports
└── __tests__/
    ├── providerRegistration.test.ts
    ├── authentication.test.ts
    ├── baseUrl.test.ts
    ├── toolIdNormalization.test.ts
    ├── messageConversion.test.ts
    ├── textGeneration.test.ts
    ├── streaming.test.ts
    ├── toolCalling.test.ts
    └── errorHandling.test.ts
```

### Data Flow

```
User Input → CLI Commands → Provider Interface
                              ↓
                    OpenAIVercelProvider
                              ↓
                    Vercel AI SDK (createOpenAI)
                              ↓
                    OpenAI API / Compatible API
```

### Integration Contracts

#### IProvider Interface Implementation

The OpenAIVercelProvider must implement all methods from IProvider:

```typescript
interface IProvider {
  // Configuration
  setKey(key: string): void;
  setKeyFile(path: string): Promise<void>;
  setBaseUrl(url: string): void;
  
  // Generation
  generateChatCompletion(
    messages: IMessage[],
    options: GenerationOptions
  ): AsyncIterable<IContent>;
  
  // Model Information
  listModels(): Promise<ModelInfo[]>;
  
  // Provider Information
  getName(): string;
  getId(): string;
}
```

#### Tool ID Normalization Contract

**Problem**: Vercel AI SDK requires OpenAI-compatible tool call IDs (starting with `call_`), but our history system uses `hist_tool_` prefixed IDs.

**Solution**: Bidirectional normalization functions:

```typescript
// Convert history tool ID to OpenAI format
normalizeToOpenAIToolId(id: string): string
// Example: hist_tool_abc123 → call_abc123, toolu_xyz → call_xyz

// Convert OpenAI tool ID back to history format
normalizeToHistoryToolId(id: string): string
// Example: call_abc123 → hist_tool_abc123
```

#### Message Conversion Contract

**Problem**: IMessage format differs from Vercel AI SDK's expected format.

**Solution**: Conversion function that handles:
- User messages with text content
- User messages with images
- Assistant messages with text
- Assistant messages with tool calls
- Tool result messages

### Key Design Decisions

#### 1. BaseProvider Extension Pattern
- **Decision**: Extend `BaseProvider` abstract class and implement `IProvider` interface
- **Rationale**: Inherits authentication precedence logic, runtime context management, debug logging
- **Implementation**: Override `generateChatCompletionWithOptions()` method
- **Consistency**: Same pattern as Anthropic, OpenAI, Gemini providers

#### 2. Stateless Client Creation
- **Decision**: Create fresh Vercel SDK `openai()` client per API operation (no caching)
- **Rationale**: Follows PLAN-20251023-STATELESS-HARDENING.P08; ensures fresh credentials
- **Implementation**: Instantiate client in `generateChatCompletionWithOptions()`

#### 3. Authentication Strategy
- **Decision**: Support standard PAT authentication only (no OAuth)
- **Methods Supported**:
  - `/key <key>` command (interactive mode)
  - `/keyfile <path>` command (interactive mode)
  - `--key <key>` CLI argument
  - `--keyfile <path>` CLI argument
- **Rationale**: OpenAI doesn't have device flow OAuth; standard PAT is sufficient
- **Testing Note**: Tests use CLI arguments only; slash commands work in interactive mode only

#### 4. Message Conversion Pattern
- **Decision**: Convert `IContent[]` to Vercel SDK `CoreMessage[]`
- **Conversion Logic**:
  - System messages: Use first `system` role message
  - User messages: Extract text from `TextBlock`s
  - Assistant messages: Extract text + tool calls
  - Tool results: Create `tool` role messages
- **Tool ID Handling**: Bidirectional normalization (`hist_tool_` ↔ `call_`)

#### 5. Streaming Strategy
- **Decision**: Use Vercel SDK's `streamText()` for all completions
- **Implementation**: Async iterate over `textStream`, yield `IContent` blocks
- **Rationale**: Streaming by default is Vercel AI SDK pattern; better UX

#### 6. Tool Handling
- **Decision**: Convert `ITool[]` to Vercel SDK tool format
- **Conversion**: Map `ITool.function` to Vercel SDK tool schema
- **ID Normalization**: `hist_tool_*` ↔ `call_*` at API boundary

#### 7. Error Handling Strategy
- **Decision**: Use existing error classes + wrap Vercel SDK errors
- **Error Classes**: `AuthenticationRequiredError`, `MissingProviderRuntimeError`
- **Rationale**: Consistent error handling across all providers

#### 8. Model Listing Approach
- **Decision**: Return hardcoded list of OpenAI models (gpt-4-turbo, gpt-4, gpt-3.5-turbo, etc.)
- **Rationale**: OpenAI's model listing API is limited; hardcoded list is more reliable

#### 9. Base URL Support
- **Decision**: Support custom base URLs via `/baseurl` command
- **Use Cases**: OpenAI-compatible APIs (LocalAI, LM Studio, etc.)
- **Implementation**: Pass to `openai()` client constructor


interface OpenAIVercelProviderContract {

### IProvider Implementation Details

#### Required Methods from IProvider

```typescript
interface IProvider {
  // Identity
  getId(): string;
  getName(): string;
  
  // Configuration
  setKey(key: string): void;
  setKeyFile(path: string): Promise<void>;
  setBaseUrl(url: string): void;
  setModelParams(params: Record<string, unknown> | undefined): void;
  getModelParams(): Record<string, unknown> | undefined;
  
  // Core generation
  generateChatCompletion(
    messages: IMessage[],
    options?: Partial<GenerateChatOptions>
  ): AsyncIterableIterator<IContent>;
  
  // Model information
  listModels(authToken?: string): Promise<IModel[]>;
  
  // Tool support
  createToolFormatter(): ToolFormatter;
  getSupportedToolFormats(): ToolFormat[];
}
```

#### OpenAIVercelProvider Implementation Strategy

```typescript
export class OpenAIVercelProvider extends BaseProvider implements IProvider {
  // Identity (required by IProvider)
  getId(): string {
    return 'openaivercel';
  }
  
  getName(): string {
    return 'OpenAI (Vercel AI SDK)';
  }
  
  // Core generation (override from BaseProvider)
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions
  ): AsyncIterableIterator<IContent> {
    // 1. Resolve authentication via BaseProvider
    const authToken = await this.resolveAuth(options.resolved.telemetry);
    
    // 2. Create fresh Vercel SDK client (stateless)
    const client = createOpenAI({
      apiKey: authToken,
      baseURL: this.getBaseURL(),
    });
    
    // 3. Convert IContent[] to CoreMessage[]
    const messages = this.convertToVercelMessages(options.contents);
    
    // 4. Convert ITool[] to Vercel SDK tools
    const tools = this.convertToVercelTools(options.tools);
    
    // 5. Call streamText() with configuration
    const result = await streamText({
      model: client(options.model),
      messages,
      tools,
      ...this.getModelParams(),
    });
    
    // 6. Stream response chunks as IContent blocks
    for await (const chunk of result.textStream) {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: chunk }],
      };
    }
    
    // 7. Yield final usage metadata
    const finalResult = await result.text;
    yield {
      speaker: 'ai' as const,
      blocks: [],
      metadata: {
        usage: {
          promptTokens: result.usage?.promptTokens,
          completionTokens: result.usage?.completionTokens,
          totalTokens: result.usage?.totalTokens,
        },
      },
    };
  }
  
  // Model listing (required by IProvider)
  async listModels(authToken?: string): Promise<IModel[]> {
    // Return hardcoded list of OpenAI models
    return [
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        provider: 'openaivercel',
        supportedToolFormats: ['openai'],
        contextWindow: 128000,
        maxOutputTokens: 4096,
      },
      {
        id: 'gpt-4',
        name: 'GPT-4',
        provider: 'openaivercel',
        supportedToolFormats: ['openai'],
        contextWindow: 8192,
        maxOutputTokens: 4096,
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        provider: 'openaivercel',
        supportedToolFormats: ['openai'],
        contextWindow: 16385,
        maxOutputTokens: 4096,
      },
    ];
  }
  
  // Tool support (inherited from BaseProvider)
  createToolFormatter(): ToolFormatter {
    return new ToolFormatter('openai');
  }
  
  getSupportedToolFormats(): ToolFormat[] {
    return ['openai'];
  }
}
```


### Tool ID Normalization Utilities

The provider must handle tool ID format differences between the history system and OpenAI API.

#### Pattern: History → OpenAI Format

```typescript
/**
 * Convert history tool ID to OpenAI-compatible format
 * @example
 *   normalizeToOpenAIToolId('hist_tool_abc123') → 'call_abc123'
 *   normalizeToOpenAIToolId('toolu_xyz') → 'call_xyz'
 *   normalizeToOpenAIToolId('call_existing') → 'call_existing'
 */
function normalizeToOpenAIToolId(id: string): string {
  if (id.startsWith('call_')) return id;
  if (id.startsWith('hist_tool_')) return 'call_' + id.slice(10);
  if (id.startsWith('toolu_')) return 'call_' + id.slice(6);
  return 'call_' + id;
}
```

#### Pattern: OpenAI → History Format

```typescript
/**
 * Convert OpenAI tool ID to history format
 * @example
 *   normalizeToHistoryToolId('call_abc123') → 'hist_tool_abc123'
 *   normalizeToHistoryToolId('hist_tool_existing') → 'hist_tool_existing'
 */
function normalizeToHistoryToolId(id: string): string {
  if (id.startsWith('hist_tool_')) return id;
  if (id.startsWith('call_')) return 'hist_tool_' + id.slice(5);
  if (id.startsWith('toolu_')) return 'hist_tool_' + id.slice(6);
  return 'hist_tool_' + id;
}
```


### Message Conversion Patterns

The provider must convert between the internal `IContent[]` format and Vercel SDK's `CoreMessage[]` format.

#### Pattern: System Messages

```typescript
// Internal format
IContent {
  speaker: 'system',
  blocks: [{ type: 'text', text: 'You are a helpful assistant' }]
}

// Vercel SDK format
CoreMessage {
  role: 'system',
  content: 'You are a helpful assistant'
}
```

#### Pattern: User Messages

```typescript
// Internal format
IContent {
  speaker: 'user',
  blocks: [
    { type: 'text', text: 'Hello' },
    { type: 'text', text: 'How are you?' }
  ]
}

// Vercel SDK format (combine text blocks)
CoreMessage {
  role: 'user',
  content: 'Hello\nHow are you?'
}
```

#### Pattern: Assistant Messages (Text Only)

```typescript
// Internal format
IContent {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'I am doing well' }]
}

// Vercel SDK format
CoreMessage {
  role: 'assistant',
  content: 'I am doing well'
}
```

#### Pattern: Assistant Messages (With Tool Calls)

```typescript
// Internal format
IContent {
  speaker: 'ai',
  blocks: [
    { type: 'text', text: 'Let me check' },
    {
      type: 'tool_call',
      id: 'hist_tool_abc123',
      name: 'get_weather',
      input: { location: 'NYC' }
    }
  ]
}

// Vercel SDK format (normalize tool ID)
CoreMessage {
  role: 'assistant',
  content: [
    { type: 'text', text: 'Let me check' },
    {
      type: 'tool-call',
      toolCallId: 'call_abc123',  // normalized from hist_tool_abc123
      toolName: 'get_weather',
      args: { location: 'NYC' }
    }
  ]
}
```

#### Pattern: Tool Result Messages

```typescript
// Internal format
IContent {
  speaker: 'tool',
  blocks: [
    {
      type: 'tool_response',
      toolCallId: 'hist_tool_abc123',
      name: 'get_weather',
      content: '{"temp": 72, "condition": "sunny"}'
    }
  ]
}

// Vercel SDK format (normalize tool ID)
CoreMessage {
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: 'call_abc123',  // normalized from hist_tool_abc123
      toolName: 'get_weather',
      result: '{"temp": 72, "condition": "sunny"}'
    }
  ]
}
```


## Verification Commands

### Automated Checks

```bash
# Verify architecture document exists
ls -la project-plans/20251127openaivercel/P01-architecture.md

# Verify IProvider interface
grep -A20 "interface IProvider" packages/core/src/providers/IProvider.ts
```

### Structural Verification Checklist

- [x] Architecture document is complete
- [x] All components are identified (provider class, utilities, tests)
- [x] Data flow is documented (user input → provider → Vercel SDK → OpenAI API)
- [x] Integration contracts are defined (IProvider implementation, message/tool conversion)
- [x] Design decisions are documented with rationale (9 key decisions documented)

## Success Criteria

- Architecture document is complete and comprehensive
- All component boundaries are clearly defined
- Integration contracts are specified
- Design decisions are documented with rationale

## Failure Recovery

If this phase fails:
1. Review existing provider implementations for patterns
2. Consult Vercel AI SDK documentation
3. Update architecture based on findings

## Related Files

- `packages/core/src/providers/IProvider.ts`
- `packages/core/src/providers/anthropic/AnthropicProvider.ts` (reference)
- `packages/core/src/providers/openai/OpenAIProvider.ts` (reference)
- `project-plans/20251127openaivercel/ARCHITECT-CONTEXT.md`

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When architecture analysis begins
- [ ] IN_PROGRESS → BLOCKED: If blocking issues found during analysis
- [ ] IN_PROGRESS → COMPLETED: When all contracts are documented
- [ ] BLOCKED → IN_PROGRESS: After blocking issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P01.md`
Contents:

```markdown
Phase: P01
Completed: YYYY-MM-DD HH:MM
Files Created: Architecture documentation
Analysis Completed:
- Existing provider patterns: [analyzed/not]
- Dependencies: [verified/not]
- Integration contracts: [defined/not]
Pseudo-contracts Defined:
- IProvider implementation: [yes/no]
- Tool ID normalization: [yes/no]
- Message conversion: [yes/no]
```
