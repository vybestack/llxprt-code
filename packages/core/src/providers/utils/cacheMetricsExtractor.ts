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

function extractNumericProperty(obj: unknown, ...path: string[]): number {
  let current: unknown = obj;
  for (const key of path) {
    if (!hasProperty(current, key)) return 0;
    current = current[key];
  }
  return toNumber(current);
}

function firstNonZero(...values: number[]): number {
  for (const v of values) {
    if (v !== 0) return v;
  }
  return 0;
}

export function extractCacheMetrics(
  usage: unknown,
  headers?: Headers,
): CacheMetrics {
  const headerCachedTokens =
    headers != null
      ? toNumber(headers.get('fireworks-cached-prompt-tokens'))
      : 0;

  const cachedTokens = firstNonZero(
    extractNumericProperty(usage, 'prompt_tokens_details', 'cached_tokens'),
    extractNumericProperty(usage, 'cache_read_input_tokens'),
    extractNumericProperty(usage, 'prompt_cache_hit_tokens'),
    headerCachedTokens,
  );

  const cacheCreationTokens = extractNumericProperty(
    usage,
    'cache_creation_input_tokens',
  );

  const cacheMissTokens = extractNumericProperty(
    usage,
    'prompt_cache_miss_tokens',
  );

  return {
    cachedTokens,
    cacheCreationTokens,
    cacheMissTokens,
  };
}
