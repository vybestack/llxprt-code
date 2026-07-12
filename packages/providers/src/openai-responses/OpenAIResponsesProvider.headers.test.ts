import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';

describe('OpenAIResponsesProvider custom headers', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should merge custom headers from config and ephemeral settings into fetch request', async () => {
    const customHeaders = {
      'X-Custom-Header': 'custom-value',
      'X-Trace-Id': 'trace-xyz',
    };

    const provider = new OpenAIResponsesProvider('test-key', undefined, {
      customHeaders: {
        'X-Provider-Header': 'provider-value',
      },
      getEphemeralSettings: () => ({
        'custom-headers': customHeaders,
      }),
    });

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ] as IContent[],
        settingsOverrides: {
          global: { 'custom-headers': customHeaders },
          provider: { 'custom-headers': customHeaders },
        },
      }),
    );

    await generator.next();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();

    const [, options] = call;
    expect(options).toBeDefined();
    expect(options?.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json; charset=utf-8',
      ...customHeaders,
      'X-Provider-Header': 'provider-value',
    });
  });
});
