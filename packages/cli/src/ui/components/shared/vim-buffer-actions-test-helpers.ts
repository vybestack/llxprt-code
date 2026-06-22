/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextBufferState } from './buffer-types.js';

// Helper to create test state
export const createTestState = (
  lines: string[] = ['hello world'],
  cursorRow = 0,
  cursorCol = 0,
): TextBufferState => ({
  lines,
  cursorRow,
  cursorCol,
  transformationsByLine: lines.map(() => []),
  preferredCol: null,
  undoStack: [],
  redoStack: [],
  clipboard: null,
  selectionAnchor: null,
  viewportWidth: 80,
  viewportHeight: 24,
  visualLayout: {
    visualLines: lines,
    logicalToVisualMap: lines.map((_line, index) => [[index, 0]]),
    visualToLogicalMap: lines.map((_line, index) => [index, 0]),
    transformedToLogicalMaps: lines.map(() => [0]),
    visualToTransformedMap: lines.map(() => 0),
  },
});
