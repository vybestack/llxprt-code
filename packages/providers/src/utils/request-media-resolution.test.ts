/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  IContent,
  InlineMediaBlock,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  LocalMediaStore,
  MediaAdmissionService,
} from '@vybestack/llxprt-code-core';
import {
  RequestMediaResolutionError,
  RequestMediaResolver,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { buildResponsesInputFromContent } from '../openai-responses/buildResponsesInputFromContent.js';
import { buildMessagesWithReasoning } from '../openai/OpenAIRequestBuilder.js';
import { convertToAnthropicMessages } from '../anthropic/AnthropicMessageNormalizer.js';
import * as mediaFormatConverter from '../gemini/GeminiMessageConverter.js';
import { convertToVercelMessages } from '../openai-vercel/messageConversion.js';
import { getContentPreview } from './contentPreview.js';
import { resolveRequestMedia } from './request-media-resolution.js';

describe('request-media-resolution', () => {
  function useTempDirectory(): () => string {
    let directory = '';
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'llxprt-provider-media-'));
    });
    afterEach(async () => {
      if (directory !== '') {
        await chmod(directory, 0o700).catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
      }
    });
    return () => directory;
  }

  interface MediaPresentation {
    readonly mimeType: string;
    readonly caption: string;
    readonly filename: string;
    readonly width: number;
    readonly height: number;
    readonly detail: 'auto' | 'high' | 'low';
    readonly providerFileId: string;
  }

  const DEFAULT_PRESENTATION: MediaPresentation = {
    mimeType: 'image/png',
    caption: 'terminal screenshot',
    filename: 'screen.png',
    width: 3,
    height: 2,
    detail: 'high',
    providerFileId: 'file_stable',
  };

  function inlineMedia(
    data: string,
    presentation = DEFAULT_PRESENTATION,
  ): InlineMediaBlock {
    return {
      type: 'media',
      encoding: 'base64',
      data,
      mimeType: presentation.mimeType,
      caption: presentation.caption,
      filename: presentation.filename,
      providerMetadata: { detail: presentation.detail },
      dimensions: {
        width: presentation.width,
        height: presentation.height,
      },
      semanticMetadata: { source: 'tool', detail: presentation.detail },
      providerFileIds: { kimi: presentation.providerFileId },
    };
  }

  function history(
    media: InlineMediaBlock | MediaReferenceBlock,
    mediaFirst = false,
  ): IContent[] {
    const textBlock = { type: 'text' as const, text: 'capture the terminal' };
    const toolResponseBlock = {
      type: 'tool_response' as const,
      callId: 'call_media',
      toolName: 'screenshot',
      result: 'captured',
    };
    return [
      {
        speaker: 'human',
        metadata: { turnId: 'turn-user' },
        blocks: mediaFirst ? [media, textBlock] : [textBlock, media],
      },
      {
        speaker: 'ai',
        metadata: { turnId: 'turn-tool-call' },
        blocks: [
          {
            type: 'tool_call',
            id: 'call_media',
            name: 'screenshot',
            parameters: { region: 'terminal' },
          },
        ],
      },
      {
        speaker: 'tool',
        metadata: { turnId: 'turn-tool-response' },
        blocks: mediaFirst
          ? [media, toolResponseBlock]
          : [toolResponseBlock, media],
      },
    ];
  }

  function serializedProviderStructures(
    contents: IContent[],
  ): Record<string, string> {
    const settings = { get: (_key: string): unknown => undefined };
    const anthropicOptions = {
      isOAuth: false,
      reasoningEnabled: false,
      config: undefined,
      unprefixToolName: (name: string): string => name,
      logger: { debug: (_message: () => string): void => undefined },
    };
    return {
      responses: JSON.stringify(buildResponsesInputFromContent(contents)),
      chat: JSON.stringify(
        buildMessagesWithReasoning(contents, { settings }, 'openai', undefined),
      ),
      anthropic: JSON.stringify(
        convertToAnthropicMessages(contents, anthropicOptions),
      ),
      multimodal: JSON.stringify(
        mediaFormatConverter.convertHistoryToGeminiFormat(contents),
      ),
      vercel: JSON.stringify(convertToVercelMessages(contents)),
    };
  }

  describe('request-media-resolution', () => {
    describe('provider request media resolution', () => {
      const tempDirectory = useTempDirectory();

      it('produces byte-equivalent provider structures for inline and referenced media', async () => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
        const data = Buffer.from(bytes).toString('base64');
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const reference = await store.admit({
          bytes,
          mimeType: 'image/png',
          dimensions: { width: 3, height: 2 },
          semanticMetadata: { source: 'tool', detail: 'high' },
          providerFileIds: { kimi: 'file_stable' },
        });
        const decoratedReference: MediaReferenceBlock = {
          ...reference,
          caption: 'terminal screenshot',
          filename: 'screen.png',
          providerMetadata: { detail: 'high' },
        };
        const resolver = new RequestMediaResolver(store);
        const runtime = {
          settingsService: new SettingsService(),
          runtimeId: 'provider-parity',
          mediaResolver: resolver,
          requestMediaBudgetBytes: reference.normalizedBase64Length * 2,
        };

        const resolved = await resolveRequestMedia(
          runtime,
          history(decoratedReference),
          undefined,
        );

        expect(
          serializedProviderStructures(
            resolved.withContents((contents) => contents),
          ),
        ).toStrictEqual(
          serializedProviderStructures(history(inlineMedia(data))),
        );
        expect(resolved.accounting().storeReadCount).toBe(1);
        expect(await store.hasReservations(reference.contentId)).toBe(true);
        await resolved.release();
        expect(await store.hasReservations(reference.contentId)).toBe(false);
      });

      it('preserves model media semantics through admission while diagnostics redact them', async () => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6, 7, 8]);
        const data = Buffer.from(bytes).toString('base64');
        const caption =
          'Use the label from /Users/example/provider-captions/hero.png verbatim';
        const filename = 'provider-assets/hero image.png';
        const providerMetadata = {
          detail: 'high',
          vendor: {
            inputPath: '/Users/example/provider-options/image.json',
            token: 'provider-semantic-token-3199',
            sequence: ['first', 'second'],
          },
        };
        const modelVisibleMedia: InlineMediaBlock = {
          type: 'media',
          encoding: 'base64',
          data,
          mimeType: 'image/png',
          caption,
          filename,
          providerMetadata,
          dimensions: { width: 3, height: 2 },
          semanticMetadata: { source: 'tool', detail: 'high' },
          providerFileIds: { kimi: 'file_semantic' },
          providerFiles: [
            {
              provider: 'kimi',
              baseURL: 'https://api.example.test',
              credentialHash: 'credential-hash-semantic',
              fileId: 'file_semantic',
              byteLength: bytes.byteLength,
              scope: 'session',
              scopeId: 'session-semantic',
              createdAt: 1_788_000_000_000,
              expiresAt: 1_788_003_600_000,
              deletion: 'retain',
              zeroDataRetention: 'not-applicable',
              deletionState: 'active',
            },
          ],
        };
        const localSourcePath = join(tempDirectory(), 'private', 'hero.png');
        const sourceMedia: InlineMediaBlock & { readonly sourcePath: string } =
          {
            ...modelVisibleMedia,
            sourcePath: localSourcePath,
          };
        const sourceContent: IContent = {
          speaker: 'human',
          metadata: { turnId: 'turn-semantic-media' },
          blocks: [sourceMedia],
        };
        const expectedContent: IContent = {
          ...sourceContent,
          blocks: [modelVisibleMedia],
        };
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const admitted = await new MediaAdmissionService(store).admitContent(
          sourceContent,
          { turnId: 'turn-semantic-media', source: 'tool-response' },
        );
        const reference = admitted.blocks[0];
        if (reference.type !== 'media' || reference.encoding !== 'reference') {
          throw new Error('Expected admitted media reference');
        }

        expect({
          caption: reference.caption,
          filename: reference.filename,
          providerMetadata: reference.providerMetadata,
        }).toStrictEqual({ caption, filename, providerMetadata });
        expect(reference).not.toHaveProperty('sourcePath');
        expect(reference).not.toHaveProperty('data');

        const diagnostic = getContentPreview([reference], 10_000);
        expect(diagnostic).not.toContain(caption);
        expect(diagnostic).not.toContain(localSourcePath);
        expect(diagnostic).not.toContain('provider-semantic-token-3199');
        expect(diagnostic).not.toContain(data);

        const resolver = new RequestMediaResolver(store);
        const resolved = await resolver.resolve({
          contents: [admitted],
          requestId: 'request-semantic-media',
          turnId: 'turn-semantic-media',
          aggregateBudgetBytes: reference.normalizedBase64Length,
        });

        try {
          const materialized = resolved.withContents((contents) => contents);
          expect(materialized[0]?.blocks[0]).toStrictEqual(modelVisibleMedia);
          expect(serializedProviderStructures(materialized)).toStrictEqual(
            serializedProviderStructures([expectedContent]),
          );
        } finally {
          await resolved.release();
        }
      });

      it('preserves provider request identity across media bytes and presentation metadata', async () => {
        const safeToken = fc
          .array(fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z', '0', '1'), {
            minLength: 1,
            maxLength: 12,
          })
          .map((characters) => characters.join(''));
        const mediaCase = fc.record({
          bytes: fc.uint8Array({ minLength: 1, maxLength: 64 }),
          mimeType: fc.constantFrom(
            'image/png',
            'image/jpeg',
            'image/webp',
            'image/gif',
          ),
          caption: safeToken,
          filename: safeToken.map((name) => `${name}.img`),
          width: fc.integer({ min: 1, max: 4096 }),
          height: fc.integer({ min: 1, max: 4096 }),
          detail: fc.constantFrom('auto', 'high', 'low'),
          providerFileId: safeToken.map((id) => `file_${id}`),
          mediaFirst: fc.boolean(),
        });

        await fc.assert(
          fc.asyncProperty(mediaCase, async (sample) => {
            const presentation: MediaPresentation = {
              mimeType: sample.mimeType,
              caption: sample.caption,
              filename: sample.filename,
              width: sample.width,
              height: sample.height,
              detail: sample.detail,
              providerFileId: sample.providerFileId,
            };
            const store = new LocalMediaStore({
              rootDirectory: tempDirectory(),
              quotaBytes: 1024 * 1024,
            });
            const reference = await store.admit({
              bytes: sample.bytes,
              mimeType: presentation.mimeType,
              dimensions: {
                width: presentation.width,
                height: presentation.height,
              },
              semanticMetadata: {
                source: 'tool',
                detail: presentation.detail,
              },
              providerFileIds: { kimi: presentation.providerFileId },
            });
            const decoratedReference: MediaReferenceBlock = {
              ...reference,
              caption: presentation.caption,
              filename: presentation.filename,
              providerMetadata: { detail: presentation.detail },
            };
            const resolver = new RequestMediaResolver(store);
            const resolved = await resolveRequestMedia(
              {
                settingsService: new SettingsService(),
                runtimeId: 'provider-property-parity',
                mediaResolver: resolver,
                requestMediaBudgetBytes: reference.normalizedBase64Length * 2,
              },
              history(decoratedReference, sample.mediaFirst),
              undefined,
            );

            try {
              const inline = inlineMedia(
                Buffer.from(sample.bytes).toString('base64'),
                presentation,
              );
              expect(
                serializedProviderStructures(
                  resolved.withContents((contents) => contents),
                ),
              ).toStrictEqual(
                serializedProviderStructures(
                  history(inline, sample.mediaFirst),
                ),
              );
            } finally {
              await resolved.release();
            }
          }),
          { numRuns: 25 },
        );
      });

      it('rejects reference metadata over budget before a provider converter runs', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const reference = await store.admit({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        const resolver = new RequestMediaResolver(store);
        const runtime = {
          settingsService: new SettingsService(),
          runtimeId: 'provider-budget',
          mediaResolver: resolver,
          requestMediaBudgetBytes: reference.normalizedBase64Length - 1,
        };

        const error = await resolveRequestMedia(
          runtime,
          history(reference),
          undefined,
        ).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(RequestMediaResolutionError);
        expect(String(error)).toContain(reference.contentId);
        expect(String(error)).toContain('turn-user');
        expect(resolver.accounting().storeReadCount).toBe(0);
        expect(await store.hasReservations(reference.contentId)).toBe(false);
      });

      it('preserves the reason from an already-aborted inline-only request', async () => {
        const controller = new AbortController();
        const abortReason = new DOMException(
          'cancelled media request',
          'AbortError',
        );
        controller.abort(abortReason);
        const contents: IContent[] = [
          {
            speaker: 'human',
            metadata: { turnId: 'turn-aborted-inline' },
            blocks: [inlineMedia('aW1hZ2U=')],
          },
        ];

        const error = await resolveRequestMedia(
          undefined,
          contents,
          controller.signal,
        ).catch((reason: unknown) => reason);

        expect(error).toBe(abortReason);
      });

      it('keeps every provider converter fail-fast for unresolved references', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const reference = await store.admit({
          bytes: new Uint8Array([7, 8, 9]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        const contents = history(reference);
        const settings = { get: (_key: string): unknown => undefined };
        const anthropicOptions = {
          isOAuth: false,
          reasoningEnabled: false,
          config: undefined,
          unprefixToolName: (name: string): string => name,
          logger: { debug: (_message: () => string): void => undefined },
        };

        expect(() => buildResponsesInputFromContent(contents)).toThrow(
          reference.contentId,
        );
        expect(() =>
          buildMessagesWithReasoning(
            contents,
            { settings },
            'openai',
            undefined,
          ),
        ).toThrow(reference.contentId);
        expect(() =>
          convertToAnthropicMessages(contents, anthropicOptions),
        ).toThrow(reference.contentId);
        expect(() =>
          mediaFormatConverter.convertHistoryToGeminiFormat(contents),
        ).toThrow(reference.contentId);
        expect(() => convertToVercelMessages(contents)).toThrow(
          reference.contentId,
        );
      });

      it('runs every unchanged-request cleanup once in LIFO order after a failure', async () => {
        const resolved = await resolveRequestMedia(
          undefined,
          [{ speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] }],
          undefined,
        );
        const order: string[] = [];
        resolved.registerCleanup(() => {
          order.push('first');
        });
        resolved.registerCleanup(() => {
          order.push('failing');
          throw new Error('cleanup failed');
        });
        resolved.registerCleanup(() => {
          order.push('last');
        });

        const error = await resolved
          .release()
          .catch((reason: unknown) => reason);
        await resolved.release();

        expect(error).toBeInstanceOf(AggregateError);
        expect(order).toStrictEqual(['last', 'failing', 'first']);
        expect(resolved.accounting().released).toBe(true);
        expect(() => resolved.withContents((contents) => contents)).toThrow(
          /after release/i,
        );
      });
    });
  });
});
