/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lines reserved by `RenderCodeBlock` for the "... generating more ..."
 * indicator and padding when a fenced block is still streaming.
 */
export const CODE_BLOCK_RESERVED_LINES = 2;

/**
 * Appends a line to an in-progress fenced code block.
 *
 * Two things matter here for issue #2852.
 *
 * The append is in place. It replaces a `[...content, line]` spread that copied
 * every accumulated line for every line, so rendering one L-line block cost
 * O(L^2) — and that render ran again on every streamed delta, which is the
 * normal state for a coding agent writing a long file. The array is
 * render-local: once a block closes it is handed to `RenderCodeBlock` and a
 * fresh array replaces it, so it is never mutated after being read.
 *
 * While the block is still streaming, `RenderCodeBlock` displays only its first
 * `availableTerminalHeight - CODE_BLOCK_RESERVED_LINES` lines, so retaining
 * more than the viewport is pure waste. The cap deliberately sits above that
 * threshold, so the truncation indicator still appears exactly when it did
 * before and the displayed slice is unchanged.
 */
export function appendCodeBlockLine(
  codeBlockContent: string[],
  line: string,
  isPending: boolean,
  availableTerminalHeight: number | undefined,
): void {
  if (
    isPending &&
    availableTerminalHeight !== undefined &&
    codeBlockContent.length >= availableTerminalHeight
  ) {
    return;
  }
  codeBlockContent.push(line);
}
