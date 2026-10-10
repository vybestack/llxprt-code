/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Request-scoped wire-body lease (issue #854, P05b4).
 *
 * One lease per physical transport call: the provider builds its SDK-shaped
 * body and hands it to the SDK inside the lease, then releases the lease once
 * the call settles (any outcome). Arrays inside the body graph are owned by
 * the lease — release() splices them so no wire array outlives the request
 * that sent it.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { collectContents } from './collectContents.js';
import { closeSync, openSync, readSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

/** Any object graph handed to a provider SDK as a request body. */
type BodyGraph = Record<string, unknown>;

function computeByteLength(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf-8');
  return -1;
}

function spliceOwnedArrays(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  const graph = value as BodyGraph;
  for (const key of Object.keys(graph)) {
    const entry = graph[key];
    if (Array.isArray(entry)) entry.splice(0);
  }
}

/**
 * A wire body built for exactly one transport call (issue #854 P05b4).
 * `value` is the SDK-shaped object graph (e.g. the Anthropic/Responses
 * request object, or the OpenAI messages array). Arrays inside it are owned
 * by the lease: release() splices them so nothing outlives the request.
 */
export interface RequestScopedBody<T> {
  /** The SDK-shaped body. Throws if the lease was released. */
  readonly value: T;
  /** Provider name the lease was acquired for (telemetry/debug only). */
  readonly provider: string;
  /** Byte length of the serialized body when cheaply known; -1 otherwise. */
  readonly byteLength: number;
  /**
   * Splices every array the lease owns and drops the body graph. Idempotent;
   * second and later calls resolve without effect.
   */
  release(): Promise<void>;
}

const activeLeases = new Set<object>();

class RequestScopedBodyLease<T> implements RequestScopedBody<T> {
  readonly provider: string;
  readonly byteLength: number;

  private released = false;
  private payload: T | undefined;

  constructor(provider: string, payload: T) {
    this.provider = provider;
    this.payload = payload;
    this.byteLength = computeByteLength(payload);
    activeLeases.add(this);
  }

  get value(): T {
    const current = this.payload;
    if (this.released || current === undefined) {
      throw new Error(
        'Request-scoped body consumed after release (issue #854 P05b4)',
      );
    }
    return current;
  }

  release(): Promise<void> {
    if (this.released) return Promise.resolve();
    this.released = true;
    const current = this.payload;
    if (current !== undefined) spliceOwnedArrays(current);
    this.payload = undefined;
    activeLeases.delete(this);
    return Promise.resolve();
  }
}

/**
 * Acquires a lease over an already-built body. Use this only when the body's
 * lifetime is managed by an external request-scoped owner (e.g. the media
 * request) that is guaranteed to call release() when the request settles;
 * otherwise prefer {@link withRequestScopedBody}.
 */
export function acquireRequestScopedBody<T>(
  provider: string,
  value: T,
): RequestScopedBody<T> {
  return new RequestScopedBodyLease(provider, value);
}

/**
 * Runs `consume` with a lease over a body built by `build`. Acquires before
 * `build`, releases after `consume` settles (success or throw), and
 * propagates the consumer's error after releasing. The body never outlives
 * this call.
 */
export async function withRequestScopedBody<T, R>(
  provider: string,
  build: () => T,
  consume: (body: RequestScopedBody<T>) => Promise<R>,
): Promise<R> {
  const body = acquireRequestScopedBody(provider, build());
  try {
    return await consume(body);
  } finally {
    await body.release();
  }
}

/** Global count of currently-acquired leases (in-flight bound probe). */
export function activeRequestBodyCount(): number {
  return activeLeases.size;
}

/**
 * Request-owned history with a disk-backed replay prefix. Each upload opens
 * a cursor and pulls rows on demand; retries reread the snapshot before
 * advancing the one-shot source. Context-dependent rebuilds still materialize
 * an array explicitly. Disposal closes the source, cursors and snapshot.
 */
export interface RequestScopedContents {
  materialize(): Promise<IContent[]>;
  readonly isMaterialized: boolean;
  stream(): AsyncIterable<IContent>;
  dispose(): Promise<void>;
}

class ProgressiveRequestContents implements RequestScopedContents {
  private storage: { root: string; path: string; fd: number } | undefined;
  private readonly cursors = new Set<number>();
  private rowCount = 0;
  private byteLength = 0;
  private reader: AsyncIterator<IContent> | undefined;
  private nextRow: Promise<void> | undefined;
  private drain: Promise<IContent[]> | undefined;
  private disposal: Promise<void> | undefined;
  private exhausted = false;
  private disposed = false;

  constructor(
    private readonly source: AsyncIterable<IContent>,
    private readonly signal?: AbortSignal,
  ) {}

  get isMaterialized(): boolean {
    return this.drain !== undefined;
  }

  private assertLive(): void {
    this.signal?.throwIfAborted();
    if (this.disposed) throw new Error('Request contents were disposed');
  }

  private readNext(): Promise<void> {
    this.assertLive();
    this.reader ??= this.source[Symbol.asyncIterator]();
    this.nextRow ??= this.reader.next().then((next) => {
      this.assertLive();
      if (next.done === true) this.exhausted = true;
      else this.append(next.value);
      this.nextRow = undefined;
    });
    return this.nextRow;
  }

  private ensureStorage(): { root: string; path: string; fd: number } {
    if (this.storage !== undefined) return this.storage;
    const root = createScratchDirSync('responses-request-snapshot-');
    const path = join(root, 'rows');
    try {
      this.storage = { root, path, fd: openSync(path, 'w+', 0o600) };
      return this.storage;
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  }

  private append(row: IContent): void {
    const { fd } = this.ensureStorage();
    // Binary rows preserve undefined, nonfinite numbers and signed strings;
    // JSON snapshots would silently change the converter's inputs.
    const bytes = serialize(row);
    const header = Buffer.alloc(8);
    header.writeDoubleLE(bytes.length);
    transferRowBytes(fd, header, this.byteLength, true);
    transferRowBytes(fd, bytes, this.byteLength + 8, true);
    this.byteLength += 8 + bytes.length;
    this.rowCount += 1;
  }

  async *stream(): AsyncIterableIterator<IContent> {
    this.assertLive();
    const cursor = openSync(this.ensureStorage().path, 'r');
    this.cursors.add(cursor);
    let offset = 0;
    try {
      for (let index = 0; ; index += 1) {
        this.assertLive();
        if (index === this.rowCount && !this.exhausted) await this.readNext();
        this.assertLive();
        if (index === this.rowCount) return;
        const header = Buffer.alloc(8);
        transferRowBytes(cursor, header, offset, false);
        const bytes = Buffer.alloc(header.readDoubleLE());
        transferRowBytes(cursor, bytes, offset + 8, false);
        offset += 8 + bytes.length;
        const row: IContent = deserialize(bytes);
        yield row;
      }
    } finally {
      if (this.cursors.delete(cursor)) closeSync(cursor);
    }
  }

  async materialize(): Promise<IContent[]> {
    this.assertLive();
    this.drain ??= collectContents(this.stream());
    return this.drain;
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.disposed = true;
    this.disposal = this.closeReader();
    return this.disposal;
  }

  private async closeReader(): Promise<void> {
    try {
      await this.reader?.return?.();
    } finally {
      this.reader = undefined;
      this.nextRow = undefined;
      this.drain = undefined;
      for (const cursor of this.cursors) closeSync(cursor);
      this.cursors.clear();
      const storage = this.storage;
      this.storage = undefined;
      if (storage !== undefined) {
        try {
          closeSync(storage.fd);
        } finally {
          rmSync(storage.root, { recursive: true, force: true });
        }
      }
    }
  }
}

function transferRowBytes(
  fd: number,
  bytes: Buffer,
  offset: number,
  write: boolean,
): void {
  let done = 0;
  while (done < bytes.length) {
    const count = write
      ? writeSync(fd, bytes, done, bytes.length - done, offset + done)
      : readSync(fd, bytes, done, bytes.length - done, offset + done);
    if (count === 0) throw new Error('Request snapshot I/O made no progress');
    done += count;
  }
}

export function requestScopedContents(
  source: AsyncIterable<IContent>,
  signal?: AbortSignal,
): RequestScopedContents {
  return new ProgressiveRequestContents(source, signal);
}
