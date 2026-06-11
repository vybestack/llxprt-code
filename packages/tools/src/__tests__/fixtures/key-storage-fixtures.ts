export const MASK_KEY_FIXTURES = [
  {
    input: 'sk-1234567890abcdef',
    output: 'sk***************ef',
  },
  {
    input: 'short',
    output: '*****',
  },
  {
    input: '',
    output: '',
  },
  {
    input: 'exactly8c',
    output: 'ex*****8c',
  },
  {
    input: 'apikey-with-lots-of-characters-here',
    output: 'ap*******************************re',
  },
] as const;

export const SUPPORTED_TOOL_NAMES_FIXTURE = ['exa'] as const;

export const VALID_KEY_CHECK_FIXTURES = [
  {
    input: 'exa',
    isValid: true,
  },
  {
    input: 'codesearch',
    isValid: false,
  },
  {
    input: 'invalid_key',
    isValid: false,
  },
  {
    input: 'google-web-search',
    isValid: false,
  },
] as const;

export const KEY_ENTRY_FIXTURES = [
  {
    name: 'exa',
    entry: {
      toolKeyName: 'exa',
      displayName: 'Exa Search',
      urlParamName: 'exaApiKey',
      description: 'API key for Exa web and code search',
    },
  },
] as const;
