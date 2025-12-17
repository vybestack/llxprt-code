import { describe, it, expect } from 'vitest';
import { filterOpenAIRequestParams } from './openaiRequestParams.js';

describe('filterOpenAIRequestParams', () => {
  it('keeps supported OpenAI parameters and normalizes aliases', () => {
    const filtered = filterOpenAIRequestParams({
      temperature: 0.5,
      'max-tokens': 2048,
      responseFormat: { type: 'json_schema' },
      stop: ['END'],
    });

    expect(filtered).toEqual({
      temperature: 0.5,
      max_tokens: 2048,
      response_format: { type: 'json_schema' },
      stop: ['END'],
    });
  });

  it('drops CLI-only or unrelated ephemeral settings', () => {
    const filtered = filterOpenAIRequestParams({
      'context-limit': 190000,
      'shell-replacement': true,
      'custom-headers': { 'X-Test': '1' },
      user: 'tester',
    });

    expect(filtered).toEqual({
      user: 'tester',
    });
  });

  it('drops internal reasoning settings nested under reasoning', () => {
    const filtered = filterOpenAIRequestParams({
      temperature: 0.7,
      reasoning: {
        effort: 'xhigh',
        enabled: true,
        includeInContext: true,
        includeInResponse: false,
        format: 'field',
        stripFromContext: 'none',
      },
    });

    expect(filtered).toEqual({
      temperature: 0.7,
      reasoning: {
        effort: 'xhigh',
      },
    });
  });
});
