/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import type {
  IContent,
  InlineMediaBlock,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { replaySession } from '../recording/ReplayEngine.js';
import { SessionRecordingService } from '../recording/SessionRecordingService.js';
import { LocalMediaStore } from './local-media-store.js';
import { MediaAdmissionService } from './media-admission-service.js';
import { SessionPersistenceService } from './SessionPersistenceService.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

function useTempDirectory(): () => string {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-media-session-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return () => directory;
}

function inlineContent(): IContent {
  return {
    speaker: 'human',
    blocks: [
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: PNG_BASE64,
      },
    ],
    metadata: { turnId: 'turn-media' },
  };
}

function referenceFrom(content: IContent): MediaReferenceBlock {
  const block = content.blocks[0];
  if (block.type !== 'media' || block.encoding !== 'reference') {
    throw new Error('Expected media reference');
  }
  return block;
}

class ReplayDiagnosticFailureStore extends LocalMediaStore {
  override async readVerified(
    _reference: MediaReferenceBlock,
  ): Promise<Uint8Array> {
    throw new Error('verification unavailable');
  }

  override async release(contentId: string, ownerId: string): Promise<void> {
    let releaseFailure: unknown;
    try {
      await super.release(contentId, ownerId);
    } catch (error) {
      releaseFailure = error;
    }
    throw releaseFailure ?? new Error('release unavailable');
  }
}

async function closeMediaStores(
  stores: readonly LocalMediaStore[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const store of [...stores].reverse()) {
    try {
      await store.close();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Failed to close media stores');
  }
}

describe('media-session-lifecycle', () => {
  describe('media recording and persistence lifecycle', () => {
    const tempDirectory = useTempDirectory();

    it('records references without raw bytes or absolute paths and replays verified media', async () => {
      const store = new LocalMediaStore({
        rootDirectory: join(tempDirectory(), 'media'),
        quotaBytes: 1024,
      });
      const admitted = await new MediaAdmissionService(store).admitContent(
        inlineContent(),
        { turnId: 'turn-media', source: 'clipboard' },
      );
      const chatsDir = join(tempDirectory(), 'chats');
      const recording = new SessionRecordingService({
        sessionId: 'session-media',
        projectHash: 'project-hash',
        chatsDir,
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
      });
      try {
        recording.recordContent(admitted);
        await recording.flush();
        const filePath = recording.getFilePath();
        assertNotNull(filePath, 'Expected materialized recording');
        const serialized = await readFile(filePath, 'utf8');
        const replay = await replaySession(filePath, 'project-hash', {
          mediaStore: store,
        });
        const versions = serialized
          .trim()
          .split('\n')
          .map((line) => {
            const parsed: unknown = JSON.parse(line);
            if (
              typeof parsed !== 'object' ||
              parsed === null ||
              !('v' in parsed)
            ) {
              throw new Error('Expected versioned recording line');
            }
            return parsed.v;
          });
        expect(versions).toStrictEqual([1, 2]);
        expect(serialized).not.toContain(PNG_BASE64);
        expect(serialized).not.toContain(tempDirectory());
        expect(replay.ok).toBe(true);
        if (!replay.ok) throw new Error(replay.error);
        expect(referenceFrom(replay.history[0]).contentId).toBe(
          referenceFrom(admitted).contentId,
        );
      } finally {
        await recording.dispose();
      }
    });

    it('persists exact media semantics without ingestion paths or raw media', async () => {
      const store = new LocalMediaStore({
        rootDirectory: join(tempDirectory(), 'media-private'),
        quotaBytes: 1024,
      });
      const sourcePath = join(tempDirectory(), 'private', 'diagram.png');
      const caption =
        'Architecture diagram from /Users/example/provider-captions/diagram.png';
      const filename = 'provider-assets/diagrams/diagram.png';
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
      const admitted = await new MediaAdmissionService(store).admitContent(
        {
          speaker: 'human',
          blocks: [media],
          metadata: { turnId: 'turn-private-recording' },
        },
        { turnId: 'turn-private-recording', source: 'at-command' },
      );
      const recording = new SessionRecordingService({
        sessionId: 'session-private-media',
        projectHash: 'project-hash',
        chatsDir: join(tempDirectory(), 'chats-private'),
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
      });

      try {
        recording.recordContent(admitted);
        await recording.flush();
        const filePath = recording.getFilePath();
        assertNotNull(filePath, 'Expected materialized recording');
        const serialized = await readFile(filePath, 'utf8');

        expect(serialized).toContain(JSON.stringify(caption));
        expect(serialized).toContain(JSON.stringify(filename));
        expect(serialized).toContain(JSON.stringify(providerMetadata));
        expect(serialized).not.toContain(sourcePath);
        expect(serialized).not.toContain(PNG_BASE64);
      } finally {
        await recording.dispose();
      }
    });

    it('accepts legacy inline replay without a media store', async () => {
      const filePath = join(tempDirectory(), 'legacy.jsonl');
      const records = [
        {
          v: 1,
          seq: 1,
          ts: '2026-08-23T00:00:00.000Z',
          type: 'session_start',
          payload: {
            sessionId: 'legacy',
            projectHash: 'project-hash',
            workspaceDirs: [],
            provider: 'test',
            model: 'test',
            startTime: '2026-08-23T00:00:00.000Z',
          },
        },
        {
          v: 1,
          seq: 2,
          ts: '2026-08-23T00:00:01.000Z',
          type: 'content',
          payload: { content: inlineContent() },
        },
      ];
      await writeFile(
        filePath,
        records.map((record) => JSON.stringify(record)).join('\n'),
      );

      const replay = await replaySession(filePath, 'project-hash');

      expect(replay.ok).toBe(true);
      if (!replay.ok) throw new Error(replay.error);
      expect(replay.history[0]).toStrictEqual(inlineContent());
    });

    it('migrates legacy inline local media during replay while preserving URL media', async () => {
      const store = new LocalMediaStore({
        rootDirectory: join(tempDirectory(), 'replay-media'),
        quotaBytes: 1024,
      });
      const filePath = join(tempDirectory(), 'legacy-with-store.jsonl');
      const legacyContent: IContent = {
        ...inlineContent(),
        blocks: [
          ...inlineContent().blocks,
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'url',
            data: 'https://example.test/image.png',
          },
        ],
      };
      const records = [
        {
          v: 1,
          seq: 1,
          ts: '2026-08-23T00:00:00.000Z',
          type: 'session_start',
          payload: {
            sessionId: 'legacy-with-store',
            projectHash: 'project-hash',
            workspaceDirs: [],
            provider: 'test',
            model: 'test',
            startTime: '2026-08-23T00:00:00.000Z',
          },
        },
        {
          v: 1,
          seq: 2,
          ts: '2026-08-23T00:00:01.000Z',
          type: 'content',
          payload: { content: legacyContent },
        },
      ];
      await writeFile(
        filePath,
        records.map((record) => JSON.stringify(record)).join('\n'),
      );

      const replay = await replaySession(filePath, 'project-hash', {
        mediaStore: store,
      });

      expect(replay.ok).toBe(true);
      if (!replay.ok) throw new Error(replay.error);
      const localBlock = replay.history[0].blocks[0];
      if (localBlock.type !== 'media') throw new Error('Expected local media');
      expect(localBlock.encoding).toBe('reference');
      expect(replay.history[0].blocks[1]).toStrictEqual(
        legacyContent.blocks[1],
      );
    });

    it('rejects malformed, missing, and corrupt references after closing each store before external mutation', async () => {
      const mediaRoot = join(tempDirectory(), 'media');
      const sourceStore = new LocalMediaStore({
        rootDirectory: mediaRoot,
        quotaBytes: 1024,
      });
      const stores = [sourceStore];
      try {
        const admitted = await new MediaAdmissionService(
          sourceStore,
        ).admitContent(inlineContent(), {
          turnId: 'turn-media',
          source: 'generated-image',
        });
        const reference = referenceFrom(admitted);
        const objectPath = join(
          mediaRoot,
          'objects',
          'sha256',
          reference.contentId.slice('sha256:'.length),
        );
        await sourceStore.close();

        const verificationStore = new LocalMediaStore({
          rootDirectory: mediaRoot,
          quotaBytes: 1024,
        });
        stores.push(verificationStore);
        const cases: readonly IContent[] = [
          {
            ...admitted,
            blocks: [{ ...reference, contentId: 'invalid' }],
          },
          admitted,
          admitted,
        ];
        const outcomes: Array<{
          readonly ok: boolean;
          readonly error: string | undefined;
        }> = [];

        for (const [index, content] of cases.entries()) {
          const filePath = join(tempDirectory(), `case-${index}.jsonl`);
          const records = [
            {
              v: 1,
              seq: 1,
              ts: '2026-08-23T00:00:00.000Z',
              type: 'session_start',
              payload: {
                sessionId: `case-${index}`,
                projectHash: 'project-hash',
                workspaceDirs: [],
                provider: 'test',
                model: 'test',
                startTime: '2026-08-23T00:00:00.000Z',
              },
            },
            {
              v: 1,
              seq: 2,
              ts: '2026-08-23T00:00:01.000Z',
              type: 'content',
              payload: { content },
            },
          ];
          await writeFile(
            filePath,
            records.map((record) => JSON.stringify(record)).join('\n'),
          );
          if (index === 1) {
            await rm(objectPath);
          }
          if (index === 2) {
            await verificationStore.close();
            await writeFile(objectPath, new Uint8Array(reference.byteLength));
          }
          const replayStore =
            index === 2
              ? new LocalMediaStore({
                  rootDirectory: mediaRoot,
                  quotaBytes: 1024,
                })
              : verificationStore;
          if (index === 2) stores.push(replayStore);
          const replay = await replaySession(filePath, 'project-hash', {
            mediaStore: replayStore,
          });
          outcomes.push({
            ok: replay.ok,
            error: replay.ok ? undefined : replay.error,
          });
          if (index === 1) {
            await verificationStore.admit({
              bytes: Buffer.from(PNG_BASE64, 'base64'),
              mimeType: 'image/png',
              dimensions: { width: 1, height: 1 },
              semanticMetadata: {},
            });
          }
        }

        expect(outcomes.map((outcome) => outcome.ok)).toStrictEqual([
          false,
          false,
          false,
        ]);
        expect(outcomes[0]?.error).toContain('contentId=invalid');
        expect(outcomes[1]?.error).toContain(reference.contentId);
        expect(outcomes[2]?.error).toContain(reference.contentId);
        for (const outcome of outcomes) {
          expect(outcome.error).toContain('turn=turn-media');
        }
      } finally {
        await closeMediaStores(stores);
      }
    });

    it('preserves content and turn diagnostics when replay verification and release both fail', async () => {
      const mediaRoot = join(tempDirectory(), 'aggregate-replay-media');
      const sourceStore = new LocalMediaStore({
        rootDirectory: mediaRoot,
        quotaBytes: 1024,
      });
      const reference = await sourceStore.admit({
        bytes: new Uint8Array([31, 32, 33]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      });
      const recording = new SessionRecordingService({
        sessionId: 'aggregate-replay',
        projectHash: 'project-hash',
        chatsDir: join(tempDirectory(), 'aggregate-replay-chats'),
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
      });

      try {
        recording.recordContent({
          speaker: 'human',
          blocks: [reference],
          metadata: { turnId: 'aggregate-replay-turn' },
        });
        await recording.flush();
        const filePath = recording.getFilePath();
        assertNotNull(filePath, 'Expected materialized recording');
        const failingStore = new ReplayDiagnosticFailureStore({
          rootDirectory: mediaRoot,
          quotaBytes: 1024,
        });

        const replay = await replaySession(filePath, 'project-hash', {
          mediaStore: failingStore,
        });

        expect(replay.ok).toBe(false);
        if (replay.ok) throw new Error('Expected replay failure');
        expect(replay.error).toContain(reference.contentId);
        expect(replay.error).toContain('turn=aggregate-replay-turn');
        expect(replay.error).toContain('verification unavailable');
        expect(replay.error).toContain('release unavailable');
      } finally {
        await recording.dispose();
      }
    });

    it('persists reference sessions with bounded byte accounting and verifies on restore', async () => {
      const projectRoot = join(tempDirectory(), 'project');
      const storage = new Storage(projectRoot);
      const store = new LocalMediaStore({
        rootDirectory: join(storage.getProjectTempDir(), 'media'),
        quotaBytes: 1024,
      });
      const admitted = await new MediaAdmissionService(store).admitContent(
        inlineContent(),
        { turnId: 'turn-media', source: 'acp-image' },
      );
      const service = new SessionPersistenceService(storage, 'session-media', {
        mediaStore: store,
        maxQueueBytes: 1024 * 1024,
      });

      await service.save([admitted]);
      await expect(
        store.readVerified(referenceFrom(admitted)),
      ).resolves.toBeInstanceOf(Uint8Array);
      const restored = await service.loadMostRecent();

      expect(service.getPendingByteCount()).toBe(0);
      expect(restored?.history[0]).toStrictEqual(admitted);
      const serialized = await readFile(service.getSessionFilePath(), 'utf8');
      expect(serialized).not.toContain(PNG_BASE64);
      expect(serialized).not.toContain(projectRoot);
      await rm(storage.getProjectTempDir(), { recursive: true, force: true });
    });
  });
});
