/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertInstanceOf } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '../services/history/HistoryService.js';
import type {
  IContent,
  InlineMediaBlock,
} from '../services/history/IContent.js';
import { LocalMediaStore } from './local-media-store.js';
import { MediaAdmissionService } from './media-admission-service.js';

describe('media-admission-service', () => {
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

  function useTempDirectory(): () => string {
    let directory = '';
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'llxprt-media-admission-'));
    });
    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });
    return () => directory;
  }

  function imageContent(data = PNG_BASE64): IContent {
    return {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'inspect this image' },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data,
          caption: 'one pixel',
          filename: 'pixel.png',
          providerMetadata: { detail: 'high' },
        },
      ],
      metadata: { turnId: 'turn-7' },
    };
  }

  describe('media-admission-service', () => {
    describe('MediaAdmissionService', () => {
      const tempDirectory = useTempDirectory();

      it('admits base64 image bytes before adding immutable references to history', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const admission = new MediaAdmissionService(store);
        const history = new HistoryService();

        await admission.addToHistory(history, imageContent(), {
          turnId: 'turn-7',
          source: 'clipboard',
        });

        const stored = history.getAll()[0];
        expect(stored.blocks[1]).toMatchObject({
          type: 'media',
          encoding: 'reference',
          mimeType: 'image/png',
          dimensions: { width: 1, height: 1 },
          caption: 'one pixel',
          filename: 'pixel.png',
          providerMetadata: { detail: 'high' },
        });
        expect(JSON.stringify(stored)).not.toContain(PNG_BASE64);
      });

      it('releases the exact reservations created for admitted contents', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const admission = new MediaAdmissionService(store);
        const context = {
          turnId: 'session-replay',
          source: 'session-replay',
        } as const;
        const admitted = await admission.admitContents(
          [imageContent()],
          context,
        );
        const admittedContent = admitted.find((_entry, index) => index === 0);
        const block = admittedContent?.blocks.find(
          (_entry, index) => index === 1,
        );
        if (block?.type !== 'media' || block.encoding !== 'reference') {
          throw new Error('Expected admitted media reference');
        }

        const reservedBeforeRelease = await store.hasReservations(
          block.contentId,
        );
        await admission.releaseContents(admitted, context);
        const reservedAfterRelease = await store.hasReservations(
          block.contentId,
        );

        expect({ reservedBeforeRelease, reservedAfterRelease }).toStrictEqual({
          reservedBeforeRelease: true,
          reservedAfterRelease: false,
        });
      });

      it('admits supported image data URIs while preserving media semantics', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const admission = new MediaAdmissionService(store);
        const sourcePath = join(tempDirectory(), 'private', 'pixel.png');
        const media: InlineMediaBlock & { readonly sourcePath: string } = {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: `data:image/png;base64,${PNG_BASE64}`,
          filename: 'provider-assets/pixel.png',
          caption: 'one pixel',
          dimensions: { width: 1, height: 1 },
          semanticMetadata: {
            detail: 'high',
            options: { preserveTransparency: true },
          },
          providerFileIds: { provider: 'file-7' },
          providerMetadata: { detail: 'high', vendorOption: 'exact' },
          sourcePath,
        };
        const content: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'inspect this image' }, media],
        };

        const admitted = await admission.admitContent(content, {
          turnId: 'turn-data-uri',
          source: 'at-command',
        });
        const stored = admitted.blocks[1];
        if (stored.type !== 'media' || stored.encoding !== 'reference') {
          throw new Error('Expected media reference');
        }

        expect(stored).toMatchObject({
          mimeType: 'image/png',
          filename: 'provider-assets/pixel.png',
          caption: 'one pixel',
          dimensions: { width: 1, height: 1 },
          semanticMetadata: {
            detail: 'high',
            options: { preserveTransparency: true },
          },
          providerFileIds: { provider: 'file-7' },
          providerMetadata: { detail: 'high', vendorOption: 'exact' },
        });
        expect('sourcePath' in stored).toBe(false);
        expect(JSON.stringify(stored)).not.toContain(tempDirectory());
        expect(await store.readVerified(stored)).toStrictEqual(
          new Uint8Array(Buffer.from(PNG_BASE64, 'base64')),
        );
      });

      it('preserves model-visible metadata while excluding ingestion paths and raw media', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const admission = new MediaAdmissionService(store);
        const sourcePath = join(tempDirectory(), 'private', 'diagram.png');
        const caption =
          'Architecture diagram from /Users/example/provider-captions/diagram.png';
        const filename = 'provider-assets/diagrams/diagram.png?variant=exact';
        const providerMetadata = {
          detail: 'high',
          vendorOptions: {
            inputPath: '/Users/example/provider-options/diagram.json',
            token: 'provider-semantic-token-3199',
          },
        };
        const media: InlineMediaBlock & { readonly sourcePath: string } = {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: PNG_BASE64,
          filename,
          caption,
          providerMetadata,
          sourcePath,
        };
        const content: IContent = {
          speaker: 'human',
          blocks: [media],
          metadata: { turnId: 'turn-private-metadata' },
        };

        const admitted = await admission.admitContent(content, {
          turnId: 'turn-private-metadata',
          source: 'at-command',
        });
        const block = admitted.blocks[0];
        if (block.type !== 'media' || block.encoding !== 'reference') {
          throw new Error('Expected admitted media reference');
        }
        const serialized = JSON.stringify(admitted);

        expect({
          caption: block.caption,
          filename: block.filename,
          providerMetadata: block.providerMetadata,
        }).toStrictEqual({ caption, filename, providerMetadata });
        expect('sourcePath' in block).toBe(false);
        expect('data' in block).toBe(false);
        expect(serialized).not.toContain(sourcePath);
        expect(serialized).not.toContain(PNG_BASE64);
      });

      it('admits historically supported images whose dimensions are unknown', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 16,
        });
        const admission = new MediaAdmissionService(store);
        const content: IContent = {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              mimeType: 'image/tiff',
              encoding: 'base64',
              data: Buffer.from([1, 2, 3, 4]).toString('base64'),
            },
          ],
        };

        const admitted = await admission.admitContent(content, {
          turnId: 'turn-unknown-dimensions',
          source: 'tool-response',
        });
        const stored = admitted.blocks[0];

        expect(stored).toMatchObject({
          type: 'media',
          encoding: 'reference',
          mimeType: 'image/tiff',
          byteLength: 4,
        });
        expect(
          stored.type === 'media' && 'dimensions' in stored
            ? stored.dimensions
            : undefined,
        ).toBeUndefined();
      });
      it('stores explicit original and selected variants without rerunning transformation policy', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 16,
        });
        const admission = new MediaAdmissionService(store);
        const originalBytes = new Uint8Array([1, 2, 3, 4]);
        const selectedBytes = new Uint8Array([9, 8, 7]);
        const content: IContent = {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              mimeType: 'image/webp',
              encoding: 'base64',
              data: Buffer.from(selectedBytes).toString('base64'),
              originalData: Buffer.from(originalBytes).toString('base64'),
              originalMimeType: 'image/png',
              transformation: {
                policyId: 'image-resize',
                policyVersion: 1,
                parameters: { maxLongEdge: 20 },
              },
            },
          ],
        };

        const admitted = await admission.admitContent(content, {
          turnId: 'turn-derived',
          source: 'read-file',
        });
        const reference = admitted.blocks[0];
        if (reference.type !== 'media' || reference.encoding !== 'reference') {
          throw new Error('Expected media reference');
        }

        expect(reference.transformation).toStrictEqual({
          policyId: 'image-resize',
          policyVersion: 1,
          parameters: { maxLongEdge: 20 },
        });
        expect(
          await store.readObjectVerified(reference.originalObject),
        ).toStrictEqual(originalBytes);
        expect(await store.readVerified(reference)).toStrictEqual(
          selectedBytes,
        );
      });

      it('preserves URL and legacy inline media without storing them', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 0,
        });
        const admission = new MediaAdmissionService(store);
        const providerMetadata = {
          inputPath: '/Users/example/provider-options/media.json',
          token: 'provider-semantic-token-3199',
        };
        const content: IContent = {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'url',
              data: 'https://example.test/image.png',
              caption: '/Users/example/provider-captions/url-image.png',
              filename: 'provider-assets/url-image.png',
              providerMetadata,
            },
            {
              type: 'media',
              mimeType: 'application/pdf',
              encoding: 'base64',
              data: 'AQID',
              caption: '/Users/example/provider-captions/document.pdf',
              filename: 'provider-assets/document.pdf',
              providerMetadata,
            },
          ],
        };

        const admitted = await admission.admitContent(content, {
          turnId: 'turn-url',
          source: 'at-command',
        });

        expect(admitted).toBe(content);
        expect(await store.getStoredByteLength()).toBe(0);
      });

      it('rejects quota failure with turn and media context before history mutation', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1,
        });
        const admission = new MediaAdmissionService(store);
        const history = new HistoryService();

        const work = admission.addToHistory(history, imageContent(), {
          turnId: 'turn-quota',
          source: 'tool-response',
        });

        await expect(work).rejects.toThrow(
          /turn-quota.*tool-response.*media\[0\].*sha256:/,
        );
        expect(history.getAll()).toStrictEqual([]);
      });

      it('rejects malformed base64 before history mutation', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const admission = new MediaAdmissionService(store);
        const history = new HistoryService();

        const work = admission.addToHistory(
          history,
          imageContent('not base64!'),
          {
            turnId: 'turn-invalid',
            source: 'generated-image',
          },
        );

        await expect(work).rejects.toThrow(
          /turn-invalid.*generated-image.*media\[0\]/,
        );
        expect(history.getAll()).toStrictEqual([]);
      });

      it('verifies existing references before provider or history use', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const admission = new MediaAdmissionService(store);
        const admitted = await admission.admitContent(imageContent(), {
          turnId: 'turn-original',
          source: 'clipboard',
        });

        const verified = await admission.admitContent(admitted, {
          turnId: 'turn-reused',
          source: 'restored-history',
        });

        expect(verified).toBe(admitted);
      });

      it('rolls back every earlier reservation when a later media block fails', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const reference = await store.admit({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        const admission = new MediaAdmissionService(store);
        const content: IContent = {
          speaker: 'human',
          metadata: { turnId: 'turn-partial-blocks' },
          blocks: [
            reference,
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: 'not-base64',
            },
          ],
        };

        await expect(
          admission.admitContent(content, {
            turnId: 'turn-partial-blocks',
            source: 'clipboard',
          }),
        ).rejects.toThrow(/media admission failed/i);

        expect(await store.hasReservations(reference.contentId)).toBe(false);
      });

      it('rolls back reservations from earlier contents when a later content fails', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const reference = await store.admit({
          bytes: new Uint8Array([4, 5, 6]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        const admission = new MediaAdmissionService(store);
        const contents: IContent[] = [
          {
            speaker: 'human',
            metadata: { turnId: 'turn-first-content' },
            blocks: [reference],
          },
          {
            speaker: 'human',
            metadata: { turnId: 'turn-second-content' },
            blocks: [
              {
                type: 'media',
                mimeType: 'image/png',
                encoding: 'base64',
                data: 'not-base64',
              },
            ],
          },
        ];

        await expect(
          admission.admitContents(contents, {
            turnId: 'turn-partial-contents',
            source: 'restored-history',
          }),
        ).rejects.toThrow(/turn-second-content/i);

        expect(await store.hasReservations(reference.contentId)).toBe(false);
      });

      it('reports the admission failure and every rollback failure together', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const reference = await store.admit({
          bytes: new Uint8Array([7, 8, 9]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        store.release = () => Promise.reject(new Error('rollback unavailable'));
        const admission = new MediaAdmissionService(store);
        const content: IContent = {
          speaker: 'human',
          metadata: { turnId: 'turn-rollback-failure' },
          blocks: [
            reference,
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: 'not-base64',
            },
          ],
        };

        const error = await admission
          .admitContent(content, {
            turnId: 'turn-rollback-failure',
            source: 'tool-response',
          })
          .catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(AggregateError);
        assertInstanceOf(
          error,
          AggregateError,
          'Expected aggregate admission rollback error',
        );
        expect(error.errors).toHaveLength(2);
        expect(String(error.errors[0])).toContain('turn-rollback-failure');
        expect(String(error.errors[1])).toContain('rollback unavailable');
      });

      it('reports the physical media index when an earlier URL precedes a missing reference', async () => {
        const store = new LocalMediaStore({
          rootDirectory: tempDirectory(),
          quotaBytes: 1024,
        });
        const admission = new MediaAdmissionService(store);
        const admitted = await admission.admitContent(imageContent(), {
          turnId: 'turn-original',
          source: 'clipboard',
        });
        const reference = admitted.blocks[1];
        if (reference.type !== 'media' || reference.encoding !== 'reference') {
          throw new Error('Expected admitted media reference');
        }
        await rm(
          join(
            store.rootDirectory,
            'objects',
            'sha256',
            reference.contentId.slice('sha256:'.length),
          ),
        );
        const content: IContent = {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'url',
              data: 'https://example.test/image.png',
            },
            reference,
          ],
          metadata: { id: 'content-42', turnId: 'turn-reused' },
        };

        const work = admission.admitContent(content, {
          turnId: 'turn-reused',
          source: 'restored-history',
        });

        await expect(work).rejects.toThrow(
          /turn-reused.*restored-history.*media\[1\].*content-42.*sha256:/,
        );
      });
    });
  });
});
