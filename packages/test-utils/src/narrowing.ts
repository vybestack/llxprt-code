/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fail-fast narrowing helpers for tests (issue #3129).
 *
 * A test that writes its own `if (x === null) throw ...` guard is doing the
 * right thing -- failing loudly on an unexpected shape rather than silently
 * substituting a default -- but jest/no-conditional-in-test cannot tell that
 * guard apart from a test that branches its assertions. These helpers keep the
 * fail-fast behaviour and move the branch out of the test body, so the rule
 * measures what it is meant to measure.
 *
 * They throw rather than calling expect() so they can be used outside a test
 * block (jest/no-standalone-expect) and so the failure names the offending
 * value instead of reporting a bare assertion failure.
 */

export function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertDefined<T>(
  value: T | undefined,
  message = 'Expected value to be defined',
): asserts value is T {
  if (value === undefined) {
    throw new Error(message);
  }
}

export function assertNotNull<T>(
  value: T | null,
  message = 'Expected value not to be null',
): asserts value is T {
  if (value === null) {
    throw new Error(message);
  }
}

export function assertPresent<T>(
  value: T | null | undefined,
  message = 'Expected value to be present',
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

export function assertInstanceOf<T>(
  value: unknown,
  ctor: new (...args: never[]) => T,
  message = `Expected an instance of ${ctor.name}`,
): asserts value is T {
  if (!(value instanceof ctor)) {
    throw new Error(message);
  }
}

/**
 * Normalises an unknown thrown value to a message string.
 *
 * `error instanceof Error ? error.message : String(error)` written inline in a
 * test counts as a conditional in the test (#3129); it is also repeated in
 * dozens of files. Extracting it keeps the behaviour identical and gives the
 * idiom one definition.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Text of a content block, or '' when the block is not a text block.
 *
 * `block.type === 'text' ? block.text : ''` inline in a test counts as a
 * conditional in the test (#3129) and is repeated across many suites.
 *
 * Not byte-identical to that expression: the input type admits an absent
 * `text`, and for the malformed `{ type: 'text', text: undefined }` this
 * returns '' where the inline form returns undefined. Valid IContent text
 * blocks always carry a string, so no call site observes the difference.
 */
export function blockTextOrEmpty(block: {
  readonly type: string;
  readonly text?: string;
}): string {
  return block.type === 'text' ? (block.text ?? '') : '';
}
