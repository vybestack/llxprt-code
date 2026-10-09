/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { heapSize, heapStats } from 'bun:jsc';
import { ProviderNormalizationDisk } from '@vybestack/llxprt-code-core/services/history/provider-normalization-disk.js';
import { NormalizedProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  requestScopedContents,
  type RequestScopedContents,
} from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { PromptKeyDiskWriter } from '@vybestack/llxprt-code-providers/runtime/prompt-key-disk-writer.js';
import { Gpt56SourceProjection } from '@vybestack/llxprt-code-providers/tokenizers/gpt56-source-projection.js';
import { SourcePromptEnvelopePreparer } from '../../prompt-envelope-source-send.js';

export class RetainedOwnerCensus {
  private readonly cohorts = new Map<
    string,
    { seen: WeakSet<object>; refs: Array<WeakRef<object>> }
  >();
  readonly trap: object[] = [];
  readonly bodyShells: object[] = [];
  readonly peak = { heap: 0, external: 0, stringCharacters: 0 };
  readonly cleanup = {
    progressive: 0,
    writers: 0,
    projections: 0,
    enforcementAttempts: 0,
    callbackClearAttempts: 0,
  };
  readonly segmentPaths = new Set<string>();

  observe(category: string, value: unknown): void {
    if (
      (typeof value !== 'object' || value === null) &&
      typeof value !== 'function'
    )
      return;
    let cohort = this.cohorts.get(category);
    if (cohort === undefined) {
      cohort = { seen: new WeakSet(), refs: [] };
      this.cohorts.set(category, cohort);
    }
    if (cohort.seen.has(value)) return;
    cohort.seen.add(value);
    cohort.refs.push(new WeakRef(value));
  }

  row(category: string, row: IContent): void {
    this.observe(category, row);
    this.observe(`${category}.blocks`, row.blocks);
    for (const block of row.blocks) this.observe(`${category}.block`, block);
    this.observe(`${category}.metadata`, row.metadata);
  }

  sampleActive(text: string): void {
    if (text.length <= this.peak.stringCharacters) return;
    this.peak.stringCharacters = text.length;
    this.peak.heap = heapSize();
    this.peak.external = process.memoryUsage().external;
  }

  survivors(): Partial<Record<string, { observed: number; live: number }>> {
    return Object.fromEntries(
      [...this.cohorts].map(([category, cohort]) => [
        category,
        {
          observed: cohort.refs.length,
          live: cohort.refs.filter((ref) => ref.deref() !== undefined).length,
        },
      ]),
    );
  }
}

export async function retainedCheckpoint(census: RetainedOwnerCensus) {
  for (let round = 0; round < 8; round++) {
    await Bun.sleep(0);
    Bun.gc(true);
  }
  const heap = heapSize();
  const memory = process.memoryUsage();
  const stats = heapStats();
  return {
    heap,
    memory,
    stats: {
      heapSize: stats.heapSize,
      heapCapacity: stats.heapCapacity,
      extraMemorySize: stats.extraMemorySize,
      objectCount: stats.objectCount,
      objectTypeCounts: stats.objectTypeCounts,
    },
    survivors: census.survivors(),
  };
}

function observeRowOwners(census: RetainedOwnerCensus): () => void {
  const disk = ProviderNormalizationDisk.prototype;
  const snapshot = NormalizedProviderRequestSnapshot.prototype;
  const writer = PromptKeyDiskWriter.prototype;
  const empty: AsyncIterable<IContent> = { async *[Symbol.asyncIterator]() {} };
  const progressive: RequestScopedContents = Object.getPrototypeOf(
    requestScopedContents(empty),
  );
  const original = {
    diskRow: disk.row,
    snapshotRead: snapshot.read,
    snapshotOpen: snapshot.openReader,
    progressiveStream: progressive.stream,
    progressiveDispose: progressive.dispose,
    writerValue: writer.value,
    writerString: writer.string,
    writerClose: writer.close,
  };
  disk.row = function (stage, index) {
    census.observe('normalization.disk', this);
    const row = original.diskRow.call(this, stage, index);
    census.row(`normalization.${stage}`, row);
    return row;
  };
  snapshot.read = function (index) {
    census.observe('request.snapshot', this);
    const row = original.snapshotRead.call(this, index);
    census.row('snapshot.row', row);
    return row;
  };
  snapshot.openReader = function (signal) {
    census.observe('request.snapshot', this);
    const reader = original.snapshotOpen.call(this, signal);
    census.observe('snapshot.reader', reader);
    return reader;
  };
  progressive.stream = async function* () {
    census.observe('progressive.owner', this);
    for await (const row of original.progressiveStream.call(this)) {
      census.row('progressive.row-copy', row);
      if (process.env.ISSUE854_RETAIN_DERIVED_ROWS === '1')
        census.trap.push(row);
      yield row;
    }
  };
  progressive.dispose = function () {
    census.cleanup.progressive++;
    return original.progressiveDispose.call(this);
  };
  writer.value = function (value) {
    census.observe('writer', this);
    census.observe('writer.derived-item', value);
    return original.writerValue.call(this, value);
  };
  writer.string = function (text, quoted) {
    census.sampleActive(text);
    return original.writerString.call(this, text, quoted);
  };
  writer.close = function () {
    census.cleanup.writers++;
    return original.writerClose.call(this);
  };
  return () => {
    disk.row = original.diskRow;
    snapshot.read = original.snapshotRead;
    snapshot.openReader = original.snapshotOpen;
    progressive.stream = original.progressiveStream;
    progressive.dispose = original.progressiveDispose;
    writer.value = original.writerValue;
    writer.string = original.writerString;
    writer.close = original.writerClose;
  };
}

function observeEnvelopeOwners(census: RetainedOwnerCensus): () => void {
  const projection = Gpt56SourceProjection.prototype;
  const preparer = SourcePromptEnvelopePreparer.prototype;
  const original = {
    acquire: projection.acquire,
    dispose: projection.dispose,
    prepare: preparer.prepare,
  };
  projection.acquire = function () {
    census.observe('source.projection', this);
    census.observe('source.segments', this.promptSegments);
    for (const segment of this.promptSegments) {
      census.observe('source.segment', segment);
      census.observe('source.segment-descriptor', segment.source);
      census.segmentPaths.add(segment.source.path);
    }
    const lease = original.acquire.call(this);
    census.observe('source.lease-closure', lease);
    return lease;
  };
  projection.dispose = function () {
    census.cleanup.projections++;
    return original.dispose.call(this);
  };
  preparer.prepare = async function (source) {
    census.observe('source.preparer', this);
    census.observe('source.selection', source);
    const prepared = await original.prepare.call(this, source);
    census.observe('source.prepared', prepared);
    census.observe('source.options', prepared.options);
    census.observe('source.contents-closure', prepared.options.contents);
    census.observe('source.release-closure', prepared.releaseIfUnsent);
    census.observe('source.runtime-builder-output', prepared.options.runtime);
    census.observe('source.metadata', prepared.options.metadata);
    census.observe('source.estimate', prepared.estimate);
    census.observe(
      'source.token',
      prepared.options.promptEnvelopeTransportToken,
    );
    return prepared;
  };
  return () => {
    projection.acquire = original.acquire;
    projection.dispose = original.dispose;
    preparer.prepare = original.prepare;
  };
}

export function observeSourceOwners(census: RetainedOwnerCensus): () => void {
  const rows = observeRowOwners(census);
  const envelope = observeEnvelopeOwners(census);
  return () => {
    rows();
    envelope();
  };
}
