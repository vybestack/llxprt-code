import { restoreGlobals, setGlobal } from '@vybestack/llxprt-code-test-utils';
import { describe, it, beforeEach, afterEach, expect, vi } from 'bun:test';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { streamCallOptions } from '../__tests__/streamCallOptions.js';

const fetchMock = vi.fn();

function setupFetchMock(): void {
  fetchMock.mockReset();
  setGlobal('fetch', fetchMock);
}

function cleanupFetchMock(): void {
  restoreGlobals();
  vi.restoreAllMocks();
}

describe('OpenAIResponsesProvider connection-phase fetch retry', () => {
  beforeEach(setupFetchMock);
  afterEach(cleanupFetchMock);

  it('should retry when fetch throws TypeError("fetch failed") on first attempt and succeed on second', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        new Response(
          `data: {"type":"response.output_text.delta","delta":"Hello from retry!"}

data: {"type":"response.completed","response":{"id":"resp_retry","status":"completed"}}

`,
          { status: 200 },
        ),
      );

    const provider = new OpenAIResponsesProvider('test-key', undefined, {
      getEphemeralSettings: () => ({}),
    });

    const generator = provider.generateChatCompletion(
      streamCallOptions({
        providerName: provider.name,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ] as IContent[],
        ephemerals: {
          retries: 3,
          retrywait: 10,
        },
      }),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toBeDefined();
    expect(chunks.flatMap((chunk) => chunk.blocks)).toContainEqual({
      type: 'text',
      text: 'Hello from retry!',
    });
  });
});

describe('OpenAIResponsesProvider connection-phase abort', () => {
  beforeEach(setupFetchMock);
  afterEach(cleanupFetchMock);

  it('should NOT retry when fetch throws an AbortError (user cancellation)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    const provider = new OpenAIResponsesProvider('test-key', undefined, {
      getEphemeralSettings: () => ({}),
    });

    const generator = provider.generateChatCompletion(
      streamCallOptions({
        providerName: provider.name,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ] as IContent[],
        ephemerals: {
          retries: 3,
          retrywait: 10,
        },
      }),
    );

    await expect(
      (async () => {
        for await (const _chunk of generator) {
          // drain
        }
      })(),
    ).rejects.toThrow('aborted');

    expect(fetchMock.mock.calls.length).toBe(1);
  });
});
