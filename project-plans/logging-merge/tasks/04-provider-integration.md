# Task 04: Provider Integration

**Phase:** Multi-Provider Implementation  
**Duration:** 2-3 days  
**Assignee:** Provider Systems Specialist Subagent  
**Dependencies:** Task 03 (Privacy Controls) must be complete and tested

## Objective

Integrate conversation logging into all existing provider implementations to ensure consistent logging behavior across Gemini, OpenAI, and Anthropic providers. Add provider-specific logging hooks, metadata capture, and ensure seamless operation with the existing multi-provider architecture.

## Provider Integration Requirements

### 1. Consistent Multi-Provider Behavior
- All providers should log conversations identically at the IProvider interface level
- Provider-specific metadata (models, tool formats, etc.) should be captured
- Provider switching should be tracked with context preservation analysis
- Tool call formats should be normalized for consistent logging

### 2. Provider-Specific Optimizations
- Each provider has unique response streaming patterns that need specific handling
- Provider-specific error patterns should be captured
- Tool format variations (OpenAI functions, Anthropic tools, Gemini functions) handled
- Provider authentication patterns should be logged (without credentials)

## Implementation Requirements

### 1. Enhance Provider-Specific Content Extraction
**File:** `packages/core/src/providers/LoggingProviderWrapper.ts`

Update the content extraction to handle all provider formats properly:

```typescript
// Update the existing extractContentFromChunk method
private extractContentFromChunk(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') {
    return '';
  }

  try {
    // Handle Gemini format
    if ('candidates' in chunk && Array.isArray((chunk as any).candidates)) {
      return this.extractGeminiContent(chunk);
    }
    
    // Handle OpenAI format
    if ('choices' in chunk && Array.isArray((chunk as any).choices)) {
      return this.extractOpenAIContent(chunk);
    }
    
    // Handle Anthropic format
    if ('type' in chunk) {
      return this.extractAnthropicContent(chunk);
    }

    // Fallback: try to extract any text content
    return this.extractGenericContent(chunk);
  } catch (error) {
    console.warn('Error extracting content from chunk:', error);
    return '';
  }
}

private extractGeminiContent(chunk: any): string {
  const candidate = chunk.candidates?.[0];
  if (!candidate) return '';

  // Handle text content
  if (candidate.content?.parts) {
    const textParts = candidate.content.parts
      .filter((part: any) => part.text)
      .map((part: any) => part.text);
    return textParts.join('');
  }

  return '';
}

private extractOpenAIContent(chunk: any): string {
  const choice = chunk.choices?.[0];
  if (!choice) return '';

  // Handle streaming content
  if (choice.delta?.content) {
    return choice.delta.content;
  }

  // Handle complete content
  if (choice.message?.content) {
    return choice.message.content;
  }

  return '';
}

private extractAnthropicContent(chunk: any): string {
  // Handle different Anthropic event types
  switch (chunk.type) {
    case 'content_block_delta':
      return chunk.delta?.text || '';
    case 'content_block_start':
      return chunk.content_block?.text || '';
    case 'message_delta':
      return chunk.delta?.text || '';
    default:
      return '';
  }
}

private extractGenericContent(chunk: any): string {
  // Try common content patterns
  if (chunk.text) return chunk.text;
  if (chunk.content) return chunk.content;
  if (chunk.message) return chunk.message;
  if (chunk.delta?.text) return chunk.delta.text;
  
  return '';
}

// Add method to extract tool calls from chunks
private extractToolCallsFromChunk(chunk: unknown): ToolCall[] {
  if (!chunk || typeof chunk !== 'object') {
    return [];
  }

  try {
    // Handle Gemini function calls
    if ('candidates' in chunk) {
      return this.extractGeminiToolCalls(chunk);
    }
    
    // Handle OpenAI function calls
    if ('choices' in chunk) {
      return this.extractOpenAIToolCalls(chunk);
    }
    
    // Handle Anthropic tool use
    if ('type' in chunk) {
      return this.extractAnthropicToolCalls(chunk);
    }

    return [];
  } catch (error) {
    console.warn('Error extracting tool calls from chunk:', error);
    return [];
  }
}

private extractGeminiToolCalls(chunk: any): ToolCall[] {
  const candidate = chunk.candidates?.[0];
  if (!candidate?.content?.parts) return [];

  return candidate.content.parts
    .filter((part: any) => part.functionCall)
    .map((part: any) => ({
      provider: 'gemini',
      name: part.functionCall.name,
      arguments: part.functionCall.args,
      id: part.functionCall.id || this.generateToolCallId()
    }));
}

private extractOpenAIToolCalls(chunk: any): ToolCall[] {
  const choice = chunk.choices?.[0];
  if (!choice) return [];

  // Handle streaming tool calls
  if (choice.delta?.tool_calls) {
    return choice.delta.tool_calls.map((call: any) => ({
      provider: 'openai',
      name: call.function?.name,
      arguments: call.function?.arguments,
      id: call.id
    }));
  }

  // Handle complete tool calls
  if (choice.message?.tool_calls) {
    return choice.message.tool_calls.map((call: any) => ({
      provider: 'openai',
      name: call.function.name,
      arguments: JSON.parse(call.function.arguments || '{}'),
      id: call.id
    }));
  }

  return [];
}

private extractAnthropicToolCalls(chunk: any): ToolCall[] {
  if (chunk.type === 'tool_use') {
    return [{
      provider: 'anthropic',
      name: chunk.name,
      arguments: chunk.input,
      id: chunk.id
    }];
  }

  return [];
}

private generateToolCallId(): string {
  return `tc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

interface ToolCall {
  provider: string;
  name: string;
  arguments: any;
  id: string;
}
```

### 2. Add Provider Context Tracking
**File:** `packages/core/src/providers/LoggingProviderWrapper.ts`

Add enhanced provider context tracking:

```typescript
// Add to LoggingProviderWrapper class
private providerContext: ProviderContext;

constructor(
  private readonly wrapped: IProvider,
  private readonly config: Config,
) {
  this.conversationId = this.generateConversationId();
  this.privacyManager = new PrivacyManager(config);
  this.providerContext = this.initializeProviderContext();
}

private initializeProviderContext(): ProviderContext {
  return {
    providerName: this.wrapped.name,
    currentModel: this.wrapped.getCurrentModel?.() || 'unknown',
    toolFormat: this.wrapped.getToolFormat?.() || 'unknown',
    isPaidMode: this.wrapped.isPaidMode?.() || false,
    capabilities: this.getProviderCapabilities(),
    sessionStartTime: Date.now()
  };
}

private getProviderCapabilities(): ProviderCapabilities {
  return {
    supportsStreaming: true, // All current providers support streaming
    supportsTools: this.wrapped.getServerTools().length > 0,
    supportsVision: this.providerSupportsVision(),
    maxTokens: this.getProviderMaxTokens(),
    supportedFormats: this.getSupportedToolFormats()
  };
}

private providerSupportsVision(): boolean {
  // Provider-specific vision support detection
  switch (this.wrapped.name) {
    case 'gemini':
      return true; // Gemini supports vision
    case 'openai':
      return this.providerContext.currentModel?.includes('vision') || 
             this.providerContext.currentModel?.includes('gpt-4') || false;
    case 'anthropic':
      return this.providerContext.currentModel?.includes('claude-3') || false;
    default:
      return false;
  }
}

private getProviderMaxTokens(): number {
  // Provider and model-specific token limits
  switch (this.wrapped.name) {
    case 'gemini':
      if (this.providerContext.currentModel?.includes('pro')) return 32768;
      if (this.providerContext.currentModel?.includes('flash')) return 8192;
      return 8192;
    case 'openai':
      if (this.providerContext.currentModel?.includes('gpt-4')) return 8192;
      if (this.providerContext.currentModel?.includes('gpt-3.5')) return 4096;
      return 4096;
    case 'anthropic':
      if (this.providerContext.currentModel?.includes('claude-3')) return 200000;
      return 100000;
    default:
      return 4096;
  }
}

private getSupportedToolFormats(): string[] {
  switch (this.wrapped.name) {
    case 'gemini':
      return ['function_calling', 'gemini_tools'];
    case 'openai':
      return ['function_calling', 'json_schema', 'hermes'];
    case 'anthropic':
      return ['xml_tools', 'anthropic_tools'];
    default:
      return [];
  }
}

// Update provider context when relevant changes occur
private updateProviderContext(): void {
  this.providerContext.currentModel = this.wrapped.getCurrentModel?.() || 'unknown';
  this.providerContext.toolFormat = this.wrapped.getToolFormat?.() || 'unknown';
  this.providerContext.isPaidMode = this.wrapped.isPaidMode?.() || false;
}

interface ProviderContext {
  providerName: string;
  currentModel: string;
  toolFormat: string;
  isPaidMode: boolean;
  capabilities: ProviderCapabilities;
  sessionStartTime: number;
}

interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  maxTokens: number;
  supportedFormats: string[];
}
```

### 3. Add Provider Performance Tracking
**File:** `packages/core/src/providers/LoggingProviderWrapper.ts`

Add performance tracking for provider comparison:

```typescript
// Add to LoggingProviderWrapper class
private performanceTracker: ProviderPerformanceTracker;

constructor(
  private readonly wrapped: IProvider,
  private readonly config: Config,
) {
  // ... existing initialization ...
  this.performanceTracker = new ProviderPerformanceTracker(this.wrapped.name);
}

private async logResponseStream(
  stream: AsyncIterableIterator<unknown>,
  promptId: string
): AsyncIterableIterator<unknown> {
  const startTime = performance.now();
  let firstTokenTime: number | null = null;
  let tokenCount = 0;
  let chunkCount = 0;
  let responseContent = '';
  let toolCalls: ToolCall[] = [];
  let responseComplete = false;

  try {
    for await (const chunk of stream) {
      chunkCount++;
      
      // Mark first token time
      if (firstTokenTime === null) {
        firstTokenTime = performance.now();
      }

      // Extract content and tool calls
      const content = this.extractContentFromChunk(chunk);
      if (content) {
        responseContent += content;
        tokenCount += this.estimateTokenCount(content);
      }

      const chunkToolCalls = this.extractToolCallsFromChunk(chunk);
      if (chunkToolCalls.length > 0) {
        toolCalls.push(...chunkToolCalls);
      }

      // Track streaming performance
      this.performanceTracker.recordChunk(chunkCount, content.length);

      yield chunk;
    }
    responseComplete = true;
  } catch (error) {
    const errorTime = performance.now();
    this.performanceTracker.recordError(errorTime - startTime, String(error));
    await this.logResponse('', promptId, errorTime - startTime, false, error);
    throw error;
  }

  if (responseComplete) {
    const totalTime = performance.now() - startTime;
    const timeToFirstToken = firstTokenTime ? firstTokenTime - startTime : null;
    
    // Record performance metrics
    this.performanceTracker.recordCompletion(
      totalTime,
      timeToFirstToken,
      tokenCount,
      chunkCount
    );

    await this.logResponse(
      responseContent, 
      promptId, 
      totalTime, 
      true, 
      undefined,
      toolCalls,
      this.performanceTracker.getLatestMetrics()
    );
  }
}

private estimateTokenCount(text: string): number {
  // Rough token estimation (actual tokenization would be provider-specific)
  return Math.ceil(text.length / 4); // Approximate tokens per character
}

// Update logResponse method to include performance data
private async logResponse(
  content: string,
  promptId: string,
  duration: number,
  success: boolean,
  error?: unknown,
  toolCalls?: ToolCall[],
  performanceMetrics?: ProviderPerformanceMetrics
): Promise<void> {
  try {
    const redactedContent = this.privacyManager.getRedactor()
      .redactResponseContent(content, this.wrapped.name);

    const event = new EnhancedConversationResponseEvent(
      this.wrapped.name,
      this.conversationId,
      this.turnNumber,
      promptId,
      redactedContent,
      duration,
      success,
      error ? String(error) : undefined,
      toolCalls,
      performanceMetrics,
      this.providerContext
    );

    logConversationResponse(this.config, event);
  } catch (logError) {
    console.warn('Failed to log conversation response:', logError);
  }
}

class ProviderPerformanceTracker {
  private metrics: ProviderPerformanceMetrics;
  
  constructor(private providerName: string) {
    this.metrics = this.initializeMetrics();
  }

  private initializeMetrics(): ProviderPerformanceMetrics {
    return {
      providerName: this.providerName,
      totalRequests: 0,
      totalTokens: 0,
      averageLatency: 0,
      timeToFirstToken: null,
      tokensPerSecond: 0,
      chunksReceived: 0,
      errorRate: 0,
      errors: []
    };
  }

  recordChunk(chunkNumber: number, contentLength: number): void {
    // Track streaming performance
    this.metrics.chunksReceived = chunkNumber;
  }

  recordCompletion(
    totalTime: number,
    timeToFirstToken: number | null,
    tokenCount: number,
    chunkCount: number
  ): void {
    this.metrics.totalRequests++;
    this.metrics.totalTokens += tokenCount;
    this.metrics.averageLatency = 
      (this.metrics.averageLatency * (this.metrics.totalRequests - 1) + totalTime) / 
      this.metrics.totalRequests;
    
    if (timeToFirstToken !== null) {
      this.metrics.timeToFirstToken = timeToFirstToken;
    }
    
    if (totalTime > 0) {
      this.metrics.tokensPerSecond = tokenCount / (totalTime / 1000);
    }
  }

  recordError(duration: number, error: string): void {
    this.metrics.errors.push({ 
      timestamp: Date.now(), 
      duration, 
      error: error.substring(0, 200) // Truncate long errors
    });
    
    // Update error rate
    const totalAttempts = this.metrics.totalRequests + 1;
    this.metrics.errorRate = this.metrics.errors.length / totalAttempts;
  }

  getLatestMetrics(): ProviderPerformanceMetrics {
    return { ...this.metrics };
  }
}

interface ProviderPerformanceMetrics {
  providerName: string;
  totalRequests: number;
  totalTokens: number;
  averageLatency: number;
  timeToFirstToken: number | null;
  tokensPerSecond: number;
  chunksReceived: number;
  errorRate: number;
  errors: Array<{ timestamp: number; duration: number; error: string }>;
}
```

### 4. Update Telemetry Events for Enhanced Provider Data
**File:** `packages/core/src/telemetry/types.ts`

Add enhanced event types with provider-specific data:

```typescript
// Add to existing telemetry types

export class EnhancedConversationResponseEvent extends ConversationResponseEvent {
  provider_context: ProviderContext;
  performance_metrics: ProviderPerformanceMetrics;
  tool_calls: ToolCall[];
  
  constructor(
    provider_name: string,
    conversation_id: string,
    turn_number: number,
    prompt_id: string,
    redacted_content: string,
    duration_ms: number,
    success: boolean,
    error?: string,
    tool_calls?: ToolCall[],
    performance_metrics?: ProviderPerformanceMetrics,
    provider_context?: ProviderContext
  ) {
    super(
      provider_name,
      conversation_id,
      turn_number,
      prompt_id,
      redacted_content,
      duration_ms,
      success,
      error
    );
    
    this.tool_calls = tool_calls || [];
    this.performance_metrics = performance_metrics || this.createDefaultMetrics(provider_name);
    this.provider_context = provider_context || this.createDefaultContext(provider_name);
  }

  private createDefaultMetrics(providerName: string): ProviderPerformanceMetrics {
    return {
      providerName,
      totalRequests: 0,
      totalTokens: 0,
      averageLatency: 0,
      timeToFirstToken: null,
      tokensPerSecond: 0,
      chunksReceived: 0,
      errorRate: 0,
      errors: []
    };
  }

  private createDefaultContext(providerName: string): ProviderContext {
    return {
      providerName,
      currentModel: 'unknown',
      toolFormat: 'unknown',
      isPaidMode: false,
      capabilities: {
        supportsStreaming: true,
        supportsTools: false,
        supportsVision: false,
        maxTokens: 4096,
        supportedFormats: []
      },
      sessionStartTime: Date.now()
    };
  }
}

export class ProviderCapabilityEvent {
  'event.name': 'provider_capability';
  'event.timestamp': string;
  provider_name: string;
  capabilities: ProviderCapabilities;
  context: ProviderContext;

  constructor(
    provider_name: string,
    capabilities: ProviderCapabilities,
    context: ProviderContext
  ) {
    this['event.name'] = 'provider_capability';
    this['event.timestamp'] = new Date().toISOString();
    this.provider_name = provider_name;
    this.capabilities = capabilities;
    this.context = context;
  }
}

// Update the TelemetryEvent union type
export type TelemetryEvent =
  | StartSessionEvent
  | EndSessionEvent
  | UserPromptEvent
  | ToolCallEvent
  | ApiRequestEvent
  | ApiErrorEvent
  | ApiResponseEvent
  | FlashFallbackEvent
  | LoopDetectedEvent
  | NextSpeakerCheckEvent
  | SlashCommandEvent
  | MalformedJsonResponseEvent
  | ConversationRequestEvent
  | ConversationResponseEvent
  | EnhancedConversationResponseEvent
  | ProviderSwitchEvent
  | ProviderCapabilityEvent;
```

### 5. Enhance ProviderManager for Better Context Tracking
**File:** `packages/core/src/providers/ProviderManager.ts`

Update ProviderManager to track provider switches and capabilities:

```typescript
// Add to existing ProviderManager class
import { 
  logProviderSwitch, 
  logProviderCapability 
} from '../telemetry/loggers.js';
import { 
  ProviderSwitchEvent, 
  ProviderCapabilityEvent 
} from '../telemetry/types.js';

export class ProviderManager implements IProviderManager {
  // ... existing properties ...
  private providerCapabilities: Map<string, ProviderCapabilities> = new Map();
  private currentConversationId?: string;

  // Enhance registerProvider method
  registerProvider(provider: IProvider): void {
    // Wrap provider with logging if conversation logging is enabled
    let finalProvider = provider;
    if (this.config?.getConversationLoggingEnabled()) {
      finalProvider = new LoggingProviderWrapper(provider, this.config);
    }

    this.providers.set(provider.name, finalProvider);

    // Capture provider capabilities
    const capabilities = this.captureProviderCapabilities(provider);
    this.providerCapabilities.set(provider.name, capabilities);

    // Log provider capability information if logging enabled
    if (this.config?.getConversationLoggingEnabled()) {
      const context = this.createProviderContext(provider, capabilities);
      logProviderCapability(this.config, new ProviderCapabilityEvent(
        provider.name,
        capabilities,
        context
      ));
    }

    // ... existing registerProvider logic ...
  }

  // Enhanced setActiveProvider method
  setActiveProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider '${name}' not found`);
    }

    const previousProviderName = this.activeProviderName;
    const newProvider = this.providers.get(name)!;

    // ... existing provider switching logic ...

    // Generate conversation ID for this session if not exists
    if (!this.currentConversationId) {
      this.currentConversationId = this.generateConversationId();
    }

    // Log provider switch with enhanced context
    if (this.config?.getConversationLoggingEnabled() && 
        previousProviderName && 
        previousProviderName !== name) {
      
      const contextPreserved = this.analyzeContextPreservation(
        previousProviderName, 
        name
      );
      
      logProviderSwitch(this.config, new ProviderSwitchEvent(
        previousProviderName,
        name,
        this.currentConversationId,
        contextPreserved
      ));
    }

    this.activeProviderName = name;
    // ... rest of existing method ...
  }

  private captureProviderCapabilities(provider: IProvider): ProviderCapabilities {
    return {
      supportsStreaming: true, // All current providers support streaming
      supportsTools: provider.getServerTools().length > 0,
      supportsVision: this.detectVisionSupport(provider),
      maxTokens: this.getProviderMaxTokens(provider),
      supportedFormats: this.getSupportedToolFormats(provider),
      hasModelSelection: typeof provider.setModel === 'function',
      hasApiKeyConfig: typeof provider.setApiKey === 'function',
      hasBaseUrlConfig: typeof provider.setBaseUrl === 'function',
      supportsPaidMode: typeof provider.isPaidMode === 'function'
    };
  }

  private detectVisionSupport(provider: IProvider): boolean {
    // Provider-specific vision detection logic
    switch (provider.name) {
      case 'gemini':
        return true;
      case 'openai':
        const model = provider.getCurrentModel?.() || '';
        return model.includes('vision') || model.includes('gpt-4');
      case 'anthropic':
        const claudeModel = provider.getCurrentModel?.() || '';
        return claudeModel.includes('claude-3');
      default:
        return false;
    }
  }

  private getProviderMaxTokens(provider: IProvider): number {
    const model = provider.getCurrentModel?.() || '';
    
    switch (provider.name) {
      case 'gemini':
        if (model.includes('pro')) return 32768;
        if (model.includes('flash')) return 8192;
        return 8192;
      case 'openai':
        if (model.includes('gpt-4')) return 8192;
        if (model.includes('gpt-3.5')) return 4096;
        return 4096;
      case 'anthropic':
        if (model.includes('claude-3')) return 200000;
        return 100000;
      default:
        return 4096;
    }
  }

  private getSupportedToolFormats(provider: IProvider): string[] {
    switch (provider.name) {
      case 'gemini':
        return ['function_calling', 'gemini_tools'];
      case 'openai':
        return ['function_calling', 'json_schema', 'hermes'];
      case 'anthropic':
        return ['xml_tools', 'anthropic_tools'];
      default:
        return [];
    }
  }

  private createProviderContext(
    provider: IProvider, 
    capabilities: ProviderCapabilities
  ): ProviderContext {
    return {
      providerName: provider.name,
      currentModel: provider.getCurrentModel?.() || 'unknown',
      toolFormat: provider.getToolFormat?.() || 'unknown',
      isPaidMode: provider.isPaidMode?.() || false,
      capabilities,
      sessionStartTime: Date.now()
    };
  }

  private analyzeContextPreservation(
    fromProvider: string, 
    toProvider: string
  ): boolean {
    // Analyze whether context can be preserved between providers
    const fromCapabilities = this.providerCapabilities.get(fromProvider);
    const toCapabilities = this.providerCapabilities.get(toProvider);

    if (!fromCapabilities || !toCapabilities) {
      return false; // Can't analyze without capabilities
    }

    // Context is better preserved between providers with similar capabilities
    const capabilityScore = this.calculateCapabilityCompatibility(
      fromCapabilities, 
      toCapabilities
    );

    // Context is considered preserved if compatibility is high
    return capabilityScore > 0.7;
  }

  private calculateCapabilityCompatibility(
    from: ProviderCapabilities, 
    to: ProviderCapabilities
  ): number {
    let score = 0;
    let totalChecks = 0;

    // Check tool support compatibility
    totalChecks++;
    if (from.supportsTools === to.supportsTools) score++;

    // Check vision support compatibility
    totalChecks++;
    if (from.supportsVision === to.supportsVision) score++;

    // Check streaming compatibility (all providers support streaming currently)
    totalChecks++;
    if (from.supportsStreaming === to.supportsStreaming) score++;

    // Check tool format compatibility
    totalChecks++;
    const hasCommonFormats = from.supportedFormats.some(format =>
      to.supportedFormats.includes(format)
    );
    if (hasCommonFormats) score++;

    return score / totalChecks;
  }

  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Add getter for current conversation ID
  getCurrentConversationId(): string {
    if (!this.currentConversationId) {
      this.currentConversationId = this.generateConversationId();
    }
    return this.currentConversationId;
  }

  // Add method to reset conversation context
  resetConversationContext(): void {
    this.currentConversationId = this.generateConversationId();
  }

  // Add method to get provider capabilities
  getProviderCapabilities(providerName?: string): ProviderCapabilities | undefined {
    const name = providerName || this.activeProviderName;
    return this.providerCapabilities.get(name);
  }

  // Add method to compare providers
  compareProviders(provider1: string, provider2: string): ProviderComparison {
    const cap1 = this.providerCapabilities.get(provider1);
    const cap2 = this.providerCapabilities.get(provider2);

    if (!cap1 || !cap2) {
      throw new Error('Cannot compare providers: capabilities not available');
    }

    return {
      provider1: provider1,
      provider2: provider2,
      capabilities: {
        [provider1]: cap1,
        [provider2]: cap2
      },
      compatibility: this.calculateCapabilityCompatibility(cap1, cap2),
      recommendation: this.generateProviderRecommendation(cap1, cap2)
    };
  }

  private generateProviderRecommendation(
    cap1: ProviderCapabilities, 
    cap2: ProviderCapabilities
  ): string {
    if (cap1.maxTokens > cap2.maxTokens) {
      return `${cap1} supports longer contexts (${cap1.maxTokens} vs ${cap2.maxTokens} tokens)`;
    }
    
    if (cap1.supportsVision && !cap2.supportsVision) {
      return `${cap1} supports vision capabilities`;
    }
    
    if (cap1.supportedFormats.length > cap2.supportedFormats.length) {
      return `${cap1} supports more tool formats`;
    }
    
    return 'Providers have similar capabilities';
  }
}

interface ProviderComparison {
  provider1: string;
  provider2: string;
  capabilities: Record<string, ProviderCapabilities>;
  compatibility: number;
  recommendation: string;
}
```

### 6. Update Enhanced Capabilities Interface
**File:** `packages/core/src/providers/types.ts`

Add enhanced provider capability definitions:

```typescript
// Add to existing types file or create new one

export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  maxTokens: number;
  supportedFormats: string[];
  hasModelSelection?: boolean;
  hasApiKeyConfig?: boolean;
  hasBaseUrlConfig?: boolean;
  supportsPaidMode?: boolean;
}

export interface ProviderContext {
  providerName: string;
  currentModel: string;
  toolFormat: string;
  isPaidMode: boolean;
  capabilities: ProviderCapabilities;
  sessionStartTime: number;
}

export interface ToolCall {
  provider: string;
  name: string;
  arguments: any;
  id: string;
}

export interface ProviderPerformanceMetrics {
  providerName: string;
  totalRequests: number;
  totalTokens: number;
  averageLatency: number;
  timeToFirstToken: number | null;
  tokensPerSecond: number;
  chunksReceived: number;
  errorRate: number;
  errors: Array<{ timestamp: number; duration: number; error: string }>;
}
```

## Testing Integration

### Provider-Specific Tests
Ensure all provider integration tests pass:

```bash
npm test packages/core/src/providers/LoggingProviderWrapper.test.ts
npm test packages/core/src/providers/ProviderManager.test.ts
```

### Multi-Provider Integration Tests
Run integration tests across all providers:

```bash
npm test packages/core/src/providers/multi-provider-logging.integration.test.ts
```

### Performance Tests
Validate performance impact across all providers:

```bash
npm test packages/core/src/telemetry/conversation-logging-performance.test.ts
```

## Acceptance Criteria

### Multi-Provider Support
- [ ] All provider types (Gemini, OpenAI, Anthropic) work with logging wrapper
- [ ] Provider-specific content extraction works correctly for each provider
- [ ] Tool calls are captured correctly regardless of provider format
- [ ] Provider switching is tracked with accurate context analysis
- [ ] Provider capabilities are correctly detected and logged

### Performance Tracking
- [ ] Response streaming performance is measured for all providers
- [ ] Token counting estimation works reasonably across providers
- [ ] Time-to-first-token is captured for all providers
- [ ] Error rates are tracked per provider
- [ ] Performance comparison between providers is possible

### Context Preservation
- [ ] Provider switches preserve conversation context where possible
- [ ] Context compatibility analysis is accurate
- [ ] Provider capability comparison works correctly
- [ ] Conversation IDs are maintained across provider switches
- [ ] Tool format compatibility is properly assessed

### Integration Quality
- [ ] No regressions in existing provider functionality
- [ ] Logging wrapper adds minimal overhead to provider operations
- [ ] Provider-specific optimizations don't break common interface
- [ ] All provider tests continue to pass
- [ ] Enhanced telemetry events are properly structured

## Task Completion Criteria

This task is complete when:

1. **Provider Integration Complete**: All providers work seamlessly with logging
2. **Content Extraction Works**: Provider-specific response parsing is accurate
3. **Performance Tracking Active**: All performance metrics are captured
4. **Context Analysis Functional**: Provider switching context is properly analyzed
5. **Tests Pass**: All integration and performance tests pass
6. **No Regressions**: Existing provider functionality is preserved

The next task (05-testing-and-validation) should not begin until all provider integrations are complete and tested.