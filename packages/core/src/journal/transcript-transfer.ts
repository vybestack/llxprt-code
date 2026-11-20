/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { GroupCopier } from './groupCopier.js';
import type { FrameHead } from './frame.js';
import { readValueBody } from './mapEntries.js';
import { OFFSET, type OffsetField } from './offsetFields.js';
import { remapOffset } from './recordTransfer.js';
import { RECORD_KIND } from './recordKinds.js';
import {
  decodeMembership,
  encodeMembership,
  decodeTranscriptHead,
  encodeTranscriptHead,
  TRANSCRIPT_HEAD_KEY,
} from './transcript-head.js';
import {
  encodeTranscriptNode,
  readTranscriptNode,
  type TranscriptEntry,
  type TranscriptChild,
  type TranscriptTreeMode,
} from './transcript-tree.js';

async function copyEntry(
  copier: GroupCopier,
  entry: TranscriptEntry,
  mode: TranscriptTreeMode,
): Promise<TranscriptEntry> {
  const copy = (spec: OffsetField, ref: number): Promise<number> =>
    remapOffset(spec, ref, (old) => copier.copyRecord(old, spec.points));
  let rowRef: number;
  if (mode === 'pieces') rowRef = await copy(OFFSET.pieceRecord, entry.rowRef);
  else if (mode === 'blocks')
    rowRef = await copy(OFFSET.blockDescriptor, entry.rowRef);
  else rowRef = await copy(OFFSET.transcriptRow, entry.rowRef);
  return {
    ...entry,
    rowRef,
    attemptRef: await copy(OFFSET.transcriptAttempt, entry.attemptRef),
    presentationRef: await copy(
      OFFSET.transcriptPresentation,
      entry.presentationRef,
    ),
  };
}

export async function copyTranscriptTree(
  copier: GroupCopier,
  root: number,
  mode: TranscriptTreeMode,
): Promise<TranscriptChild> {
  const known = await copier.known(root);
  if (known !== undefined) {
    const copied = await copier.readCopiedTranscript(known, mode);
    return {
      ref: known,
      maxId: 0n,
      count: 0,
      maxRowRef: Math.max(
        0,
        ...copied.entries.map((entry) =>
          Math.max(entry.rowRef, entry.presentationRef),
        ),
        ...copied.children.map((child) => child.maxRowRef),
      ),
    };
  }
  const node = await readTranscriptNode(copier.source, root, mode);
  const entries: TranscriptEntry[] = [];
  const children: TranscriptChild[] = [];
  for (const entry of node.entries)
    entries.push(await copyEntry(copier, entry, mode));
  for (const child of node.children) {
    const copied = await copyTranscriptTree(copier, child.ref, mode);
    children.push({ ...child, ref: copied.ref, maxRowRef: copied.maxRowRef });
  }
  const record = {
    kind: RECORD_KIND.TNODE,
    kindHeader: encodeTranscriptNode({ ...node, entries, children }),
  };
  const ref = await copier.append(record, 'TNODE');
  await copier.remember(root, ref);
  return {
    ref,
    maxId:
      node.level === 0
        ? entries[entries.length - 1].transcriptId
        : children[children.length - 1].maxId,
    count:
      node.level === 0
        ? entries.length
        : children.reduce((sum, child) => sum + child.count, 0),
    maxRowRef: Math.max(
      0,
      ...entries.map((entry) => Math.max(entry.rowRef, entry.presentationRef)),
      ...children.map((child) => child.maxRowRef),
    ),
  };
}

export async function copyTranscriptValue(
  copier: GroupCopier,
  ref: number,
  head: FrameHead,
): Promise<number | undefined> {
  const key = new TextDecoder().decode(head.kindHeader);
  if (key !== TRANSCRIPT_HEAD_KEY && !key.startsWith('member:'))
    return undefined;
  const known = await copier.known(ref);
  if (known !== undefined) return known;
  const body = await readValueBody(copier.source, head);
  let bytes: Uint8Array;
  if (key === TRANSCRIPT_HEAD_KEY) {
    const value = decodeTranscriptHead(body);
    const root =
      value.root === 0
        ? 0
        : (await copyTranscriptTree(copier, value.root, 'transcript')).ref;
    const openRoot =
      value.openRoot === 0
        ? 0
        : (await copyTranscriptTree(copier, value.openRoot, 'open')).ref;
    bytes = encodeTranscriptHead({ ...value, root, openRoot });
  } else {
    const value = decodeMembership(body);
    const rowRef = await remapOffset(
      OFFSET.membershipRow,
      value.rowRef,
      (old) => copier.copyRecord(old, 'ROW'),
    );
    const occurrencesRoot =
      value.occurrencesRoot === 0
        ? 0
        : (
            await copyTranscriptTree(
              copier,
              value.occurrencesRoot,
              'membership',
            )
          ).ref;
    bytes = encodeMembership({ ...value, rowRef, occurrencesRoot });
  }
  const offset = await copier.append(
    {
      kind: RECORD_KIND.VALUE,
      kindHeader: head.kindHeader,
      body: { length: bytes.length, chunks: [bytes] },
    },
    'VALUE',
  );
  await copier.remember(ref, offset);
  return offset;
}
