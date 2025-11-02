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

export function filterOpenAIRequestParams(
  source: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!source) {
    return undefined;
  }

  const filtered: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(source)) {
    if (value === undefined || value === null) {
      continue;
    }
    const normalizedKey = normalizeOpenAIParamKey(rawKey);
    if (!OPENAI_ALLOWED_PARAM_KEYS.has(normalizedKey)) {
      continue;
    }
    filtered[normalizedKey] = value;
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}
