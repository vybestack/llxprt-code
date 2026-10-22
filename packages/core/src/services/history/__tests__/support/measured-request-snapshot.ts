/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  generateDeterministicMistralId,
  normalizeToAnthropicToolId,
  normalizeToOpenAIToolId,
} from '@vybestack/llxprt-code-tools';
import { BoundedIdNodeCache } from '../../../../journal/idTrieCache.js';
import { sha256KeyHash } from '../../../../journal/idKeys.js';
import { PinLease, PinnedRead } from '../../../../journal/pinLease.js';
import { VersionSnapshot } from '../../../../journal/versionSnapshot.js';
import { RECORD_KIND } from '../../../../journal/recordKinds.js';
import { decodeRowHeader } from '../../../../journal/rowRecord.js';
import type { RecordAccess } from '../../../../journal/recordAccess.js';
import type { JournalSession } from '../../journalSession.js';

export async function measuredRequestSnapshot(
  session: JournalSession,
  cleanupFailure?: Error,
  beforeHead?: () => Promise<void>,
): Promise<{
  readonly snapshot: VersionSnapshot;
  readonly stats: {
    heads: number;
    blocks: number;
    bodies: number;
    releases: number;
  };
}> {
  const read = await session.store.openRead();
  const stats = { heads: 0, blocks: 0, bodies: 0, releases: 0 };
  const raw = read.access;
  const access: RecordAccess = {
    recordError: raw.recordError,
    async readRecordHead(offset, what, prefetch) {
      stats.heads++;
      await beforeHead?.();
      return raw.readRecordHead(offset, what, prefetch);
    },
    readRecordStart(offset, what, prefetch) {
      stats.heads++;
      return raw.readRecordStart(offset, what, prefetch);
    },
    readRecordRange(head, offset, length) {
      if (head.kind === RECORD_KIND.ROW) {
        const header = decodeRowHeader(head.kindHeader);
        if (length > 0 && offset >= header.idsLen + header.metaLen)
          stats.blocks++;
      }
      return raw.readRecordRange(head, offset, length);
    },
    readRecordBody(head, chunkBytes, what) {
      if (head.kind === RECORD_KIND.ROW) stats.bodies++;
      return raw.readRecordBody(head, chunkBytes, what);
    },
  };
  const lease = new PinLease(async () => {
    stats.releases++;
    await read.close();
    if (cleanupFailure !== undefined) throw cleanupFailure;
  });
  return {
    snapshot: new VersionSnapshot(
      new PinnedRead(read.version, access, lease),
      {
        hasher: sha256KeyHash,
        occurrenceSpace: 'source-with-normalized',
        mistralCandidate: generateDeterministicMistralId,
        normalizers: {
          openai: normalizeToOpenAIToolId,
          anthropic: normalizeToAnthropicToolId,
        },
      },
      new BoundedIdNodeCache(),
      session.store.sortedLabels,
    ),
    stats,
  };
}
