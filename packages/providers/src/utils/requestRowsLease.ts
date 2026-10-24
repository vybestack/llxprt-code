/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  isProviderRequestSource,
  type ProviderRequestSelection,
  type ProviderRequestRows,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type {
  GenerateChatOptions,
  ProviderChatOptions,
  ProviderToolset,
} from '../IProvider.js';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
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

export function admitProviderContents(
  options: ProviderChatOptions,
): GenerateChatOptions {
  const { contents } = options;
  return {
    ...options,
    contents: isAsyncIterableContents(contents)
      ? contents
      : callerOwnedRawProviderSource(contents),
  };
}

export function acquireRequestRows(
  input: ProviderChatOptions | AsyncIterable<IContent>,
  tools?: ProviderToolset,
  signal?: AbortSignal,
): RequestRowsScope {
  const rawOptions = isAsyncIterableContents(input)
    ? { contents: input, tools }
    : admitProviderContents(input);
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

export function stagedRequestRows(
  contents: AsyncIterable<IContent>,
): Promise<ProviderRequestRows> {
  const lease = leases.get(contents);
  if (lease === undefined) {
    return Promise.reject(
      new Error(
        'Provider request rows were not staged; acquire them with acquireRequestRows',
      ),
    );
  }
  return lease.staged();
}

class RequestRowsLease {
  private admission: Promise<ProviderRequestSelection> | undefined;
  private closed = false;
  private readonly readers = new Set<AsyncGenerator<IContent, void, unknown>>();
  readonly contents: AsyncIterable<IContent>;
  private readonly onAbort = (): void => this.dispose();

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
    if (this.closed) throw new Error('Provider request rows are closed');
  }

  private openReader(
    rows?: ProviderRequestRows,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    const reader = this.trackReader(() => reader, rows, signal);
    this.readers.add(reader);
    return reader;
  }

  private async *trackReader(
    reader: () => AsyncGenerator<IContent, void, unknown>,
    rows?: ProviderRequestRows,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    try {
      this.assertOpen();
      const selected = rows ?? (await this.staged());
      for await (const row of selected.openReader(signal ?? this.signal)) {
        this.assertOpen();
        yield row;
      }
    } finally {
      this.readers.delete(reader());
    }
  }

  async staged(): Promise<ProviderRequestRows> {
    this.assertOpen();
    if (this.rows !== undefined) return this.scopedRows(this.rows);
    if (this.input === undefined || !isProviderRequestSource(this.input))
      throw new Error(
        'Provider contents require requestRows or an openProviderRequest source',
      );
    this.admission ??= this.input.openProviderRequest(this.signal);
    const rows = await (this.signal === undefined
      ? this.admission
      : raceWithAbort(this.admission, this.signal));
    this.assertOpen();
    return this.scopedRows(rows);
  }

  private scopedRows(rows: ProviderRequestRows): ProviderRequestRows {
    return {
      ...(rows.native === undefined ? {} : { native: rows.native }),
      ...(rows.callerOwned === true ? { callerOwned: true } : {}),
      count: rows.count,
      openReader: (signal) => this.openReader(rows, signal),
      readAt: (index, signal) => {
        this.assertOpen();
        return rows.readAt(index, signal);
      },
    };
  }

  private dispose(): void {
    this.closed = true;
    this.input = undefined;
    this.signal?.removeEventListener('abort', this.onAbort);
  }

  async close(): Promise<void> {
    this.dispose();
    try {
      for (const reader of this.readers) await reader.return();
    } finally {
      this.readers.clear();
      await this.admission?.then(
        (rows) => rows.close(),
        () => undefined,
      );
    }
  }
}
