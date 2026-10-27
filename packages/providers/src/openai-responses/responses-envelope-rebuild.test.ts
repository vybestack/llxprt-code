/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DEFAULT_HTTP_JSON_ENVELOPE_BYTES } from '../utils/boundedJsonBody.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { nativeJournalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import { providerStreamError } from '../__tests__/support/provider-stream-error.js';
import {
  buildNormalizedOptions,
  captureResponsesTestRequest,
  type ResponsesTestDeps,
} from './responses-request.test-helpers.js';
import { buildDiskTextResponsesContext } from './responses-disk-text-projection.js';
import { executeOpenAIResponsesRequest } from './openAIResponsesExecutor.js';
import {
  createCodexResponsesWebSocketTransport,
  DEFAULT_WEBSOCKET_JSON_ENVELOPE_BYTES,
} from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  connectionLimitScript,
  type FakeSocket,
} from './__tests__/openAIResponsesWebSocketTransport.test-helpers.js';

function* rows(): Generator<IContent> {
  yield {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'x'.repeat(DEFAULT_HTTP_JSON_ENVELOPE_BYTES) },
    ],
  };
  yield {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'answer' }],
    metadata: { id: 'resp_dead', responsesStored: true },
  };
  yield { speaker: 'human', blocks: [{ type: 'text', text: 'next question' }] };
}

function disconnectScript(socket: FakeSocket): void {
  socket.open();
  socket.onSend = (): void => socket.error();
}

describe('Responses native rebuilt envelope planning', () => {
  for (const renewal of [false, true]) {
    it(`refuses an oversized ${renewal ? 'WebSocket renewal' : 'HTTP fallback'} before opening its transport`, async () => {
      const harness = new SocketHarness([
        renewal ? connectionLimitScript() : disconnectScript,
      ]);
      const transport = createCodexResponsesWebSocketTransport({
        openSocket: harness.openSocket,
      });
      const deps: ResponsesTestDeps = {
        providerName: 'openai-responses',
        logger: new DebugLogger('envelope-rebuild-test'),
        requestBaseURL: 'https://chatgpt.com/backend-api/codex',
        requestHeaders: undefined,
        defaultModel: 'gpt-5.6-sol',
        isCodexMode: () => true,
        getCodexAccountId: async () => 'account',
        resolveAuthTokenForPrompt: async () => 'token',
        shouldRetryOnError: () => false,
        getUnallowedModelParameters: () => new Set<string>(),
        getWebSocketTransport: () => transport,
        isWebSocketTransportActive: () => true,
        getMediaTransportCapabilities: () =>
          declaredMediaTransportCapabilities('codex'),
      };
      const fixture = await nativeJournalSendFixture(rows());
      const request = captureResponsesTestRequest(
        buildNormalizedOptions({
          requestRows: fixture.selection,
          contentCount: fixture.selection.count,
          contents: [],
        }),
        deps,
      );
      const prepared = await buildDiskTextResponsesContext(request, deps);
      const originalFetch = globalThis.fetch;
      let httpEntries = 0;
      globalThis.fetch = Object.assign(
        (): Promise<Response> => {
          httpEntries += 1;
          return Promise.reject(new Error('Unexpected HTTP request'));
        },
        { preconnect: originalFetch.preconnect },
      );
      let error: unknown;
      try {
        expect(prepared.request.previous_response_id).toBe('resp_dead');
        error = await providerStreamError(
          executeOpenAIResponsesRequest(request, deps, prepared),
        );
        expect(prepared.mediaRequest.accounting().released).toBe(true);
        expect(harness.sockets).toHaveLength(1);
        expect(harness.sockets[0].sent).toHaveLength(1);
        expect(harness.sockets[0].sent[0].length).toBeLessThan(1024);
        expect(harness.sockets[0].sent[0]).toContain(
          '"previous_response_id":"resp_dead"',
        );
        expect(httpEntries).toBe(0);
        expect(error).toBeInstanceOf(RangeError);
        if (!(error instanceof RangeError)) throw error;
        expect(error.message).toMatch(
          new RegExp(
            `^JSON request envelope exceeds ${renewal ? DEFAULT_WEBSOCKET_JSON_ENVELOPE_BYTES : DEFAULT_HTTP_JSON_ENVELOPE_BYTES} bytes \\(\\d+ bytes\\)$`,
          ),
        );
      } finally {
        globalThis.fetch = originalFetch;
        transport.close();
        await prepared.mediaRequest.release();
        await fixture.close();
      }
      expect(() => fixture.selection.openReader()).toThrow('closed');
    }, 170000);
  }
});
