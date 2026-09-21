/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P02e
 * @requirement G1,G2
 *
 * Scrollback pager boot wiring (issue-854-design.md §8): ui.scrollbackPagerEnabled
 * is read ONCE at boot — the store decision never changes mid-session. When the
 * flag is on and the session journal path resolves, a ScrollbackPagerStore is
 * constructed against the journal with the residency knobs from
 * ui.scrollbackMarginViewports / ui.scrollbackByteFloorKiB (KiB → bytes) and
 * handed to the layout through the returned binding. When the journal path is
 * unavailable (no recording, unmaterialized file) the non-pager path stays
 * active and a one-line notice is added to the history — never a throw. A
 * mid-session flag change does not hot-swap anything; it only surfaces a
 * restart prompt (cleared again if the setting returns to its boot value).
 * Immediately after construction the hook starts the store's boot-time
 * resumeFromJournal() seed (P04b); a failure tears the binding down and
 * takes the non-pager fallback with a one-line notice — never a throw out
 * of the hook. On unmount the store is closed, dropping the journal cursor.
 */

import { useEffect, useRef, useState } from 'react';
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
} from '../../../../constants/scrollbackLimits.js';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { RecordingSwapCallbacks } from '../../../../services/performResume.js';
import { MessageType, type HistoryItemWithoutId } from '../../../types.js';

const SCROLLBACK_UNAVAILABLE_NOTICE = 'scrollback unavailable: no journal';
const SCROLLBACK_RESUME_FAILED_NOTICE = 'scrollback unavailable: resume failed';
const SCROLLBACK_RESTART_NOTICE =
  'scrollback pager setting changed: restart to apply';

/** Store plus the viewport reporter shared with the viewport component. */
export interface ScrollbackPagerBinding {
  readonly store: ScrollbackPagerStore;
  readonly viewport: ScrollbackViewportReporter;
}

export interface UseScrollbackBootstrapOptions {
  readonly settings: LoadedSettings;
  readonly recordingSwapCallbacks: RecordingSwapCallbacks;
  readonly addItem: (item: HistoryItemWithoutId, timestamp?: number) => number;
}

export interface ScrollbackBootstrapResult {
  readonly pager: ScrollbackPagerBinding | null;
  readonly restartNotice: string | null;
}

function isFlagEnabled(settings: LoadedSettings): boolean {
  return settings.merged.ui.scrollbackPagerEnabled === true;
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

/**
 * Maps the residency knobs into the store's settings; the schema defaults
 * (2 viewports, 256 KiB) apply whenever a settings file carries a missing or
 * non-numeric value. The byte knob is KiB on the wire, bytes in the store.
 */
export function scrollbackPagerSettingsFrom(
  settings: LoadedSettings,
): ScrollbackPagerSettings {
  const ui = settings.merged.ui;
  return {
    marginViewports: positiveOr(
      ui.scrollbackMarginViewports,
      DEFAULT_SCROLLBACK_MARGIN_VIEWPORTS,
    ),
    byteFloorBytes:
      positiveOr(ui.scrollbackByteFloorKiB, DEFAULT_SCROLLBACK_BYTE_FLOOR_KIB) *
      1024,
    purgeDebounceMs: SCROLLBACK_PURGE_DEBOUNCE_MS,
  };
}

/** Boot-time pager decision: a live binding, the fallback notice, or flag-off. */
type ScrollbackBootOutcome =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly binding: ScrollbackPagerBinding };

/**
 * Resolves the boot-time pager outcome once: a live store binding when the
 * flag is on and the journal path resolves, 'unavailable' when the flag is
 * on but no journal exists (one-line notice), and 'disabled' when the flag
 * is off (no notice).
 */
function resolveBootOutcome(
  settings: LoadedSettings,
  recordingSwapCallbacks: RecordingSwapCallbacks,
): ScrollbackBootOutcome {
  if (!isFlagEnabled(settings)) {
    return { kind: 'disabled' };
  }
  const journalPath =
    recordingSwapCallbacks.getCurrentRecording()?.getFilePath() ?? null;
  if (journalPath === null) {
    return { kind: 'unavailable' };
  }
  const viewport: ScrollbackViewportReporter = {
    visibleKeys: [],
    viewportLines: 0,
    rowHeightLines: () => 1,
  };
  const store = createScrollbackPagerStore({
    filePath: journalPath,
    viewport,
    pageRows: SCROLLBACK_PAGE_ROWS,
    settings: scrollbackPagerSettingsFrom(settings),
  });
  return { kind: 'ready', binding: { store, viewport } };
}

export function useScrollbackBootstrap(
  options: UseScrollbackBootstrapOptions,
): ScrollbackBootstrapResult {
  const { settings, recordingSwapCallbacks, addItem } = options;

  // Boot-time construction: the flag and journal path are resolved once.
  // The store owns no renders, so it never re-binds; unmount closes it.
  const pagerRef = useRef<ScrollbackPagerBinding | null>(null);
  const initializedRef = useRef(false);
  const unavailableRef = useRef(false);
  const noticeSentRef = useRef(false);
  const disposedRef = useRef(false);
  // Resume-failure teardown: the binding is dropped whole and the hook
  // falls back to the non-pager path with the one-line notice; it never
  // throws out of the hook.
  const handleResumeFailure = (store: ScrollbackPagerStore): void => {
    if (disposedRef.current || pagerRef.current?.store !== store) {
      return;
    }
    pagerRef.current = null;
    unavailableRef.current = true;
    void store.close();
    if (noticeSentRef.current) {
      return;
    }
    noticeSentRef.current = true;
    addItem(
      {
        type: MessageType.INFO,
        text: SCROLLBACK_RESUME_FAILED_NOTICE,
      },
      Date.now(),
    );
  };
  if (!initializedRef.current) {
    initializedRef.current = true;
    const outcome = resolveBootOutcome(settings, recordingSwapCallbacks);
    if (outcome.kind === 'unavailable') {
      unavailableRef.current = true;
    }
    if (outcome.kind === 'ready') {
      pagerRef.current = outcome.binding;
      // Boot-time resume: seed the resident window with the journal's
      // last page.
      void outcome.binding.store
        .resumeFromJournal()
        .catch(() => handleResumeFailure(outcome.binding.store));
    }
  }

  // The unavailable notice is a history row on the fallback (non-pager)
  // path; the guard keeps it at exactly one line across re-renders. The
  // effect covers a missing journal at boot; the resume catch above covers
  // a failed seed.
  useEffect(() => {
    if (noticeSentRef.current || !unavailableRef.current) {
      return;
    }
    noticeSentRef.current = true;
    addItem(
      { type: MessageType.INFO, text: SCROLLBACK_UNAVAILABLE_NOTICE },
      Date.now(),
    );
  }, [addItem]);

  // The flag itself is never reactive: a mid-session change only prompts
  // for a restart, and the prompt clears if the boot value is restored.
  // The effect keys on the flag value, so the rerender cadence is irrelevant.
  const bootFlagRef = useRef<boolean | null>(null);
  bootFlagRef.current ??= isFlagEnabled(settings);
  const flagNow = isFlagEnabled(settings);
  const [restartNotice, setRestartNotice] = useState<string | null>(null);
  useEffect(() => {
    setRestartNotice(
      flagNow === bootFlagRef.current ? null : SCROLLBACK_RESTART_NOTICE,
    );
  }, [flagNow]);

  useEffect(() => {
    const pager = pagerRef.current;
    return () => {
      disposedRef.current = true;
      void pager?.store.close();
    };
  }, []);

  return { pager: pagerRef.current, restartNotice };
}
