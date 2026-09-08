/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '../../test-utils/render.js';
import { CliSpinner } from './CliSpinner.js';
import { debugState } from '../debug.js';
import {
  configureUnicodeSupport,
  resetUnicodeSupportForTesting,
} from '../contexts/UnicodeRenderingContext.js';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

function spinnerFrameOrEmpty(frame: string | undefined): string {
  return frame ?? '';
}

function firstSpinnerCharacter(frame: string): string {
  return [...frame][0] ?? '';
}

function maximumSpinnerCodePoint(frame: string): number {
  return Math.max(
    0,
    ...[...frame].map((character) => character.codePointAt(0) ?? 0),
  );
}

describe('<CliSpinner />', () => {
  beforeEach(() => {
    debugState.debugNumAnimatedComponents = 0;
  });

  afterEach(() => {
    resetUnicodeSupportForTesting(true);
  });

  it('should increment debugNumAnimatedComponents on mount and decrement on unmount', () => {
    expect(debugState.debugNumAnimatedComponents).toBe(0);
    const { unmount } = render(<CliSpinner />);
    expect(debugState.debugNumAnimatedComponents).toBe(1);
    unmount();
    expect(debugState.debugNumAnimatedComponents).toBe(0);
  });

  it('renders an ASCII frame when Unicode rendering is disabled', () => {
    configureUnicodeSupport('off');
    const { lastFrame } = render(<CliSpinner />);
    const frame = spinnerFrameOrEmpty(lastFrame());
    const asciiFrames = new Set(['-', '\\', '|', '/']);
    const firstChar = firstSpinnerCharacter(frame);
    expect(asciiFrames.has(firstChar)).toBe(true);
  });

  it('does not render a Braille glyph when Unicode rendering is disabled', () => {
    configureUnicodeSupport('off');
    const { lastFrame } = render(<CliSpinner />);
    const frame = spinnerFrameOrEmpty(lastFrame());
    const maxCodePoint = maximumSpinnerCodePoint(frame);
    expect(maxCodePoint).toBeLessThan(0x2800);
  });
});
