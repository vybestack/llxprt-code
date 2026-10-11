/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns the agent's `attempt-boundary` signal into a paragraph break in the
 * non-interactive printer (issue #3840).
 *
 * The agent reports that a later attempt's output begins; whether a break is
 * needed depends on what this printer has displayed. Callers pass the text
 * that will actually be shown (after emoji filtering), so text the filter
 * removed never counts as displayed. A break is owed only when something was
 * already displayed for the current model call, and it is written lazily in
 * front of the next displayed text, so hidden thinking never produces a
 * leading, doubled or trailing separator. A break only tops the output up to a
 * blank line: a trailing `\n\n` already is one.
 *
 * Plain text output ends a separated run with exactly one newline: once a
 * separator has been written, trailing newlines are held back until more
 * output follows, and dropped if none does. Runs without separators keep
 * their historical output.
 */
export class AttemptSeparator {
  readonly #holdTrailingNewlines: boolean;
  /** Last two characters displayed for the current model call. */
  #callTail = '';
  #breakOwed = false;
  #separatorWritten = false;
  #heldNewlines = '';

  /**
   * @param holdTrailingNewlines true when the output gets a final newline
   * appended (plain text and quiet output), so a separated run must not end
   * with a newline of its own.
   */
  constructor(holdTrailingNewlines: boolean) {
    this.#holdTrailingNewlines = holdTrailingNewlines;
  }

  /** An attempt boundary arrived: the next displayed text starts a paragraph. */
  markBoundary(): void {
    if (this.#callTail !== '') {
      this.#breakOwed = true;
    }
  }

  /**
   * Returns `text` with the owed paragraph break in front of it, and records
   * it as displayed. Empty text is never displayed, so it keeps the break owed.
   */
  display(text: string): string {
    if (text === '') {
      return text;
    }
    let displayed = text;
    if (this.#breakOwed) {
      displayed = this.#breakFor(this.#callTail) + text;
      this.#breakOwed = false;
      this.#separatorWritten = true;
    }
    this.#callTail = (this.#callTail + displayed).slice(-2);
    if (!this.#holdTrailingNewlines || !this.#separatorWritten) {
      return displayed;
    }
    return this.#holdTrailing(displayed);
  }

  /**
   * The model call that produced the displayed output is over (its tool result
   * arrived). Later boundaries only separate attempts of the next call.
   */
  endCall(): void {
    this.#callTail = '';
    this.#breakOwed = false;
  }

  /**
   * Everything displayed so far was thrown away (output kept in a buffer that
   * was emptied), so nothing is owed or held for it any more.
   */
  reset(): void {
    this.#callTail = '';
    this.#breakOwed = false;
    this.#separatorWritten = false;
    this.#heldNewlines = '';
  }

  #holdTrailing(displayed: string): string {
    let bodyEnd = displayed.length;
    while (bodyEnd > 0 && displayed[bodyEnd - 1] === '\n') {
      bodyEnd -= 1;
    }
    const body = displayed.slice(0, bodyEnd);
    const trailing = displayed.slice(bodyEnd);
    if (body === '') {
      this.#heldNewlines += trailing;
      return '';
    }
    const released = this.#heldNewlines + body;
    this.#heldNewlines = trailing;
    return released;
  }

  #breakFor(tail: string): string {
    if (tail.endsWith('\n\n')) {
      return '';
    }
    return tail.endsWith('\n') ? '\n' : '\n\n';
  }
}
