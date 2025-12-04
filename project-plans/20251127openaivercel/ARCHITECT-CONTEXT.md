# Architect Context: OpenAIVercelProvider Implementation

## Project Overview

This plan is for implementing a **new, standalone provider** called `openaivercel` that uses Vercel AI SDK to interact with OpenAI-compatible APIs. This is NOT a replacement for the existing `openai` provider, but rather an additional option that users can choose.

## Key Decisions

### 1. Provider Positioning
- **Standalone provider**: Sits alongside existing `openai` provider
- **No migration**: Both providers coexist permanently
- **User selection**: Users explicitly choose via `/provider openaivercel`
- **Same interface**: Implements `IProvider` like all other providers

### 2. Authentication
- **Standard auth only**: Supports `/key` and `/keyfile` commands
- **NO OAuth**: No special Qwen OAuth handling (that stays with `openai` provider)
- **Standard baseURL**: Supports `/baseurl` for custom endpoints
- **PAT support**: Personal Access Tokens via key/keyfile

### 3. Usage Pattern
```bash
/provider openaivercel
/baseurl https://api.openai.com/v1
/keyfile ~/.openai/key
/model gpt-4
```

## Why Vercel AI SDK?

From the original issue request:

> "I'm tired of swatting at flies. Every day a new model or provider pops up. I'd like to see if we can outsource this to vercel and work more on features and less on stupid problems like model quirks and provider issues."

Benefits:
- Automatic provider quirk handling
- Model geometry heuristics (context window detection)
- Same SDK used by opencode (better provider support)
- Less maintenance for model-specific issues

## Architecture Decisions (Phase 01)

Based on analysis of existing provider implementations, the following key architectural decisions have been made:

### 1. BaseProvider Extension
- **Decision**: OpenAIVercelProvider extends `BaseProvider` class
- **Rationale**: Inherits authentication precedence, runtime context management, debug logging
- **Impact**: Reduces implementation complexity, ensures consistency with other providers

### 2. Stateless Client Creation
- **Decision**: Create fresh Vercel SDK client per API operation (no caching)
- **Rationale**: Follows PLAN-20251023-STATELESS-HARDENING.P08 requirements
- **Impact**: Ensures fresh credentials, prevents stale client issues

### 3. Message Conversion Strategy
- **Pattern**: IContent[] → CoreMessage[] (Vercel SDK format)
- **Key conversions**:
  - System messages: First system role message
  - User messages: Combine TextBlocks into single string
  - Assistant messages: Extract text + tool calls
  - Tool results: Create tool role messages with normalized IDs
- **Tool ID normalization**: Bidirectional (`hist_tool_` ↔ `call_`)

### 4. Streaming Implementation
- **Pattern**: Use Vercel SDK's `streamText()` API
- **Implementation**: Async iterate over `textStream`, yield IContent blocks
- **Rationale**: Consistent with Vercel AI SDK patterns, better UX

### 5. Authentication Scope
- **Supported**: Standard PAT authentication (key/keyfile)
- **Not Supported**: OAuth device flow (OpenAI doesn't support it)
- **Rationale**: Simplifies implementation, sufficient for OpenAI API access

See P01-architecture.md for complete architectural documentation.



## Technical Architecture

### Provider Interface

The new provider must implement `IProvider` interface:

```typescript
export interface IProvider {
  name: string;
  isDefault?: boolean;
  getModels(): Promise<IModel[]>;
  generateChatCompletion(options: GenerateChatOptions): AsyncIterableIterator<IContent>;
  getCurrentModel?(): string;
  getDefaultModel(): string;
  getToolFormat?(): string;
  isPaidMode?(): boolean;
  getServerTools(): string[];
  invokeServerTool(toolName: string, params: unknown, config?: unknown, signal?: AbortSignal): Promise<unknown>;
  getModelParams?(): Record<string, unknown> | undefined;
  clearAuthCache?(): void;
  clearAuth?(): void;
}
```

### Key Components to Understand

#### 1. BaseProvider
All providers extend `BaseProvider` which provides:
- Authentication resolution (API keys, keyfiles)
- Settings management
- Configuration handling
- Tool format detection
- Model parameter extraction

Reference: `packages/core/src/providers/BaseProvider.ts`

#### 2. IContent Format
llxprt uses a unified content format for all providers:

```typescript
export interface IContent {
  speaker: 'human' | 'ai' | 'tool';
  blocks: Array<TextBlock | ToolCallBlock | ToolResponseBlock>;
  metadata?: Record<string, unknown>;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolCallBlock {
  type: 'tool_call';
  id: string;  // Format: hist_tool_<uuid>
  name: string;
  parameters: unknown;
}

export interface ToolResponseBlock {
  type: 'tool_response';
  callId: string;  // Must match tool_call id
  toolName: string;
  result?: string;
  error?: string;
  status?: 'success' | 'error';
}
```

Reference: `packages/core/src/services/history/IContent.ts`

#### 3. Tool Format Conversion

llxprt internally uses **Gemini-style** tool format:

```typescript
// Internal Gemini format
{
  functionDeclarations: [
    {
      name: string;
      description?: string;
      parametersJsonSchema?: unknown;
      parameters?: unknown;
    }
  ]
}
```

Vercel AI SDK expects **OpenAI-style** format:

```typescript
// OpenAI/Vercel format
{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  }
}
```

**Solution**: Use existing `ToolFormatter` class:

```typescript
import { ToolFormatter } from '../../tools/ToolFormatter.js';

const formatter = new ToolFormatter();
const openaiTools = formatter.convertGeminiToFormat(geminiTools, 'openai');
```

Reference: `packages/core/src/tools/ToolFormatter.ts`

#### 4. Tool Call ID Normalization (CRITICAL)

**The Problem**: Different ID formats must be translated correctly.

- **HistoryService format**: `hist_tool_<uuid>` (internal storage)
- **OpenAI format**: `call_<uuid>` (API format)
- **Anthropic format**: `toolu_<uuid>` (for reference)

**Why It Matters**: Tool responses MUST match tool call IDs or the conversation breaks.

**Existing Solution in OpenAIProvider**:

```typescript
// Convert to OpenAI format when sending to API
private normalizeToOpenAIToolId(id: string): string {
  if (id.startsWith('call_')) return id;
  if (id.startsWith('hist_tool_')) {
    const uuid = id.substring('hist_tool_'.length);
    return 'call_' + uuid;
  }
  if (id.startsWith('toolu_')) {
    const uuid = id.substring('toolu_'.length);
    return 'call_' + uuid;
  }
  return 'call_' + id;  // Unknown format
}

// Convert to history format when receiving from API
private normalizeToHistoryToolId(id: string): string {
  if (id.startsWith('hist_tool_')) return id;
  if (id.startsWith('call_')) {
    const uuid = id.substring('call_'.length);
    return 'hist_tool_' + uuid;
  }
  if (id.startsWith('toolu_')) {
    const uuid = id.substring('toolu_'.length);
    return 'hist_tool_' + uuid;
  }
  return 'hist_tool_' + id;  // Unknown format
}
```

**Your provider must implement similar ID normalization.**

Reference: `packages/core/src/providers/openai/OpenAIProvider.ts` (lines with `normalizeToOpenAIToolId`, `normalizeToHistoryToolId`)

#### 5. History Service Flow

Understanding how tool calls flow through the system:

**Turn 1: User Request**
```typescript
{
  speaker: 'human',
  blocks: [{ type: 'text', text: 'Read /tmp/config.json' }]
}
```

**Turn 2: AI Tool Call**
```typescript
{
  speaker: 'ai',
  blocks: [
    { type: 'text', text: "I'll read that file" },
    {
      type: 'tool_call',
      id: 'hist_tool_abc123',  // ← History format
      name: 'read_file',
      parameters: { path: '/tmp/config.json' }
    }
  ]
}
```

**Turn 3: Tool Execution**
```typescript
// Core layer executes tool
const result = await toolScheduler.executeTool('read_file', params);

// Result added to history
{
  speaker: 'tool',
  blocks: [{
    type: 'tool_response',
    callId: 'hist_tool_abc123',  // ← MUST match
    toolName: 'read_file',
    result: '{"config": "data"}',
    status: 'success'
  }]
}
```

**Turn 4: Replay to Provider**
When history is replayed to the provider, you must:
1. Convert `hist_tool_xxx` IDs to `call_xxx` format
2. Build Vercel SDK message structures
3. Ensure tool responses reference correct tool call IDs

### Vercel AI SDK Integration

#### Key Packages

```json
{
  "dependencies": {
    "ai": "^3.x.x",           // Core Vercel AI SDK
    "@ai-sdk/openai": "^0.x.x" // OpenAI provider for Vercel SDK
  }
}
```

#### Primary APIs

**Model Creation**:
```typescript
import { createOpenAI } from '@ai-sdk/openai';

const openai = createOpenAI({
  apiKey: 'your-api-key',
  baseURL: 'https://api.openai.com/v1'  // Optional
});

const model = openai('gpt-4');
```

**Streaming Text**:
```typescript
import { streamText } from 'ai';

const result = await streamText({
  model: model,
  messages: convertedMessages,
  tools: convertedTools,
  maxTokens: 1000
});

// Async iteration over text chunks
for await (const chunk of result.textStream) {
  // chunk is a string
}

// Tool calls available after stream completes
const toolCalls = await result.toolCalls;
```

**Non-Streaming Text**:
```typescript
import { generateText } from 'ai';

const result = await generateText({
  model: model,
  messages: convertedMessages,
  tools: convertedTools
});

// result.text contains full response
// result.toolCalls contains any tool calls
```

#### Message Format

Vercel SDK expects OpenAI-style messages:

```typescript
type Message = 
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

type ToolCall = {
  id: string;        // e.g., 'call_abc123'
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
};
```

#### Tool Format

```typescript
type Tool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: JSONSchema;  // JSON Schema object
  };
};
```

### Conversion Requirements

#### IContent → Vercel Messages

```typescript
function convertToVercelMessages(contents: IContent[]): Message[] {
  const messages: Message[] = [];
  
  for (const content of contents) {
    if (content.speaker === 'human') {
      const text = content.blocks
        .filter(b => b.type === 'text')
        .map(b => (b as TextBlock).text)
        .join('\n');
      messages.push({ role: 'user', content: text });
    }
    else if (content.speaker === 'ai') {
      const text = content.blocks
        .filter(b => b.type === 'text')
        .map(b => (b as TextBlock).text)
        .join('\n');
      
      const toolCalls = content.blocks
        .filter(b => b.type === 'tool_call')
        .map(b => {
          const tc = b as ToolCallBlock;
          return {
            id: normalizeToOpenAIToolId(tc.id),
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.parameters)
            }
          };
        });
      
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls })
      });
    }
    else if (content.speaker === 'tool') {
      for (const block of content.blocks) {
        if (block.type === 'tool_response') {
          const tr = block as ToolResponseBlock;
          messages.push({
            role: 'tool',
            content: tr.result || '',
            tool_call_id: normalizeToOpenAIToolId(tr.callId)
          });
        }
      }
    }
  }
  
  return messages;
}
```

#### Vercel Response → IContent

```typescript
// Streaming
async function* convertVercelStreamToContent(result: StreamTextResult): AsyncGenerator<IContent> {
  // Yield text chunks
  for await (const chunk of result.textStream) {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: chunk }]
    };
  }
  
  // Yield tool calls after stream completes
  const toolCalls = await result.toolCalls;
  if (toolCalls.length > 0) {
    yield {
      speaker: 'ai',
      blocks: toolCalls.map(tc => ({
        type: 'tool_call',
        id: normalizeToHistoryToolId(tc.toolCallId),
        name: tc.toolName,
        parameters: tc.args
      }))
    };
  }
}
```

## CodeRabbit's Key Insights

From the issue comments, CodeRabbit identified these critical points:

### 1. Tool Call Flow
> "The provider yields tool calls with IDs. Those IDs are stored in HistoryService. When tool results come back, they reference those IDs. When replaying history, we must convert IDs to the provider's expected format."

### 2. Streaming Considerations
> "Vercel SDK's streamText returns an AsyncIterableIterator. You need to convert chunks to IContent blocks. Text chunks should be yielded immediately. Tool calls are available after the stream completes via `result.toolCalls`."

### 3. Tool Response Payload
> "Tool responses need proper error handling and status. Use `buildToolResponsePayload` helper to construct tool response content with truncation, error messages, and metadata."

Reference: `packages/core/src/providers/utils/toolResponsePayload.ts`

### 4. Authentication Precedence
> "BaseProvider handles auth precedence: direct API key > keyfile > environment variable. You don't need to reimplement this, just use `await this.getAuthToken()`."

### 5. Model Parameters
> "Extract model parameters from settings using `extractModelParamsFromOptions()` pattern. These get merged into the Vercel SDK request."

## Implementation Pattern from OpenAIProvider

The existing `OpenAIProvider` provides the blueprint:

### Key Methods to Implement

1. **Constructor**: Initialize BaseProvider with auth config
2. **getModels()**: Return available models
3. **getDefaultModel()**: Return default model name
4. **generateChatCompletionWithOptions()**: Main generation method
5. **Tool ID normalization**: Helper methods for ID conversion
6. **Message conversion**: IContent ↔ Vercel messages
7. **Error handling**: Retry logic, abort signal support

### Constructor Pattern

```typescript
constructor(
  apiKey: string | undefined,
  baseURL?: string,
  config?: IProviderConfig
) {
  super(
    {
      name: 'openaivercel',
      apiKey,
      baseURL,
      envKeyNames: ['OPENAI_API_KEY'],
      // NO OAuth configuration - keep it simple
    },
    config
  );
}
```

### Generation Method Pattern

```typescript
protected async *generateChatCompletionWithOptions(
  options: NormalizedGenerateChatOptions
): AsyncIterableIterator<IContent> {
  // 1. Get auth token
  const authToken = await this.getAuthToken();
  
  // 2. Create Vercel SDK client
  const openai = createOpenAI({
    apiKey: authToken,
    baseURL: options.resolved.baseURL ?? this.getBaseURL()
  });
  
  // 3. Get model
  const modelName = options.resolved.model || this.getDefaultModel();
  const model = openai(modelName);
  
  // 4. Convert tools
  const formatter = new ToolFormatter();
  const vercelTools = formatter.convertGeminiToFormat(options.tools, 'openai');
  
  // 5. Convert messages
  const messages = this.convertToVercelMessages(options.contents);
  
  // 6. Add system prompt
  const systemPrompt = await getCoreSystemPromptAsync(...);
  messages.unshift({ role: 'system', content: systemPrompt });
  
  // 7. Stream or generate
  const streamingEnabled = /* check settings */;
  
  if (streamingEnabled) {
    const result = await streamText({
      model,
      messages,
      tools: vercelTools,
      // ... other options
    });
    
    yield* this.convertVercelStreamToContent(result);
  } else {
    const result = await generateText({
      model,
      messages,
      tools: vercelTools,
    });
    
    yield this.convertVercelResponseToContent(result);
  }
}
```

## Testing Requirements

From `dev-docs/RULES.md`:

### TDD Approach
1. **Write test first** (RED)
2. **Implement minimal code** to pass (GREEN)
3. **Refactor** if valuable

### Test Coverage
- Tool call ID normalization (hist_tool ↔ call_)
- Message conversion (IContent ↔ Vercel messages)
- Streaming vs non-streaming responses
- Tool format conversion
- Error handling
- Authentication resolution
- Multiple tool calls in one turn
- Tool response matching

### Test Structure
```typescript
describe('OpenAIVercelProvider', () => {
  describe('Tool ID Normalization', () => {
    it('should convert hist_tool_ to call_ format', () => {
      // Test normalizeToOpenAIToolId
    });
    
    it('should convert call_ to hist_tool_ format', () => {
      // Test normalizeToHistoryToolId
    });
  });
  
  describe('Message Conversion', () => {
    it('should convert IContent to Vercel messages', () => {
      // Test convertToVercelMessages
    });
    
    it('should preserve tool call IDs during conversion', () => {
      // Critical test - IDs must match
    });
  });
  
  // ... more test suites
});
```

## Files to Reference

### Critical Files
1. `packages/core/src/providers/openai/OpenAIProvider.ts` - Reference implementation
2. `packages/core/src/providers/BaseProvider.ts` - Base class to extend
3. `packages/core/src/providers/IProvider.ts` - Interface to implement
4. `packages/core/src/tools/ToolFormatter.ts` - Tool format conversion
5. `packages/core/src/services/history/IContent.ts` - Content block types
6. `packages/core/src/core/prompts.ts` - System prompt generation

### Helper Utilities
7. `packages/core/src/providers/utils/toolResponsePayload.ts` - Tool response helpers
8. `packages/core/src/providers/utils/authToken.ts` - Auth token resolution
9. `packages/core/src/utils/retry.ts` - Retry logic
10. `packages/core/src/tools/doubleEscapeUtils.ts` - Parameter processing

### Test References
11. `packages/core/src/providers/openai/OpenAIProvider.test.ts` - Test patterns

## Key Constraints

### From RULES.md
- **TypeScript strict mode**: No `any`, no type assertions
- **Immutable data**: No mutations
- **Pure functions**: Minimize side effects
- **TDD mandatory**: Tests before implementation
- **100% behavior coverage**: Test all user-facing behavior

### From PLAN-TEMPLATE.md
- **Phase structure**: Each phase has clear prerequisites
- **Plan markers**: All code must include `@plan:PLAN-ID.P##` markers
- **Requirement markers**: Link code to requirements with `@requirement:REQ-ID`
- **Verification**: Both structural and semantic verification required
- **No TODOs**: No deferred implementation allowed

### Provider-Specific
- **No OAuth**: Keep authentication simple (key/keyfile only)
- **No Qwen**: This provider doesn't need special Qwen handling
- **Standalone**: Works independently of other providers
- **Standard interface**: Fully implements IProvider
- **Tool compatibility**: Must handle tool calls correctly

## Success Criteria

The OpenAIVercelProvider implementation is successful when:

1. **Functional**:
   - Users can switch to it via `/provider openaivercel`
   - Supports standard auth: `/key`, `/keyfile`
   - Supports custom endpoints: `/baseurl`
   - Handles tool calls correctly with proper ID mapping
   - Streams responses properly
   - Reports usage/token metadata

2. **Quality**:
   - 100% test coverage of behavior
   - Follows TDD approach (tests first)
   - No TypeScript errors
   - No linting warnings
   - Adheres to RULES.md conventions

3. **Integration**:
   - Works with existing HistoryService
   - Compatible with existing tool infrastructure
   - Doesn't break existing providers
   - Properly registered in provider registry

4. **Documentation**:
   - Clear plan with all phases
   - Each phase has verification steps
   - Code has proper plan/requirement markers
   - Usage examples provided

## Non-Goals

What this implementation does NOT need:

- [ERROR] OAuth support (Qwen or otherwise)
- [ERROR] Migration path from old provider
- [ERROR] Provider selection mechanism
- [ERROR] Backward compatibility layers
- [ERROR] Deprecation of existing OpenAI provider
- [ERROR] Support for non-OpenAI Vercel SDK providers
- [ERROR] Custom tool formats beyond standard OpenAI
- [ERROR] Special model-specific quirk handling (that's Vercel SDK's job)

## Summary for Plan Creation

Create a phased implementation plan for `OpenAIVercelProvider` that:

1. **Extends BaseProvider** with standard auth (no OAuth)
2. **Implements IProvider** interface completely
3. **Uses Vercel AI SDK** (`@ai-sdk/openai`) for API calls
4. **Converts formats** properly:
   - IContent ↔ Vercel messages
   - Gemini tools → OpenAI tools (via ToolFormatter)
   - hist_tool IDs ↔ call_ IDs
5. **Supports streaming** and non-streaming modes
6. **Handles tool calls** with correct ID preservation
7. **Follows TDD** with tests before implementation
8. **Includes verification** at each phase

The plan should have clear phases, prerequisites, verification steps, and completion criteria following PLAN-TEMPLATE.md structure.



---

## Phase 01 Analysis: Deep Dive into Existing Patterns

### BaseProvider Architecture Analysis

#### Core Structure Patterns from BaseProvider.ts

1. **Constructor Pattern**
   ```typescript
   constructor(config: BaseProviderConfig & IProviderConfig) {
     // Store config for later use
     // Set up auth precedence resolver
     // Initialize debug logger
     // DO NOT create client in constructor (stateless pattern)
   }
   ```

2. **Client Instantiation Pattern** (CRITICAL)
   - BaseProvider has **NO** instance-level client
   - Each operation creates a fresh client via `buildProviderClient()`
   - Pattern from PLAN-20251023-STATELESS-HARDENING.P08
   - Example from AnthropicProvider:
     ```typescript
     private instantiateClient(authToken: string, baseURL?: string): Anthropic {
       const options: ClientOptions = {
         apiKey: authToken,
         baseURL: baseURL || undefined,
       };
       return new Anthropic(options);
     }
     ```

3. **Authentication Flow**
   - Uses `AuthPrecedenceResolver` for auth precedence chain
   - Resolution order:
     1. /key command key
     2. /keyfile command keyfile  
     3. --key CLI argument
     4. --keyfile CLI argument
     5. Environment variables
     6. OAuth (if enabled)
   - Resolved via `buildProviderClient()` method

4. **Settings Service Resolution**
   - BaseProvider has `resolveSettingsService()` method
   - Checks: options.settings → runtime context → config
   - Used for stateless parameter retrieval (NO memoization)

5. **Runtime Context Handling**
   - BaseProvider uses `ProviderRuntimeContext` for state
   - Pattern: `peekActiveProviderRuntimeContext()` to get context
   - Pattern: `setActiveProviderRuntimeContext()` to set context
   - Context contains: settings, config, auth tokens, metadata

### Message Conversion Patterns Discovered

#### IContent Structure (from IContent.ts)

```typescript
export interface IContent {
  speaker: 'human' | 'ai' | 'tool';
  blocks: ContentBlock[];
}

export type ContentBlock = 
  | TextBlock 
  | ToolCallBlock 
  | ToolResponseBlock 
  | ImageBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolCallBlock {
  type: 'tool_call';
  id: string;
  name: string;
  parameters: string; // JSON string
}

export interface ToolResponseBlock {
  type: 'tool_response';
  id: string;
  content: string;
  isError?: boolean;
}
```

#### Anthropic Message Conversion Strategy

From AnthropicProvider.ts lines 950-1150:

1. **System Message Extraction**
   - First 'human' message with system=true becomes system message
   - System text goes to `system` parameter in API call
   - NOT part of messages array

2. **Message Grouping**
   - Messages grouped by speaker
   - Consecutive same-speaker messages merged
   - Tool calls and text can be in same message

3. **Tool Call Message Format**
   ```typescript
   {
     role: 'assistant',
     content: [
       { type: 'text', text: '...' },
       { 
         type: 'tool_use',
         id: 'normalized_id',
         name: 'tool_name',
         input: { /* parsed JSON */ }
       }
     ]
   }
   ```

4. **Tool Response Message Format**
   ```typescript
   {
     role: 'user',
     content: [
       {
         type: 'tool_result',
         tool_use_id: 'tool_id',
         content: 'response text',
         is_error: false
       }
     ]
   }
   ```

#### OpenAI Message Conversion Strategy

From OpenAIProvider.ts lines 800-1000:

1. **Dual Mode Support**
   - **Textual mode**: No tool support, tools converted to text
   - **Native mode**: Full tool call support

2. **Message Grouping**
   - Similar to Anthropic: group by speaker
   - Consecutive same-speaker merged
   - Exception: assistant with tool calls followed by tool results

3. **Tool Call Message Format** (Native Mode)
   ```typescript
   {
     role: 'assistant',
     content: 'text content',
     tool_calls: [
       {
         id: 'call_id',
         type: 'function',
         function: {
           name: 'tool_name',
           arguments: '{"param":"value"}' // JSON string
         }
       }
     ]
   }
   ```

4. **Tool Response Message Format** (Native Mode)
   ```typescript
   {
     role: 'tool',
     tool_call_id: 'call_id',
     content: 'response text'
   }
   ```

5. **Textual Mode Tool Handling**
   - Tool calls converted to text description
   - Tool responses as user messages
   - Format: "Tool: tool_name(params)\nResult: response"

### Tool Handling Patterns

#### ToolFormatter Usage

From ToolFormatter.ts:

1. **Tool Schema Conversion**
   ```typescript
   const formatter = new ToolFormatter();
   const toolSchemas = formatter.formatTools(tools, 'openai');
   // Returns OpenAI-compatible tool definitions
   ```

2. **Tool Formats Supported**
   - 'openai': Native OpenAI format
   - 'anthropic': Anthropic format
   - Others: 'deepseek', 'qwen', 'hermes', 'xml', 'llama', 'gemma'

3. **Tool Call Block Processing**
   - Parse `parameters` string as JSON
   - Handle malformed JSON gracefully
   - Normalize tool IDs per provider requirements

#### Vercel AI SDK Tool Mapping

Vercel AI SDK uses different format:

```typescript
// Vercel SDK tool definition
{
  type: 'function',
  function: {
    name: 'tool_name',
    description: 'description',
    parameters: { /* JSON schema */ }
  }
}

// Vercel SDK tool call result
{
  type: 'tool-call',
  toolCallId: 'id',
  toolName: 'name',
  args: { /* parsed object */ }
}
```

**Conversion Strategy for OpenAIVercelProvider:**
- ToolFormatter already supports 'openai' format
- Vercel SDK's tool format is compatible with OpenAI
- Use existing ToolFormatter with 'openai' format
- Convert Vercel SDK responses back to IContent blocks

### Error Handling Patterns

#### From BaseProvider.ts and Provider Implementations

1. **Authentication Errors**
   ```typescript
   throw new AuthenticationRequiredError(
     'No API key found',
     this.name,
     ['key', 'keyfile', 'env']
   );
   ```

2. **Runtime Context Errors**
   ```typescript
   throw new MissingProviderRuntimeError(
     this.name,
     ['settings', 'config'],
     'REQ-SP4-001'
   );
   ```

3. **API Error Wrapping**
   - Catch provider-specific errors
   - Re-throw with context
   - Preserve original error in cause
   - Example from AnthropicProvider:
     ```typescript
     catch (error) {
       this.getLogger().error(() => 
         `Failed to list models: ${error}`
       );
       throw error;
     }
     ```

4. **Streaming Error Handling**
   - Errors during streaming yield error content
   - Format: `{ speaker: 'ai', blocks: [{ type: 'text', text: 'Error: ...' }] }`
   - Continue iteration (don't throw)

#### Vercel AI SDK Error Handling

Vercel SDK throws standard errors:
- `APICallError`: API call failed
- `InvalidResponseDataError`: Response parsing failed
- Network errors propagate naturally

**Strategy for OpenAIVercelProvider:**
- Catch Vercel SDK errors
- Wrap in appropriate llxprt error types
- Maintain error message clarity
- Use debug logger for detailed context

### Model Discovery Patterns

#### From AnthropicProvider.ts (lines 360-425)

```typescript
async listModels(): Promise<IModel[]> {
  const authToken = await this.resolveAuthToken();
  const baseURL = this.getBaseURL();
  const client = this.instantiateClient(authToken, baseURL);
  
  const models: IModel[] = [];
  
  // Handle pagination
  for await (const model of client.beta.models.list()) {
    models.push({
      id: model.id,
      name: model.display_name || model.id,
      provider: 'anthropic',
      supportedToolFormats: ['anthropic'],
      contextWindow: this.getContextWindowForModel(model.id),
      maxOutputTokens: this.getMaxOutputTokensForModel(model.id),
    });
  }
  
  return models;
}
```

#### From OpenAIProvider.ts (lines 365-460)

```typescript
async listModels(): Promise<IModel[]> {
  const authToken = await this.resolveAuthToken();
  const baseURL = this.getBaseURL();
  const client = this.instantiateClient(authToken, baseURL);
  const response = await client.models.list();
  const models: IModel[] = [];
  
  for await (const model of response) {
    // Filter out non-chat models
    if (!/embedding|whisper|audio|tts|image|vision|dall[- ]?e|moderation/i.test(model.id)) {
      models.push({
        id: model.id,
        name: model.id,
        provider: 'openai',
        supportedToolFormats: ['openai'],
      });
    }
  }
  
  return models;
}
```

**Pattern for OpenAIVercelProvider:**
- Vercel SDK does NOT provide model listing API
- Models must be defined statically or discovered via OpenAI client
- Options:
  1. Hardcode common models (gpt-4, gpt-3.5-turbo, etc.)
  2. Use @ai-sdk/openai's underlying OpenAI client for discovery
  3. Accept any model ID user provides (no listing)

**Recommended Approach:**
- Static list of known OpenAI models
- Allow custom model IDs via settings
- Document that model listing is limited vs openai provider

### Streaming Implementation Patterns

#### From AnthropicProvider.ts (lines 750-950)

```typescript
protected override async *generateChatCompletionWithOptions(
  options: NormalizedGenerateChatOptions,
): AsyncIterableIterator<IContent> {
  const { client } = await this.buildProviderClient(options);
  const { contents, tools } = options;
  
  // Convert IContent to provider format
  const anthropicMessages = this.convertToAnthropicMessages(contents);
  
  // Build request
  const request = {
    model: this.resolveModelId(),
    messages: anthropicMessages,
    stream: true,
    max_tokens: this.getMaxTokens(),
    tools: tools ? this.formatTools(tools) : undefined,
  };
  
  // Stream response
  const stream = await client.messages.create(request);
  
  let currentText = '';
  let currentToolCalls: ToolCallBlock[] = [];
  
  for await (const chunk of stream) {
    // Process deltas
    if (chunk.type === 'content_block_delta') {
      if (chunk.delta.type === 'text_delta') {
        currentText += chunk.delta.text;
        yield { speaker: 'ai', blocks: [{ type: 'text', text: chunk.delta.text }] };
      }
      // ... handle tool_use deltas
    }
  }
}
```

#### Vercel AI SDK Streaming Pattern

```typescript
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const openai = createOpenAI({ apiKey: '...' });

const result = streamText({
  model: openai('gpt-4'),
  messages: [...],
  tools: {...},
});

// Text streaming
for await (const delta of result.textStream) {
  // delta is string
}

// Full streaming (includes tool calls)
for await (const part of result.fullStream) {
  // part can be: text-delta, tool-call, tool-result, finish, error
}
```

**Conversion Strategy for OpenAIVercelProvider:**
- Use `fullStream` for complete response handling
- Convert stream parts to IContent blocks:
  - `text-delta` → `{ type: 'text', text: delta }`
  - `tool-call` → `{ type: 'tool_call', id, name, parameters }`
  - `tool-result` → `{ type: 'tool_response', id, content }`
- Maintain streaming state (current text, pending tool calls)
- Yield IContent after each meaningful chunk

### File Structure Patterns

#### Anthropic Provider Structure

```
packages/core/src/providers/anthropic/
├── AnthropicProvider.ts          (main provider)
├── AnthropicProvider.test.ts     (unit tests)
└── README.md                      (provider docs)
```

#### OpenAI Provider Structure

```
packages/core/src/providers/openai/
├── OpenAIProvider.ts             (main provider)
├── OpenAIProvider.test.ts        (unit tests)
└── README.md                      (provider docs)
```

**Recommended Structure for OpenAIVercelProvider:**

```
packages/core/src/providers/openai-vercel/
├── OpenAIVercelProvider.ts       (main provider implementation)
├── OpenAIVercelProvider.test.ts  (unit tests)
├── messageConverter.ts           (IContent ↔ Vercel messages)
├── messageConverter.test.ts      (conversion tests)
└── README.md                      (provider documentation)
```

### Integration Points

#### Provider Registration (ProviderManager.ts)

1. **Provider Registry**
   - Providers registered in ProviderManager
   - Each has unique name/ID
   - Must implement IProvider interface

2. **Discovery Mechanism**
   - Providers imported in ProviderManager
   - Added to registry map
   - Available via `/provider <name>` command

3. **Registration Pattern**
   ```typescript
   import { OpenAIVercelProvider } from './openai-vercel/OpenAIVercelProvider.js';
   
   this.providers.set('openaivercel', new OpenAIVercelProvider({
     name: 'openaivercel',
     envKeyNames: ['OPENAI_API_KEY'],
   }));
   ```

#### CLI Integration

1. **Provider Selection**
   - Command: `/provider openaivercel`
   - Updates runtime settings
   - Persists to config

2. **Model Selection**
   - Command: `/model <model-id>`
   - Validates against listModels()
   - Persists to settings

3. **Authentication Commands**
   - `/key <api-key>`: Set API key
   - `/keyfile <path>`: Load from file
   - `/baseurl <url>`: Set custom endpoint

### Critical Design Decisions for OpenAIVercelProvider

Based on the above analysis:

1. **No Client Memoization**
   - Follow stateless pattern from PLAN-20251023-STATELESS-HARDENING.P08
   - Create fresh Vercel SDK client for each operation
   - Store only config, NOT client instance

2. **Message Conversion Strategy**
   - Separate converter module (messageConverter.ts)
   - Handle IContent → Vercel format
   - Handle Vercel responses → IContent
   - Support both streaming and non-streaming

3. **Tool Format**
   - Use ToolFormatter with 'openai' format
   - Vercel SDK compatible with OpenAI tool format
   - No custom tool format needed

4. **Model Discovery**
   - Static list of common models
   - Allow any model ID via settings
   - Document limitation vs openai provider
   - Consider future enhancement: delegate to OpenAI client

5. **Error Handling**
   - Wrap Vercel SDK errors in llxprt errors
   - Use AuthenticationRequiredError for auth failures
   - Use DebugLogger for detailed context
   - Stream errors as IContent (don't throw)

6. **Streaming Implementation**
   - Use Vercel SDK's fullStream
   - Convert stream parts to IContent incrementally
   - Maintain state for text accumulation
   - Handle tool calls in streaming context

7. **Testing Strategy**
   - Unit tests for message conversion
   - Unit tests for provider methods
   - Mock Vercel SDK calls
   - Integration tests for streaming
   - Follow existing test patterns

---

## Implementation Checklist (For P02+)

### Core Files to Create

- [ ] `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- [ ] `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.test.ts`
- [ ] `packages/core/src/providers/openai-vercel/messageConverter.ts`
- [ ] `packages/core/src/providers/openai-vercel/messageConverter.test.ts`
- [ ] `packages/core/src/providers/openai-vercel/README.md`

### Core Patterns to Implement

- [ ] Extend BaseProvider (NOT standalone class)
- [ ] Implement IProvider interface
- [ ] Use AuthPrecedenceResolver for auth
- [ ] No client memoization (stateless pattern)
- [ ] Fresh client per operation via instantiateClient()
- [ ] Convert IContent to Vercel messages via messageConverter
- [ ] Handle streaming with fullStream
- [ ] Use ToolFormatter for tool definitions
- [ ] Wrap Vercel SDK errors appropriately
- [ ] Register in ProviderManager

### Authentication Patterns

- [ ] Constructor accepts BaseProviderConfig
- [ ] resolveAuthToken() from BaseProvider
- [ ] Support /key and /keyfile commands
- [ ] Support OPENAI_API_KEY env var
- [ ] NO OAuth support (keep simple)

### Testing Requirements

- [ ] Message conversion tests (IContent → Vercel)
- [ ] Message conversion tests (Vercel → IContent)
- [ ] Tool handling tests
- [ ] Streaming tests
- [ ] Error handling tests
- [ ] Auth precedence tests

---
