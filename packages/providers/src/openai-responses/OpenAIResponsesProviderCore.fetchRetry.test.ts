import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';

function createSuccessfulResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.output_text.delta","delta":"Hello from retry!"}\n\n',
        ),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('OpenAIResponsesProvider connection-phase fetch retry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('should retry when fetch throws TypeError("fetch failed") on first attempt and succeed on second', async () => {
    let attempt = 0;
    fetchMock.mockImplementation(() => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return Promise.resolve(createSuccessfulResponse());
    });

    const provider = new OpenAIResponsesProvider(
      'test-key',
      undefined,
      { getEphemeralSettings: () => ({}) },
      undefined,
      fetchMock as typeof fetch,
      (error) => error instanceof TypeError,
    );

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ] as IContent[],
        ephemerals: { retries: 3, retrywait: 10 },
      }),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) chunks.push(chunk);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toBeDefined();
  });

  it('should NOT retry when fetch throws an AbortError (user cancellation)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    const provider = new OpenAIResponsesProvider(
      'test-key',
      undefined,
      { getEphemeralSettings: () => ({}) },
      undefined,
      fetchMock as typeof fetch,
    );
    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ] as IContent[],
        ephemerals: { retries: 3, retrywait: 10 },
      }),
    );

    const consumption = (async (): Promise<void> => {
      for await (const _chunk of generator) {
        // drain
      }
    })();
    expect(consumption).rejects.toThrow('aborted');
    await consumption.catch(() => undefined);

    expect(fetchMock.mock.calls.length).toBe(1);
  });
});
