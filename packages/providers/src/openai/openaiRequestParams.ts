/**
 * Shared utilities for sanitizing OpenAI/Synthetic request parameters
 * before sending them over the wire. CLI "ephemeral" settings often
 * contain UX toggles (context limits, shell replacement, etc.) that
 * must never be forwarded to the API.
 */

const OPENAI_ALLOWED_PARAM_KEYS = new Set<string>([
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'stop',
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'logit_bias',
  'user',
  'n',
  'seed',
  'response_format',
  'stream',
  'stream_options',
  'tool_choice',
  'metadata',
  'modalities',
  'parallel_tool_calls',
  'top_k',
  'top_logprobs',
  'logprobs',
  'reasoning',
  'audio',
  'audio_format',
  'prediction',
  'prompt_cache_key',
  'prompt_cache_retention',
]);

const OPENAI_PARAM_KEY_ALIASES: Record<string, string> = {
  'max-tokens': 'max_tokens',
  maxTokens: 'max_tokens',
  'response-format': 'response_format',
  responseFormat: 'response_format',
  'tool-choice': 'tool_choice',
  toolChoice: 'tool_choice',
};

function normalizeOpenAIParamKey(key: string): string {
  if (OPENAI_PARAM_KEY_ALIASES[key]) {
    return OPENAI_PARAM_KEY_ALIASES[key];
  }
  return key.replace(/-/g, '_');
}

const OPENAI_REASONING_INTERNAL_KEYS = new Set<string>([
  'enabled',
  'includeInContext',
  'includeInResponse',
  'format',
  'stripFromContext',
  'verbosity',
]);

function stripInternalReasoningKeys(
  value: unknown,
): Record<string, unknown> | undefined {
  if (
    value === undefined ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const isNullOrUndefined = nestedValue === undefined || nestedValue === null;
    const shouldSkip =
      isNullOrUndefined ||
      OPENAI_REASONING_INTERNAL_KEYS.has(key) ||
      (key === 'summary' && nestedValue === 'none');
    if (shouldSkip) {
      continue;
    }
    sanitized[key] = nestedValue;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function processParamEntry(
  rawKey: string,
  value: unknown,
): { key: string; value: unknown } | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalizedKey = normalizeOpenAIParamKey(rawKey);
  if (!OPENAI_ALLOWED_PARAM_KEYS.has(normalizedKey)) {
    return undefined;
  }
  if (normalizedKey === 'reasoning') {
    const sanitized = stripInternalReasoningKeys(value);
    if (!sanitized) {
      return undefined;
    }
    return { key: normalizedKey, value: sanitized };
  }
  if (
    normalizedKey === 'prompt_cache_key' &&
    typeof value === 'string' &&
    value.trim() === ''
  ) {
    return undefined;
  }
  return { key: normalizedKey, value };
}

export function filterOpenAIRequestParams(
  source: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!source) {
    return undefined;
  }

  const filtered: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(source)) {
    const processed = processParamEntry(rawKey, value);
    if (processed !== undefined) {
      filtered[processed.key] = processed.value;
    }
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}
