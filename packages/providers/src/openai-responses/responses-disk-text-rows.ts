/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

/** Explicit opt-in. The caller owns an immutable disk selection, never a row array. */
export class ResponsesDiskTextRows implements ProviderRequestRows {
  readonly count: number;
  readonly #rows: ProviderRequestRows & { close?: () => void | Promise<void> };

  constructor(
    rows: ProviderRequestRows & { close?: () => void | Promise<void> },
  ) {
    this.count = rows.count;
    this.#rows = rows;
    Object.freeze(this);
  }

  openReader(signal?: AbortSignal): AsyncGenerator<IContent, void, unknown> {
    return this.#rows.openReader(signal);
  }

  close(): void | Promise<void> {
    if (this.#rows.close === undefined)
      throw new Error(
        'Disk selection ownership requires an enclosing close operation',
      );
    return this.#rows.close();
  }
}
