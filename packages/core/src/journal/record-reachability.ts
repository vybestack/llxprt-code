/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { getU64, putU64, viewOf } from './bytes.js';
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import type { ReadGroup } from './idFactBatch.js';
import { sha256KeyHash } from './idKeys.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { KeyedMapBatch, KeyedMapReader } from './keyedMap.js';

export type ReachabilityCategory = 'context' | 'transcript' | 'checkpoint';
export interface ReachabilityEdge {
  readonly offset: number;
  readonly category: ReachabilityCategory;
  /** ITNODE leaf values have different meanings in the fact trie and keyed maps. */
  readonly index?: 'facts' | 'map';
}
export interface ReachabilityTotals {
  readonly contextOnlyBytes: number;
  readonly transcriptOnlyBytes: number;
  readonly sharedBytes: number;
  readonly checkpointOnlyBytes: number;
}
export interface ReachabilityState extends ReachabilityTotals {
  readonly indexRoot: number;
}
export const EMPTY_REACHABILITY: ReachabilityState = {
  indexRoot: 0,
  contextOnlyBytes: 0,
  transcriptOnlyBytes: 0,
  sharedBytes: 0,
  checkpointOnlyBytes: 0,
};

export interface ReachableRecord {
  readonly bytes: number;
  /** A numeric child inherits its parent's category; explicit edges cross root domains. */
  readonly children: ReadonlyArray<number | ReachabilityEdge>;
}
export type ResolveReachableRecord = (
  edge: ReachabilityEdge,
) => Promise<ReachableRecord>;

interface ReferenceMarker {
  readonly bytes: number;
  readonly context: number;
  readonly transcript: number;
  readonly checkpoint: number;
}

function decodeMarker(bytes: Uint8Array | undefined): ReferenceMarker {
  if (bytes === undefined)
    return { bytes: 0, context: 0, transcript: 0, checkpoint: 0 };
  if (bytes.length !== 32)
    throw new JournalFormatError('Invalid record reachability marker');
  const view = viewOf(bytes);
  return {
    bytes: getU64(view, 0, 'record bytes'),
    context: getU64(view, 8, 'context references'),
    transcript: getU64(view, 16, 'transcript references'),
    checkpoint: getU64(view, 24, 'checkpoint references'),
  };
}

function encodeMarker(marker: ReferenceMarker): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = viewOf(bytes);
  putU64(view, 0, 'record bytes', marker.bytes);
  putU64(view, 8, 'context references', marker.context);
  putU64(view, 16, 'transcript references', marker.transcript);
  putU64(view, 24, 'checkpoint references', marker.checkpoint);
  return bytes;
}

function bucket(marker: ReferenceMarker): keyof ReachabilityTotals | undefined {
  if (marker.context > 0 && marker.transcript > 0) return 'sharedBytes';
  if (marker.context > 0) return 'contextOnlyBytes';
  if (marker.transcript > 0) return 'transcriptOnlyBytes';
  if (marker.checkpoint > 0) return 'checkpointOnlyBytes';
  return undefined;
}

/**
 * A persistent reference ledger over immutable records. Only a category's
 * zero-to-one and one-to-zero transitions visit children. New roots must be
 * admitted before old roots are released, preserving unchanged subtrees.
 * Marker writes spill at the existing map batch cap, never at session size.
 * Ledger records are accounting scratch, not members of the payload graph.
 */
export class RecordReachability {
  private readonly markers: KeyedMapBatch;
  private totals: ReachabilityTotals;

  constructor(
    state: ReachabilityState,
    private readonly appender: RecordAppender,
    private readonly readGroup: ReadGroup,
    private readonly resolve: ResolveReachableRecord,
  ) {
    this.totals = {
      contextOnlyBytes: state.contextOnlyBytes,
      transcriptOnlyBytes: state.transcriptOnlyBytes,
      sharedBytes: state.sharedBytes,
      checkpointOnlyBytes: state.checkpointOnlyBytes,
    };
    this.markers = new KeyedMapBatch(
      new KeyedMapReader(
        readGroup(appender.nextOffset),
        new BoundedIdNodeCache(),
        'state',
        sha256KeyHash,
      ),
      state.indexRoot,
    );
  }

  async replace(
    added: Iterable<ReachabilityEdge> | AsyncIterable<ReachabilityEdge>,
    removed: Iterable<ReachabilityEdge> | AsyncIterable<ReachabilityEdge>,
  ): Promise<void> {
    for await (const edge of added) await this.change(edge, 1);
    for await (const edge of removed) await this.change(edge, -1);
  }

  async commit(): Promise<ReachabilityState> {
    return {
      ...this.totals,
      indexRoot: await this.markers.commit(this.appender),
    };
  }

  private async change(edge: ReachabilityEdge, delta: 1 | -1): Promise<void> {
    if (edge.offset === 0) return;
    const key = `ref:${edge.offset}`;
    const before = decodeMarker(await this.markers.get(key));
    const count = before[edge.category] + delta;
    if (count < 0)
      throw new JournalFormatError(
        `Record ${edge.offset} ${edge.category} reference underflow`,
      );
    const transition = (before[edge.category] === 0) !== (count === 0);
    const record = transition ? await this.resolve(edge) : undefined;
    if (
      record !== undefined &&
      before.bytes !== 0 &&
      before.bytes !== record.bytes
    )
      throw new JournalFormatError(`Record ${edge.offset} changed its length`);
    const after = {
      ...before,
      bytes: record?.bytes ?? before.bytes,
      [edge.category]: count,
    };
    this.move(before, after);
    this.markers.set(key, encodeMarker(after));
    await this.markers.spillWhenFull(this.appender, this.readGroup);
    if (record === undefined) return;
    for (const child of record.children)
      await this.change(
        typeof child === 'number' ? { ...edge, offset: child } : child,
        delta,
      );
  }

  private move(before: ReferenceMarker, after: ReferenceMarker): void {
    const oldBucket = bucket(before);
    const newBucket = bucket(after);
    if (oldBucket === newBucket) return;
    const totals = { ...this.totals };
    if (oldBucket !== undefined) totals[oldBucket] -= before.bytes;
    if (newBucket !== undefined) totals[newBucket] += after.bytes;
    this.totals = totals;
  }
}

export function reachableBytes(totals: ReachabilityTotals): number {
  return (
    totals.contextOnlyBytes +
    totals.transcriptOnlyBytes +
    totals.sharedBytes +
    totals.checkpointOnlyBytes
  );
}
