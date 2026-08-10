/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RenderOptions } from 'ink';
import {
  createInkStdio,
  type StdoutWriteObserver,
} from '@vybestack/llxprt-code-core';

/**
 * The render-metrics payload Ink passes to its onRender callback. Extracted
 * from the installed Ink's RenderOptions type so it tracks the actual API
 * (verified: the installed @jrichman/ink provides `{ renderTime: number }`).
 */
type InkRenderMetrics = Parameters<NonNullable<RenderOptions['onRender']>>[0];

/**
 * CLI-owned render observer. P06/P07 install an instance to accumulate render
 * passes and duration. Ink provides renderTime (a real duration) per pass.
 */
export interface InteractiveRenderObserver {
  onRender(renderTimeMs: number): void;
}

type InkRenderOptionsConfig = {
  getScreenReader(): boolean;
};

type InkRenderOptionsSettings = {
  merged: {
    ui: {
      useAlternateBuffer?: boolean;
      incrementalRendering?: boolean;
    };
  };
};

// --- Lazy cached interactive stdio seam (P05) ---
// Replaces the former eager module-scope createInkStdio() call so that an
// optional stdout observer can be installed before the first render. Zed's
// separate direct createInkStdio() call stays observer-free and uncounted.
let interactiveStdio: ReturnType<typeof createInkStdio> | null = null;
let interactiveStdoutObserver: StdoutWriteObserver | null = null;

// --- Optional render observer (P05) ---
let interactiveRenderObserver: InteractiveRenderObserver | null = null;

/**
 * Installs (or clears) the optional stdout observer on the interactive Ink
 * instance. Must be called before the first render (i.e. before
 * {@link getInteractiveStdio} builds the cache). Setting a different observer
 * invalidates the cache so the next build carries it; setting the same value
 * is a no-op that reuses the cached instance.
 *
 * Default-off: never calling this means no observer is installed and no
 * counting work occurs.
 */
export function setInteractiveStdoutObserver(
  observer: StdoutWriteObserver | null,
): void {
  if (observer === interactiveStdoutObserver) {
    return;
  }
  interactiveStdoutObserver = observer;
  interactiveStdio = null;
}

/**
 * Returns the cached interactive stdio, building it lazily on first access
 * with whatever stdout observer (if any) was installed beforehand.
 */
export function getInteractiveStdio(): ReturnType<typeof createInkStdio> {
  return (interactiveStdio ??= createInkStdio(
    interactiveStdoutObserver ?? undefined,
  ));
}

/**
 * Installs (or clears) the optional render observer wired to Ink's onRender
 * callback on the interactive instance. P06/P07 install an instance to record
 * render passes and duration. Default-off: never calling this means no onRender
 * wiring is added to the returned RenderOptions.
 */
export function setInteractiveRenderObserver(
  observer: InteractiveRenderObserver | null,
): void {
  interactiveRenderObserver = observer;
}

/**
 * Returns the currently installed interactive render observer, or null when
 * none is installed. Used by the perf registry for identity-safe disposal
 * (clear only if the observer still points at this registry).
 */
export function getInteractiveRenderObserver(): InteractiveRenderObserver | null {
  return interactiveRenderObserver;
}

/**
 * Returns the currently installed stdout observer, or null when none is
 * installed. Used by the perf registry for identity-safe disposal.
 */
export function getInteractiveStdoutObserver(): StdoutWriteObserver | null {
  return interactiveStdoutObserver;
}

/**
 * @plan PLAN-20251215-OLDUI-SCROLL.P04
 * @requirement REQ-456.4
 */
export const inkRenderOptions = (
  config: InkRenderOptionsConfig,
  settings: InkRenderOptionsSettings,
): RenderOptions => {
  const isScreenReaderEnabled = config.getScreenReader();
  const useAlternateBuffer =
    settings.merged.ui.useAlternateBuffer === true && !isScreenReaderEnabled;
  const incrementalRendering =
    useAlternateBuffer && settings.merged.ui.incrementalRendering !== false;

  const stdio = getInteractiveStdio();

  const options: RenderOptions = {
    stdout: stdio.stdout,
    stderr: stdio.stderr,
    exitOnCtrlC: false,
    patchConsole: false,
    isScreenReaderEnabled,
    alternateBuffer: useAlternateBuffer,
    incrementalRendering,
  };

  // Render observer is wired only when installed (default-off). The observer
  // value is captured into a local closure at options-construction time; a
  // later setInteractiveRenderObserver(null) does NOT retroactively clear an
  // already-built options object. Rebuild the options to pick up a change.
  if (interactiveRenderObserver !== null) {
    const renderObserver = interactiveRenderObserver;
    options.onRender = (metrics: InkRenderMetrics) => {
      renderObserver.onRender(metrics.renderTime);
    };
  }

  return options;
};
