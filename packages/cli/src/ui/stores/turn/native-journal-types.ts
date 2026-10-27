/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  JournalReadCounters,
  EmojiFilterMode,
  NativeJournalReadDependencies,
  IContent,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../types.js';

export interface NativeJournalOptions {
  readonly emojiFilterMode?: EmojiFilterMode;
  readonly counters?: JournalReadCounters;
  readonly signal?: AbortSignal;
  readonly journal?: NativeJournalReadDependencies;
  readonly publishedEnd?: number;
}

export type NativeDisplayEntry =
  | {
      readonly kind: 'boundary';
      readonly contextState?: 'in-context' | 'purged' | 'n/a';
      readonly transcriptId?: string;
      readonly offset: number;
      readonly length: number;
      readonly seq: number;
      readonly envelope: {
        readonly v: 1;
        readonly seq: number;
        readonly ts: string;
        readonly type: 'compressed';
        readonly payload: { readonly summary: IContent };
      };
    }
  | {
      readonly kind: 'projected';
      readonly contextState?: 'in-context' | 'purged' | 'n/a';
      readonly transcriptId?: string;
      readonly offset: number;
      readonly length: number;
      readonly seq: number | null;
      readonly rows: number;
      readonly item: HistoryItem;
    };
