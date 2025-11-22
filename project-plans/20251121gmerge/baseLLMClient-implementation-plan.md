# baseLLMClient Implementation Plan

## 1. Architecture Overview

The baseLLMClient is a stateless utility class that extracts LLM utility methods from the main client.ts, providing a clean separation between conversational (stateful) and utility (stateless) operations. This follows the Single Responsibility Principle and enables better testability.

```
┌─────────────────────────────────────────────────────────────┐
│                         Application Layer                    │
├─────────────────────────────────────────────────────────────┤
│  client.ts (stateful)        │   baseLLMClient (stateless)  │
│  - Conversation management   │   - generateJson()           │
│  - Context tracking          │   - generateEmbedding()      │
│  - History management        │   - generateContent()        │
│  - Uses baseLLMClient ────────>  - countTokens()            │
└──────────────┬───────────────┴────────────┬─────────────────┘
               │                            │
               v                            v
┌─────────────────────────────────────────────────────────────┐
│                    ContentGenerator Interface                │
├─────────────────────────────────────────────────────────────┤
│                   Provider Adapter Layer                     │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│ Anthropic│  OpenAI  │  Gemini  │  Vertex  │   Future...    │
│  Adapter │  Adapter │  Adapter │  Adapter │   Providers    │
└──────────┴──────────┴──────────┴──────────┴────────────────┘
```

### Key Design Principles

1. **Stateless Operations Only**: No session state, history, or context management
2. **Provider Agnostic**: Works with any provider through adapters
3. **Dependency Injection**: Provider selection happens at runtime
4. **Interface-Based**: Clear contracts between layers
5. **Testable**: Easy to mock and test in isolation
6. **Incremental Migration**: Can coexist with current client.ts during migration

## 2. Interfaces

```typescript
// packages/core/src/core/IBaseLLMClient.ts
/**
 * Interface for stateless LLM utility operations
 * @requirement REQ-BLLM-001: Stateless utility operations
 * @requirement REQ-BLLM-002: Multi-provider support
 */
export interface IBaseLLMClient {
  /**
   * Generate structured JSON from a prompt using the specified schema
   * Used by: llm-edit-fixer, next-speaker-checker, complexity-analyzer
   */
  generateJson<T = Record<string, unknown>>(
    contents: IContent[],
    schema: Record<string, unknown>,
    options?: GenerateJsonOptions
  ): Promise<T>;

  /**
   * Generate embeddings for text inputs
   * Used by: semantic search, similarity calculations
   */
  generateEmbedding(
    texts: string[],
    options?: EmbeddingOptions
  ): Promise<number[][]>;

  /**
   * Generate content without conversation context
   * Used by: summarizer, one-off completions
   */
  generateContent(
    contents: IContent[],
    options?: GenerateContentOptions
  ): Promise<IGenerateContentResponse>;

  /**
   * Count tokens for the given content
   * Used by: context window management, cost estimation
   */
  countTokens(
    contents: IContent[],
    options?: CountTokensOptions
  ): Promise<ICountTokensResponse>;
}

// packages/core/src/core/IUtilityLLMProvider.ts
/**
 * Provider interface for utility LLM operations
 * Extends the base provider with utility-specific methods
 */
export interface IUtilityLLMProvider {
  /**
   * Provider identifier
   */
  readonly name: string;

  /**
   * Generate JSON with provider-specific implementation
   */
  generateJson<T>(
    contents: IContent[],
    schema: Record<string, unknown>,
    config: ProviderConfig
  ): Promise<T>;

  /**
   * Generate embeddings with provider-specific implementation
   */
  generateEmbedding(
    texts: string[],
    config: ProviderConfig
  ): Promise<number[][]>;

  /**
   * Generate content without state management
   */
  generateContent(
    contents: IContent[],
    config: ProviderConfig
  ): Promise<IGenerateContentResponse>;

  /**
   * Count tokens using provider-specific tokenizer
   */
  countTokens(
    contents: IContent[],
    config: ProviderConfig
  ): Promise<ICountTokensResponse>;

  /**
   * Check if provider supports a specific utility operation
   */
  supportsOperation(operation: UtilityOperation): boolean;
}

// packages/core/src/core/baseLLMClient.types.ts
export interface GenerateJsonOptions {
  model?: string;
  abortSignal?: AbortSignal;
  maxRetries?: number;
  temperature?: number;
  provider?: string;
  systemInstruction?: string;
}

export interface EmbeddingOptions {
  model?: string;
  abortSignal?: AbortSignal;
  provider?: string;
  dimensions?: number;
}

export interface GenerateContentOptions {
  model?: string;
  abortSignal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  provider?: string;
  systemInstruction?: string;
}

export interface CountTokensOptions {
  model?: string;
  provider?: string;
}

export enum UtilityOperation {
  GENERATE_JSON = 'generateJson',
  GENERATE_EMBEDDING = 'generateEmbedding',
  GENERATE_CONTENT = 'generateContent',
  COUNT_TOKENS = 'countTokens',
}

export interface ProviderConfig {
  model: string;
  apiKey?: string;
  baseURL?: string;
  authToken?: ResolvedAuthToken;
  abortSignal?: AbortSignal;
  maxRetries?: number;
  temperature?: number;
  maxTokens?: number;
  systemInstruction?: string;
  dimensions?: number;
}

export interface IGenerateContentResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

export interface ICountTokensResponse {
  totalTokens: number;
  promptTokens?: number;
  cachedTokens?: number;
}
```

## 3. Test Plan (Test-First Approach)

### 3.1 Unit Tests - baseLLMClient.test.ts

```typescript
describe('BaseLLMClient', () => {
  describe('generateJson', () => {
    it('should generate JSON with Anthropic provider');
    it('should generate JSON with OpenAI provider');
    it('should generate JSON with Gemini provider');
    it('should handle malformed JSON responses by extracting from markdown');
    it('should retry on transient failures');
    it('should respect abort signals');
    it('should throw on invalid schema');
    it('should use fallback provider when primary fails');
    it('should cache provider selection for session');
    it('should handle empty response gracefully');
  });

  describe('generateEmbedding', () => {
    it('should generate embeddings with OpenAI provider');
    it('should generate embeddings with Gemini provider');
    it('should throw for providers that don\'t support embeddings');
    it('should handle empty text array');
    it('should batch large text arrays appropriately');
    it('should normalize embedding dimensions across providers');
    it('should respect abort signals');
    it('should handle rate limits with exponential backoff');
  });

  describe('generateContent', () => {
    it('should generate content with all supported providers');
    it('should apply system instructions correctly');
    it('should respect max token limits');
    it('should handle temperature settings');
    it('should track token usage');
    it('should handle streaming responses');
    it('should respect abort signals');
  });

  describe('countTokens', () => {
    it('should count tokens accurately for each provider');
    it('should handle different content types (text, images, tools)');
    it('should cache token counts for identical content');
    it('should provide estimates for unsupported providers');
  });

  describe('provider selection', () => {
    it('should select provider based on configuration');
    it('should fallback to default provider when specified provider unavailable');
    it('should cache provider instances');
    it('should validate provider capabilities before use');
  });

  describe('error handling', () => {
    it('should provide meaningful error messages');
    it('should include provider context in errors');
    it('should handle network failures gracefully');
    it('should handle authentication failures');
    it('should handle quota exceeded errors');
  });
});
```

### 3.2 Provider Adapter Tests

```typescript
describe('Provider Adapters', () => {
  describe('AnthropicUtilityAdapter', () => {
    it('should convert IContent to Anthropic format');
    it('should handle Claude-specific JSON generation');
    it('should map Anthropic responses to common format');
    it('should handle Anthropic-specific errors');
  });

  describe('OpenAIUtilityAdapter', () => {
    it('should convert IContent to OpenAI format');
    it('should handle GPT JSON mode');
    it('should generate embeddings with text-embedding-3');
    it('should map OpenAI responses to common format');
  });

  describe('GeminiUtilityAdapter', () => {
    it('should convert IContent to Gemini format');
    it('should handle responseJsonSchema');
    it('should generate embeddings with text-embedding-004');
    it('should handle Gemini-specific token counting');
  });
});
```

### 3.3 Integration Tests

```typescript
describe('BaseLLMClient Integration', () => {
  it('should work with llm-edit-fixer');
  it('should work with summarizer');
  it('should work with complexity-analyzer');
  it('should handle provider switching mid-session');
  it('should maintain backward compatibility with existing generateJson calls');
});
```

## 4. Implementation Steps

### Step 1: Create Core Interfaces and Types
**Files:**
- `/packages/core/src/core/IBaseLLMClient.ts`
- `/packages/core/src/core/IUtilityLLMProvider.ts`
- `/packages/core/src/core/baseLLMClient.types.ts`

**Actions:**
1. Define all interfaces as specified above
2. Add JSDoc comments with requirement tags
3. Export from index.ts for public API

### Step 2: Write Failing Tests
**Files:**
- `/packages/core/src/core/baseLLMClient.test.ts`
- `/packages/core/src/providers/adapters/__tests__/*.test.ts`

**Actions:**
1. Create comprehensive test suite following TDD
2. Mock provider responses
3. Test error scenarios
4. Ensure all tests fail initially

### Step 3: Implement BaseLLMClient Class
**File:** `/packages/core/src/core/baseLLMClient.ts`

```typescript
export class BaseLLMClient implements IBaseLLMClient {
  private providers: Map<string, IUtilityLLMProvider>;
  private defaultProvider: string;
  private contentGenerator: ContentGenerator;

  constructor(
    private config: Config,
    private providerManager: IProviderManager,
  ) {
    this.providers = new Map();
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Register available providers
  }

  async generateJson<T>(
    contents: IContent[],
    schema: Record<string, unknown>,
    options?: GenerateJsonOptions
  ): Promise<T> {
    // Implementation with retry logic and JSON extraction
  }

  async generateEmbedding(
    texts: string[],
    options?: EmbeddingOptions
  ): Promise<number[][]> {
    // Implementation with provider selection
  }

  async generateContent(
    contents: IContent[],
    options?: GenerateContentOptions
  ): Promise<IGenerateContentResponse> {
    // Implementation with token tracking
  }

  async countTokens(
    contents: IContent[],
    options?: CountTokensOptions
  ): Promise<ICountTokensResponse> {
    // Implementation with caching
  }
}
```

### Step 4: Create Provider Adapters
**Files:**
- `/packages/core/src/providers/adapters/AnthropicUtilityAdapter.ts`
- `/packages/core/src/providers/adapters/OpenAIUtilityAdapter.ts`
- `/packages/core/src/providers/adapters/GeminiUtilityAdapter.ts`
- `/packages/core/src/providers/adapters/BaseUtilityAdapter.ts`

**Actions:**
1. Create base adapter with common functionality
2. Implement provider-specific adapters
3. Handle format conversions between IContent and provider formats
4. Implement error mapping

### Step 5: Refactor client.ts
**File:** `/packages/core/src/core/client.ts`

**Changes:**
1. Add baseLLMClient as dependency
2. Delegate utility methods to baseLLMClient
3. Maintain backward compatibility
4. Keep conversation-specific logic in client.ts

```typescript
export class GeminiClient {
  private baseLLMClient: IBaseLLMClient;

  constructor(...) {
    this.baseLLMClient = new BaseLLMClient(this.config, this.providerManager);
  }

  async generateJson(...): Promise<...> {
    // Delegate to baseLLMClient
    return this.baseLLMClient.generateJson(contents, schema, {
      model,
      abortSignal,
      provider: this.getCurrentProvider(),
    });
  }

  async generateEmbedding(...): Promise<...> {
    // Delegate to baseLLMClient
    return this.baseLLMClient.generateEmbedding(texts, {
      model: this.embeddingModel,
      provider: this.getCurrentProvider(),
    });
  }
}
```

### Step 6: Update Call Sites
**Files to Update:**
- `/packages/core/src/utils/llm-edit-fixer.ts`
- `/packages/core/src/utils/summarizer.ts`
- `/packages/core/src/services/complexity-analyzer.ts`
- Any other files using utility methods

**Actions:**
1. Update imports if needed
2. Ensure backward compatibility
3. Add provider hints where beneficial

### Step 7: Add Telemetry and Logging
**Files:**
- `/packages/core/src/core/baseLLMClient.ts`
- `/packages/core/src/providers/adapters/*.ts`

**Actions:**
1. Add debug logging for provider selection
2. Track utility call metrics
3. Log retry attempts
4. Monitor token usage

## 5. Migration Plan

### Phase 1: Parallel Implementation (Week 1)
- Create baseLLMClient alongside existing implementation
- No changes to existing code
- Full test coverage for new code

### Phase 2: Internal Testing (Week 2)
- Create feature flag for baseLLMClient usage
- Test with internal tools (llm-edit-fixer, summarizer)
- Monitor performance and accuracy

### Phase 3: Gradual Migration (Week 3)
- Update client.ts to delegate to baseLLMClient
- One method at a time:
  1. generateJson (most used)
  2. generateContent
  3. generateEmbedding
  4. countTokens

### Phase 4: Cleanup (Week 4)
- Remove duplicated code from client.ts
- Update documentation
- Remove feature flags

### Files Requiring Updates:
```
packages/core/src/core/client.ts - Refactor to use baseLLMClient
packages/core/src/utils/llm-edit-fixer.ts - No change (backward compatible)
packages/core/src/utils/summarizer.ts - No change (backward compatible)
packages/core/src/services/complexity-analyzer.ts - Optional: use baseLLMClient directly
packages/core/src/core/coreToolScheduler.ts - May need import updates
packages/core/src/tools/web-fetch.ts - Check for any utility usage
packages/core/src/tools/web-search-invocation.ts - Check for any utility usage
```

## 6. Success Criteria

- ✅ All existing tests pass without modification
- ✅ New baseLLMClient tests achieve 95%+ coverage
- ✅ Works with all current providers (Anthropic, OpenAI, Gemini, Vertex)
- ✅ No regression in performance (measured by benchmarks)
- ✅ client.ts is simplified (removes ~400 lines of utility code)
- ✅ Clear separation between stateful and stateless operations
- ✅ Provider switching works seamlessly
- ✅ Error messages are clear and actionable
- ✅ Telemetry captures utility usage metrics
- ✅ Documentation is complete and accurate

## 7. Risk Mitigation

### Risk: Breaking Changes
**Mitigation:**
- Maintain backward compatibility through delegation
- Extensive test coverage before any refactoring
- Feature flags for gradual rollout

### Risk: Provider Incompatibilities
**Mitigation:**
- Abstract provider differences in adapters
- Fallback to estimation for unsupported operations
- Clear capability checking

### Risk: Performance Degradation
**Mitigation:**
- Benchmark before and after
- Cache provider instances
- Optimize hot paths

### Risk: Complex Migration
**Mitigation:**
- Incremental approach
- Parallel implementation
- Automated testing at each step

## 8. Future Enhancements

1. **Streaming Support**: Add streaming variants of utility methods
2. **Batch Operations**: Optimize for batch JSON generation
3. **Response Caching**: Cache identical requests
4. **Provider Routing**: Smart routing based on task type
5. **Cost Optimization**: Route to cheaper providers when possible
6. **Fallback Chains**: Multiple fallback providers
7. **Response Validation**: Schema validation for all responses
8. **Observability**: OpenTelemetry integration

## Appendix A: Provider Capabilities Matrix

| Provider   | generateJson | generateEmbedding | countTokens | Streaming |
|-----------|-------------|------------------|-------------|-----------|
| Anthropic | ✅ (via tools) | ❌ | ✅ (estimation) | ✅ |
| OpenAI    | ✅ (JSON mode) | ✅ | ✅ | ✅ |
| Gemini    | ✅ (responseJsonSchema) | ✅ | ✅ | ✅ |
| Vertex    | ✅ | ✅ | ✅ | ✅ |

## Appendix B: File Structure

```
packages/core/src/core/
├── baseLLMClient.ts              # Main implementation
├── baseLLMClient.test.ts         # Unit tests
├── baseLLMClient.types.ts        # Type definitions
├── IBaseLLMClient.ts             # Public interface
├── IUtilityLLMProvider.ts       # Provider interface
└── providers/
    └── adapters/
        ├── BaseUtilityAdapter.ts      # Base class
        ├── AnthropicUtilityAdapter.ts # Anthropic implementation
        ├── OpenAIUtilityAdapter.ts    # OpenAI implementation
        ├── GeminiUtilityAdapter.ts    # Gemini implementation
        └── __tests__/
            ├── AnthropicUtilityAdapter.test.ts
            ├── OpenAIUtilityAdapter.test.ts
            └── GeminiUtilityAdapter.test.ts
```