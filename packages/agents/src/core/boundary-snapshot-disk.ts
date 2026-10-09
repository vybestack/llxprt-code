/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { HookSnapshotRows } from '@vybestack/llxprt-code-core/hooks/hookOutputSnapshot.js';
import { isSpeakerContent } from '@vybestack/llxprt-code-core/services/history/historyJournalGuards.js';
import { ProviderNormalizationStorage } from '@vybestack/llxprt-code-core/services/history/provider-normalization-storage.js';
import { contentProjectionKey } from './boundaryRecovery.js';

type Stage = 'before' | 'after' | 'raw';

export class BoundarySnapshotDisk {
  private readonly directory: string;
  private readonly storage: ProviderNormalizationStorage;
  private readonly readers = new Set<BoundaryDiskReader>();
  private closed = false;
  private failure: unknown = new Error('Boundary snapshot closed');
  private readonly onAbort = (): void => this.close(this.signal?.reason);

  constructor(
    root: string,
    private readonly signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    this.directory = mkdtempSync(join(root, 'boundary-snapshot-'));
    try {
      this.storage = new ProviderNormalizationStorage(this.directory);
    } catch (error) {
      rmSync(this.directory, { recursive: true, force: true });
      throw error;
    }
    signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  private check(): void {
    this.signal?.throwIfAborted();
    if (this.closed) throw this.failure;
  }

  async capture(stage: Stage, rows: HookSnapshotRows): Promise<void> {
    this.check();
    let index = 0;
    const reader = rows.openReader(this.signal);
    try {
      for await (const row of reader) {
        this.check();
        if (!isSpeakerContent(row)) throw new Error('Invalid hook content row');
        const key = contentProjectionKey(row);
        this.storage.set(`row:${stage}:${index}`, row);
        this.storage.set(`key:${stage}:${index}`, key);
        this.storage.set(`member:${stage}:${key}`, true);
        index++;
      }
      if (index !== rows.count)
        throw new Error('Boundary source count mismatch');
      this.storage.set(`count:${stage}`, index);
    } finally {
      await reader.return();
    }
  }

  count(stage: Stage): number {
    this.check();
    const count = this.storage.get(`count:${stage}`);
    if (typeof count !== 'number') throw new Error('Missing boundary stage');
    return count;
  }

  key(stage: Stage, index: number): string {
    this.check();
    const key = this.storage.get(`key:${stage}:${index}`);
    if (typeof key !== 'string') throw new Error('Missing boundary projection');
    return key;
  }

  contains(stage: Stage, key: string): boolean {
    this.check();
    return this.storage.get(`member:${stage}:${key}`) === true;
  }

  row(stage: Stage, index: number): IContent {
    this.check();
    const row = this.storage.get(`row:${stage}:${index}`);
    if (!isSpeakerContent(row)) throw new Error('Missing boundary content');
    return row;
  }

  rangeMatches(
    a: Stage,
    startA: number,
    b: Stage,
    startB: number,
    count: number,
  ): boolean {
    for (let index = 0; index < count; index++) {
      if (this.key(a, startA + index) !== this.key(b, startB + index))
        return false;
    }
    return true;
  }

  straddles(historyCount: number): boolean {
    for (let index = 0; index < historyCount; index++)
      this.storage.set(`history:${this.key('before', index)}`, true);
    for (let index = historyCount; index < this.count('before'); index++) {
      this.check();
      if (this.storage.get(`history:${this.key('before', index)}`) === true)
        return true;
    }
    return false;
  }

  selection(stage: Stage, start = 0): ProviderRequestRows {
    return new BoundaryDiskSelection(
      this,
      stage,
      start,
      this.count(stage) - start,
    );
  }

  open(
    stage: Stage,
    start: number,
    count: number,
    signal?: AbortSignal,
  ): BoundaryDiskReader {
    this.check();
    signal?.throwIfAborted();
    const reader = new BoundaryDiskReader(this, stage, start, count, signal);
    this.readers.add(reader);
    return reader;
  }

  release(reader: BoundaryDiskReader): void {
    this.readers.delete(reader);
  }

  close(reason: unknown = new Error('Boundary snapshot closed')): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = reason;
    this.signal?.removeEventListener('abort', this.onAbort);
    for (const reader of this.readers) reader.fail(reason);
    try {
      this.storage.close();
    } finally {
      rmSync(this.directory, { recursive: true, force: true });
    }
  }
}

class BoundaryDiskSelection implements ProviderRequestRows {
  constructor(
    private readonly disk: BoundarySnapshotDisk,
    private readonly stage: Stage,
    private readonly start: number,
    readonly count: number,
  ) {}

  openReader(signal?: AbortSignal): AsyncGenerator<IContent, void, unknown> {
    return this.disk.open(this.stage, this.start, this.count, signal);
  }
}

class BoundaryDiskReader implements AsyncGenerator<IContent, void, unknown> {
  private index = 0;
  private failed = false;
  private failure: unknown;
  private readonly onAbort = (): void => this.fail(this.signal?.reason);

  constructor(
    private owner: BoundarySnapshotDisk | undefined,
    private readonly stage: Stage,
    private readonly start: number,
    private readonly count: number,
    private readonly signal?: AbortSignal,
  ) {
    signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  [Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
    return this;
  }
  [Symbol.asyncDispose](): Promise<void> {
    this.finish();
    return Promise.resolve();
  }

  next(): Promise<IteratorResult<IContent, void>> {
    try {
      if (this.failed) throw this.failure;
      const owner = this.owner;
      if (owner === undefined || this.index === this.count)
        return this.return();
      return Promise.resolve({
        done: false,
        value: owner.row(this.stage, this.start + this.index++),
      });
    } catch (error) {
      this.fail(error);
      return Promise.reject(error);
    }
  }

  return(): Promise<IteratorResult<IContent, void>> {
    this.finish();
    return Promise.resolve({ done: true, value: undefined });
  }

  throw(error?: unknown): Promise<IteratorResult<IContent, void>> {
    this.fail(error);
    return Promise.reject(error);
  }

  fail(error: unknown): void {
    this.failed = true;
    this.failure = error;
    this.finish();
  }

  private finish(): void {
    this.signal?.removeEventListener('abort', this.onAbort);
    this.owner?.release(this);
    this.owner = undefined;
  }
}
