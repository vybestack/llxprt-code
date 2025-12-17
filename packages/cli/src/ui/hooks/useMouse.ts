/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import type { MouseHandler } from '../contexts/MouseContext.js';
import { useMouseContext } from '../contexts/MouseContext.js';

export function useMouse(
  onMouseEvent: MouseHandler,
  { isActive }: { isActive: boolean },
) {
  const { subscribe, unsubscribe } = useMouseContext();

  useEffect(() => {
    if (!isActive) {
      return;
    }

    subscribe(onMouseEvent);
    return () => {
      unsubscribe(onMouseEvent);
    };
  }, [isActive, onMouseEvent, subscribe, unsubscribe]);
}
