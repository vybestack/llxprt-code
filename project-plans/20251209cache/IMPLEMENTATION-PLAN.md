# Issue #529: Context/Prefix Caching Implementation Plan

## Overview

Add prompt caching support for OpenAI-compatible providers (OpenRouter, Groq, Fireworks, Deepseek, etc.) using a universal cache metrics extractor that handles all provider formats without provider-specific branching.

## Architecture

### Universal Cache Extractor

One function handles ALL providers by vacuuming up all possible cache-related fields:

```typescript
const cachedTokens =
  toNumber(details.cached_tokens) ||              // OpenAI, Groq
  toNumber(u.cache_read_input_tokens) ||          // Anthropic
  toNumber(u.prompt_cache_hit_tokens) ||          // Deepseek
  toNumber(headers?.get('fireworks-cached-prompt-tokens')) ||
  0;
```

Adding a new provider = add one line to the fallback chain.

## Provider Support Matrix

| Provider | Caching Type | Response Field | Implementation |
|----------|-------------|----------------|----------------|
| Anthropic | Explicit | `cache_read_input_tokens`, `cache_creation_input_tokens` | Already implemented |
| OpenAI | Automatic | `prompt_tokens_details.cached_tokens` | Phase 4 |
| Groq | Automatic | `prompt_tokens_details.cached_tokens` | Phase 4 |
| Deepseek | Automatic | `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens` | Phase 4 |
| Fireworks | Automatic | Headers: `fireworks-cached-prompt-tokens` | Phase 5 |
| OpenRouter | Passthrough | Varies by backend | Phase 4/5 |
| Qwen | Explicit | `cache_creation_input_tokens`, `cached_tokens` | Phase 4 |

## Implementation Phases

### Phase 1: Core Cache Metrics Extractor

**Files:**
- `packages/core/src/providers/utils/cacheMetricsExtractor.ts` (new)
- `packages/core/src/providers/utils/cacheMetricsExtractor.test.ts` (new)

**Interface:**
```typescript
export interface CacheMetrics {
  cachedTokens: number;        // Tokens read from cache
  cacheCreationTokens: number; // Tokens written to cache
  cacheMissTokens: number;     // Tokens that missed cache (Deepseek)
}

export function extractCacheMetrics(
  usage: unknown,
  headers?: Headers
): CacheMetrics;
```

**Tests to write FIRST:**
- OpenAI/Groq format extraction
- Anthropic format extraction
- Deepseek format extraction
- Fireworks headers extraction
- Fallback to zeros when no cache fields
- Handle null/undefined gracefully
- Priority order when multiple fields present

### Phase 2: Update UsageStats Interface

**Files:**
- `packages/core/src/services/history/IContent.ts`

**Changes:**
```typescript
export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;

  // Provider-agnostic cache fields (new)
  cachedTokens?: number;
  cacheCreationTokens?: number;
  cacheMissTokens?: number;

  // Anthropic-specific (backward compatibility)
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
```

### Phase 3: Update LoggingProviderWrapper

**Files:**
- `packages/core/src/providers/LoggingProviderWrapper.ts`
- `packages/cli/src/providers/logging/LoggingProviderWrapper.test.ts`

**Changes:**
- Update `extractTokenCountsFromTokenUsage` to prefer new provider-agnostic fields
- Fallback to Anthropic-specific fields for backward compatibility

### Phase 4: Update OpenAIProvider

**Files:**
- `packages/core/src/providers/openai/OpenAIProvider.ts`
- `packages/core/src/providers/openai/OpenAIProvider.caching.test.ts` (new)

**Changes:**
- Import and use `extractCacheMetrics`
- Extract cache metrics in streaming handler
- Extract cache metrics in non-streaming handler
- Populate `UsageStats` with cache fields

### Phase 5: Update OpenAIVercelProvider

**Files:**
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.caching.test.ts` (new)

**Changes:**
- Extend custom fetch to capture cache headers
- Extract cache metrics from AI SDK usage
- Populate `UsageStats` with cache fields

### Phase 6: Update UI

**Files:**
- `packages/cli/src/ui/components/CacheStatsDisplay.tsx`
- `packages/cli/src/ui/components/CacheStatsDisplay.test.tsx`

**Changes:**
- Update "no data" message to list all supported providers
- Remove "Anthropic only" language

## Implementation Order

| Step | File | Type | Depends On |
|------|------|------|------------|
| 1 | `cacheMetricsExtractor.test.ts` | Test | - |
| 2 | `cacheMetricsExtractor.ts` | Impl | Step 1 |
| 3 | `IContent.ts` | Interface | - |
| 4 | `LoggingProviderWrapper.test.ts` | Test | Steps 2,3 |
| 5 | `LoggingProviderWrapper.ts` | Impl | Step 4 |
| 6 | `OpenAIProvider.caching.test.ts` | Test | Steps 2,3 |
| 7 | `OpenAIProvider.ts` | Impl | Step 6 |
| 8 | `OpenAIVercelProvider.caching.test.ts` | Test | Steps 2,3 |
| 9 | `OpenAIVercelProvider.ts` | Impl | Step 8 |
| 10 | `CacheStatsDisplay.test.tsx` | Test | Steps 5,7,9 |
| 11 | `CacheStatsDisplay.tsx` | Impl | Step 10 |

## Verification Checklist

- [ ] All tests pass
- [ ] No TODO/HACK/FIXME comments
- [ ] No "in a real implementation" stubs
- [ ] TypeScript compiles without errors
- [ ] ESLint passes with no warnings
- [ ] Backward compatibility with Anthropic maintained
- [ ] `/stats cache` displays for all providers
- [ ] Cache metrics flow through LoggingProviderWrapper to ProviderManager

## References

- Issue: https://github.com/vybestack/llxprt-code/issues/529
- OpenAI Caching: https://platform.openai.com/docs/guides/prompt-caching
- Groq Caching: https://console.groq.com/docs/prompt-caching
- Fireworks Caching: https://docs.fireworks.ai/guides/prompt-caching
- Deepseek Caching: https://api-docs.deepseek.com/guides/kv_cache
