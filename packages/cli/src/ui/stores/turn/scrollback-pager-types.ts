/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  JournalReadCounters,
  EmojiFilterMode,
  NativeJournalReadDependencies,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../types.js';
import type { RowIdentity } from '../../utils/rowIdentity.js';
import type { HistoryContextState } from '../../utils/historyContextState.js';

export interface ScrollbackViewportReporter {
  visibleKeys: readonly string[];
  /** Explicit scroll intent remains stable while React catches up to commits. */
  followingTail?: boolean;
  viewportLines: number;
  rowHeightLines(): number;
}
export interface ScrollbackPagerSettings {
  readonly marginViewports: number;
  readonly byteFloorBytes: number;
  readonly purgeDebounceMs: number;
}
export interface ScrollbackPagerOptions {
  readonly filePath: string;
  readonly emojiFilterMode?: EmojiFilterMode;
  readonly viewport: ScrollbackViewportReporter;
  readonly pageRows: number;
  readonly settings: ScrollbackPagerSettings;
  readonly chunkBytes?: number;
  readonly counters?: JournalReadCounters;
  readonly journal?: NativeJournalReadDependencies;
}
export interface ScrollbackRow {
  readonly key: string;
  readonly seq: number | null;
  readonly identity: RowIdentity;
  readonly offset: number | null;
  readonly item: HistoryItem;
  readonly contextState?: HistoryContextState;
}
export interface ScrollbackPagerState {
  readonly rows: readonly ScrollbackRow[];
  readonly loadingOlder: boolean;
  readonly atVisibilityFloor: boolean;
  readonly atFileEnd: boolean;
  readonly hasNewOutput: boolean;
  readonly generation: number;
  readonly error: string | null;
}
export interface ScrollbackPagerMetrics {
  readonly residentBytes: number;
  readonly residentRows: number;
}
export interface ScrollbackResumeSummary {
  readonly seededRows: number;
  readonly floorOffset: number;
  readonly tailOffset: number;
  readonly headSeq: number | null;
  readonly tailSeq: number | null;
  readonly atClearBoundary: boolean;
}
export interface ScrollbackPagerStore {
  getState(): ScrollbackPagerState;
  pageBack(): Promise<void>;
  pageForward(): Promise<void>;
  resumeFromJournal(): Promise<ScrollbackResumeSummary>;
  invalidate(): Promise<void>;
  reportViewport(): void;
  pageOut(direction: 'older' | 'newer'): void;
  setContextWindow(window: { firstSeq: number; lastSeq: number }): void;
  metrics(): ScrollbackPagerMetrics;
  close(): Promise<void>;
}
