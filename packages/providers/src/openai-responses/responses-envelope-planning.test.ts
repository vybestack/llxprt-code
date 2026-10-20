/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DEFAULT_HTTP_JSON_ENVELOPE_BYTES } from '../utils/boundedJsonBody.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import { providerStreamError } from '../__tests__/support/provider-stream-error.js';
import {
  buildNormalizedOptions,
  captureResponsesTestRequest,
  type ResponsesTestDeps,
} from './responses-request.test-helpers.js';
import { buildDiskTextResponsesContext } from './responses-disk-text-projection.js';
import { diskResponsesBodyLength } from './responses-disk-body.js';
import { executeOpenAIResponsesRequest } from './openAIResponsesExecutor.js';
import {
  createCodexResponsesWebSocketTransport,
  DEFAULT_WEBSOCKET_JSON_ENVELOPE_BYTES,
} from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  completingScript,
} from './__tests__/openAIResponsesWebSocketTransport.test-helpers.js';

function rows(textBytes: number): Iterable<IContent> {
  return (function* (): Generator<IContent> {
    yield {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'x'.repeat(textBytes) }],
    };
  })();
}

describe('Responses WebSocket native envelope planning', () => {
  for (const bodyLength of [
    DEFAULT_WEBSOCKET_JSON_ENVELOPE_BYTES,
    DEFAULT_WEBSOCKET_JSON_ENVELOPE_BYTES + 1,
    DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
    DEFAULT_HTTP_JSON_ENVELOPE_BYTES + 1,
  ]) {
    it(`refuses a response.create frame with a ${bodyLength}-byte HTTP body before opening a socket`, async () => {
      const harness = new SocketHarness([completingScript()]);
      const transport = createCodexResponsesWebSocketTransport({
        openSocket: harness.openSocket,
      });
      const deps: ResponsesTestDeps = {
        providerName: 'openai-responses',
        logger: new DebugLogger('envelope-test'),
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
      };
      const smallFixture = await journalSendFixture(rows(1));
      const smallRequest = captureResponsesTestRequest(
        buildNormalizedOptions({
          requestRows: smallFixture.selection,
          contentCount: smallFixture.selection.count,
          contents: [],
        }),
        deps,
      );
      const small = await buildDiskTextResponsesContext(smallRequest, deps);
      const overhead =
        (await diskResponsesBodyLength(
          small.request,
          small.sourcePrompt.toEstimatorProjection(),
        )) - 1;
      await small.mediaRequest.release();
      await smallFixture.close();
      const fixture = await journalSendFixture(rows(bodyLength - overhead));
      const request = captureResponsesTestRequest(
        buildNormalizedOptions({
          requestRows: fixture.selection,
          contentCount: fixture.selection.count,
          contents: [],
        }),
        deps,
      );
      const prepared = await buildDiskTextResponsesContext(request, deps);
      let error: unknown;
      let httpEntries = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = Object.assign(
        (): Promise<Response> => {
          httpEntries += 1;
          return Promise.reject(new Error('Unexpected HTTP fallback'));
        },
        { preconnect: originalFetch.preconnect },
      );
      try {
        expect(
          await diskResponsesBodyLength(
            prepared.request,
            prepared.sourcePrompt.toEstimatorProjection(),
          ),
        ).toBe(bodyLength);
        error = await providerStreamError(
          executeOpenAIResponsesRequest(request, deps, prepared),
        );
        expect(prepared.mediaRequest.accounting().released).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
        transport.close();
        await prepared.mediaRequest.release();
        await fixture.close();
      }
      expect(harness.sockets).toHaveLength(0);
      expect(httpEntries).toBe(0);
      expect(error).toBeInstanceOf(RangeError);
      if (!(error instanceof RangeError)) throw error;
      expect(error.message).toBe(
        `JSON request envelope exceeds ${DEFAULT_WEBSOCKET_JSON_ENVELOPE_BYTES} bytes (${bodyLength + Buffer.byteLength(',"type":"response.create"')} bytes)`,
      );
      expect(() => fixture.selection.openReader()).toThrow('closed');
    }, 170000);
  }
});
