/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { rmSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ProviderNormalizationStorage } from '@vybestack/llxprt-code-core/services/history/provider-normalization-storage.js';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

/**
 * Small keyed facts about a request's rows (an id seen, an id mapped to
 * another id, an id's message position) in a request-scoped scratch directory.
 * Keys and values live on disk, so the heap holds no per-row state however
 * long the history is. Not for row or message bodies: those belong to the body
 * spool or to the provider normalization disk. Values must be JSON.
 *
 * The owner closes the index; closing removes the directory.
 */
export class KeyedRowIndex {
  private closed = false;

  private constructor(
    private readonly directory: string,
    private readonly storage: ProviderNormalizationStorage,
  ) {}

  /** An empty index in a fresh scratch directory named after `purpose`. */
  static create(purpose: string): KeyedRowIndex {
    const directory = createScratchDirSync(`${purpose}-`);
    try {
      return new KeyedRowIndex(
        directory,
        new ProviderNormalizationStorage(directory),
      );
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * An index filled in one pass over `rows`: `observe` is called once per row
   * in order and records into the index. A failure or abort closes the index
   * before the error reaches the caller.
   */
  static async build(
    purpose: string,
    rows: AsyncIterable<IContent>,
    observe: (row: IContent, index: KeyedRowIndex) => void,
    signal?: AbortSignal,
  ): Promise<KeyedRowIndex> {
    const index = KeyedRowIndex.create(purpose);
    try {
      for await (const row of rows) {
        signal?.throwIfAborted();
        observe(row, index);
      }
      return index;
    } catch (error) {
      index.close();
      throw error;
    }
  }

  /** Later writes to a key replace earlier ones. */
  set(key: string, value: unknown): void {
    this.storage.set(key, value);
  }

  /** The stored value, or `undefined` when the key was never set. */
  get(key: string): unknown {
    return this.storage.get(key);
  }

  has(key: string): boolean {
    return this.storage.get(key) !== undefined;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.storage.close();
    } finally {
      rmSync(this.directory, { recursive: true, force: true });
    }
  }
}
