/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ink render workload for the issue-2852 memory target (issue #3365).
 *
 * The other modes drive the streaming pipeline. None of them renders a frame,
 * so a leak in the Ink render path is invisible to the existing plateau
 * verdicts. That is not theoretical: evaluating the upstream-ink migration
 * (#3345) found that the pinned fork plateaus under sustained rendering while
 * both candidate upgrade targets grow without bound, and no check would have
 * failed on the regression.
 *
 * This imports the real `ink` package rather than a stub, so whatever the
 * repository resolves `ink` to is what gets measured. A dependency swap
 * therefore changes the subject of the measurement, which is the point.
 *
 * The tree mirrors `AlternateBufferLayout`: terminal-sized, `overflow: hidden`,
 * and no `<Static>`. Alternate buffer is the default, so this is the shape that
 * actually renders in a normal session.
 */

import { EventEmitter } from 'node:events';
import React from 'react';
import { Box, Text, render } from 'ink';

/** Columns and rows for the simulated terminal. */
const COLUMNS = 120;
const ROWS = 40;
/** Lines of text per frame, leaving room for the box to fit the viewport. */
const LINES_PER_FRAME = ROWS - 2;

/**
 * Discards output. Ink only needs `columns`, `rows` and `write`; keeping the
 * bytes would measure the sink instead of the renderer.
 */
class SinkStdout extends EventEmitter {
  readonly columns = COLUMNS;
  readonly rows = ROWS;
  readonly isTTY = true;
  bytesWritten = 0;

  write = (chunk: string): boolean => {
    this.bytesWritten += chunk.length;
    return true;
  };
}

/** Minimal readable stand-in; Ink probes these during mount. */
class SinkStdin extends EventEmitter {
  readonly isTTY = true;
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read(): null {
    return null;
  }
}

type FrameProps = { readonly seq: number };

/**
 * Distinct content every frame, as streaming assistant output produces. Reusing
 * one string would be served from the renderer's text caches and would measure
 * nothing.
 */
function Frame({ seq }: FrameProps): React.ReactElement {
  const lines = [];
  for (let row = 0; row < LINES_PER_FRAME; row += 1) {
    lines.push(
      React.createElement(
        Text,
        { key: row, wrap: 'wrap' },
        `${seq}:${row} lorem ipsum dolor sit amet consectetur adipiscing elit sed`,
      ),
    );
  }
  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: COLUMNS,
      height: ROWS,
      overflow: 'hidden',
    },
    lines,
  );
}

export type InkWorkload = {
  /**
   * Renders `count` frames through the live reconciler, and throws unless the
   * renderer both produced every frame and wrote it out. Verifying rather than
   * assuming is the point: a workload that silently renders nothing still
   * produces a flat, passing plateau.
   */
  renderFrames: (count: number) => void;
  /**
   * Frames the renderer actually produced, counted from Ink's `onRender`.
   * This is not the same as the number of `rerender` calls unless throttling
   * is disabled.
   */
  framesRendered: () => number;
  /** Total bytes the renderer emitted. */
  bytesWritten: () => number;
  /** Unmounts the app. */
  dispose: () => void;
};

/**
 * Mounts one Ink app and returns a handle that re-renders it. The instance is
 * deliberately kept across turns: a fresh mount per turn would reset renderer
 * state and hide exactly the accumulation this mode exists to detect.
 */
export function createInkWorkload(): InkWorkload {
  const stdout = new SinkStdout();
  let rendered = 0;

  const instance = render(React.createElement(Frame, { seq: 0 }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new SinkStdout() as unknown as NodeJS.WriteStream,
    stdin: new SinkStdin() as unknown as NodeJS.ReadStream,
    exitOnCtrlC: false,
    patchConsole: false,
    // Ink throttles frame production to `maxFps ?? 30` while reconciliation
    // stays synchronous. Left at the default, a tight rerender loop would
    // reconcile thousands of times but produce only a handful of frames, so
    // the text and layout work this mode exists to measure would barely run.
    // Zero disables the throttle so every rerender produces a frame.
    maxFps: 0,
    onRender: () => {
      rendered += 1;
    },
  });

  let seq = 0;
  return {
    renderFrames(count: number): void {
      const framesBefore = rendered;
      const bytesBefore = stdout.bytesWritten;
      for (let frame = 0; frame < count; frame += 1) {
        seq += 1;
        instance.rerender(React.createElement(Frame, { seq }));
      }
      const produced = rendered - framesBefore;
      if (produced !== count) {
        throw new Error(
          `Ink produced ${produced} frames for ${count} rerenders; the render workload is not being measured`,
        );
      }
      // Checked as well as counted, because a frame can be built and never
      // written. Ink's `onRender` runs `render(rootNode)` and then returns
      // early when `is-in-ci` sees CI or CONTINUOUS_INTEGRATION, skipping the
      // log-update write path entirely. Measured on this module at 200 frames:
      // 500,332 bytes with CI unset, 6 bytes with CI=true, `framesRendered`
      // 201 either way. Without this the mode would report a clean plateau
      // over a run whose write path did nothing.
      if (stdout.bytesWritten === bytesBefore) {
        throw new Error(
          `Ink produced ${produced} frames but wrote no terminal output; ` +
            'unset CI and CONTINUOUS_INTEGRATION so the write path is measured',
        );
      }
    },
    framesRendered: () => rendered,
    bytesWritten: () => stdout.bytesWritten,
    dispose: () => {
      instance.unmount();
    },
  };
}

/**
 * `bun scripts/issue-2852-memory-ink.ts [frames]` renders the workload once and
 * prints its counters, or exits non-zero with whichever guard tripped.
 *
 * This exists so the workload can be exercised in a child process with a chosen
 * environment. Ink decides whether to write at import time from `CI` and
 * `CONTINUOUS_INTEGRATION`, so a test in the parent process cannot cover both
 * cases, and on a CI runner it cannot cover the writing one at all.
 */
if (import.meta.main) {
  const requested = Number(process.argv[2] ?? '200');
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new Error(
      `Frames must be a positive integer, got: ${process.argv[2]}`,
    );
  }
  const workload = createInkWorkload();
  try {
    workload.renderFrames(requested);
    process.stdout.write(
      `${JSON.stringify({
        requested,
        framesRendered: workload.framesRendered(),
        bytesWritten: workload.bytesWritten(),
      })}\n`,
    );
  } finally {
    workload.dispose();
  }
}
