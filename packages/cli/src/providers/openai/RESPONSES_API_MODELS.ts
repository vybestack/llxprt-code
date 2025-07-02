export const RESPONSES_API_MODELS = [
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
