/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  EmojiFilterMode,
  RowOwnership,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../types.js';
import type { RowSource } from './rowIdentity.js';
import { ToolResponseIndex } from './toolResponseIndex.js';
import { projectToolPages } from './projectToolPages.js';

export class HistoryProjection {
  private opener: IContent | undefined;
  private responses: ToolResponseIndex | undefined;
  private index = 0;
  private groupStart = 0;
  private source: RowSource = { kind: 'legacy', index: 0 };
  private id = -1;

  constructor(
    private readonly mode?: EmojiFilterMode,
    private readonly ownership?: RowOwnership,
    private readonly temporaryRoot?: string,
    private readonly signal?: AbortSignal,
  ) {}

  *accept(row: IContent, source?: RowSource): Iterable<HistoryItem> {
    this.ownership?.retain(row);
    try {
      this.signal?.throwIfAborted();
      if (row.speaker !== 'tool') {
        yield* this.flush();
        this.groupStart = this.index;
        this.source = source ?? { kind: 'legacy', index: this.index };
        this.opener = row;
        this.ownership?.retain(row);
      } else {
        this.responses ??= new ToolResponseIndex(
          this.temporaryRoot,
          this.ownership,
        );
        this.responses.add(row);
      }
      this.index += 1;
    } finally {
      this.ownership?.release(row);
    }
  }

  *flush(): Iterable<HistoryItem> {
    try {
      yield* this.project();
    } finally {
      this.close();
    }
  }

  /** Projects the open group without closing it, so later rows can join. */
  *project(): Iterable<HistoryItem> {
    if (!this.opener) return;
    for (const item of projectToolPages(
      this.opener,
      this.responses,
      this.groupStart,
      this.mode,
      this.ownership,
    )) {
      this.signal?.throwIfAborted();
      const identity = item.rowIdentity;
      const projected: HistoryItem = {
        ...item,
        id: this.id--,
        ...(identity?.kind === 'legacy'
          ? {
              rowIdentity: {
                ...this.source,
                discriminator: identity.discriminator,
                ...(identity.toolOffset === undefined
                  ? {}
                  : { toolOffset: identity.toolOffset }),
              },
            }
          : {}),
      };
      this.ownership?.retain(projected);
      try {
        yield projected;
      } finally {
        this.ownership?.release(projected);
      }
    }
  }

  /**
   * Parks the open group's opener on disk beside its indexed responses, so
   * nothing but the group's call-count-sized scratch survives between passes.
   * `resume` brings the opener back for more responses to join.
   */
  suspend(): void {
    if (!this.opener) return;
    this.responses ??= new ToolResponseIndex(
      this.temporaryRoot,
      this.ownership,
    );
    this.responses.saveOpener(this.opener);
    this.ownership?.release(this.opener);
    this.opener = undefined;
  }

  resume(source: RowSource): void {
    if (!this.responses) throw new Error('No parked group to resume');
    const opener = this.responses.loadOpener();
    this.ownership?.retain(opener);
    this.opener = opener;
    this.source = source;
  }

  close(): void {
    if (this.opener) this.ownership?.release(this.opener);
    this.opener = undefined;
    this.responses?.close();
    this.responses = undefined;
  }
}
