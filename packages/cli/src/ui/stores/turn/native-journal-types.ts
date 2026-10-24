/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  JournalReadCounters,
  NativeJournalReadDependencies,
  IContent,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../types.js';

export interface NativeJournalOptions {
  readonly counters?: JournalReadCounters;
  readonly signal?: AbortSignal;
  readonly journal?: NativeJournalReadDependencies;
}

export type NativeDisplayEntry =
  | {
      readonly kind: 'boundary';
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
      readonly offset: number;
      readonly length: number;
      readonly seq: number | null;
      readonly rows: number;
      readonly item: HistoryItem;
    };
