/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { inkRenderOptions } from './inkRenderOptions.js';

describe('inkRenderOptions', () => {
  it('disables alternate buffer when screen reader mode is enabled', () => {
    const options = inkRenderOptions(
      { getScreenReader: () => true },
      {
        merged: {
          ui: { useAlternateBuffer: true, incrementalRendering: true },
        },
      },
    );

    expect(options).toEqual(
      expect.objectContaining({
        exitOnCtrlC: false,
        patchConsole: false,
        isScreenReaderEnabled: true,
        alternateBuffer: false,
        incrementalRendering: false,
      }),
    );
  });

  it('enables alternate buffer and incremental rendering by default when configured', () => {
    const options = inkRenderOptions(
      { getScreenReader: () => false },
      { merged: { ui: { useAlternateBuffer: true } } },
    );

    expect(options).toEqual(
      expect.objectContaining({
        exitOnCtrlC: false,
        patchConsole: false,
        isScreenReaderEnabled: false,
        alternateBuffer: true,
        incrementalRendering: true,
      }),
    );
  });

  it('disables incremental rendering when ui.incrementalRendering is false', () => {
    const options = inkRenderOptions(
      { getScreenReader: () => false },
      {
        merged: {
          ui: { useAlternateBuffer: true, incrementalRendering: false },
        },
      },
    );

    expect(options).toEqual(
      expect.objectContaining({
        exitOnCtrlC: false,
        patchConsole: false,
        isScreenReaderEnabled: false,
        alternateBuffer: true,
        incrementalRendering: false,
      }),
    );
  });

  it('disables alternate buffer when ui.useAlternateBuffer is not true', () => {
    const options = inkRenderOptions(
      { getScreenReader: () => false },
      { merged: { ui: { useAlternateBuffer: false } } },
    );

    expect(options).toEqual(
      expect.objectContaining({
        exitOnCtrlC: false,
        patchConsole: false,
        isScreenReaderEnabled: false,
        alternateBuffer: false,
        incrementalRendering: false,
      }),
    );
  });
});
