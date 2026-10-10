/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '../services/history/IContent.js';
import { parseChronologyBinding } from './chronologyBinding.js';
import {
  DurableDensityIndex,
  type DensityEntry,
} from './durableDensityIndex.js';
import {
  MutableRowDirectory,
  type NumericRow,
  type RowSource,
} from './mutableRowDirectory.js';
import { ResolverDiskIndex, type IndexedRow } from './resolverDiskIndex.js';
import {
  field,
  chronology,
  validRow,
  validSeq,
  MAX_PURGE_SNAPSHOT_BYTES,
} from './resolverProjection.js';
import {
  scanResolverLines,
  ResolverRowReader,
  type ProjectedLine,
} from './resolverScan.js';
import type { ResolverFileHandle } from './journalResolver.js';
import type {
  CheckpointSource,
  DurableFoldCheckpoint,
} from './durableFoldCheckpoint.js';

export class UnsupportedDurableFoldEvent extends Error {
  constructor(readonly eventType: string) {
    super(`Durable row fold does not support ${eventType}`);
    this.name = 'UnsupportedDurableFoldEvent';
  }
}

/**
 * A descriptor pinned synchronously at capture time, before any await. The
 * inode survives an unlink of the path, so a retire/adopt/commit that removes
 * the file cannot strand a fold that started from an earlier capture.
 */
export interface PinnedFile {
  readonly fd: number;
  readonly size: number;
  /** Device and inode of the pinned file; stable across unlink and append. */
  readonly identity: string;
  readonly handle: ResolverFileHandle;
  release(): void;
}

/** Pin an unlinked-safe read descriptor synchronously. */
export function pinReadableFile(path: string): PinnedFile {
  const fd = openSync(path, 'r');
  let size: number;
  let identity: string;
  try {
    const stat = fstatSync(fd);
    size = stat.size;
    identity = `${stat.dev}:${stat.ino}`;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    closeSync(fd);
  };
  return {
    fd,
    size,
    identity,
    release,
    handle: {
      stat: async () => ({ size }),
      read: async (buffer, offset, length, position) => {
        if (released) throw new Error('Pinned file source is released');
        return readSync(fd, buffer, offset, length, position);
      },
      close: async () => {
        release();
      },
    },
  };
}

export interface DurableRowFoldOptions {
  readonly filePath?: string;
  readonly maxBytes: number;
  readonly scratchRoot?: string;
  readonly chunkBytes?: number;
  readonly resumeBoundary?: number;
  readonly projectionPath?: string;
  readonly pinnedJournal?: PinnedFile;
  readonly pinnedProjection?: PinnedFile;
  /** Standing state that lets a pinned fold scan only the appended tail. */
  readonly checkpoint?: DurableFoldCheckpoint;
  readonly signal?: AbortSignal;
}

function isContent(value: unknown): value is IContent {
  return (
    ['human', 'ai', 'tool'].includes(String(field(value, 'speaker'))) &&
    Array.isArray(field(value, 'blocks'))
  );
}

function projectedRow(
  content: unknown,
  source: RowSource = 'durable',
): NumericRow {
  const offset = field(content, 'start');
  const bytes = field(content, 'bytes');
  if (
    !validRow(content) ||
    typeof offset !== 'number' ||
    typeof bytes !== 'number'
  )
    throw new Error('Invalid projected durable content row');
  const marker = chronology(content);
  if (!Number.isNaN(marker) && !validSeq(marker))
    throw new UnsupportedDurableFoldEvent('non_numeric_chronology');
  return {
    source,
    offset,
    bytes,
    chronologySeq: Number.isNaN(marker) ? null : marker,
    pendingSlot: -1,
    invalidateResponses: false,
  };
}

function indexedRow(row: IndexedRow): NumericRow {
  if (!Number.isNaN(row.chron) && !validSeq(row.chron))
    throw new UnsupportedDurableFoldEvent('non_numeric_chronology');
  return {
    source: 'durable',
    offset: row.start,
    bytes: row.bytes,
    chronologySeq: Number.isNaN(row.chron) ? null : row.chron,
    pendingSlot: -1,
    invalidateResponses: false,
  };
}

function foldRewind(directory: MutableRowDirectory, payload: unknown): void {
  const count = field(payload, 'itemsRemoved');
  if (typeof count !== 'number' || count < 0) return;
  const cut = field(payload, 'cutSeq');
  if (cut !== undefined && !validSeq(cut))
    throw new UnsupportedDurableFoldEvent('non_numeric_rewind_cut');
  const position = validSeq(cut) ? directory.firstChronology(cut) : -1;
  directory.truncate(
    position === -1 ? Math.max(0, directory.length - count) : position,
  );
}

function foldChronologyBinding(
  directory: MutableRowDirectory,
  payload: unknown,
): void {
  const binding = parseChronologyBinding(payload);
  if (binding === null || binding.rowIndex >= directory.length) return;
  const content = field(payload, 'content');
  if (content !== undefined && !validRow(content)) return;
  const previous = directory.rowAt(binding.rowIndex);
  const source = content === undefined ? previous : projectedRow(content);
  directory.replace(binding.rowIndex, {
    ...source,
    chronologySeq: binding.chronology.seq,
    chronologyOverlay: true,
    chronologyUserTurn: binding.chronology.userTurn,
    chronologyStep: binding.chronology.step,
    chronologyRecordedAt: binding.chronology.recordedAt,
    invalidateResponses:
      binding.invalidateResponses === true || source.invalidateResponses,
  });
}

function foldSyntheticInsert(
  directory: MutableRowDirectory,
  payload: unknown,
): void {
  const content = field(payload, 'content');
  const chronologySeq = field(payload, 'chronologySeq');
  const afterSeq = field(payload, 'afterSeq');
  if (!validRow(content) || !validSeq(chronologySeq) || !validSeq(afterSeq))
    return;
  const anchor = directory.firstChronology(afterSeq);
  if (anchor === -1) return;
  directory.insert(anchor + 1, projectedRow(content));
}

function densityRow(entry: DensityEntry): NumericRow {
  if (!Number.isNaN(entry.chron) && !validSeq(entry.chron))
    throw new UnsupportedDurableFoldEvent('non_numeric_chronology');
  return {
    source: 'durable',
    offset: entry.start,
    bytes: entry.bytes,
    chronologySeq: Number.isNaN(entry.chron) ? null : entry.chron,
    pendingSlot: -1,
    invalidateResponses: false,
  };
}

function foldDensity(
  directory: MutableRowDirectory,
  payload: unknown,
  line: ProjectedLine,
  density: DurableDensityIndex,
): void {
  if (
    !Array.isArray(field(payload, 'removedSeqs')) ||
    !Array.isArray(field(payload, 'replacements')) ||
    line.projection.invalidDensity
  )
    return;
  directory.transform((row) => {
    if (row.chronologySeq === null) return row;
    const replacement = density.find('replacement', row.chronologySeq);
    if (replacement !== null) return densityRow(replacement);
    return density.find('removed', row.chronologySeq) === null ? row : null;
  });
}

function foldSemanticPurge(
  directory: MutableRowDirectory,
  payload: unknown,
  line: ProjectedLine,
  staged: ResolverDiskIndex,
): void {
  if (line.length > MAX_PURGE_SNAPSHOT_BYTES && field(line.parsed, 'v') !== 2)
    throw new UnsupportedDurableFoldEvent('oversized_semantic_media_purge');
  const history = field(payload, 'history');
  if (!Array.isArray(history) || line.projection.invalidPurge) return;
  directory.truncate(0);
  for (let index = 0; index < staged.length; index += 1)
    directory.append(indexedRow(staged.get(index)));
}

export function foldLine(
  directory: MutableRowDirectory,
  line: ProjectedLine,
  staged: ResolverDiskIndex,
  density: DurableDensityIndex,
  source: RowSource = 'durable',
): void {
  if (line.invalid || line.blank || line.parsed === null) return;
  const version = field(line.parsed, 'v');
  if (version !== 1 && version !== 2)
    throw new Error(
      `Unsupported recording version ${String(version)} in history journal`,
    );
  const type = field(line.parsed, 'type');
  if (typeof type !== 'string') return;
  const payload = field(line.parsed, 'payload');
  switch (type) {
    case 'content':
    case 'compressed': {
      const row = field(payload, type === 'content' ? 'content' : 'summary');
      if (
        !validRow(row) ||
        (type === 'compressed' &&
          field(payload, 'itemsCompressed') === undefined)
      )
        return;
      const numeric = projectedRow(row, source);
      if (type === 'compressed') directory.truncate(0);
      directory.append(numeric);
      return;
    }
    case 'rewind':
      foldRewind(directory, payload);
      return;
    case 'compression_detail':
      return;
    case 'density_mutation':
      foldDensity(directory, payload, line, density);
      return;
    case 'synthetic_insert':
      foldSyntheticInsert(directory, payload);
      return;
    case 'chronology_bind':
      foldChronologyBinding(directory, payload);
      return;
    case 'semantic_media_purge':
      foldSemanticPurge(directory, payload, line, staged);
      return;
    default:
      return;
  }
}

export function resolveRowContent(
  content: IContent,
  row: NumericRow,
): IContent {
  let resolved = content;
  if (row.chronologyOverlay === true) {
    if (
      row.chronologySeq === null ||
      row.chronologyUserTurn === undefined ||
      row.chronologyStep === undefined ||
      row.chronologyRecordedAt === undefined
    )
      throw new Error('Corrupt durable chronology overlay');
    resolved = {
      ...content,
      metadata: {
        ...content.metadata,
        chronology: {
          seq: row.chronologySeq,
          userTurn: row.chronologyUserTurn,
          step: row.chronologyStep,
          recordedAt: row.chronologyRecordedAt,
        },
      },
    };
  }
  if (!row.invalidateResponses) return resolved;
  return invalidateResponsesStatefulChain([resolved])[0];
}

/** Internal indexed fold. A caller owns the returned handle and must close it. */
export class DurableRowFold {
  private readonly reader: ResolverRowReader;
  private readonly projectionReader?: ResolverRowReader;
  private closed = false;
  constructor(
    private readonly handle: ResolverFileHandle,
    private readonly directory: MutableRowDirectory,
    chunkBytes: number,
    maxBytes: number,
    private readonly densityMetrics: ReturnType<DurableDensityIndex['metrics']>,
    private readonly projectionHandle?: ResolverFileHandle,
    projectionBytes = 0,
  ) {
    this.reader = new ResolverRowReader(handle, chunkBytes, maxBytes);
    if (projectionHandle)
      this.projectionReader = new ResolverRowReader(
        projectionHandle,
        chunkBytes,
        projectionBytes,
      );
  }
  get length(): number {
    return this.directory.length;
  }
  rowAt(index: number): NumericRow {
    return this.directory.rowAt(index);
  }
  metrics(): {
    readonly residentBufferBytes: number;
    readonly fileBytes: number;
    readonly densityIndexResidentBufferBytes: number;
    readonly densityIndexPeakDiskBytes: number;
    readonly densityIndexPeakEntries: number;
  } {
    return {
      ...this.directory.metrics(),
      densityIndexResidentBufferBytes: this.densityMetrics.residentBufferBytes,
      densityIndexPeakDiskBytes: this.densityMetrics.peakDiskBytes,
      densityIndexPeakEntries: this.densityMetrics.peakEntries,
    };
  }
  async readRow(index: number): Promise<IContent> {
    return this.readNumericRow(this.directory.rowAt(index));
  }
  /** Resolve a row from an overlay directory against this fold's pinned handles. */
  async readNumericRow(row: NumericRow): Promise<IContent> {
    if (this.closed) throw new Error('Durable row fold is closed');
    if (row.source === 'pending')
      throw new Error('Pending row has no durable source');
    const reader =
      row.source === 'projection' ? this.projectionReader : this.reader;
    if (!reader) throw new Error('Missing projected row source');
    const content = await reader.read(row.offset, row.bytes);
    if (!isContent(content)) throw new Error('Durable row changed since fold');
    return resolveRowContent(content, row);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.handle.close();
    } finally {
      try {
        await this.projectionHandle?.close();
      } finally {
        this.directory.close();
      }
    }
  }
}
function io(source: Awaited<ReturnType<typeof fs.open>>): ResolverFileHandle {
  return {
    stat: async () => ({ size: (await source.stat()).size }),
    read: async (buffer, offset, length, position) =>
      (await source.read(buffer, offset, length, position)).bytesRead,
    close: () => source.close(),
  };
}

async function scanRestoredPrefix(
  directory: MutableRowDirectory,
  staged: ResolverDiskIndex,
  density: DurableDensityIndex,
  journal: ResolverFileHandle,
  projection: ResolverFileHandle | undefined,
  boundary: number,
  projectionBytes: number,
  chunkBytes: number,
  signal?: AbortSignal,
): Promise<void> {
  if (boundary === 0) return;
  const prefix = projection ?? journal;
  const prefixBytes = projection ? projectionBytes : boundary;
  for await (const line of scanResolverLines(
    prefix,
    chunkBytes,
    staged,
    prefixBytes,
    false,
    density,
    0,
    signal,
  ))
    foldLine(
      directory,
      line,
      staged,
      density,
      projection ? 'projection' : 'durable',
    );
  directory.transform((row) => ({ ...row, invalidateResponses: true }));
}

function requiredJournalPath(path: string | undefined): string {
  if (path === undefined)
    throw new TypeError(
      'Durable row fold requires a journal path or pinned source',
    );
  return path;
}

async function openProjection(
  options: DurableRowFoldOptions,
  boundary: number,
): Promise<ResolverFileHandle | undefined> {
  if (boundary === 0) return undefined;
  if (options.pinnedProjection !== undefined)
    return options.pinnedProjection.handle;
  if (options.projectionPath === undefined) return undefined;
  return io(await fs.open(options.projectionPath, 'r'));
}

interface BoundCheckpoint {
  readonly checkpoint: DurableFoldCheckpoint;
  readonly source: CheckpointSource;
}

/** The checkpoint binding for a fold whose journal and prefix are pinned, if any. */
function bindCheckpoint(
  options: DurableRowFoldOptions,
  journal: ResolverFileHandle,
  boundary: number,
  projection: ResolverFileHandle | undefined,
): BoundCheckpoint | null {
  const { checkpoint, pinnedJournal } = options;
  if (checkpoint === undefined || pinnedJournal === undefined) return null;
  let projectionIdentity = 'none';
  if (boundary > 0 && projection !== undefined) {
    if (options.pinnedProjection === undefined) return null;
    projectionIdentity = options.pinnedProjection.identity;
  }
  return {
    checkpoint,
    source: {
      journal: pinnedJournal.identity,
      projection: projectionIdentity,
      boundary,
      handle: journal,
      scratchRoot: options.scratchRoot,
    },
  };
}

function foldParameters(options: DurableRowFoldOptions): {
  readonly boundary: number;
  readonly chunkBytes: number;
} {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
    throw new RangeError('Invalid durable fold watermark');
  const boundary = options.resumeBoundary ?? 0;
  if (
    !Number.isSafeInteger(boundary) ||
    boundary < 0 ||
    boundary > options.maxBytes
  )
    throw new RangeError('Invalid durable fold resume boundary');
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0)
    throw new RangeError('Invalid durable fold chunk size');
  return { boundary, chunkBytes };
}

/** Resources acquired while folding; the caller releases them on failure. */
interface FoldResources {
  projection?: ResolverFileHandle;
  directory?: MutableRowDirectory;
  staged?: ResolverDiskIndex;
  density?: DurableDensityIndex;
}

async function buildFold(
  options: DurableRowFoldOptions,
  journal: ResolverFileHandle,
  resources: FoldResources,
): Promise<DurableRowFold> {
  const { boundary, chunkBytes } = foldParameters(options);
  options.signal?.throwIfAborted();
  if ((await journal.stat()).size < options.maxBytes)
    throw new Error('Durable journal truncated below pinned watermark');
  const projection = await openProjection(options, boundary);
  resources.projection = projection;
  const staged = new ResolverDiskIndex(options.scratchRoot);
  resources.staged = staged;
  const density = new DurableDensityIndex(options.scratchRoot);
  resources.density = density;
  const projectionBytes = projection ? (await projection.stat()).size : 0;
  const bound = bindCheckpoint(options, journal, boundary, projection);
  const resumed =
    (await bound?.checkpoint.restore(bound.source, options.maxBytes)) ?? null;
  const directory =
    resumed?.directory ?? new MutableRowDirectory(options.scratchRoot);
  resources.directory = directory;
  if (resumed === null)
    await scanRestoredPrefix(
      directory,
      staged,
      density,
      journal,
      projection,
      boundary,
      projectionBytes,
      chunkBytes,
      options.signal,
    );
  for await (const line of scanResolverLines(
    journal,
    chunkBytes,
    staged,
    options.maxBytes,
    false,
    density,
    resumed?.watermark ?? boundary,
    options.signal,
  ))
    foldLine(directory, line, staged, density);
  if (resumed?.watermark !== options.maxBytes)
    await bound?.checkpoint.save(bound.source, options.maxBytes, directory);
  const densityMetrics = density.metrics();
  staged.close();
  density.close();
  return new DurableRowFold(
    journal,
    directory,
    Math.min(chunkBytes, 64 * 1024),
    options.maxBytes,
    densityMetrics,
    projection,
    projectionBytes,
  );
}

/**
 * Scan a durable byte prefix in <=64KiB reads without hydrating history rows.
 * With a checkpoint, only the bytes appended since the last fold are scanned.
 */
export async function foldDurableRows(
  options: DurableRowFoldOptions,
): Promise<DurableRowFold> {
  foldParameters(options);
  const journal = options.pinnedJournal
    ? options.pinnedJournal.handle
    : io(await fs.open(requiredJournalPath(options.filePath), 'r'));
  const resources: FoldResources = {};
  try {
    return await buildFold(options, journal, resources);
  } catch (error) {
    // The scan error takes precedence over secondary cleanup failures.
    await Promise.allSettled([resources.projection?.close(), journal.close()]);
    for (const scratch of [
      resources.directory,
      resources.staged,
      resources.density,
    ]) {
      try {
        scratch?.close();
      } catch {
        // Continue releasing the remaining scratch resources.
      }
    }
    throw error;
  }
}
