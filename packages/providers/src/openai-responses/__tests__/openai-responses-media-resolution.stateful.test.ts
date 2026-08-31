/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import {
  createCodexResponsesWebSocketTransport,
  type WebSocketTransport,
} from '../openAIResponsesWebSocketTransport.js';
import {
  completingScript,
  SocketHarness,
} from '../openAIResponsesWebSocketTransport.test-helpers.js';
import { buildCodexOAuthManager } from '../codexStateful.test-helpers.js';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const originalFetch = global.fetch;

class SocketCodexProvider extends OpenAIResponsesProvider {
  constructor(private readonly harness: SocketHarness) {
    super('codex-api-key', CODEX_BASE_URL, undefined, buildCodexOAuthManager());
  }

  protected override createWebSocketTransport(): WebSocketTransport {
    return createCodexResponsesWebSocketTransport({
      openSocket: this.harness.openSocket,
    });
  }
}

function useTempDirectory(): () => string {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-responses-media-'));
  });
  afterEach(async () => {
    global.fetch = originalFetch;
    if (directory !== '') {
      await chmod(directory, 0o700).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
  return () => directory;
}

function completedResponse(id: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: {"type":"response.output_text.delta","delta":"ok"}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `data: {"type":"response.completed","response":{"id":"${id}","status":"completed"}}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function parentRejectedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: "Previous response with id 'resp_parent' not found",
        type: 'invalid_request_error',
      },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );
}

function history(
  beforeParent: MediaReferenceBlock,
  afterParent: MediaReferenceBlock,
  parentBaseURL = OPENAI_BASE_URL,
): IContent[] {
  return [
    {
      speaker: 'human',
      metadata: { turnId: 'turn-before-parent' },
      blocks: [beforeParent],
    },
    {
      speaker: 'ai',
      metadata: {
        id: 'resp_parent',
        responsesStored: true,
        providerBaseURL: parentBaseURL,
        turnId: 'turn-parent',
      },
      blocks: [{ type: 'text', text: 'stored response' }],
    },
    {
      speaker: 'human',
      metadata: { turnId: 'turn-after-parent' },
      blocks: [afterParent],
    },
  ];
}

function objectPath(
  store: LocalMediaStore,
  reference: MediaReferenceBlock,
): string {
  return join(
    store.rootDirectory,
    'objects',
    'sha256',
    reference.contentId.slice('sha256:'.length),
  );
}

async function runRequest(
  provider: OpenAIResponsesProvider,
  contents: IContent[],
  resolver: RequestMediaResolver,
  budget: number,
  stateful = true,
): Promise<void> {
  const settings = new SettingsService();
  settings.setProviderSetting(provider.name, 'model', 'gpt-5.6');
  const config = createRuntimeConfigStub(settings);
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    config,
    runtimeId: 'responses-media-stateful',
    mediaResolver: resolver,
    requestMediaBudgetBytes: budget,
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: provider.name,
    ephemeralsSnapshot: { 'responses-stateful': stateful },
  });
  const options = createProviderCallOptions({
    providerName: provider.name,
    contents,
    settings,
    config,
    runtime,
    invocation,
    ephemerals: { 'responses-stateful': stateful },
  });

  for await (const _content of provider.generateChatCompletion(options)) {
    // Drain the real transport parser.
  }
}

async function admitted(
  store: LocalMediaStore,
  bytes: Uint8Array,
): Promise<MediaReferenceBlock> {
  return store.admit({
    bytes,
    mimeType: 'image/png',
    semanticMetadata: { variantPolicy: 'admitted-v1' },
  });
}

describe('openai-responses-media-resolution', () => {
  describe('OpenAI Responses stateful media resolution', () => {
    const tempDirectory = useTempDirectory();

    it('reads only post-parent media when the stateful parent is usable', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 1024,
      });
      const beforeParent = await admitted(store, new Uint8Array([1, 2, 3]));
      const afterParent = await admitted(store, new Uint8Array([4, 5, 6]));
      await unlink(objectPath(store, beforeParent));
      const resolver = new RequestMediaResolver(store);
      const requestBodies: string[] = [];
      global.fetch = async (_input, init): Promise<Response> => {
        requestBodies.push(await new Response(init?.body).text());
        return completedResponse('resp_next');
      };
      const provider = new OpenAIResponsesProvider('test-key', OPENAI_BASE_URL);

      await runRequest(
        provider,
        history(beforeParent, afterParent),
        resolver,
        beforeParent.normalizedBase64Length +
          afterParent.normalizedBase64Length,
      );

      expect(requestBodies).toHaveLength(1);
      expect(requestBodies[0]).not.toContain('AQID');
      expect(requestBodies[0]).toContain('BAUG');
      expect(requestBodies[0]).toContain(
        '"previous_response_id":"resp_parent"',
      );
      expect(resolver.accounting()).toStrictEqual({
        activeRequestCount: 0,
        reservedContentCount: 0,
        materializedNormalizedBytes: 0,
        storeReadCount: 1,
      });
    });

    it('releases the suffix and resolves exact full history after parent rejection', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 1024,
      });
      const beforeParent = await admitted(store, new Uint8Array([1, 2, 3]));
      const afterParent = await admitted(store, new Uint8Array([4, 5, 6]));
      const resolver = new RequestMediaResolver(store);
      const requestBodies: string[] = [];
      global.fetch = async (_input, init): Promise<Response> => {
        requestBodies.push(await new Response(init?.body).text());
        return requestBodies.length === 1
          ? parentRejectedResponse()
          : completedResponse('resp_recovered');
      };
      const provider = new OpenAIResponsesProvider('test-key', OPENAI_BASE_URL);

      await runRequest(
        provider,
        history(beforeParent, afterParent),
        resolver,
        beforeParent.normalizedBase64Length +
          afterParent.normalizedBase64Length,
      );

      expect(requestBodies).toHaveLength(2);
      expect(requestBodies[1]).toContain('AQID');
      expect(requestBodies[1]).toContain('BAUG');
      expect(requestBodies[1]).not.toContain('previous_response_id');
      expect(resolver.accounting()).toStrictEqual({
        activeRequestCount: 0,
        reservedContentCount: 0,
        materializedNormalizedBytes: 0,
        storeReadCount: 3,
      });
    });

    it('resolves full history when the stored parent belongs to another endpoint', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 1024,
      });
      const beforeParent = await admitted(store, new Uint8Array([1, 2, 3]));
      const afterParent = await admitted(store, new Uint8Array([4, 5, 6]));
      const resolver = new RequestMediaResolver(store);
      const requestBodies: string[] = [];
      global.fetch = async (_input, init): Promise<Response> => {
        requestBodies.push(await new Response(init?.body).text());
        return completedResponse('resp_endpoint');
      };
      const provider = new OpenAIResponsesProvider('test-key', OPENAI_BASE_URL);

      await runRequest(
        provider,
        history(beforeParent, afterParent, 'https://other.example/v1'),
        resolver,
        beforeParent.normalizedBase64Length +
          afterParent.normalizedBase64Length,
      );

      expect(requestBodies[0]).toContain('AQID');
      expect(requestBodies[0]).toContain('BAUG');
      expect(requestBodies[0]).not.toContain('previous_response_id');
      expect(resolver.accounting().storeReadCount).toBe(2);
    });

    it('resolves exact full history when stateful policy invalidates the chain', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 1024,
      });
      const beforeParent = await admitted(store, new Uint8Array([1, 2, 3]));
      const afterParent = await admitted(store, new Uint8Array([4, 5, 6]));
      const resolver = new RequestMediaResolver(store);
      const requestBodies: string[] = [];
      global.fetch = async (_input, init): Promise<Response> => {
        requestBodies.push(await new Response(init?.body).text());
        return completedResponse('resp_stateless');
      };
      const provider = new OpenAIResponsesProvider('test-key', OPENAI_BASE_URL);

      await runRequest(
        provider,
        history(beforeParent, afterParent),
        resolver,
        beforeParent.normalizedBase64Length +
          afterParent.normalizedBase64Length,
        false,
      );

      expect(requestBodies).toHaveLength(1);
      expect(requestBodies[0]).toContain('AQID');
      expect(requestBodies[0]).toContain('BAUG');
      expect(requestBodies[0]).not.toContain('previous_response_id');
      expect(resolver.accounting().storeReadCount).toBe(2);
    });

    it('sends only the exact post-parent media bytes over the Codex WebSocket', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 1024,
      });
      const beforeParent = await admitted(store, new Uint8Array([1, 2, 3]));
      const afterParent = await admitted(store, new Uint8Array([4, 5, 6]));
      await unlink(objectPath(store, beforeParent));
      const resolver = new RequestMediaResolver(store);
      const harness = new SocketHarness([completingScript('ok')]);
      const provider = new SocketCodexProvider(harness);

      await runRequest(
        provider,
        history(beforeParent, afterParent, CODEX_BASE_URL),
        resolver,
        afterParent.normalizedBase64Length,
      );

      expect(harness.sockets).toHaveLength(1);
      const wireBody = harness.sockets[0]?.sent[0];
      expect(wireBody).toBeDefined();
      expect(wireBody).toContain('BAUG');
      expect(wireBody).not.toContain('AQID');
      expect(wireBody).toContain('previous_response_id');
      expect(resolver.accounting()).toStrictEqual({
        activeRequestCount: 0,
        reservedContentCount: 0,
        materializedNormalizedBytes: 0,
        storeReadCount: 1,
      });
    });
    it.each(['missing', 'corrupt', 'hash-mismatch', 'over-budget'])(
      'fails %s post-parent media before Codex socket or HTTP submission',
      async (failure) => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const beforeParent = await admitted(store, new Uint8Array([1, 2, 3]));
        const invalid = await admitted(store, new Uint8Array([4, 5, 6]));
        if (failure === 'missing') {
          await unlink(objectPath(store, invalid));
        } else if (failure === 'corrupt') {
          await writeFile(objectPath(store, invalid), new Uint8Array([4]));
        } else if (failure === 'hash-mismatch') {
          await writeFile(
            objectPath(store, invalid),
            new Uint8Array([7, 8, 9]),
          );
        }
        const resolver = new RequestMediaResolver(store);
        const harness = new SocketHarness([completingScript('unreachable')]);
        let httpSubmissions = 0;
        global.fetch = async (): Promise<Response> => {
          httpSubmissions += 1;
          return completedResponse('unreachable');
        };
        const provider = new SocketCodexProvider(harness);
        const budget =
          failure === 'over-budget'
            ? invalid.normalizedBase64Length - 1
            : invalid.normalizedBase64Length;

        const error = await runRequest(
          provider,
          history(beforeParent, invalid, CODEX_BASE_URL),
          resolver,
          budget,
        ).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(Error);
        expect(String(error)).toContain('turn-after-parent');
        expect(harness.sockets).toHaveLength(0);
        expect(httpSubmissions).toBe(0);
        expect(resolver.accounting().activeRequestCount).toBe(0);
        expect(await store.hasReservations(invalid.contentId)).toBe(false);
      },
    );

    it('rebuilds exact full media history for Codex HTTP fallback after transport loss', async () => {
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 1024,
      });
      const beforeParent = await admitted(store, new Uint8Array([1, 2, 3]));
      const afterParent = await admitted(store, new Uint8Array([4, 5, 6]));
      const resolver = new RequestMediaResolver(store);
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () =>
            socket.serverClose({
              code: 1006,
              reason: 'transport lost',
              wasClean: false,
            });
        },
      ]);
      const requestBodies: string[] = [];
      global.fetch = async (_input, init): Promise<Response> => {
        requestBodies.push(await new Response(init?.body).text());
        return completedResponse('resp_http_fallback');
      };
      const provider = new SocketCodexProvider(harness);

      await runRequest(
        provider,
        history(beforeParent, afterParent, CODEX_BASE_URL),
        resolver,
        beforeParent.normalizedBase64Length +
          afterParent.normalizedBase64Length,
      );

      expect(harness.sockets).toHaveLength(1);
      expect(requestBodies).toHaveLength(1);
      expect(requestBodies[0]).toContain('AQID');
      expect(requestBodies[0]).toContain('BAUG');
      expect(requestBodies[0]).not.toContain('previous_response_id');
      expect(resolver.accounting()).toStrictEqual({
        activeRequestCount: 0,
        reservedContentCount: 0,
        materializedNormalizedBytes: 0,
        storeReadCount: 3,
      });
    });

    it.each(['missing', 'corrupt', 'hash-mismatch', 'over-budget'])(
      'fails %s full-history media before network submission',
      async (failure) => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const invalid = await admitted(store, new Uint8Array([1, 2, 3]));
        const afterParent = await admitted(store, new Uint8Array([4, 5, 6]));
        if (failure === 'missing') {
          await unlink(objectPath(store, invalid));
        } else if (failure === 'corrupt') {
          await writeFile(objectPath(store, invalid), new Uint8Array([9]));
        } else if (failure === 'hash-mismatch') {
          await writeFile(
            objectPath(store, invalid),
            new Uint8Array([9, 9, 9]),
          );
        }
        const resolver = new RequestMediaResolver(store);
        let networkSubmissionCount = 0;
        global.fetch = async (): Promise<Response> => {
          networkSubmissionCount += 1;
          return completedResponse('unexpected');
        };
        const provider = new OpenAIResponsesProvider(
          'test-key',
          OPENAI_BASE_URL,
        );
        const fullBudget =
          invalid.normalizedBase64Length + afterParent.normalizedBase64Length;
        const budget =
          failure === 'over-budget'
            ? invalid.normalizedBase64Length - 1
            : fullBudget;

        const error = await runRequest(
          provider,
          history(invalid, afterParent, 'https://other.example/v1'),
          resolver,
          budget,
        ).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(Error);
        expect(String(error)).toContain('turn-before-parent');
        expect(networkSubmissionCount).toBe(0);
        expect(resolver.accounting().activeRequestCount).toBe(0);
        expect(await store.hasReservations(invalid.contentId)).toBe(false);
      },
    );
  });
});
