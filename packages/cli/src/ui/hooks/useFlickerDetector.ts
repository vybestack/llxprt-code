/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { type DOMElement, measureElement } from 'ink';
import { appEvents, AppEvent } from '../../utils/events.js';

/**
 * Hook to detect UI flicker by measuring the root element's height
 * against the terminal height.
 *
 * This hook is for TELEMETRY ONLY - it detects overflow and emits
 * a Flicker event for monitoring purposes. It does NOT prevent flicker.
 *
 * Actual flicker prevention is handled in AppContainer by:
 * 1. Measuring footer height
 * 2. Calculating available terminal height
 * 3. Passing constraints to child components
 *
 * This addresses issue #456 - flicker resistance for narrow terminals
 * and dialogs/long output scenarios.
 */
export function useFlickerDetector(
  rootUiRef: React.RefObject<DOMElement | null>,
  terminalHeight: number,
  constrainHeight: boolean,
): void {
  useEffect(() => {
    if (rootUiRef.current) {
      const measurement = measureElement(rootUiRef.current);
      if (measurement.height > terminalHeight && constrainHeight) {
        appEvents.emit(AppEvent.Flicker, {
          contentHeight: measurement.height,
          terminalHeight,
          overflow: measurement.height - terminalHeight,
        });
      }
    }
  }); // NO dependency array - runs after every render
}
