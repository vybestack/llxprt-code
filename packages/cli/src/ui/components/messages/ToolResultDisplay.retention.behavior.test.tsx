/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool results are truncated at 1,000,000 characters and then trimmed to the
 * visible window before layout, so a result showing a few dozen lines pays to
 * wrap a few dozen lines, not the thousands its body contains.
 *
 * Memory behavior is asserted on the settled JavaScriptCore heap (heapSize +
 * extraMemorySize after two full collections), not process RSS: RSS is
 * process-wide and never falls back after allocator or JIT growth, so a
 * strict RSS budget conflates what this component retains with whatever else
 * the test process touched. The settled heap isolates what renders of the
 * component actually keep alive. Cycled bodies are also dropped by the test
 * itself before the settled measurement, so the delta reports what renders
 * kept, not what the test was still holding.
 */

import { describe, it, expect } from 'bun:test';
import type React from 'react';
import { ToolResultDisplay, trimToVisibleTail } from './ToolResultDisplay.js';
import {
  renderWithProviders,
  wrapWithProviders,
} from '../../../__tests__/render.js';

interface JscHeapStats {
  heapSize: number;
  extraMemorySize: number;
}

interface JscMemoryTestApi {
  gcAndSweep: () => void;
  heapStats: () => JscHeapStats;
}

function isJscMemoryTestApi(value: unknown): value is JscMemoryTestApi {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'gcAndSweep' in value &&
    typeof value.gcAndSweep === 'function' &&
    'heapStats' in value &&
    typeof value.heapStats === 'function'
  );
}

function loadJscMemoryApi(): JscMemoryTestApi {
  const jsc = process.getBuiltinModule('bun:jsc');
  if (!isJscMemoryTestApi(jsc)) {
    throw new Error('bun:jsc gcAndSweep/heapStats are unavailable');
  }
  return jsc;
}

/**
 * Retained heap after full collection: two sweeps so a measurement reflects
 * retained rather than pending memory, and heapSize plus extraMemorySize so
 * string backing stores outside the marked heap are counted too. JSC updates
 * these statistics at collection time, so every read must follow a sweep.
 */
function settledRetainedHeapBytes(): number {
  const jsc = loadJscMemoryApi();
  jsc.gcAndSweep();
  jsc.gcAndSweep();
  const stats = jsc.heapStats();
  return stats.heapSize + stats.extraMemorySize;
}

const MIB = 1024 * 1024;
const TERMINAL_WIDTH = 120;
const AVAILABLE_HEIGHT = 40;
const SOURCE_LINE = 'abcdefghij'.repeat(20);
const CYCLE_BODY_COUNT = 8;

function makeResult(characters: number, salt: number): string {
  const lineCount = Math.ceil(characters / SOURCE_LINE.length);
  return Array.from(
    { length: lineCount },
    (_, index) => `s${salt}line${index} ${SOURCE_LINE}`,
  ).join('\n');
}

/**
 * A single unbroken line of exactly the requested length, distinct per salt.
 * Minified output and logs without newlines arrive this way, and one source
 * line has no newline boundaries to trim on.
 */
function makeUnbrokenResult(characters: number, salt: number): string {
  const chunk = `${String(salt).padStart(2, '0')}abcdefghij`;
  const repeats = Math.floor(characters / chunk.length);
  const remainder = characters - repeats * chunk.length;
  return remainder === 0
    ? chunk.repeat(repeats)
    : chunk.repeat(repeats) + chunk.slice(0, remainder);
}

function buildResultElement(
  resultDisplay: string,
  terminalWidth = TERMINAL_WIDTH,
): React.ReactElement {
  return (
    <ToolResultDisplay
      resultDisplay={resultDisplay}
      terminalWidth={terminalWidth}
      availableTerminalHeight={AVAILABLE_HEIGHT}
      renderOutputAsMarkdown={false}
    />
  );
}

interface RenderedRoot {
  lastFrame: () => string | undefined;
  rerender: (tree: React.ReactElement) => void;
  unmount: () => void;
}

/**
 * Renders the warmup body the way the app mounts the component: the full
 * provider stack around it.
 */
function mountWarmup(): RenderedRoot {
  const root = renderWithProviders(buildResultElement(makeResult(100_000, 0)));
  root.lastFrame();
  return root;
}

/**
 * Shrinks off the last large body, unmounts, and returns the settled heap.
 * Ending on a small body is part of the shape being measured: the harness
 * keeps its own reference to the final render, so a large final body would
 * measure the harness, not the component.
 */
function finishCycle(root: RenderedRoot): number {
  root.rerender(wrapWithProviders(buildResultElement(makeResult(100_000, 99))));
  root.lastFrame();
  root.unmount();
  return settledRetainedHeapBytes();
}

/**
 * Rerenders the component once per body, each rerender carrying the full
 * provider-wrapped tree (rerendering a bare element drops the providers,
 * which is a harness artifact rather than component behavior). The bodies
 * live only inside this call, so once it returns the component, not the
 * test, is the only possible retainer of them.
 */
function rerenderDistinctBodies(
  root: RenderedRoot,
  makeBody: (index: number) => string,
): void {
  const bodies = Array.from({ length: CYCLE_BODY_COUNT }, (_, index) =>
    makeBody(index),
  );
  for (const body of bodies) {
    root.rerender(wrapWithProviders(buildResultElement(body)));
    root.lastFrame();
  }
}

/**
 * Same shape as rerenderDistinctBodies, but every rerender receives the same
 * body, created and released inside this call.
 */
function rerenderRepeatedBody(root: RenderedRoot): void {
  const body = makeResult(1_000_000, 1);
  for (let index = 0; index < CYCLE_BODY_COUNT; index++) {
    root.rerender(wrapWithProviders(buildResultElement(body)));
    root.lastFrame();
  }
}

/**
 * Builds the unbroken bodies, renders each once, renders each again, and
 * reports the settled heap after each pass. The bodies and everything they
 * anchor live only inside this call, so once it returns the component, not
 * the test, is the only possible retainer of them. The two pass readings
 * are taken while the bodies are still held, so the revisit delta between
 * them compares like-for-like measurements and the first-sight storage of
 * the bodies cancels out of it.
 */
function cycleUnbrokenBodies(root: RenderedRoot): {
  afterFirstPass: number;
  afterRevisit: number;
} {
  const bodies = Array.from({ length: CYCLE_BODY_COUNT }, (_, index) =>
    makeUnbrokenResult(1_000_000, index + 1),
  );
  for (const body of bodies) {
    root.rerender(wrapWithProviders(buildResultElement(body)));
    root.lastFrame();
  }
  const afterFirstPass = settledRetainedHeapBytes();
  for (const body of bodies) {
    root.rerender(wrapWithProviders(buildResultElement(body)));
    root.lastFrame();
  }
  const afterRevisit = settledRetainedHeapBytes();
  return { afterFirstPass, afterRevisit };
}

function renderResult(resultDisplay: string): { frame: string } {
  const { lastFrame, unmount } = renderWithProviders(
    buildResultElement(resultDisplay),
  );
  const frame = lastFrame() ?? '';
  unmount();
  return { frame };
}

// Thresholds hold at least twice the clean measurement and sit at least twice
// below the sabotaged measurement that must fail them, on numbers measured on
// Bun 1.3.14 (darwin-arm64):
// - distinct-body cycling retains 1.87-1.95 MiB over eight ~1 MiB bodies; a
//   component made to pin its bodies measured 18.06 MiB (reference pinning)
//   and 8.33 MiB (trim bypassed, layout retained per render).
// - repeating one body retains 0.43-0.47 MiB; pinning it measured 2.48 MiB.
// - cycling unbroken bodies twice and unmounting retains 1.40-1.43 MiB
//   against a baseline from before the bodies exist; a component made to
//   pin unbroken bodies on first sight measured 17.47 MiB. Revisiting the
//   flattened bodies retains 0.87-0.90 MiB while they are held; paying the
//   first-sight cost again per render measured 17.2-17.3 MiB (probe
//   evidence from issue #3457), and a trim bypass also runs each render
//   into the seconds, past the test timeout.
// - one unbroken body while mounted costs 2.20-2.25 MiB, mostly the body
//   itself; laying it out untrimmed measured 12.45 MiB.
// - one large { content } object body while mounted costs 2.37-2.49 MiB
//   (issue #3428); handing MarkdownDisplay the untrimmed body measured
//   46.14 MB (44.0 MiB) on the same channel.
const CYCLED_RETENTION_LIMIT_BYTES = 4 * MIB;
const REPEATED_BODY_RETENTION_LIMIT_BYTES = 1 * MIB;
const UNBROKEN_RETENTION_LIMIT_BYTES = 4 * MIB;
const UNBROKEN_REVISIT_LIMIT_BYTES = 2 * MIB;
const UNBROKEN_MOUNT_LIMIT_BYTES = 6 * MIB;
const OBJECT_MOUNT_LIMIT_BYTES = 8 * MIB;

function buildObjectResultElement(
  content: string,
  terminalWidth = TERMINAL_WIDTH,
): React.ReactElement {
  return (
    <ToolResultDisplay
      resultDisplay={{ content }}
      terminalWidth={terminalWidth}
      availableTerminalHeight={AVAILABLE_HEIGHT}
      renderOutputAsMarkdown={false}
    />
  );
}

describe('ToolResultDisplay — large results cost only what they display', () => {
  it('does not retain cycled result bodies after unmount', () => {
    const root = mountWarmup();
    const before = settledRetainedHeapBytes();
    rerenderDistinctBodies(root, (index) => makeResult(1_000_000, index + 1));
    const retainedBytes = finishCycle(root) - before;
    expect(retainedBytes).toBeLessThan(CYCLED_RETENTION_LIMIT_BYTES);
  });

  it('retains nothing when rerenders repeat the same body', () => {
    const root = mountWarmup();
    const before = settledRetainedHeapBytes();
    rerenderRepeatedBody(root);
    const retainedBytes = finishCycle(root) - before;
    expect(retainedBytes).toBeLessThan(REPEATED_BODY_RETENTION_LIMIT_BYTES);
  });

  it('retains nothing when cycled unbroken bodies are seen again', () => {
    // Two bounds guard the two ways unbroken bodies can be kept. The
    // absolute bound reads its baseline before the bodies exist and
    // compares it to the settled heap after both passes, the root shrunk
    // and unmounted, and the helper's own references to the bodies gone,
    // so a component that retains first sight of an unbroken body fails
    // it: the flattened storage of the test's rope-built strings dies with
    // those references unless the component kept a copy. The revisit bound
    // then catches a cost paid again on every later render of the same
    // bodies. Its readings come from inside the helper, where the bodies
    // are still held, because a first render flattens a rope-built
    // unbroken body in place, a cost of first use the test's own strings
    // pay; holding the bodies on both sides of that delta is what cancels
    // the first-sight storage out of it.
    const root = mountWarmup();
    const baseline = settledRetainedHeapBytes();
    const { afterFirstPass, afterRevisit } = cycleUnbrokenBodies(root);
    const retainedBytes = finishCycle(root) - baseline;
    expect(retainedBytes).toBeLessThan(UNBROKEN_RETENTION_LIMIT_BYTES);
    const revisitBytes = afterRevisit - afterFirstPass;
    expect(revisitBytes).toBeLessThan(UNBROKEN_REVISIT_LIMIT_BYTES);
  });

  it('bounds a single unbroken line, which has no newlines to trim on', () => {
    // Minified output and logs without newlines arrive as one source line, so
    // a line-count check alone would hand the whole body to layout.
    const { frame } = renderResult(makeUnbrokenResult(1_000_000, 1));

    expect(frame).toContain('hidden');
    expect(frame).toContain('abcdefghij');
  });

  // A broken trim makes this mount slow as well as heavy; the ceiling is
  // for the heap assertion to be the verdict, not a timeout.
  it('bounds what a single unbroken line costs while mounted', () => {
    // Settled reads keep the comparison deterministic; the mounted tree
    // stays live through them. The narrow width multiplies the rows a
    // broken trim would lay out (one row per width-sized chunk of the
    // body) while the visible window stays a few dozen rows either way.
    const settled = settledRetainedHeapBytes();
    const { lastFrame, unmount } = renderWithProviders(
      buildResultElement(makeUnbrokenResult(1_000_000, 1), 12),
    );
    const frame = lastFrame() ?? '';
    const whileMounted = settledRetainedHeapBytes();
    unmount();
    const marginalBytes = whileMounted - settled;

    // While mounted the body itself is necessarily live, roughly doubling
    // on this channel (heapSize and extraMemorySize each count its backing
    // store). A broken trim would additionally lay out a row per twelve
    // characters of body, and that layout dwarfs the body.
    expect(marginalBytes).toBeLessThan(UNBROKEN_MOUNT_LIMIT_BYTES);
    // Row wrapping can cut the body's twelve-character pattern anywhere,
    // so no fixed mid-body substring is guaranteed to survive it. The end
    // of the body is: the visible window keeps the tail, and its last row
    // therefore ends with the body's own final characters.
    expect(frame.trimEnd().endsWith('01ab')).toBe(true);
  }, 60_000);

  it('bounds what a single large { content } object body costs while mounted', () => {
    // The object render path feeds the (trimmed) body to the same
    // full-buffer processors the string path feeds MaxSizedBox, so an
    // unbounded input would lay out a row per source line of the body.
    const settled = settledRetainedHeapBytes();
    const { lastFrame, unmount } = renderWithProviders(
      buildObjectResultElement(makeResult(1_000_000, 1), 12),
    );
    const frame = lastFrame() ?? '';
    const whileMounted = settledRetainedHeapBytes();
    unmount();
    const marginalBytes = whileMounted - settled;

    expect(marginalBytes).toBeLessThan(OBJECT_MOUNT_LIMIT_BYTES);
    expect(frame).toContain('hidden');
    expect(frame).toContain('line4999');
  }, 60_000);

  it('still shows the end of the output and reports hidden lines', () => {
    // 200,000 characters at 200 per line yields source lines line0..line999.
    const { frame } = renderResult(makeResult(200_000, 0));

    // The tail is what remains visible, not an arbitrary prefix.
    expect(frame).toContain('line999');
    expect(frame).not.toContain('line0 ');

    // The reader is told content was omitted.
    expect(frame).toContain('hidden');
  });

  it('counts hidden rows by line, not by character count', () => {
    // Nine one-character lines followed by a long one. The character budget
    // drops only 19 characters, but those characters are ten display rows.
    const text = `${'x\n'.repeat(9)}${'y'.repeat(1001)}`;
    const { hiddenDisplayLines } = trimToVisibleTail(text, 10, 100);

    expect(hiddenDisplayLines).toBe(10);
  });

  it('leaves results that fit entirely visible', () => {
    const { frame } = renderResult('alpha\nbravo\ncharlie');

    expect(frame).toContain('alpha');
    expect(frame).toContain('bravo');
    expect(frame).toContain('charlie');
    expect(frame).not.toContain('hidden');
  });
});
