/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { getU64, getU64Big, putU64, putU64Big, viewOf } from './bytes.js';
import { BoundedIdNodeCache, type IdNodeCache } from './idTrieCache.js';
import { JournalFormatError } from './errors.js';
import { TranscriptAppend } from './transcript-append.js';
import type { RecordAppender } from './groupAppender.js';
import type { RecordAccess } from './recordAccess.js';

import { RECORD_KIND } from './recordKinds.js';
export const TRANSCRIPT_NODE_KIND = RECORD_KIND.TNODE;
export const TRANSCRIPT_FANOUT = 32;
export type TranscriptTreeMode =
  | 'transcript'
  | 'blocks'
  | 'pieces'
  | 'membership'
  | 'open';
const MODE_CODES = {
  transcript: 0,
  blocks: 1,
  pieces: 2,
  membership: 3,
  open: 4,
};
export interface TranscriptEntry {
  readonly transcriptId: bigint;
  readonly rowRef: number;
  readonly recordLength: number;
  readonly label: bigint;
  readonly revision: number;
  readonly audience: number;
  readonly status: number;
  readonly attemptRef: number;
  readonly supersedesId: bigint;
  readonly presentationRef: number;
}
export interface TranscriptChild {
  readonly maxId: bigint;
  readonly maxRowRef: number;
  readonly ref: number;
  readonly count: number;
}
export interface TranscriptNode {
  readonly mode: TranscriptTreeMode;
  readonly level: number;
  readonly entries: readonly TranscriptEntry[];
  readonly children: readonly TranscriptChild[];
}

export function encodeTranscriptNode(node: TranscriptNode): Uint8Array {
  const count = node.level === 0 ? node.entries.length : node.children.length;
  if (count < 1 || count > TRANSCRIPT_FANOUT)
    throw new JournalFormatError('Invalid transcript fanout');
  const bytes = new Uint8Array(8 + count * (node.level === 0 ? 64 : 32));
  const view = viewOf(bytes);
  view.setUint8(0, MODE_CODES[node.mode]);
  view.setUint8(1, node.level);
  view.setUint16(2, count, true);
  node.entries.forEach((entry, index) =>
    encodeEntry(view, 8 + index * 64, entry),
  );
  node.children.forEach((child, index) => {
    const at = 8 + index * 32;
    putU64Big(view, at, 'maxId', child.maxId);
    putU64(view, at + 8, 'child ref', child.ref);
    putU64(view, at + 16, 'child count', child.count);
    putU64(view, at + 24, 'maxRowRef', child.maxRowRef);
  });
  return bytes;
}

function encodeEntry(view: DataView, at: number, entry: TranscriptEntry): void {
  putU64Big(view, at, 'transcriptId', entry.transcriptId);
  putU64(view, at + 8, 'rowRef', entry.rowRef);
  putU64(view, at + 16, 'recordLength', entry.recordLength);
  putU64Big(view, at + 24, 'label', entry.label);
  view.setUint32(at + 32, entry.revision, true);
  view.setUint8(at + 36, entry.audience);
  view.setUint8(at + 37, entry.status);
  putU64(view, at + 40, 'attemptRef', entry.attemptRef);
  putU64Big(view, at + 48, 'supersedesId', entry.supersedesId);
  putU64(view, at + 56, 'presentationRef', entry.presentationRef);
}

function decodeEntry(view: DataView, at: number): TranscriptEntry {
  return {
    transcriptId: getU64Big(view, at),
    rowRef: getU64(view, at + 8, 'rowRef'),
    recordLength: getU64(view, at + 16, 'recordLength'),
    label: getU64Big(view, at + 24),
    revision: view.getUint32(at + 32, true),
    audience: view.getUint8(at + 36),
    status: view.getUint8(at + 37),
    attemptRef: getU64(view, at + 40, 'attemptRef'),
    supersedesId: getU64Big(view, at + 48),
    presentationRef: getU64(view, at + 56, 'presentationRef'),
  };
}

export function decodeTranscriptNode(
  bytes: Uint8Array,
  mode: TranscriptTreeMode,
): TranscriptNode {
  if (bytes.length < 8)
    throw new JournalFormatError('Truncated transcript node');
  const view = viewOf(bytes);
  const level = view.getUint8(1);
  const count = view.getUint16(2, true);
  const modeCode = MODE_CODES[mode];
  const expectedSize = 8 + count * (level === 0 ? 64 : 32);
  if (
    view.getUint8(0) !== modeCode ||
    count < 1 ||
    count > TRANSCRIPT_FANOUT ||
    bytes.length !== expectedSize
  )
    throw new JournalFormatError('Invalid transcript node');
  const entries: TranscriptEntry[] = [];
  const children: TranscriptChild[] = [];
  for (let index = 0; index < count; index++) {
    if (level === 0) entries.push(decodeEntry(view, 8 + index * 64));
    else {
      const at = 8 + index * 32;
      children.push({
        maxId: getU64Big(view, at),
        ref: getU64(view, at + 8, 'ref'),
        count: getU64(view, at + 16, 'count'),
        maxRowRef: getU64(view, at + 24, 'maxRowRef'),
      });
    }
  }
  return { mode, level, entries, children };
}

export async function readTranscriptNode(
  access: RecordAccess,
  ref: number,
  mode: TranscriptTreeMode,
): Promise<TranscriptNode> {
  const head = await access.readRecordHead(ref, 'TNODE', 4096);
  if (head.kind !== TRANSCRIPT_NODE_KIND || head.bodyLen !== 0)
    throw access.recordError(
      head,
      new JournalFormatError('Invalid transcript tree record'),
    );
  try {
    return decodeTranscriptNode(head.kindHeader, mode);
  } catch (error) {
    throw access.recordError(
      head,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/** A fixed cache bounds both committed and freshly written path nodes. */
export class TranscriptTreeWriter {
  private readonly cache = new BoundedIdNodeCache();
  constructor(
    private readonly access: () => RecordAccess,
    private readonly appender: RecordAppender,
    private readonly mode: TranscriptTreeMode,
    private readonly committedCache?: IdNodeCache,
  ) {}

  appendGroup(root: number): TranscriptAppend {
    return new TranscriptAppend(
      root,
      (ref) => this.read(ref),
      (node) => this.write(node),
    );
  }

  private async read(ref: number): Promise<TranscriptNode> {
    const cached = this.cache.get(ref);
    if (cached !== undefined) return decodeTranscriptNode(cached, this.mode);
    const bytes = this.committedCache?.get(ref);
    if (bytes !== undefined) return decodeTranscriptNode(bytes, this.mode);
    await this.appender.drain();
    const node = await readTranscriptNode(this.access(), ref, this.mode);
    this.cache.put(ref, encodeTranscriptNode(node));
    return node;
  }

  private async write(node: TranscriptNode): Promise<TranscriptChild> {
    const ref = await this.appender.append({
      kind: TRANSCRIPT_NODE_KIND,
      kindHeader: encodeTranscriptNode(node),
    });
    this.cache.put(ref, encodeTranscriptNode(node));
    return {
      ref,
      maxRowRef:
        node.level === 0
          ? Math.max(
              ...node.entries.map((entry) =>
                entry.rowRef === 0 ? entry.presentationRef : entry.rowRef,
              ),
            )
          : Math.max(...node.children.map((child) => child.maxRowRef)),
      maxId:
        node.level === 0
          ? node.entries[node.entries.length - 1].transcriptId
          : node.children[node.children.length - 1].maxId,
      count:
        node.level === 0
          ? node.entries.length
          : node.children.reduce((sum, child) => sum + child.count, 0),
    };
  }

  entries(root: number, fromId: bigint): AsyncGenerator<TranscriptEntry> {
    return transcriptEntries(
      this.access(),
      root,
      this.mode,
      fromId,
      false,
      (ref) => this.read(ref),
    );
  }

  async findRowRef(root: number, rowRef: number): Promise<TranscriptEntry> {
    const entry = await this.lookupRowRef(root, rowRef);
    if (entry === undefined)
      throw new JournalFormatError('Context row has no transcript identity');
    return entry;
  }

  private async lookupRowRef(
    root: number,
    rowRef: number,
  ): Promise<TranscriptEntry | undefined> {
    const node = await this.read(root);
    if (node.level === 0)
      return node.entries.find((entry) => entry.rowRef === rowRef);
    for (const child of node.children) {
      if (child.maxRowRef < rowRef) continue;
      const entry = await this.lookupRowRef(child.ref, rowRef);
      if (entry !== undefined) return entry;
    }
    return undefined;
  }

  async remove(root: number, id: bigint): Promise<number> {
    if (root === 0)
      throw new JournalFormatError('Missing membership occurrence');
    const child = await this.removeFrom(root, id);
    return child?.ref ?? 0;
  }

  private async removeFrom(
    ref: number,
    id: bigint,
  ): Promise<TranscriptChild | undefined> {
    const node = await this.read(ref);
    if (node.level === 0) {
      const entries = node.entries.filter((entry) => entry.transcriptId !== id);
      if (entries.length === node.entries.length)
        throw new JournalFormatError('Missing membership occurrence');
      return entries.length === 0
        ? undefined
        : this.write({ ...node, entries });
    }
    const at = node.children.findIndex((child) => child.maxId >= id);
    if (at < 0) throw new JournalFormatError('Missing membership occurrence');
    const replacement = await this.removeFrom(node.children[at].ref, id);
    const children = [...node.children];
    children.splice(at, 1, ...(replacement === undefined ? [] : [replacement]));
    return children.length === 0
      ? undefined
      : this.write({ ...node, children });
  }

  async insert(root: number, entry: TranscriptEntry): Promise<number> {
    const node =
      root === 0
        ? { mode: this.mode, level: 0, entries: [], children: [] }
        : await this.read(root);
    const children = await this.insertInto(node, entry);
    if (children.length === 1) return children[0].ref;
    return (
      await this.write({
        mode: this.mode,
        level: node.level + 1,
        entries: [],
        children,
      })
    ).ref;
  }

  private async insertInto(
    node: TranscriptNode,
    entry: TranscriptEntry,
  ): Promise<TranscriptChild[]> {
    if (node.level === 0) {
      const entries = [...node.entries];
      let at = entries.findIndex(
        (item) => item.transcriptId >= entry.transcriptId,
      );
      if (at < 0) at = entries.length;
      entries.splice(
        at,
        entries[at]?.transcriptId === entry.transcriptId ? 1 : 0,
        entry,
      );
      if (entries.length <= TRANSCRIPT_FANOUT)
        return [await this.write({ ...node, entries })];
      return [
        await this.write({ ...node, entries: entries.slice(0, 16) }),
        await this.write({ ...node, entries: entries.slice(16) }),
      ];
    }
    const children = [...node.children];
    let at = children.findIndex((child) => child.maxId >= entry.transcriptId);
    if (at < 0) at = children.length - 1;
    const replacements = await this.insertInto(
      await this.read(children[at].ref),
      entry,
    );
    children.splice(at, 1, ...replacements);
    if (children.length <= TRANSCRIPT_FANOUT)
      return [await this.write({ ...node, children })];
    return [
      await this.write({ ...node, children: children.slice(0, 16) }),
      await this.write({ ...node, children: children.slice(16) }),
    ];
  }
}

/** A seek retains only the search path and one leaf, in either direction. */
export async function* transcriptEntries(
  access: RecordAccess,
  root: number,
  mode: TranscriptTreeMode,
  fromId: bigint,
  backward: boolean,
  readNode: (ref: number) => Promise<TranscriptNode> = (ref) =>
    readTranscriptNode(access, ref, mode),
): AsyncGenerator<TranscriptEntry> {
  if (root === 0) return;
  const node = await readNode(root);
  if (node.level === 0) {
    for (
      let at = backward ? node.entries.length - 1 : 0;
      backward ? at >= 0 : at < node.entries.length;
      at += backward ? -1 : 1
    ) {
      const entry = node.entries[at];
      if (
        backward ? entry.transcriptId <= fromId : entry.transcriptId >= fromId
      )
        yield entry;
    }
    return;
  }
  let first = node.children.findIndex((child) => child.maxId >= fromId);
  if (first < 0) first = node.children.length - 1;
  for (
    let at = first;
    backward ? at >= 0 : at < node.children.length;
    at += backward ? -1 : 1
  ) {
    yield* transcriptEntries(
      access,
      node.children[at].ref,
      mode,
      fromId,
      backward,
      readNode,
    );
  }
}
