/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { useEffect, useState } from 'react';
import type { EmojiFilterMode } from '@vybestack/llxprt-code-core';
import type {
  ScrollbackPagerSettings,
  ScrollbackPagerStore,
  ScrollbackViewportReporter,
} from '../../../stores/turn/scrollbackPager.js';
import { createScrollbackPagerStore } from '../../../stores/turn/scrollbackPager.js';
import {
  DEFAULT_SCROLLBACK_BYTE_FLOOR_KIB,
  DEFAULT_SCROLLBACK_MARGIN_VIEWPORTS,
  SCROLLBACK_PAGE_ROWS,
  SCROLLBACK_PURGE_DEBOUNCE_MS,
  SCROLLBACK_VIEWPORT_POLL_MS,
} from '../../../../constants/scrollbackLimits.js';
import type { LoadedSettings } from '../../../../config/settings.js';

export interface ScrollbackPagerBinding {
  readonly store: ScrollbackPagerStore;
  readonly viewport: ScrollbackViewportReporter;
}

export interface JournalPathSource {
  getCurrentRecording(): { getFilePath(): string | null } | null;
}

export interface UseScrollbackBootstrapOptions {
  readonly settings: LoadedSettings;
  readonly epoch?: number;
  readonly emojiFilterMode?: EmojiFilterMode;
  readonly recordingSwapCallbacks: JournalPathSource;
}

export interface ScrollbackBootstrapResult {
  readonly pager: ScrollbackPagerBinding | null;
}

export function scrollbackPagerSettingsFrom(
  settings: LoadedSettings,
): ScrollbackPagerSettings {
  const ui = settings.merged.ui;
  return {
    marginViewports:
      ui.scrollbackMarginViewports ?? DEFAULT_SCROLLBACK_MARGIN_VIEWPORTS,
    byteFloorBytes:
      (ui.scrollbackByteFloorKiB ?? DEFAULT_SCROLLBACK_BYTE_FLOOR_KIB) * 1024,
    purgeDebounceMs: SCROLLBACK_PURGE_DEBOUNCE_MS,
  };
}

export function useScrollbackBootstrap({
  settings,
  epoch = 0,
  emojiFilterMode,
  recordingSwapCallbacks,
}: UseScrollbackBootstrapOptions): ScrollbackBootstrapResult {
  const [pager, setPager] = useState<ScrollbackPagerBinding | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let disposed = false;
    let path: string | null = null;
    let active: ScrollbackPagerBinding | null = null;
    let awaitingFirstJournal =
      recordingSwapCallbacks.getCurrentRecording()?.getFilePath() == null;
    const update = (): void => {
      const nextPath =
        recordingSwapCallbacks.getCurrentRecording()?.getFilePath() ?? null;
      if (nextPath === path) return;
      path = nextPath;
      void active?.store.close();
      active = null;
      setPager(null);
      if (nextPath === null) return;
      const viewport: ScrollbackViewportReporter = {
        visibleKeys: [],
        viewportLines: 0,
        rowHeightLines: () => 1,
      };
      const binding = {
        viewport,
        store: createScrollbackPagerStore({
          filePath: nextPath,
          // A journal created after mount belongs to the live first turn.
          // Its approvals must not become resumed-orphan cancellations.
          orphanBeforeTranscriptId: awaitingFirstJournal ? 0n : undefined,
          emojiFilterMode,
          viewport,
          pageRows: SCROLLBACK_PAGE_ROWS,
          settings: scrollbackPagerSettingsFrom(settings),
        }),
      };
      active = binding;
      awaitingFirstJournal = false;
      void binding.store.resumeFromJournal().then(
        () => {
          if (!disposed && active === binding) setPager(binding);
        },
        (failure: unknown) => {
          if (!disposed && active === binding) setError(() => failure);
        },
      );
    };
    update();
    const timer = setInterval(update, SCROLLBACK_VIEWPORT_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
      void active?.store.close();
    };
  }, [recordingSwapCallbacks, settings, epoch, emojiFilterMode]);
  if (error !== null) throw error;
  return { pager };
}
