import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  withSuffixFixture,
  suffixRow,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  deferred,
  accountingFactory,
} from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  buildAgent,
  internalConfig,
} from '../../../agents/src/api/__tests__/helpers/agentHarness.js';

export const cleanupBounds = { rows: 440, serializedBytes: 8 * 1024 * 1024 };
const mediaInput = {
  bytes: new Uint8Array([5, 6, 7, 8]),
  mimeType: 'application/octet-stream',
  semanticMetadata: {},
  original: {
    bytes: new Uint8Array([1, 2, 3, 4]),
    mimeType: 'application/octet-stream',
  },
  transformation: {
    policyId: 'cleanup-test',
    policyVersion: 1,
    parameters: {},
  },
};

export class CleanupHistory extends HistoryService {
  readonly paused = deferred();
  readonly resume = deferred();
  readonly external = new RowOwnership();
  readonly retained: IContent[] = [];
  armed = false;
  delivered = 0;
  opened = 0;
  closed = 0;
  pauseAt: number | undefined;
  failAt: number | undefined;
  retaining: 'borrowed' | 'copy' | undefined;
  digest: string | undefined;
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'cleanup eager history forbidden',
    );
  }

  override async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    if (!this.armed) {
      yield* super.streamRawHistory(signal);
      return;
    }
    this.opened++;
    const hash = createHash('sha256');
    try {
      for await (const row of super.streamRawHistory(signal)) {
        this.delivered++;
        hash.update(JSON.stringify(row));
        if (this.retaining !== undefined) {
          const owned = this.retaining === 'copy' ? structuredClone(row) : row;
          this.external.retain(owned);
          this.retained.push(owned);
        }
        if (this.delivered === this.pauseAt) {
          this.paused.resolve();
          await this.resume.promise;
          signal?.throwIfAborted();
        }
        if (this.delivered === this.failAt)
          throw new Error('cleanup source fault');
        yield row;
      }
      this.digest = hash.digest('hex');
    } finally {
      this.closed++;
    }
  }

  releaseExternal(): void {
    for (const row of this.retained) this.external.release(row);
    this.retained.length = 0;
  }
}

export function cleanupRow(
  index: number,
  bytes: number,
  size: number,
  reference: MediaReferenceBlock,
): IContent {
  const row = suffixRow(index, bytes);
  return {
    ...row,
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: index === size - 1 ? [...row.blocks, reference] : row.blocks,
  };
}

export function expectedCleanupDigest(
  size: number,
  bytes: number,
  reference: MediaReferenceBlock,
): string {
  const hash = createHash('sha256');
  for (let index = 0; index < size; index++)
    hash.update(JSON.stringify(cleanupRow(index, bytes, size, reference)));
  return hash.digest('hex');
}

export function mediaObjectPath(
  store: LocalMediaStore,
  contentId: string,
): string {
  return join(
    store.rootDirectory,
    'objects',
    'sha256',
    contentId.slice('sha256:'.length),
  );
}

export interface CleanupFixture {
  readonly config: Config;
  readonly history: CleanupHistory;
  readonly reader: RowOwnership;
  readonly decoded: () => number;
  readonly root: string;
  readonly store: LocalMediaStore;
  readonly reference: MediaReferenceBlock;
  readonly orphan: MediaReferenceBlock;
}

export async function withCleanupHistory<T>(
  size: number,
  active: boolean,
  action: (fixture: CleanupFixture) => Promise<T>,
  bytes = 2048,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'issue854-cleanup-history-'));
  const store = new LocalMediaStore({
    rootDirectory: join(root, 'a'.repeat(64), 'media'),
    quotaBytes: 1024 * 1024,
  });
  try {
    const reference = await store.admit(mediaInput);
    const orphan = await store.admit({
      bytes: new Uint8Array([9, 10, 11, 12]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const stale = new Date(Date.now() - 120_000);
    for (const id of [
      reference.originalContentId,
      reference.selectedContentId,
      orphan.contentId,
    ])
      await utimes(mediaObjectPath(store, id), stale, stale);
    return await withSuffixFixture(
      size,
      async (service, reader, counters) => {
        if (!(service instanceof CleanupHistory))
          throw new Error('Missing cleanup history');
        const { agent, cleanup } = await buildAgent('plain-text.jsonl');
        const config = internalConfig(agent);
        config.setTokenizerFactory(accountingFactory((text) => text.length));
        config.setEphemeralSetting('context-limit', 100_000_000);
        await config.getLocalMediaStore().admit(mediaInput);
        const client = config.getAgentClient();
        client.storeHistoryServiceForReuse(service);
        try {
          if (active) await client.startChat([]);
          service.armed = true;
          const before = counters.snapshot().rowsDecoded;
          return await action({
            config,
            history: service,
            reader,
            decoded: () => counters.snapshot().rowsDecoded - before,
            root,
            store,
            reference,
            orphan,
          });
        } finally {
          service.resume.resolve();
          service.releaseExternal();
          await cleanup();
        }
      },
      bytes,
      (index, payload) => cleanupRow(index, payload, size, reference),
      undefined,
      (options) => new CleanupHistory(options),
    );
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
}

export function recordCleanupOwners(
  size: number,
  active: boolean,
  phase: string,
  fixture: CleanupFixture,
): void {
  const output = process.env.CLEANUP_HISTORY_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      JSON.stringify({
        size,
        active,
        phase,
        delivered: fixture.history.delivered,
        decoded: fixture.decoded(),
        reader: fixture.reader.snapshot(),
        external: fixture.history.external.snapshot(),
      }) + '\n',
    );
}
