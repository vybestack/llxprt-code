/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import type {
  CommitEffect,
  CommitEffectContext,
  CommitEffectFactory,
} from '../journal/commitEffect.js';
import type { GroupRecord, RecordAppender } from '../journal/groupAppender.js';
import { BoundedIdNodeCache } from '../journal/idTrieCache.js';
import { sha256KeyHash } from '../journal/idKeys.js';
import { KeyedMapBatch, KeyedMapReader } from '../journal/keyedMap.js';
import { RECORD_KIND } from '../journal/recordKinds.js';
import { readMapEntries, readValueBody } from '../journal/mapEntries.js';
import type { JournalStore } from '../journal/journalStore.js';
import { decodeRowHeader, ROW_BLOCK_TYPE } from '../journal/rowRecord.js';
import {
  isMediaReferenceBlock,
  type MediaReferenceBlock,
} from '../services/history/IContent.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';

const PREFIX = 'recording-media:';
const decoder = new TextDecoder('utf-8', { fatal: true });

interface MediaEntry {
  readonly reference: MediaReferenceBlock;
  readonly lease: string;
  readonly previous: string;
}

function decodeEntry(bytes: Uint8Array): MediaEntry {
  const value: unknown = JSON.parse(decoder.decode(bytes));
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid recording media ownership entry');
  if (!('reference' in value) || !isMediaReferenceBlock(value.reference))
    throw new Error('Invalid recording media ownership reference');
  if (!('lease' in value) || typeof value.lease !== 'string')
    throw new Error('Invalid recording media ownership lease');
  if (!('previous' in value) || typeof value.previous !== 'string')
    throw new Error('Invalid recording media ownership predecessor');
  return {
    reference: value.reference,
    lease: value.lease,
    previous: value.previous,
  };
}

function identity(reference: MediaReferenceBlock): string {
  return `${reference.originalContentId}/${reference.selectedContentId}`;
}

function ownerId(lease: string, reference: MediaReferenceBlock): string {
  return `native-recording-${lease}-${identity(reference)}`;
}

export interface RecordingMediaOwner {
  readonly effect: CommitEffectFactory;
  close(journal: JournalStore): Promise<void>;
}

export function recordingMediaEffect(
  store: LocalMediaStore | undefined,
): RecordingMediaOwner | undefined {
  if (store?.recordingArchive === undefined) return undefined;
  const archive = store.recordingArchive;
  const lease = randomUUID();
  return {
    effect: (context) =>
      new RecordingMediaCommit(context, store, archive, lease),
    close: async (journal) => {
      const read = await journal.openRead();
      try {
        for await (const entry of readMapEntries(
          read.access,
          new BoundedIdNodeCache(),
          read.version?.roots.stateRoot ?? 0,
        )) {
          if (!entry.key.startsWith(PREFIX)) continue;
          const value = decodeEntry(
            await readValueBody(read.access, entry.head),
          );
          if (value.lease === lease)
            await archive.release(
              value.reference.contentId,
              ownerId(lease, value.reference),
            );
        }
      } finally {
        read.close();
      }
    },
  };
}

class RecordingMediaCommit implements CommitEffect {
  private root = 0;
  private head = '';
  private readableEnd = 0;
  private appender: RecordAppender | undefined;
  private readonly cache = new BoundedIdNodeCache();

  constructor(
    private readonly context: CommitEffectContext,
    private readonly source: LocalMediaStore,
    private readonly archive: LocalMediaStore,
    private readonly lease: string,
  ) {}

  private reader(): KeyedMapReader {
    return new KeyedMapReader(
      this.appender === undefined
        ? undefined
        : this.context.read(this.readableEnd),
      this.cache,
      'state',
      sha256KeyHash,
    );
  }

  async append(record: GroupRecord, appender: RecordAppender): Promise<number> {
    this.appender = appender;
    if (record.kind !== RECORD_KIND.ROW || record.body === undefined)
      return appender.append(record);
    const media = decodeRowHeader(record.kindHeader).blocks.filter(
      (block) => block.type === ROW_BLOCK_TYPE.media,
    );
    if (media.length === 0) return appender.append(record);
    const bytes = media.map((block) => new Uint8Array(block.length));
    const body = record.body;
    async function* chunks(): AsyncGenerator<Uint8Array> {
      let offset = 0;
      for await (const chunk of body.chunks) {
        for (let index = 0; index < media.length; index++) {
          const block = media[index];
          const from = Math.max(offset, block.offset);
          const to = Math.min(
            offset + chunk.length,
            block.offset + block.length,
          );
          if (from < to)
            bytes[index].set(
              chunk.subarray(from - offset, to - offset),
              from - block.offset,
            );
        }
        offset += chunk.length;
        yield chunk;
      }
    }
    const offset = await appender.append({
      ...record,
      body: { length: body.length, chunks: chunks() },
    });
    for (const encoded of bytes) {
      const block: unknown = JSON.parse(decoder.decode(encoded));
      if (
        typeof block === 'object' &&
        block !== null &&
        'encoding' in block &&
        block.encoding === 'reference'
      ) {
        if (!isMediaReferenceBlock(block))
          throw new Error('Invalid native recording media reference');
        await this.publish(block, appender);
      }
    }
    return offset;
  }

  private async publish(
    reference: MediaReferenceBlock,
    appender: RecordAppender,
  ): Promise<void> {
    const key = PREFIX + identity(reference);
    const pending = await this.reader().get(this.root, key);
    if (pending !== undefined) return;
    const committed = await this.context.getState(key);
    if (committed !== undefined && decodeEntry(committed).lease === this.lease)
      return;
    const entry: MediaEntry = {
      reference,
      lease: this.lease,
      previous: this.head,
    };
    const batch = new KeyedMapBatch(this.reader(), this.root);
    batch.set(key, Buffer.from(JSON.stringify(entry)));
    this.root = await batch.commit(appender);
    await appender.drain();
    this.readableEnd = appender.nextOffset;
    this.head = identity(reference);
    const admissions = [];
    for (const object of [reference.originalObject, reference.selectedObject]) {
      admissions.push({
        object,
        bytes: await this.source.readObjectVerified(object),
      });
    }
    await this.archive.stageObjects(admissions, {
      references: [reference],
      ownerId: ownerId(this.lease, reference),
    });
  }

  async finish(stateRoot: number, appender: RecordAppender): Promise<number> {
    if (this.head === '') return stateRoot;
    await appender.drain();
    this.readableEnd = appender.nextOffset;
    let root = stateRoot;
    for await (const entry of this.entries()) {
      const batch = new KeyedMapBatch(this.reader(), root);
      batch.set(
        PREFIX + identity(entry.reference),
        Buffer.from(JSON.stringify(entry)),
      );
      root = await batch.commit(appender);
      await appender.drain();
      this.readableEnd = appender.nextOffset;
    }
    return root;
  }

  private async *entries(): AsyncGenerator<MediaEntry> {
    let id = this.head;
    while (id !== '') {
      const bytes = await this.reader().get(this.root, PREFIX + id);
      if (bytes === undefined) throw new Error('Missing recording media owner');
      const entry = decodeEntry(bytes);
      id = entry.previous;
      yield entry;
    }
  }

  async settle(committed: boolean): Promise<void> {
    if (!committed) {
      for await (const { reference } of this.entries()) {
        await this.archive.release(
          reference.contentId,
          ownerId(this.lease, reference),
        );
      }
    }
    this.head = '';
  }
}
