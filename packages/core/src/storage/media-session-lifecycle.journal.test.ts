/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
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
import { JournalRecordingService } from '../recording/journalRecordingService.js';
import {
  JournalResumeBoot,
  resumePointOf,
} from '../recording/journalResume.js';
import { JournalSession } from '../services/history/journalSession.js';
import { readJournalFileFacts } from '../recording/journalSessionListing.js';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { LocalMediaStore } from './local-media-store.js';
import { MediaAdmissionService } from './media-admission-service.js';
import { SessionPersistenceService } from './SessionPersistenceService.js';

function diagnosticMessages(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return [
    error.message,
    ...(error instanceof AggregateError
      ? error.errors.map(diagnosticMessages)
      : []),
    ...(error.cause === undefined ? [] : [diagnosticMessages(error.cause)]),
  ].join('\n');
}

describe('media-session-lifecycle', () => {
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
        const recording = JournalRecordingService.create({
          sessionId: 'session-media',
          projectHash: 'project-hash',
          chatsDir,
          workspaceDirs: [],
          provider: 'test',
          model: 'test',
        });
        try {
          await (await recording.session()).append([admitted]);
          await recording.flush();
          const filePath = recording.getFilePath();
          assertNotNull(filePath, 'Expected materialized recording');
          const serialized = await readFile(filePath, 'utf8');
          await recording.dispose();
          const rows = await nativeRows(filePath, store);
          expect(serialized.slice(0, 8)).toBe('LLXJRNL\0');
          expect(serialized).not.toContain(PNG_BASE64);
          expect(serialized).not.toContain(tempDirectory());
          expect(referenceFrom(rows[0]).contentId).toBe(
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
        const recording = JournalRecordingService.create({
          sessionId: 'session-private-media',
          projectHash: 'project-hash',
          chatsDir: join(tempDirectory(), 'chats-private'),
          workspaceDirs: [],
          provider: 'test',
          model: 'test',
        });

        try {
          await (await recording.session()).append([admitted]);
          await recording.flush();
          const filePath = recording.getFilePath();
          assertNotNull(filePath, 'Expected materialized recording');
          const serialized = await readFile(filePath, 'utf8');
          await recording.dispose();

          expect(serialized).toContain(JSON.stringify(caption));
          expect(serialized).toContain(JSON.stringify(filename));
          expect(serialized).toContain(JSON.stringify(providerMetadata));
          expect(serialized).not.toContain(sourcePath);
          expect(serialized).not.toContain(PNG_BASE64);
        } finally {
          await recording.dispose();
        }
      });

      it('refuses retired inline recordings with the exact file diagnostic', async () => {
        const filePath = join(tempDirectory(), 'legacy.jsonl');
        await writeFile(
          filePath,
          JSON.stringify({
            v: 1,
            seq: 1,
            type: 'content',
            payload: { content: inlineContent() },
          }) + '\n',
        );
        await expect(JournalSession.open(filePath)).rejects.toThrow(
          retiredJournalMessage(filePath),
        );
      });

      it('reads native inline media without a media store', async () => {
        const recording = await nativeFixture(
          tempDirectory(),
          'inline',
          inlineContent(),
        );
        try {
          const filePath = requirePath(recording);
          await recording.dispose();
          const rows = await nativeRows(filePath);
          expect(rows[0]).toStrictEqual(inlineContent());
        } finally {
          await recording.dispose();
        }
      });

      it('records admitted local media while preserving URL media', async () => {
        const store = new LocalMediaStore({
          rootDirectory: join(tempDirectory(), 'replay-media'),
          quotaBytes: 1024,
        });
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
        const admitted = await new MediaAdmissionService(store).admitContent(
          legacyContent,
          { turnId: 'turn-media', source: 'native-recording' },
        );
        const recording = await nativeFixture(
          tempDirectory(),
          'admitted',
          admitted,
        );
        try {
          const filePath = requirePath(recording);
          await recording.dispose();
          const rows = await nativeRows(filePath, store);
          const localBlock = rows[0].blocks[0];
          if (localBlock.type !== 'media')
            throw new Error('Expected local media');
          expect(localBlock.encoding).toBe('reference');
          expect(rows[0].blocks[1]).toStrictEqual(legacyContent.blocks[1]);
        } finally {
          await recording.dispose();
          await store.close();
        }
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
            const recording = await nativeFixture(
              tempDirectory(),
              'case-' + index,
              content,
            );
            const filePath = requirePath(recording);
            await recording.dispose();
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
            const error = await nativeRows(filePath, replayStore).then(
              () => undefined,
              (failure: unknown) => failure,
            );
            outcomes.push({
              ok: error === undefined,
              error: error instanceof Error ? error.message : undefined,
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

      it('preserves native read verification diagnostics without creating a replay reservation', async () => {
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
        const recording = JournalRecordingService.create({
          sessionId: 'aggregate-replay',
          projectHash: 'project-hash',
          chatsDir: join(tempDirectory(), 'aggregate-replay-chats'),
          workspaceDirs: [],
          provider: 'test',
          model: 'test',
        });

        try {
          await (
            await recording.session()
          ).append([
            {
              speaker: 'human',
              blocks: [reference],
              metadata: { turnId: 'aggregate-replay-turn' },
            },
          ]);
          await recording.flush();
          const filePath = recording.getFilePath();
          assertNotNull(filePath, 'Expected materialized recording');
          await recording.dispose();
          const failingStore = new ReplayDiagnosticFailureStore({
            rootDirectory: mediaRoot,
            quotaBytes: 1024,
          });

          const failure = await nativeRows(filePath, failingStore).then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(failure).toBeInstanceOf(Error);
          if (!(failure instanceof Error)) throw failure;
          expect(failure.message).toContain(reference.contentId);
          expect(failure.message).toContain('turn=aggregate-replay-turn');
          expect(failure.cause).toBeInstanceOf(Error);
          if (!(failure.cause instanceof Error)) throw failure.cause;
          expect(failure.cause.message).toContain('verification unavailable');
          expect(await failingStore.hasReservations(reference.contentId)).toBe(
            false,
          );
          const persistenceConfig = {
            projectRoot: tempDirectory(),
            chatsDir: join(tempDirectory(), 'aggregate-persistence'),
          };
          const persisted = new SessionPersistenceService(
            persistenceConfig,
            'aggregate-persistence',
            { mediaStore: sourceStore },
          );
          await collectJournalFileRowsForAssertions(filePath, async (rows) => {
            await persisted.save([...rows]);
          });
          const loader = new SessionPersistenceService(
            persistenceConfig,
            'aggregate-persistence',
            { mediaStore: failingStore },
          );
          const loadFailure = await loader.loadMostRecent().then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(loadFailure).toBeInstanceOf(AggregateError);
          const diagnostics = diagnosticMessages(loadFailure);
          expect(diagnostics).toContain(reference.contentId);
          expect(diagnostics).toContain('turn=aggregate-replay-turn');
          expect(diagnostics).toContain('verification unavailable');
          expect(diagnostics).toContain('release unavailable');
          await failingStore.close();
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
        const service = new SessionPersistenceService(
          {
            projectRoot: storage.getProjectRoot(),
            chatsDir: storage.getProjectChatsDir(),
          },
          'session-media',
          {
            mediaStore: store,
            maxQueueBytes: 1024 * 1024,
          },
        );

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
});

function requirePath(recording: JournalRecordingService): string {
  const path = recording.getFilePath();
  assertNotNull(path, 'Expected materialized native recording');
  return path;
}

async function nativeFixture(
  directory: string,
  id: string,
  content: IContent,
): Promise<JournalRecordingService> {
  const recording = JournalRecordingService.create({
    sessionId: id,
    projectHash: 'project-hash',
    chatsDir: join(directory, id),
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  await (await recording.session()).append([content]);
  return recording;
}

async function nativeRows(
  filePath: string,
  mediaStore?: LocalMediaStore,
): Promise<IContent[]> {
  const file = await readJournalFileFacts(filePath);
  if (file === undefined) throw new Error('Missing session facts');
  const recording = await JournalRecordingService.open(
    {
      sessionId: file.facts.sessionId,
      projectHash: 'project-hash',
      chatsDir: join(filePath, '..'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore,
    },
    filePath,
  );
  try {
    const boot = new JournalResumeBoot(
      recording,
      await resumePointOf(recording),
    );
    const rows: IContent[] = [];
    for await (const row of boot.streamRows()) rows.push(row);
    return rows;
  } finally {
    await recording.dispose();
  }
}
