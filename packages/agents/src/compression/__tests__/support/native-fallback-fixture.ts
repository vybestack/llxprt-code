/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoreSuffixFixtureGraph } from '../../../../../core/src/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import {
  BatchOwnerCensus,
  batchGate,
} from '../../../../../core/src/services/history/__tests__/support/addbatch-stream-test-helpers.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { open } from 'node:fs/promises';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { exactTokenizer } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { MediaReferenceBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { nativeFileRows } from './native-file-rows.js';
import { compressionValueDigest } from '../compression-value-fixture.js';

class FinalizationOwner extends HistoryMediaOwnership {
  readonly acknowledged = batchGate();
  readonly resume = batchGate();
  armed = false;
  failure: Error | undefined;

  override prepareReferenceReplacement(
    ...args: Parameters<HistoryMediaOwnership['prepareReferenceReplacement']>
  ): ReturnType<HistoryMediaOwnership['prepareReferenceReplacement']> {
    const effect = super.prepareReferenceReplacement(...args);
    const pause = this.armed;
    this.armed = false;
    return {
      publish: () => effect.publish(),
      rollback: () => effect.rollback(),
      finalize: async () => {
        if (pause) {
          this.acknowledged.resolve();
          await this.resume.promise;
          if (this.failure !== undefined) throw this.failure;
        }
        await effect.finalize?.();
      },
    };
  }
}

async function pausedWriter(root: string): Promise<{
  session: JournalSession;
  paused: Promise<void>;
  arm(): void;
  release(): void;
}> {
  const paused = batchGate();
  const resume = batchGate();
  let armed = false;
  const wait = async (): Promise<void> => {
    if (!armed) return;
    armed = false;
    paused.resolve();
    await resume.promise;
  };
  const session = await JournalSession.create(join(root, 'primary.llxj'), {
    journal: {
      open: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          fd: handle.fd,
          read: (...args) => handle.read(...args),
          stat: () => handle.stat(),
          truncate: (length) => handle.truncate(length),
          close: () => handle.close(),
          write: async (...args) => {
            await wait();
            return handle.write(...args);
          },
          writev: async (buffers, position) => {
            await wait();
            return handle.writev([...buffers], position);
          },
        };
      },
    },
  });
  return {
    session,
    paused: paused.promise,
    arm: () => {
      armed = true;
    },
    release: () => resume.resolve(),
  };
}

function nativeGraph(
  root: string,
  owners: BatchOwnerCensus,
  session: JournalSession,
): ReturnType<typeof createCoreSuffixFixtureGraph> {
  const opener = spyOn(JournalSession, 'createUnlinked').mockResolvedValue(
    session,
  );
  try {
    return createCoreSuffixFixtureGraph(
      root,
      owners,
      (options) => {
        if (options.attachmentCounters === undefined)
          throw new Error('Missing native read counters');
        return new HistoryService({
          ...options,
          attachmentCounters: {
            ...options.attachmentCounters,
            ownership: owners,
          },
        });
      },
      'journal',
    );
  } finally {
    opener.mockRestore();
  }
}

export interface NativeFallbackFixture {
  readonly history: HistoryService;
  readonly owners: BatchOwnerCensus;
  readonly writerPaused: Promise<void>;
  pauseWriter(): void;
  releaseWriter(): void;
  readonly acknowledged: Promise<void>;
  pauseFinalization(failure?: Error): Promise<void>;
  releaseFinalization(): void;
  failAdmissionAfter(rows: number): Error;
  durable(settled?: boolean): ReturnType<typeof compressionValueDigest>;
  admit(): Promise<MediaReferenceBlock>;
  reserved(contentId: string): Promise<boolean>;
}

export async function withNativeFallbackFixture(
  action: (fixture: NativeFallbackFixture) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'native-fallback-values-'));
  const writer = await pausedWriter(root);
  const owners = new BatchOwnerCensus();
  const { service: history, recording } = nativeGraph(
    root,
    owners,
    writer.session,
  );
  const media = new LocalMediaStore({
    rootDirectory: join(root, 'media'),
    quotaBytes: 1024,
  });
  const owner = new FinalizationOwner(media);
  history.setTokenizerFactory(exactTokenizer());
  try {
    await action({
      history,
      owners,
      writerPaused: writer.paused,
      pauseWriter: () => writer.arm(),
      releaseWriter: () => writer.release(),
      acknowledged: owner.acknowledged.promise,
      pauseFinalization: async (failure) => {
        await history.registerMediaOwner(owner);
        await history.settleMediaOwnership();
        owner.armed = true;
        owner.failure = failure;
      },
      releaseFinalization: () => owner.resume.resolve(),
      failAdmissionAfter: (rows) => {
        const failure = new Error('native fallback admission failed');
        let remaining = rows;
        history.setTokenizerFactory(
          exactTokenizer(() => {
            if (remaining-- === 0) throw failure;
          }),
        );
        return failure;
      },
      durable: async (settled = true) => {
        if (settled) await history.waitForCommit();
        await recording.flush();
        const path = settled ? recording.getFilePath() : writer.session.path;
        if (path === null) throw new Error('Missing native fallback mirror');
        return compressionValueDigest(nativeFileRows(path));
      },
      admit: () =>
        media.admit({
          bytes: new Uint8Array([1]),
          mimeType: 'application/octet-stream',
          semanticMetadata: {},
        }),
      reserved: (contentId) => media.hasReservations(contentId),
    });
  } finally {
    writer.release();
    owner.resume.resolve();
    await history.dispose();
    await recording.dispose();
    await media.close();
    rmSync(root, { recursive: true, force: true });
  }
}

export async function reachesGate(
  gate: Promise<void>,
  operation: Promise<unknown>,
): Promise<void> {
  await Promise.race([
    gate,
    operation.then((error) => {
      throw error ?? new Error('Operation ended before native gate');
    }),
  ]);
}
