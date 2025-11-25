/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { measureElement, DOMElement } from 'ink';

/**
 * Gets the bounding box of an Ink DOM element.
 * Note: Ink's measureElement only returns width and height.
 * Getting absolute position (x, y) is not directly supported by the public API
 * in a way that maps to screen coordinates reliably without traversing the tree
 * or using internal APIs.
 *
 * This function returns a best-effort bounding box.
 * For now, we mock x/y as 0 or try to infer if possible, but primarily we need
 * width/height for layout calculations.
 *
 * TODO: Investigate if we can get real absolute coordinates or if we need
 * to track them manually via context/props.
 */
export function getBoundingBox(element: DOMElement | null): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (!element) {
    return null;
  }

  const { width, height } = measureElement(element);

  // Mock position for now as Ink doesn't expose it easily
  return {
    x: 0,
    y: 0,
    width,
    height,
  };
}
