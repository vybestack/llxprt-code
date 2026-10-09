/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { ProviderNormalizationDisk } from '@vybestack/llxprt-code-core/services/history/provider-normalization-disk.js';
import type { GenerateChatOptions, ProviderToolset } from '../IProvider.js';
import {
  getRequestSignal,
  raceWithAbort,
  withRequestSignal,
} from './abortSignal.js';
import { isAsyncIterableContents } from './collectContents.js';

const leases = new WeakMap<AsyncIterable<IContent>, RequestRowsLease>();

export interface RequestRowsScope {
  readonly options: GenerateChatOptions;
  close(): Promise<void>;
}

export function acquireRequestRows(
  input: GenerateChatOptions | AsyncIterable<IContent>,
  tools?: ProviderToolset,
  signal?: AbortSignal,
): RequestRowsScope {
  const rawOptions = isAsyncIterableContents(input)
    ? { contents: input, tools }
    : input;
  const options =
    signal === undefined ? rawOptions : withRequestSignal(rawOptions, signal);
  const existing = leases.get(options.contents);
  if (existing !== undefined) {
    return { options, close: async () => {} };
  }
  const owner = new RequestRowsLease(
    options.contents,
    options.requestRows,
    getRequestSignal(options),
  );
  return {
    options: {
      ...options,
      contents: owner.contents,
      contentCount: owner.count ?? options.contentCount,
    },
    close: () => owner.close(),
  };
}

class RequestRowsLease {
  private disk: ProviderNormalizationDisk | undefined;
  private source: AsyncIterator<IContent> | undefined;
  private length = 0;
  private exhausted = false;
  private closed = false;
  private advancing: Promise<void> | undefined;
  private failure: unknown;
  private readonly readers = new Set<AsyncGenerator<IContent, void, unknown>>();
  readonly contents: AsyncIterable<IContent>;
  private readonly onAbort = (): void => {
    this.failure = this.signal?.reason;
    this.disposeDisk();
  };

  constructor(
    private input: AsyncIterable<IContent> | undefined,
    private readonly rows?: ProviderRequestRows,
    private readonly signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    this.contents = { [Symbol.asyncIterator]: () => this.openReader() };
    leases.set(this.contents, this);
    signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  get count(): number | undefined {
    return this.rows?.count;
  }

  private assertOpen(): void {
    this.signal?.throwIfAborted();
    if (this.failure !== undefined) throw this.failure;
    if (this.closed) throw new Error('Provider request rows are closed');
  }

  private openReader(): AsyncGenerator<IContent, void, unknown> {
    const reader = this.trackReader(() => reader);
    this.readers.add(reader);
    return reader;
  }

  private async *trackReader(
    reader: () => AsyncGenerator<IContent, void, unknown>,
  ): AsyncGenerator<IContent, void, unknown> {
    try {
      yield* this.readRows();
    } finally {
      this.readers.delete(reader());
    }
  }

  private async *readRows(): AsyncGenerator<IContent, void, unknown> {
    this.assertOpen();
    if (this.rows !== undefined) {
      yield* this.rows.openReader(this.signal);
      return;
    }
    for (let index = 0; ; index++) {
      this.assertOpen();
      if (index === this.length && !this.exhausted) {
        this.advancing ??= this.advance().finally(() => {
          this.advancing = undefined;
        });
        if (this.signal === undefined) await this.advancing;
        else await raceWithAbort(this.advancing, this.signal);
      }
      this.assertOpen();
      if (index === this.length) return;
      if (this.disk === undefined)
        throw new Error('Missing request staging disk');
      yield this.disk.row('ordered', index);
    }
  }

  private async *readInput(
    input: AsyncIterable<IContent>,
  ): AsyncGenerator<IContent> {
    yield* input;
  }

  private async advance(): Promise<void> {
    try {
      this.assertOpen();
      if (this.input !== undefined) {
        this.source = this.readInput(this.input);
        this.input = undefined;
        this.disk = new ProviderNormalizationDisk();
      }
      if (this.source === undefined)
        throw new Error('Missing request staging source');
      const next = await this.source.next();
      this.assertOpen();
      if (next.done === true) {
        this.exhausted = true;
        this.source = undefined;
        return;
      }
      if (this.disk === undefined)
        throw new Error('Missing request staging disk');
      this.disk.append('ordered', next.value);
      this.length++;
    } catch (error) {
      this.failure = error;
      throw error;
    }
  }

  private disposeDisk(): void {
    this.closed = true;
    this.input = undefined;
    this.signal?.removeEventListener('abort', this.onAbort);
    this.disk?.close();
    this.disk = undefined;
  }

  async close(): Promise<void> {
    this.disposeDisk();
    try {
      for (const reader of this.readers) await reader.return();
    } finally {
      this.readers.clear();
      const source = this.source;
      this.source = undefined;
      await source?.return?.();
    }
  }
}
