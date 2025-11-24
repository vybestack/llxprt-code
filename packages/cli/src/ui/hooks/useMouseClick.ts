/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type DOMElement } from 'ink';
import { getBoundingBox } from '../utils/ink-utils.js';
import type React from 'react';
import { useMouse, type MouseEvent } from '../contexts/MouseContext.js';

export const useMouseClick = (
  containerRef: React.RefObject<DOMElement | null>,
  handler: (event: MouseEvent, relativeX: number, relativeY: number) => void,
  options: { isActive?: boolean; button?: 'left' | 'right' } = {},
) => {
  const { isActive = true, button = 'left' } = options;

  useMouse(
    (event: MouseEvent) => {
      const eventName = button === 'left' ? 'left-press' : 'right-release';
      if (event.name === eventName && containerRef.current) {
        const boundingBox = getBoundingBox(containerRef.current);
        if (!boundingBox) return;
        const { x, y, width, height } = boundingBox;
        // Terminal mouse events are 1-based, Ink layout is 0-based.
        const mouseX = event.col - 1;
        const mouseY = event.row - 1;

        const relativeX = mouseX - x;
        const relativeY = mouseY - y;

        if (
          relativeX >= 0 &&
          relativeX < width &&
          relativeY >= 0 &&
          relativeY < height
        ) {
          handler(event, relativeX, relativeY);
        }
      }
    },
    { isActive },
  );
};
