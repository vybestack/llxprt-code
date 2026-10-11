/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  ReplaceTransactionFold,
  type ReplaceRowStore,
} from '@vybestack/llxprt-code-core';
import type { JournalPageFile } from './journal-page-file.js';

/**
 * Membership adapter that lets the core replace-transaction rule drive the
 * pager's projected page file. The fold's row counts are journal content rows
 * (a tool group is several rows but fewer pages), so `length` is a running
 * count of content rows read in the current pass and the page-level base is
 * remembered separately. Only scalars are retained.
 */
export class PagerReplaceTransaction implements ReplaceRowStore {
  readonly fold = new ReplaceTransactionFold();
  /** Content rows read in this pass; the fold treats it as the row count. */
  private rows = 0;
  private pageBase = 0;
  private beginOffset = 0;
  private committedAt: number | null = null;

  constructor(private readonly pages: JournalPageFile) {}

  get length(): number {
    return this.rows;
  }

  countRow(): void {
    this.rows += 1;
  }

  /** Page index at which the open transaction's rows start. */
  get openBase(): number {
    return this.pageBase;
  }

  /** Journal offset of the open transaction's `replace_begin`. */
  get openOffset(): number {
    return this.beginOffset;
  }

  /** Remembers where a `replace_begin` at `offset` starts in the pages. */
  mark(offset: number): void {
    this.pageBase = this.pages.length;
    this.beginOffset = offset;
  }

  /**
   * Offset of the `replace_begin` whose commit was applied since the last
   * call, or null. The pager treats a commit as a full clear at that offset.
   */
  takeCommit(): number | null {
    const offset = this.committedAt;
    this.committedAt = null;
    return offset;
  }

  truncate(length: number): void {
    this.pages.truncate(this.pageBase);
    this.rows = length;
  }

  dropPrefix(count: number): void {
    this.pages.dropPrefix(this.pageBase);
    this.rows -= count;
    this.committedAt = this.beginOffset;
  }
}
