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
  /** Renders `count` frames through the live reconciler. */
  renderFrames: (count: number) => void;
  /**
   * Frames the renderer actually produced, counted from Ink's `onRender`.
   * This is not the same as the number of `rerender` calls unless throttling
   * is disabled, so the caller can verify the workload did the work it asked
   * for rather than assuming it.
   */
  framesRendered: () => number;
  /** Total bytes the renderer emitted, for sanity-checking the run did work. */
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
      for (let frame = 0; frame < count; frame += 1) {
        seq += 1;
        instance.rerender(React.createElement(Frame, { seq }));
      }
    },
    framesRendered: () => rendered,
    bytesWritten: () => stdout.bytesWritten,
    dispose: () => {
      instance.unmount();
    },
  };
}
