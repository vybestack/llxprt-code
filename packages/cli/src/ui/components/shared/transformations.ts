/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Text transformations for the text buffer.
 * This module handles collapsing and expanding of content like image paths
 * to provide more concise visual representations.
 */

import type { Transformation } from './buffer-types.js';
import { LruCache, unescapePath } from '@vybestack/llxprt-code-core';
import { cpLen, cpSlice } from '../../utils/textUtils.js';
import { LRU_BUFFER_PERF_CACHE_LIMIT } from '../../constants.js';
import path from 'node:path';

/**
 * Regex pattern for matching image file paths.
 * Matches paths starting with @ followed by image extensions.
 */
export const imagePathRegex =
  /@((?:\\.|[^\s\r\n\\])+?\.(?:png|jpg|jpeg|gif|webp|svg|bmp))\b/gi;

/**
 * Gets the transformed (collapsed) representation of an image path.
 * @param filePath - The image file path (may include @ prefix)
 * @returns A collapsed representation like "[Image filename.png]"
 */
export function getTransformedImagePath(filePath: string): string {
  const raw = filePath;

  // Ignore leading @ when stripping directories, but keep it for simple '@file.png'
  const withoutAt = raw.startsWith('@') ? raw.slice(1) : raw;

  // Unescape the path to handle escaped spaces and other characters
  const unescaped = unescapePath(withoutAt);

  // Find last directory separator, supporting both POSIX and Windows styles
  const lastSepIndex = Math.max(
    unescaped.lastIndexOf('/'),
    unescaped.lastIndexOf('\\'),
  );

  // If we saw a separator, take the segment after it; otherwise fall back to the unescaped string
  const fileName =
    lastSepIndex >= 0 ? unescaped.slice(lastSepIndex + 1) : unescaped;

  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const maxBaseLength = 10;

  const truncatedBase =
    baseName.length > maxBaseLength
      ? `...${baseName.slice(-maxBaseLength)}`
      : baseName;

  return `[Image ${truncatedBase}${extension}]`;
}

/**
 * Calculates all transformations for a single line of text.
 * @param line - The line text to analyze
 * @returns An array of Transformation objects for the line
 */
const transformationsCache = new LruCache<string, Transformation[]>(
  LRU_BUFFER_PERF_CACHE_LIMIT,
);

export function calculateTransformationsForLine(
  line: string,
): Transformation[] {
  const cached = transformationsCache.get(line);
  if (cached) {
    return cached;
  }

  const transformations: Transformation[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state to ensure clean matching from start of line
  imagePathRegex.lastIndex = 0;

  while ((match = imagePathRegex.exec(line)) !== null) {
    const logicalText = match[0];
    const logStart = cpLen(line.substring(0, match.index));
    const logEnd = logStart + cpLen(logicalText);

    transformations.push({
      logStart,
      logEnd,
      logicalText,
      collapsedText: getTransformedImagePath(logicalText),
    });
  }

  transformationsCache.set(line, transformations);

  return transformations;
}

/**
 * Calculates transformations for all lines in the buffer.
 * @param lines - Array of text lines
 * @returns An array of Transformation arrays, one per line
 */
export function calculateTransformations(lines: string[]): Transformation[][] {
  return lines.map((ln) => calculateTransformationsForLine(ln));
}

/**
 * Gets the transformation under the cursor position.
 * @param row - The cursor row
 * @param col - The cursor column
 * @param spansByLine - The transformations for each line
 * @returns The Transformation under the cursor, or null if none
 */
export function getTransformUnderCursor(
  row: number,
  col: number,
  spansByLine: Transformation[][] | null | undefined,
): Transformation | null {
  if (!spansByLine || row < 0 || row >= spansByLine.length) return null;
  const spans = spansByLine.at(row);
  if (!spans || spans.length === 0) return null;
  for (const span of spans) {
    if (col >= span.logStart && col <= span.logEnd) {
      return span;
    }
    if (col < span.logStart) break;
  }
  return null;
}

/**
 * Calculates the transformed version of a line with position mapping.
 * @param logLine - The original logical line text
 * @param logIndex - The index of this logical line
 * @param logicalCursor - The current cursor position [row, col]
 * @param transformations - The transformations to apply
 * @returns An object with the transformed line and position mapping
 */
export function calculateTransformedLine(
  logLine: string,
  logIndex: number,
  logicalCursor: [number, number],
  transformations: Transformation[],
): { transformedLine: string; transformedToLogMap: number[] } {
  let transformedLine = '';
  const transformedToLogMap: number[] = [];
  let lastLogPos = 0;

  const cursorIsOnThisLine = logIndex === logicalCursor[0];
  const cursorCol = logicalCursor[1];

  for (const transform of transformations) {
    const textBeforeTransformation = cpSlice(
      logLine,
      lastLogPos,
      transform.logStart,
    );
    transformedLine += textBeforeTransformation;
    for (let i = 0; i < cpLen(textBeforeTransformation); i++) {
      transformedToLogMap.push(lastLogPos + i);
    }

    const isExpanded =
      cursorIsOnThisLine &&
      cursorCol >= transform.logStart &&
      cursorCol <= transform.logEnd;
    const transformedText = isExpanded
      ? transform.logicalText
      : transform.collapsedText;
    transformedLine += transformedText;

    // Map transformed characters back to logical characters
    const transformedLen = cpLen(transformedText);
    if (isExpanded) {
      for (let i = 0; i < transformedLen; i++) {
        transformedToLogMap.push(transform.logStart + i);
      }
    } else {
      // Collapsed: distribute transformed positions monotonically across the raw span.
      // This preserves ordering across wrapped slices so logicalToVisualMap has
      // increasing startColInLogical and visual cursor mapping remains consistent.
      const logicalLength = Math.max(0, transform.logEnd - transform.logStart);
      for (let i = 0; i < transformedLen; i++) {
        // Map the i-th transformed code point into [logStart, logEnd)
        const transformationToLogicalOffset =
          logicalLength === 0
            ? 0
            : Math.floor((i * logicalLength) / transformedLen);
        const transformationToLogicalIndex =
          transform.logStart +
          Math.min(
            transformationToLogicalOffset,
            Math.max(logicalLength - 1, 0),
          );
        transformedToLogMap.push(transformationToLogicalIndex);
      }
    }
    lastLogPos = transform.logEnd;
  }

  // Append text after last transform
  const remainingUntransformedText = cpSlice(logLine, lastLogPos);
  transformedLine += remainingUntransformedText;
  for (let i = 0; i < cpLen(remainingUntransformedText); i++) {
    transformedToLogMap.push(lastLogPos + i);
  }

  // For a cursor at the very end of the transformed line
  transformedToLogMap.push(cpLen(logLine));

  return { transformedLine, transformedToLogMap };
}
