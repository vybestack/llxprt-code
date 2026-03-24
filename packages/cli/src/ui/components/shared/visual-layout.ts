/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Visual layout calculations for the text buffer.
 * This module handles text wrapping and coordinate transformations
 * between logical and visual positions.
 */

import type { VisualLayout } from './buffer-types.js';
import {
  calculateTransformationsForLine,
  calculateTransformedLine,
} from './transformations.js';
import { toCodePoints, getCachedStringWidth } from '../../utils/textUtils.js';

interface LayoutAccumulator {
  visualLines: string[];
  logicalToVisualMap: Array<Array<[number, number]>>;
  visualToLogicalMap: Array<[number, number]>;
  transformedToLogicalMaps: number[][];
  visualToTransformedMap: number[];
}

function createLayoutAccumulator(): LayoutAccumulator {
  return {
    visualLines: [],
    logicalToVisualMap: [],
    visualToLogicalMap: [],
    transformedToLogicalMaps: [],
    visualToTransformedMap: [],
  };
}

function appendVisualSegment(
  layout: LayoutAccumulator,
  logicalLineIndex: number,
  logicalStartCol: number,
  transformedStartCol: number,
  text: string,
): void {
  const visualRow = layout.visualLines.length;
  layout.logicalToVisualMap[logicalLineIndex].push([
    visualRow,
    logicalStartCol,
  ]);
  layout.visualToLogicalMap.push([logicalLineIndex, logicalStartCol]);
  layout.visualToTransformedMap.push(transformedStartCol);
  layout.visualLines.push(text);
}

function appendEmptyLogicalLine(
  layout: LayoutAccumulator,
  logicalLineIndex: number,
): void {
  appendVisualSegment(layout, logicalLineIndex, 0, 0, '');
}

function buildWrappedChunk(
  codePoints: string[],
  startCol: number,
  viewportWidth: number,
): { text: string; consumedCodePoints: number } {
  let chunk = '';
  let visualWidth = 0;
  let consumedCodePoints = 0;
  let wordBreakConsumedCodePoints = 0;

  for (let i = startCol; i < codePoints.length; i++) {
    const char = codePoints[i];
    const charWidth = getCachedStringWidth(char);

    if (visualWidth + charWidth > viewportWidth) {
      if (
        wordBreakConsumedCodePoints > 0 &&
        startCol + wordBreakConsumedCodePoints < i
      ) {
        return {
          text: codePoints
            .slice(startCol, startCol + wordBreakConsumedCodePoints)
            .join(''),
          consumedCodePoints: wordBreakConsumedCodePoints,
        };
      }

      if (consumedCodePoints === 0) {
        return { text: char, consumedCodePoints: 1 };
      }
      break;
    }

    chunk += char;
    visualWidth += charWidth;
    consumedCodePoints++;

    if (char === ' ') {
      wordBreakConsumedCodePoints = consumedCodePoints - 1;
    }
  }

  if (consumedCodePoints === 0 && startCol < codePoints.length) {
    return { text: codePoints[startCol], consumedCodePoints: 1 };
  }

  return { text: chunk, consumedCodePoints };
}

function shouldSkipWrappedDelimiterSpace(
  codePoints: string[],
  startCol: number,
  consumedCodePoints: number,
): boolean {
  const nextCol = startCol + consumedCodePoints;
  return nextCol < codePoints.length && codePoints[nextCol] === ' ';
}

function appendWrappedTransformedLine(
  layout: LayoutAccumulator,
  logicalLineIndex: number,
  transformedLine: string,
  transformedToLogicalMap: number[],
  viewportWidth: number,
): void {
  const codePoints = toCodePoints(transformedLine);
  let transformedCol = 0;

  while (transformedCol < codePoints.length) {
    const { text, consumedCodePoints } = buildWrappedChunk(
      codePoints,
      transformedCol,
      viewportWidth,
    );

    const logicalStartCol = transformedToLogicalMap[transformedCol] ?? 0;
    appendVisualSegment(
      layout,
      logicalLineIndex,
      logicalStartCol,
      transformedCol,
      text,
    );

    transformedCol += Math.max(1, consumedCodePoints);
    if (
      shouldSkipWrappedDelimiterSpace(
        codePoints,
        transformedCol - Math.max(1, consumedCodePoints),
        Math.max(1, consumedCodePoints),
      )
    ) {
      transformedCol++;
    }
  }
}

function appendLogicalLineLayout(
  layout: LayoutAccumulator,
  logicalLine: string,
  logicalLineIndex: number,
  logicalCursor: [number, number],
  viewportWidth: number,
): void {
  layout.logicalToVisualMap[logicalLineIndex] = [];

  const transformations = calculateTransformationsForLine(logicalLine);
  const { transformedLine, transformedToLogMap } = calculateTransformedLine(
    logicalLine,
    logicalLineIndex,
    logicalCursor,
    transformations,
  );
  layout.transformedToLogicalMaps[logicalLineIndex] = transformedToLogMap;

  if (transformedLine.length === 0) {
    appendEmptyLogicalLine(layout, logicalLineIndex);
    return;
  }

  appendWrappedTransformedLine(
    layout,
    logicalLineIndex,
    transformedLine,
    transformedToLogMap,
    viewportWidth,
  );
}

function ensureLayoutHasVisualLine(
  layout: LayoutAccumulator,
  logicalLines: string[],
): void {
  const isEmptyDocument =
    logicalLines.length === 0 ||
    (logicalLines.length === 1 && logicalLines[0] === '');

  if (!isEmptyDocument || layout.visualLines.length > 0) {
    return;
  }

  layout.logicalToVisualMap[0] = layout.logicalToVisualMap[0] ?? [];
  appendVisualSegment(layout, 0, 0, 0, '');
}

/**
 * Calculates the visual wrapping of lines and the mapping between logical and visual coordinates.
 * This is an expensive operation and should be memoized.
 * @param logicalLines - The logical (unwrapped) lines
 * @param viewportWidth - The width of the viewport in characters
 * @param logicalCursor - The current cursor position [row, col]
 * @returns The visual layout with all mappings
 */
export function calculateLayout(
  logicalLines: string[],
  viewportWidth: number,
  logicalCursor: [number, number],
): VisualLayout {
  const layout = createLayoutAccumulator();

  logicalLines.forEach((logicalLine, logicalLineIndex) => {
    appendLogicalLineLayout(
      layout,
      logicalLine,
      logicalLineIndex,
      logicalCursor,
      viewportWidth,
    );
  });

  ensureLayoutHasVisualLine(layout, logicalLines);
  return layout;
}

/**
 * Calculates the visual cursor position based on a pre-calculated layout.
 * This is a lightweight operation.
 * @param layout - The pre-calculated visual layout
 * @param logicalCursor - The logical cursor position [row, col]
 * @returns The visual cursor position [row, col]
 */
export function calculateVisualCursorFromLayout(
  layout: VisualLayout,
  logicalCursor: [number, number],
): [number, number] {
  const { logicalToVisualMap, visualLines, transformedToLogicalMaps } = layout;
  const [logicalRow, logicalCol] = logicalCursor;

  const segmentsForLogicalLine = logicalToVisualMap[logicalRow];
  if (!segmentsForLogicalLine || segmentsForLogicalLine.length === 0) {
    return [0, 0];
  }

  let targetSegmentIndex = segmentsForLogicalLine.findIndex(
    ([, startColInLogical], index) => {
      const nextStartColInLogical =
        index + 1 < segmentsForLogicalLine.length
          ? segmentsForLogicalLine[index + 1][1]
          : Infinity;
      return (
        logicalCol >= startColInLogical && logicalCol < nextStartColInLogical
      );
    },
  );

  if (targetSegmentIndex === -1) {
    targetSegmentIndex =
      logicalCol === 0 ? 0 : segmentsForLogicalLine.length - 1;
  }

  const [visualRow, startColInLogical] =
    segmentsForLogicalLine[targetSegmentIndex];

  const transformedToLogicalMap = transformedToLogicalMaps[logicalRow] ?? [];
  let transformedCol = 0;
  for (let i = 0; i < transformedToLogicalMap.length; i++) {
    if (transformedToLogicalMap[i] > logicalCol) {
      transformedCol = Math.max(0, i - 1);
      break;
    }
    if (i === transformedToLogicalMap.length - 1) {
      transformedCol = transformedToLogicalMap.length - 1;
    }
  }

  let startColInTransformed = 0;
  while (
    startColInTransformed < transformedToLogicalMap.length &&
    transformedToLogicalMap[startColInTransformed] < startColInLogical
  ) {
    startColInTransformed++;
  }

  const clampedTransformedCol = Math.min(
    transformedCol,
    Math.max(0, transformedToLogicalMap.length - 1),
  );
  const visualCol = clampedTransformedCol - startColInTransformed;
  const clampedVisualCol = Math.min(
    Math.max(visualCol, 0),
    toCodePoints(visualLines[visualRow] ?? '').length,
  );
  return [visualRow, clampedVisualCol];
}
