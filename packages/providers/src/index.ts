/**
 * @plan:PLAN-20260603-ISSUE1584.P11
 * @requirement:REQ-PKG-001
 * @pseudocode lines 15-21
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider package public API entry point.
 *
 * Exports all provider implementations, manager, tokenizers, errors, and
 * utility functions that were previously re-exported from core.
 *
 * Per integration-contract.md IC-01, this is the single source of truth
 * for the providers package public API.
 */

// --- Contract interfaces ---
export type {
  IProvider,
  GenerateChatOptions,
  ProviderToolset,
} from './IProvider.js';
export type { IProviderManager } from './IProviderManager.js';
export type { IModel } from './IModel.js';
export type { ITool } from './ITool.js';
export type { ITokenizer } from './tokenizers/ITokenizer.js';
export type { NormalizedGenerateChatOptions } from './BaseProvider.js';
export { ContentGeneratorRole } from './ContentGeneratorRole.js';

// --- Provider manager ---
export { ProviderManager } from './ProviderManager.js';
export type { CacheStatistics } from './tokenUsageTracker.js';

// --- Provider implementations ---
export { OpenAIProvider } from './openai/OpenAIProvider.js';
export { AnthropicProvider } from './anthropic/AnthropicProvider.js';
export { GeminiProvider } from './gemini/GeminiProvider.js';
export { OpenAIResponsesProvider } from './openai-responses/OpenAIResponsesProvider.js';
export { OpenAIVercelProvider } from './openai-vercel/index.js';
export { FakeProvider } from './fake/FakeProvider.js';
export {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type LoadBalancerSubProfile,
  type LoadBalancerStats,
  type ExtendedLoadBalancerStats,
  type BackendMetrics,
  type CircuitBreakerState,
  type ResolvedSubProfile,
} from './LoadBalancingProvider.js';

// --- Content generation ---
export { ProviderContentGenerator } from './ProviderContentGenerator.js';

// --- Tokenizers ---
export { OpenAITokenizer } from './tokenizers/OpenAITokenizer.js';
export { AnthropicTokenizer } from './tokenizers/AnthropicTokenizer.js';

// --- Errors ---
export {
  AuthenticationRequiredError,
  RateLimitError,
  QuotaError,
  AuthenticationError,
  ServerError,
  NetworkError,
  ClientError,
  MissingProviderRuntimeError,
  LoadBalancerFailoverError,
  AllBucketsExhaustedError,
  isAuthBucketFailureReason,
  type BucketFailureReason,
} from './errors.js';

// --- Provider types ---
export type {
  Provider,
  ProviderMessage,
  ProviderTool,
  ProviderToolCall,
} from './types.js';
export type { IProviderConfig } from './types/IProviderConfig.js';
export type {
  ProviderTelemetryContext,
  ResolvedAuthToken,
} from './types/providerRuntime.js';
export type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

// --- Provider config keys ---
export { PROVIDER_CONFIG_KEYS } from './providerConfigKeys.js';

// --- Provider utilities ---
export {
  fetchApiKeyQuota,
  detectApiKeyProvider,
  detectApiKeyProviderFromName,
  type ApiKeyQuotaResult,
  type ApiKeyQuotaProvider,
  API_KEY_PROVIDER_NAME_MAP,
} from './apiKeyQuotaResolver.js';
// --- Usage info ---
export * from './anthropic/usageInfo.js';
export { formatAllUsagePeriods } from './anthropic/usageInfo.js';
export * from './gemini/usageInfo.js';
export * from './openai/codexUsageInfo.js';
export {
  CodexUsageInfoSchema,
  formatCodexUsage,
} from './openai/codexUsageInfo.js';
export * from './zai/usageInfo.js';
export * from './synthetic/usageInfo.js';
export * from './chutes/usageInfo.js';
export * from './kimi/usageInfo.js';

// --- Additional utilities ---
export { ConversationCache } from './openai/ConversationCache.js';
export { getOpenAIProviderInfo } from './openai/getOpenAIProviderInfo.js';

// --- Additional types needed for provider construction ---
export type { DumpMode } from './utils/dumpContext.js';
export { dumpRequestContext } from './utils/dumpContext.js';
export {
  buildAnthropicDumpMessages,
  buildGeminiDumpContents,
  buildOpenAIDumpMessages,
  buildProviderDumpBody,
} from './utils/providerRequestConversion.js';
export { wrapStreamWithDump } from './utils/dumpSDKContext.js';
