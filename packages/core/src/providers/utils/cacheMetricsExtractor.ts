export interface CacheMetrics {
  cachedTokens: number;
  cacheCreationTokens: number;
  cacheMissTokens: number;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function hasProperty<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, unknown> {
  return typeof obj === 'object' && obj !== null && key in obj;
}

export function extractCacheMetrics(
  usage: unknown,
  headers?: Headers,
): CacheMetrics {
  const cachedTokens =
    (hasProperty(usage, 'prompt_tokens_details') &&
      hasProperty(usage.prompt_tokens_details, 'cached_tokens') &&
      toNumber(usage.prompt_tokens_details.cached_tokens)) ||
    (hasProperty(usage, 'cache_read_input_tokens') &&
      toNumber(usage.cache_read_input_tokens)) ||
    (hasProperty(usage, 'prompt_cache_hit_tokens') &&
      toNumber(usage.prompt_cache_hit_tokens)) ||
    (headers && toNumber(headers.get('fireworks-cached-prompt-tokens'))) ||
    0;

  const cacheCreationTokens =
    (hasProperty(usage, 'cache_creation_input_tokens') &&
      toNumber(usage.cache_creation_input_tokens)) ||
    0;

  const cacheMissTokens =
    (hasProperty(usage, 'prompt_cache_miss_tokens') &&
      toNumber(usage.prompt_cache_miss_tokens)) ||
    0;

  return {
    cachedTokens,
    cacheCreationTokens,
    cacheMissTokens,
  };
}
