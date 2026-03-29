/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type DOMElement, measureElement } from 'ink';
import { useLayoutEffect, useRef } from 'react';
import { useMouseSelection } from '../../../hooks/useMouseSelection.js';
import { useKeypress, type Key } from '../../../hooks/useKeypress.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { ConsoleMessageItem } from '../../../types.js';

const selectionLogger = new DebugLogger('llxprt:ui:selection');

/**
 * @hook useLayoutMeasurement
 * @description Mouse selection and layout measurement
 * @inputs enabled, onCopiedText, setFooterHeight, terminalHeight, consoleMessages, showErrorDetails
 * @outputs mainControlsRef, pendingHistoryItemRef, rootUiRef, copySelectionToClipboard
 * @sideEffects useLayoutEffect for measurement
 * @cleanup Removes listeners on unmount
 * @strictMode Safe - measurements in layout effect
 * @subscriptionStrategy Resubscribe
 */

export interface UseLayoutMeasurementParams {
  enabled?: boolean;
  copyShortcutEnabled?: boolean;
  onCopiedText?: (text: string) => void;
  setFooterHeight: (height: number) => void;
  terminalHeight: number;
  consoleMessages: ConsoleMessageItem[];
  showErrorDetails: boolean;
}

export interface UseLayoutMeasurementResult {
  mainControlsRef: React.RefObject<DOMElement | null>;
  pendingHistoryItemRef: React.RefObject<DOMElement | null>;
  rootUiRef: React.RefObject<DOMElement | null>;
}

export function useLayoutMeasurement({
  enabled = true,
  copyShortcutEnabled = enabled,
  onCopiedText,
  setFooterHeight,
  terminalHeight,
  consoleMessages,
  showErrorDetails,
}: UseLayoutMeasurementParams): UseLayoutMeasurementResult {
  const mainControlsRef = useRef<DOMElement>(null);
  const pendingHistoryItemRef = useRef<DOMElement>(null);
  const rootUiRef = useRef<DOMElement>(null);

  const { copySelectionToClipboard } = useMouseSelection({
    enabled,
    rootRef: rootUiRef,
    onCopiedText:
      onCopiedText ??
      ((text) => {
        if (selectionLogger.enabled) {
          selectionLogger.debug(
            () => `Copied ${text.length} characters to clipboard`,
          );
        }
      }),
  });

  // Fix for issue #1284: Add keyboard shortcut for Cmd+C/Ctrl+C to copy selection.
  // Keep shortcut separate from mouse-selection enablement so copy mode can still
  // use keyboard copy even when in-app mouse selection is disabled.
  useKeypress(
    (key: Key) => {
      if (key.name === 'c' && (key.ctrl || key.meta)) {
        void copySelectionToClipboard();
      }
    },
    { isActive: copyShortcutEnabled },
  );

  useLayoutEffect(() => {
    if (mainControlsRef.current != null) {
      const fullFooterMeasurement = measureElement(mainControlsRef.current);
      setFooterHeight(fullFooterMeasurement.height);
    }
  }, [terminalHeight, consoleMessages, showErrorDetails, setFooterHeight]);

  return {
    mainControlsRef,
    pendingHistoryItemRef,
    rootUiRef,
  };
}
