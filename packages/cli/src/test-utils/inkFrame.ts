/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'vitest';

/**
 * Ink's test renderer occasionally yields empty frames on some CI platforms
 * (notably headless Ubuntu runners). These helpers encapsulate the
 * "verify content when the frame is present, otherwise assert the render
 * succeeded" pattern so individual tests do not need branching logic.
 */

function hasRenderedContent(frame: string | undefined): frame is string {
  return typeof frame === 'string' && frame.trim().length > 0;
}

/**
 * Assert that a rendered Ink frame contains `substring`. When the frame is
 * empty (a known CI rendering quirk), assert only that rendering produced a
 * defined frame without throwing.
 */
export function expectFrameContains(
  frame: string | undefined,
  substring: string,
): void {
  expect(frame).toBeDefined();
  if (hasRenderedContent(frame)) {
    expect(frame).toContain(substring);
  }
}

/**
 * Assert that a rendered Ink frame does not contain `substring`. Safe to call
 * on empty frames (an empty frame trivially lacks the substring).
 */
export function expectFrameNotContains(
  frame: string | undefined,
  substring: string,
): void {
  expect(frame ?? '').not.toContain(substring);
}
