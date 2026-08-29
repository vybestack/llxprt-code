/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool results are truncated at 1,000,000 characters and then handed whole to
 * MaxSizedBox, which lays out every line before clipping to the visible window.
 * A result showing twenty lines paid to wrap thousands.
 *
 * That cost is permanent. Measured on Bun 1.3.14 (darwin-arm64), releasing
 * transient allocations returns `heapSize` to baseline while process RSS stays
 * at its peak, so one oversized layout raises the floor for the whole session.
 *
 * A source line always produces at least one display line, so source lines
 * beyond the window can never be visible and do not need to be laid out.
 */

import { describe, it, expect } from 'bun:test';
import { ToolResultDisplay } from './ToolResultDisplay.js';
import { renderWithProviders } from '../../../test-utils/render.js';

interface JscGcApi {
  gcAndSweep: () => void;
}

function isJscGcApi(value: unknown): value is JscGcApi {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return 'gcAndSweep' in value && typeof value.gcAndSweep === 'function';
}

/** Full collection, so a measurement reflects retained rather than pending memory. */
function gcAndSweep(): void {
  const jsc = process.getBuiltinModule('bun:jsc');
  if (!isJscGcApi(jsc)) {
    throw new Error('bun:jsc gcAndSweep is unavailable');
  }
  jsc.gcAndSweep();
}

const TERMINAL_WIDTH = 120;
const AVAILABLE_HEIGHT = 40;
const SOURCE_LINE = 'abcdefghij'.repeat(20);

function makeResult(characters: number): string {
  const lineCount = Math.ceil(characters / SOURCE_LINE.length);
  return Array.from(
    { length: lineCount },
    (_, index) => `line${index} ${SOURCE_LINE}`,
  ).join('\n');
}

function renderResult(resultDisplay: string): {
  frame: string;
  peakRssBytes: number;
} {
  const { lastFrame, unmount } = renderWithProviders(
    <ToolResultDisplay
      resultDisplay={resultDisplay}
      terminalWidth={TERMINAL_WIDTH}
      availableTerminalHeight={AVAILABLE_HEIGHT}
      renderOutputAsMarkdown={false}
    />,
  );
  const frame = lastFrame() ?? '';
  const peakRssBytes = process.memoryUsage.rss();
  unmount();
  return { frame, peakRssBytes };
}

function settleRssBytes(): number {
  gcAndSweep();
  gcAndSweep();
  return process.memoryUsage.rss();
}

describe('ToolResultDisplay — large results cost only what they display', () => {
  // Runs first: resident memory never falls back once claimed, so an earlier
  // oversized render in this process would mask the marginal cost.
  it('does not lay out result lines that cannot be displayed', () => {
    // Warm up React, Ink, and the layout paths on a smaller result so the
    // comparison measures marginal layout cost rather than one-time warmup.
    renderResult(makeResult(100_000));
    const settled = settleRssBytes();

    // Ten times the content, same visible window.
    const large = renderResult(makeResult(1_000_000));
    const marginalBytes = large.peakRssBytes - settled;

    // Before the input was bounded this marginal cost measured 23.6, 24.2 and
    // 24.5 MiB across three runs on Bun 1.3.14 (darwin-arm64), for a window of
    // roughly thirty-five lines that does not change with content size.
    expect(marginalBytes).toBeLessThan(10 * 1024 * 1024);
  });

  it('still shows the end of the output and reports hidden lines', () => {
    // 200,000 characters at 200 per line yields source lines line0..line999.
    const { frame } = renderResult(makeResult(200_000));

    // The tail is what remains visible, not an arbitrary prefix.
    expect(frame).toContain('line999');
    expect(frame).not.toContain('line0 ');

    // The reader is told content was omitted.
    expect(frame).toContain('hidden');
  });

  it('leaves results that fit entirely visible', () => {
    const { frame } = renderResult('alpha\nbravo\ncharlie');

    expect(frame).toContain('alpha');
    expect(frame).toContain('bravo');
    expect(frame).toContain('charlie');
    expect(frame).not.toContain('hidden');
  });
});
