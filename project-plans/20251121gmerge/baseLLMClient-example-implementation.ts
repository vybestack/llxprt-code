/**
 * Example implementation of baseLLMClient demonstrating clean architecture principles
 * This follows SOLID principles with dependency injection, single responsibility, and clear abstractions
 */

import { IBaseLLMClient } from './IBaseLLMClient';
import { IUtilityLLMProvider, UtilityOperation } from './IUtilityLLMProvider';
import {
  GenerateJsonOptions,
  EmbeddingOptions,
  GenerateContentOptions,
  CountTokensOptions,
  IGenerateContentResponse,
  ICountTokensResponse,
  ProviderConfig,
} from './baseLLMClient.types';
import { IContent } from '../services/history/IContent';
import { Config } from '../config/config';
import { IProviderManager } from '../providers/IProviderManager';
import { retryWithBackoff } from '../utils/retry';
import { DebugLogger } from '../debug/index';
import { reportError } from '../utils/errorReporting';

/**
 * Stateless utility class for LLM operations
 * Follows Single Responsibility Principle: Only handles stateless utility operations
 */
export class BaseLLMClient implements IBaseLLMClient {
  private readonly providers: Map<string, IUtilityLLMProvider> = new Map();
  private readonly logger: DebugLogger;
  private readonly defaultProvider: string;
  private readonly tokenCountCache: Map<string, ICountTokensResponse> = new Map();

  constructor(
    private readonly config: Config,
    private readonly providerManager: IProviderManager,
    private readonly providerAdapterFactory?: IProviderAdapterFactory,
  ) {
    this.logger = new DebugLogger('baseLLMClient');
    this.defaultProvider = this.config.getProvider() || 'gemini';
    this.initializeProviders();
  }

  /**
   * Initialize provider adapters using Dependency Injection
   * This allows for easy testing and provider addition
   */
  private initializeProviders(): void {
    const factory = this.providerAdapterFactory || new DefaultProviderAdapterFactory();

    // Register adapters for each available provider
    const availableProviders = this.providerManager.listProviders();

    for (const providerName of availableProviders) {
      const adapter = factory.createAdapter(providerName, this.providerManager);
      if (adapter) {
        this.providers.set(providerName, adapter);
        this.logger.debug(() => `Registered adapter for provider: ${providerName}`);
      }
    }
  }

  /**
   * Generate structured JSON from content
   * Demonstrates: Error handling, retry logic, response normalization
   */
  async generateJson<T = Record<string, unknown>>(
    contents: IContent[],
    schema: Record<string, unknown>,
    options?: GenerateJsonOptions
  ): Promise<T> {
    const provider = await this.getProvider(options?.provider, UtilityOperation.GENERATE_JSON);
    const config = this.buildProviderConfig(options);

    this.logger.debug(() =>
      `Generating JSON with provider ${provider.name}, model ${config.model}`
    );

    try {
      const apiCall = async () => {
        const rawResponse = await provider.generateJson<T>(contents, schema, config);
        return this.normalizeJsonResponse<T>(rawResponse, schema);
      };

      const result = await retryWithBackoff(
        apiCall,
        options?.maxRetries || 3,
        options?.abortSignal
      );

      this.logger.debug(() => `Successfully generated JSON with ${provider.name}`);
      return result;

    } catch (error) {
      // Enhanced error with context for debugging
      const enhancedError = this.enhanceError(
        error,
        'generateJson',
        provider.name,
        config.model
      );

      await reportError(
        enhancedError,
        `Failed to generate JSON with provider ${provider.name}`,
        { contents, schema, options },
        'baseLLMClient-generateJson'
      );

      // Try fallback provider if available
      if (options?.provider && options.provider !== this.defaultProvider) {
        this.logger.warn(() =>
          `Provider ${options.provider} failed, falling back to ${this.defaultProvider}`
        );
        return this.generateJson(contents, schema, {
          ...options,
          provider: this.defaultProvider,
        });
      }

      throw enhancedError;
    }
  }

  /**
   * Generate embeddings for text
   * Demonstrates: Batching, capability checking, provider-specific handling
   */
  async generateEmbedding(
    texts: string[],
    options?: EmbeddingOptions
  ): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const provider = await this.getProvider(options?.provider, UtilityOperation.GENERATE_EMBEDDING);
    const config = this.buildProviderConfig(options);

    // Batch texts if needed (provider-specific limits)
    const batchSize = this.getProviderBatchSize(provider.name);
    const batches = this.batchArray(texts, batchSize);

    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
      try {
        const embeddings = await provider.generateEmbedding(batch, config);
        allEmbeddings.push(...embeddings);
      } catch (error) {
        const enhancedError = this.enhanceError(
          error,
          'generateEmbedding',
          provider.name,
          config.model
        );

        await reportError(
          enhancedError,
          `Failed to generate embeddings with provider ${provider.name}`,
          { batchSize: batch.length, options },
          'baseLLMClient-generateEmbedding'
        );

        throw enhancedError;
      }
    }

    return allEmbeddings;
  }

  /**
   * Generate content without conversation context
   * Demonstrates: Clean interface, token tracking, system instruction handling
   */
  async generateContent(
    contents: IContent[],
    options?: GenerateContentOptions
  ): Promise<IGenerateContentResponse> {
    const provider = await this.getProvider(options?.provider, UtilityOperation.GENERATE_CONTENT);
    const config = this.buildProviderConfig(options);

    this.logger.debug(() =>
      `Generating content with provider ${provider.name}, model ${config.model}`
    );

    try {
      const response = await provider.generateContent(contents, config);

      // Track token usage for cost monitoring
      if (response.usage) {
        this.logger.info(() =>
          `Token usage: ${response.usage.totalTokens} total ` +
          `(${response.usage.promptTokens} prompt, ${response.usage.completionTokens} completion)`
        );
      }

      return response;

    } catch (error) {
      const enhancedError = this.enhanceError(
        error,
        'generateContent',
        provider.name,
        config.model
      );

      await reportError(
        enhancedError,
        `Failed to generate content with provider ${provider.name}`,
        { contentLength: contents.length, options },
        'baseLLMClient-generateContent'
      );

      throw enhancedError;
    }
  }

  /**
   * Count tokens with caching
   * Demonstrates: Caching strategy, estimation fallback
   */
  async countTokens(
    contents: IContent[],
    options?: CountTokensOptions
  ): Promise<ICountTokensResponse> {
    // Generate cache key from content
    const cacheKey = this.generateTokenCountCacheKey(contents, options);

    // Check cache first
    const cached = this.tokenCountCache.get(cacheKey);
    if (cached) {
      this.logger.debug(() => 'Using cached token count');
      return cached;
    }

    const provider = await this.getProvider(options?.provider, UtilityOperation.COUNT_TOKENS);
    const config = this.buildProviderConfig(options);

    try {
      const result = await provider.countTokens(contents, config);

      // Cache the result
      this.tokenCountCache.set(cacheKey, result);

      // Limit cache size
      if (this.tokenCountCache.size > 1000) {
        const firstKey = this.tokenCountCache.keys().next().value;
        this.tokenCountCache.delete(firstKey);
      }

      return result;

    } catch (error) {
      // Fallback to estimation if provider doesn't support token counting
      if (!provider.supportsOperation(UtilityOperation.COUNT_TOKENS)) {
        this.logger.warn(() =>
          `Provider ${provider.name} doesn't support token counting, using estimation`
        );
        return this.estimateTokenCount(contents);
      }

      throw this.enhanceError(
        error,
        'countTokens',
        provider.name,
        config.model
      );
    }
  }

  /**
   * Get provider with capability validation
   * Demonstrates: Dependency Inversion - depend on abstractions not concretions
   */
  private async getProvider(
    providerName: string | undefined,
    operation: UtilityOperation
  ): Promise<IUtilityLLMProvider> {
    const name = providerName || this.defaultProvider;

    let provider = this.providers.get(name);

    if (!provider) {
      // Lazy load provider if not cached
      const adapter = await this.loadProviderAdapter(name);
      if (adapter) {
        this.providers.set(name, adapter);
        provider = adapter;
      } else {
        throw new Error(`Provider ${name} not available`);
      }
    }

    // Validate provider supports the operation
    if (!provider.supportsOperation(operation)) {
      throw new Error(
        `Provider ${name} does not support ${operation}. ` +
        `Available providers for ${operation}: ${this.getProvidersForOperation(operation).join(', ')}`
      );
    }

    return provider;
  }

  /**
   * Build provider configuration from options
   * Demonstrates: Configuration management, default handling
   */
  private buildProviderConfig(options?: Partial<GenerateJsonOptions & EmbeddingOptions & GenerateContentOptions>): ProviderConfig {
    return {
      model: options?.model || this.config.getModel(),
      apiKey: this.config.getApiKey(options?.provider),
      baseURL: this.config.getBaseURL(options?.provider),
      abortSignal: options?.abortSignal,
      maxRetries: options?.maxRetries || 3,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      systemInstruction: options?.systemInstruction,
      dimensions: options?.dimensions,
    };
  }

  /**
   * Normalize JSON response from various formats
   * Handles markdown-wrapped JSON, malformed responses, etc.
   */
  private normalizeJsonResponse<T>(
    rawResponse: unknown,
    schema: Record<string, unknown>
  ): T {
    // If already an object, return it
    if (typeof rawResponse === 'object' && rawResponse !== null) {
      return rawResponse as T;
    }

    // If string, try to parse
    if (typeof rawResponse === 'string') {
      let text = rawResponse.trim();

      // Remove markdown wrapper if present
      const markdownMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (markdownMatch && markdownMatch[1]) {
        text = markdownMatch[1].trim();
      }

      try {
        return JSON.parse(text) as T;
      } catch (parseError) {
        // Special handling for specific cases (e.g., next_speaker returning plain "user" or "model")
        if (schema && this.isNextSpeakerSchema(schema) && (text === 'user' || text === 'model')) {
          return {
            reasoning: 'Provider returned plain text response',
            next_speaker: text,
          } as T;
        }

        throw new Error(`Failed to parse JSON response: ${parseError}`);
      }
    }

    throw new Error(`Unexpected response type: ${typeof rawResponse}`);
  }

  /**
   * Enhance error with context for better debugging
   */
  private enhanceError(
    error: unknown,
    operation: string,
    provider: string,
    model: string
  ): Error {
    const originalError = error instanceof Error ? error : new Error(String(error));

    const enhancedError = new Error(
      `[BaseLLMClient.${operation}] Failed with provider ${provider} (model: ${model}): ${originalError.message}`
    );

    // Preserve stack trace
    enhancedError.stack = originalError.stack;
    (enhancedError as any).cause = originalError;
    (enhancedError as any).provider = provider;
    (enhancedError as any).model = model;
    (enhancedError as any).operation = operation;

    return enhancedError;
  }

  /**
   * Helper methods for clean code organization
   */

  private batchArray<T>(array: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  private getProviderBatchSize(provider: string): number {
    const batchSizes: Record<string, number> = {
      openai: 100,
      gemini: 100,
      anthropic: 50, // If they add embedding support
    };
    return batchSizes[provider] || 50;
  }

  private generateTokenCountCacheKey(
    contents: IContent[],
    options?: CountTokensOptions
  ): string {
    const contentHash = JSON.stringify(contents).substring(0, 100); // Simple hash
    return `${options?.provider || 'default'}-${options?.model || 'default'}-${contentHash}`;
  }

  private estimateTokenCount(contents: IContent[]): ICountTokensResponse {
    // Simple estimation: ~4 characters per token
    let totalChars = 0;
    for (const content of contents) {
      for (const part of content.parts || []) {
        if ('text' in part) {
          totalChars += part.text?.length || 0;
        }
      }
    }

    const estimatedTokens = Math.ceil(totalChars / 4);
    return {
      totalTokens: estimatedTokens,
      promptTokens: estimatedTokens,
    };
  }

  private isNextSpeakerSchema(schema: Record<string, unknown>): boolean {
    return schema.properties &&
           'next_speaker' in (schema.properties as Record<string, unknown>);
  }

  private getProvidersForOperation(operation: UtilityOperation): string[] {
    return Array.from(this.providers.entries())
      .filter(([_, provider]) => provider.supportsOperation(operation))
      .map(([name]) => name);
  }

  private async loadProviderAdapter(name: string): Promise<IUtilityLLMProvider | null> {
    // Dynamic loading logic would go here
    // For now, return null to indicate not found
    return null;
  }
}

/**
 * Factory for creating provider adapters
 * Demonstrates: Factory Pattern, Open/Closed Principle
 */
interface IProviderAdapterFactory {
  createAdapter(providerName: string, providerManager: IProviderManager): IUtilityLLMProvider | null;
}

class DefaultProviderAdapterFactory implements IProviderAdapterFactory {
  createAdapter(providerName: string, providerManager: IProviderManager): IUtilityLLMProvider | null {
    switch (providerName) {
      case 'anthropic':
        return new AnthropicUtilityAdapter(providerManager);
      case 'openai':
        return new OpenAIUtilityAdapter(providerManager);
      case 'gemini':
        return new GeminiUtilityAdapter(providerManager);
      case 'vertex':
        return new VertexUtilityAdapter(providerManager);
      default:
        return null;
    }
  }
}

// Stub adapter classes - would be implemented separately
class AnthropicUtilityAdapter implements IUtilityLLMProvider {
  name = 'anthropic';
  constructor(private providerManager: IProviderManager) {}

  async generateJson<T>(contents: IContent[], schema: Record<string, unknown>, config: ProviderConfig): Promise<T> {
    // Implementation using Claude's function calling
    throw new Error('Not implemented');
  }

  async generateEmbedding(texts: string[], config: ProviderConfig): Promise<number[][]> {
    // Anthropic doesn't support embeddings yet
    throw new Error('Embeddings not supported by Anthropic');
  }

  async generateContent(contents: IContent[], config: ProviderConfig): Promise<IGenerateContentResponse> {
    // Implementation
    throw new Error('Not implemented');
  }

  async countTokens(contents: IContent[], config: ProviderConfig): Promise<ICountTokensResponse> {
    // Use Claude's tokenizer
    throw new Error('Not implemented');
  }

  supportsOperation(operation: UtilityOperation): boolean {
    return operation !== UtilityOperation.GENERATE_EMBEDDING;
  }
}

class OpenAIUtilityAdapter implements IUtilityLLMProvider {
  name = 'openai';
  constructor(private providerManager: IProviderManager) {}

  // Similar structure for OpenAI...
  async generateJson<T>(contents: IContent[], schema: Record<string, unknown>, config: ProviderConfig): Promise<T> {
    throw new Error('Not implemented');
  }

  async generateEmbedding(texts: string[], config: ProviderConfig): Promise<number[][]> {
    throw new Error('Not implemented');
  }

  async generateContent(contents: IContent[], config: ProviderConfig): Promise<IGenerateContentResponse> {
    throw new Error('Not implemented');
  }

  async countTokens(contents: IContent[], config: ProviderConfig): Promise<ICountTokensResponse> {
    throw new Error('Not implemented');
  }

  supportsOperation(operation: UtilityOperation): boolean {
    return true; // OpenAI supports all operations
  }
}

class GeminiUtilityAdapter implements IUtilityLLMProvider {
  name = 'gemini';
  constructor(private providerManager: IProviderManager) {}

  // Similar structure for Gemini...
  async generateJson<T>(contents: IContent[], schema: Record<string, unknown>, config: ProviderConfig): Promise<T> {
    throw new Error('Not implemented');
  }

  async generateEmbedding(texts: string[], config: ProviderConfig): Promise<number[][]> {
    throw new Error('Not implemented');
  }

  async generateContent(contents: IContent[], config: ProviderConfig): Promise<IGenerateContentResponse> {
    throw new Error('Not implemented');
  }

  async countTokens(contents: IContent[], config: ProviderConfig): Promise<ICountTokensResponse> {
    throw new Error('Not implemented');
  }

  supportsOperation(operation: UtilityOperation): boolean {
    return true; // Gemini supports all operations
  }
}

class VertexUtilityAdapter implements IUtilityLLMProvider {
  name = 'vertex';
  constructor(private providerManager: IProviderManager) {}

  // Similar structure for Vertex AI...
  async generateJson<T>(contents: IContent[], schema: Record<string, unknown>, config: ProviderConfig): Promise<T> {
    throw new Error('Not implemented');
  }

  async generateEmbedding(texts: string[], config: ProviderConfig): Promise<number[][]> {
    throw new Error('Not implemented');
  }

  async generateContent(contents: IContent[], config: ProviderConfig): Promise<IGenerateContentResponse> {
    throw new Error('Not implemented');
  }

  async countTokens(contents: IContent[], config: ProviderConfig): Promise<ICountTokensResponse> {
    throw new Error('Not implemented');
  }

  supportsOperation(operation: UtilityOperation): boolean {
    return true; // Vertex supports all operations
  }
}