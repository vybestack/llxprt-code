/**
 * Fallback model list for the standalone OpenAI Responses provider.
 *
 * Transport/model classification (supports vs requires Responses) lives in
 * `openaiModelPolicy.ts` — this list is ONLY for getModels() fallback when
 * the API is unreachable.
 */
export const RESPONSES_API_MODELS = [
  'gpt-5.6',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4o-realtime',
  'gpt-4-turbo',
  'gpt-4-turbo-preview',
  'o3-pro',
  'o3',
  'o3-mini',
  'o1',
  'o1-mini',
  'gpt-4.1',
] as const;

export type ResponsesApiModel = (typeof RESPONSES_API_MODELS)[number];
