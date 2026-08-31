/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertDefined } from '@vybestack/llxprt-code-test-utils';
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
import type { IProvider } from '../IProvider.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';

const originalFetch = globalThis.fetch;

type ProviderKind = 'anthropic' | 'chat';
type FailureKind = 'missing' | 'corrupt' | 'hash-mismatch' | 'over-budget';

interface ProviderCase {
  readonly kind: ProviderKind;
  readonly model: string;
  readonly baseURL: string;
}

const PROVIDERS: readonly ProviderCase[] = [
  {
    kind: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    baseURL: 'https://api.anthropic.com',
  },
  {
    kind: 'chat',
    model: 'gpt-4.1',
    baseURL: 'https://api.openai.com/v1',
  },
];
const FAILURES: readonly FailureKind[] = [
  'missing',
  'corrupt',
  'hash-mismatch',
  'over-budget',
];

function useTempDirectory(): () => string {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-provider-media-entry-'));
  });
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (directory !== '') {
      await chmod(directory, 0o700).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
  return () => directory;
}

function providerFor(providerCase: ProviderCase): IProvider {
  return providerCase.kind === 'anthropic'
    ? new AnthropicProvider('test-key', providerCase.baseURL)
    : new OpenAIProvider('test-key', providerCase.baseURL);
}

function successfulResponse(kind: ProviderKind): Response {
  if (kind === 'anthropic') {
    return Response.json({
      id: 'msg_media',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  }
  return Response.json({
    id: 'chatcmpl-media',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

async function requestBodyText(
  body: BodyInit | null | undefined,
): Promise<string> {
  return body === null || body === undefined ? '' : new Response(body).text();
}

async function admitted(
  store: LocalMediaStore,
  bytes: Uint8Array,
  policyVersion: number,
): Promise<MediaReferenceBlock> {
  return store.admit({
    bytes,
    mimeType: 'image/png',
    semanticMetadata: { selectedBy: 'recorded-policy' },
    transformation: {
      policyId: 'image-selection',
      policyVersion,
      parameters: { maxLongEdge: 1024 },
    },
  });
}

function history(references: readonly MediaReferenceBlock[]): IContent[] {
  return references.map((reference, index) => ({
    speaker: 'human',
    metadata: { turnId: `turn-media-${index}` },
    blocks: [{ type: 'text', text: `image ${index}` }, reference],
  }));
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

async function damageReference(
  kind: FailureKind,
  store: LocalMediaStore,
  reference: MediaReferenceBlock,
): Promise<void> {
  if (kind === 'missing') {
    await unlink(objectPath(store, reference));
    return;
  }
  if (kind === 'corrupt') {
    await writeFile(objectPath(store, reference), new Uint8Array([1]));
    return;
  }
  if (kind === 'hash-mismatch') {
    await writeFile(
      objectPath(store, reference),
      new Uint8Array(reference.byteLength).fill(255),
    );
  }
}

function callOptions(
  providerCase: ProviderCase,
  provider: IProvider,
  contents: IContent[],
  resolver: RequestMediaResolver,
  budget: number,
  signal?: AbortSignal,
): ReturnType<typeof createProviderCallOptions> {
  const settings = new SettingsService();
  settings.setProviderSetting(provider.name, 'model', providerCase.model);
  settings.setProviderSetting(provider.name, 'streaming', 'disabled');
  settings.setProviderSetting(provider.name, 'prompt-caching', 'off');
  const config = createRuntimeConfigStub(settings);
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    config,
    runtimeId: `${providerCase.kind}-media-entry`,
    mediaResolver: resolver,
    requestMediaBudgetBytes: budget,
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: provider.name,
    ephemeralsSnapshot: {
      streaming: 'disabled',
      'prompt-caching': 'off',
      retries: 1,
      retrywait: 1,
    },
    ...(signal === undefined ? {} : { signal }),
  });
  return createProviderCallOptions({
    providerName: provider.name,
    contents,
    settings,
    config,
    runtime,
    invocation,
    resolved: {
      model: providerCase.model,
      baseURL: providerCase.baseURL,
      authToken: 'test-key',
    },
  });
}

async function drain(
  provider: IProvider,
  options: ReturnType<typeof callOptions>,
): Promise<void> {
  for await (const _content of provider.generateChatCompletion(options)) {
    // Drain the real provider parser.
  }
}

describe('provider-media-recovery', () => {
  describe('stateless provider media recovery entry points', () => {
    const tempDirectory = useTempDirectory();

    for (const providerCase of PROVIDERS) {
      it(`${providerCase.kind} sends full logical history with the exact recorded selected variants after provider or policy changes`, async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const first = await admitted(store, new Uint8Array([1, 2, 3]), 1);
        const second = await admitted(store, new Uint8Array([9, 8, 7, 6]), 2);
        const resolver = new RequestMediaResolver(store);
        let body = '';
        globalThis.fetch = async (_input, init): Promise<Response> => {
          body = await requestBodyText(init?.body);
          return successfulResponse(providerCase.kind);
        };
        const provider = providerFor(providerCase);

        await drain(
          provider,
          callOptions(
            providerCase,
            provider,
            history([first, second]),
            resolver,
            first.normalizedBase64Length + second.normalizedBase64Length,
          ),
        );

        expect(body).toContain(Buffer.from([1, 2, 3]).toString('base64'));
        expect(body).toContain(Buffer.from([9, 8, 7, 6]).toString('base64'));
        expect(resolver.accounting()).toStrictEqual({
          activeRequestCount: 0,
          reservedContentCount: 0,
          materializedNormalizedBytes: 0,
          storeReadCount: 2,
        });
      });

      for (const failure of FAILURES) {
        it(`${providerCase.kind} fails ${failure} referenced media before network submission`, async () => {
          const store = new LocalMediaStore({
            rootDirectory: tempDirectory(),
            quotaBytes: 1024,
          });
          const reference = await admitted(
            store,
            new Uint8Array([1, 2, 3, 4]),
            1,
          );
          if (failure !== 'over-budget') {
            await damageReference(failure, store, reference);
          }
          const resolver = new RequestMediaResolver(store);
          let networkSubmissionCount = 0;
          globalThis.fetch = async (): Promise<Response> => {
            networkSubmissionCount += 1;
            return successfulResponse(providerCase.kind);
          };
          const provider = providerFor(providerCase);
          const budget =
            failure === 'over-budget'
              ? reference.normalizedBase64Length - 1
              : reference.normalizedBase64Length;

          const error = await drain(
            provider,
            callOptions(
              providerCase,
              provider,
              history([reference]),
              resolver,
              budget,
            ),
          ).catch((reason: unknown) => reason);

          expect(error).toBeInstanceOf(Error);
          expect(String(error)).toContain('turn-media-0');
          expect(networkSubmissionCount).toBe(0);
          expect(resolver.accounting().activeRequestCount).toBe(0);
          expect(await store.hasReservations(reference.contentId)).toBe(false);
        });
      }
    }

    it('releases Chat media reservations when an in-flight request is cancelled', async () => {
      const providerCase = PROVIDERS.find((entry) => entry.kind === 'chat');
      assertDefined(providerCase, 'Chat provider case is missing');
      const store = new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 1024,
      });
      const reference = await admitted(store, new Uint8Array([5, 6, 7]), 1);
      const resolver = new RequestMediaResolver(store);
      const controller = new AbortController();
      let announceStarted = (): void => {
        throw new Error('Request start was not wired');
      };
      const started = new Promise<void>((resolve) => {
        announceStarted = resolve;
      });
      let rejectRequest = (_error: Error): void => {
        throw new Error('Request rejection was not wired');
      };
      globalThis.fetch = async (): Promise<Response> => {
        announceStarted();
        return new Promise<Response>((_resolve, reject) => {
          rejectRequest = reject;
        });
      };
      const provider = providerFor(providerCase);
      const work = drain(
        provider,
        callOptions(
          providerCase,
          provider,
          history([reference]),
          resolver,
          reference.normalizedBase64Length,
          controller.signal,
        ),
      );

      await started;
      expect(await store.hasReservations(reference.contentId)).toBe(true);
      const cancellation = new Error('cancelled by test');
      controller.abort(cancellation);
      rejectRequest(cancellation);
      const error = await work.catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(Error);
      expect(await store.hasReservations(reference.contentId)).toBe(false);
      expect(resolver.accounting().activeRequestCount).toBe(0);
    });
  });
});
