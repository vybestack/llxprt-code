/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import type { ResolverFileHandle } from './journalResolver.js';
import type { MutableRowDirectory } from './mutableRowDirectory.js';

/** Bytes before the watermark that must be unchanged for a checkpoint to apply. */
const TAIL_DIGEST_BYTES = 4096;
const NEWLINE = 10;
/** Distinct from fold scratch: a checkpoint lives as long as its history store. */
const CHECKPOINT_PREFIX = 'llxprt-fold-checkpoint-';

/**
 * Which journal prefix a checkpoint describes. The journal is append-only, so a
 * checkpoint at watermark W stays valid for any later fold of the same file.
 */
export interface CheckpointSource {
  /** Device and inode of the pinned journal. */
  readonly journal: string;
  /** Identity of the restored-prefix projection, or 'none'. */
  readonly projection: string;
  readonly boundary: number;
  readonly handle: ResolverFileHandle;
  readonly scratchRoot?: string;
}

export interface RestoredCheckpoint {
  readonly directory: MutableRowDirectory;
  /** Journal byte offset where the incremental scan resumes. */
  readonly watermark: number;
}

interface Entry {
  readonly key: string;
  readonly watermark: number;
  readonly tailDigest: string;
  readonly directory: MutableRowDirectory;
}

function checkpointKey(source: CheckpointSource): string {
  return `${source.journal}|${source.projection}|${source.boundary}`;
}

/**
 * Digest of the last bytes before `watermark`, or null when the watermark does
 * not sit on a record boundary (a checkpoint there could not be resumed).
 */
async function tailDigest(
  handle: ResolverFileHandle,
  watermark: number,
): Promise<string | null> {
  const length = Math.min(watermark, TAIL_DIGEST_BYTES);
  if (length === 0) return null;
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const read = await handle.read(
      buffer,
      filled,
      length - filled,
      watermark - length + filled,
    );
    if (read === 0)
      throw new Error('Durable journal truncated below pinned watermark');
    filled += read;
  }
  if (buffer[length - 1] !== NEWLINE) return null;
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Standing fold state for one journal: the row directory after folding the
 * journal up to a record-aligned watermark. Later folds copy it and scan only
 * the appended tail instead of re-reading the whole journal. The directory is
 * disk-backed (64 bytes per surviving row) and owned by this object until
 * dispose().
 */
export class DurableFoldCheckpoint {
  private entry: Entry | null = null;
  private disposed = false;

  /** A private copy of the checkpoint directory when it applies to `maxBytes`. */
  async restore(
    source: CheckpointSource,
    maxBytes: number,
  ): Promise<RestoredCheckpoint | null> {
    const entry = this.entry;
    if (
      this.disposed ||
      entry === null ||
      entry.key !== checkpointKey(source) ||
      entry.watermark > maxBytes
    )
      return null;
    const directory = entry.directory.clone(
      source.scratchRoot,
      CHECKPOINT_PREFIX,
    );
    try {
      const digest = await tailDigest(source.handle, entry.watermark);
      if (digest === entry.tailDigest)
        return { directory, watermark: entry.watermark };
    } catch (error) {
      directory.close();
      throw error;
    }
    directory.close();
    // The file no longer holds the folded prefix; the checkpoint is stale.
    this.discard(entry);
    return null;
  }

  /** Keep a copy of `directory`, folded through `watermark`, when it is newer. */
  async save(
    source: CheckpointSource,
    watermark: number,
    directory: MutableRowDirectory,
  ): Promise<void> {
    const current = this.entry;
    if (this.disposed || this.supersedes(current, source, watermark)) return;
    const digest = await tailDigest(source.handle, watermark);
    if (
      digest === null ||
      this.isDisposed() ||
      this.supersedes(this.entry, source, watermark)
    )
      return;
    const copy = directory.clone(source.scratchRoot, CHECKPOINT_PREFIX);
    const previous = this.entry;
    this.entry = {
      key: checkpointKey(source),
      watermark,
      tailDigest: digest,
      directory: copy,
    };
    previous?.directory.close();
  }

  dispose(): void {
    this.disposed = true;
    const entry = this.entry;
    this.entry = null;
    entry?.directory.close();
  }

  // A method, not a field read: dispose() can run while save() awaits.
  private isDisposed(): boolean {
    return this.disposed;
  }

  private supersedes(
    entry: Entry | null,
    source: CheckpointSource,
    watermark: number,
  ): boolean {
    return (
      entry !== null &&
      entry.key === checkpointKey(source) &&
      entry.watermark >= watermark
    );
  }

  private discard(entry: Entry): void {
    if (this.entry !== entry) return;
    this.entry = null;
    entry.directory.close();
  }
}
