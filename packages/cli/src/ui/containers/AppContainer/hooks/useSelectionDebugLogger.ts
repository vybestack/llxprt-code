/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const selectionLogger = new DebugLogger('llxprt:ui:selection');

interface UseSelectionDebugLoggerParams {
  confirmationRequest: { prompt: React.ReactNode } | null;
}

/**
 * @hook useSelectionDebugLogger
 * @description Emits debug logs when confirmation dialog opens/closes
 * @inputs confirmationRequest
 * @outputs void
 */
export function useSelectionDebugLogger({
  confirmationRequest,
}: UseSelectionDebugLoggerParams): void {
  const isInitialMountRef = useRef(true);
  const prevConfirmationRequestRef = useRef(confirmationRequest);

  useEffect(() => {
    if (!selectionLogger.enabled) {
      isInitialMountRef.current = false;
      return;
    }

    // Skip logging on the initial mount — only log actual state transitions.
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      prevConfirmationRequestRef.current = confirmationRequest;
      return;
    }

    const wasOpen = prevConfirmationRequestRef.current !== null;
    const isOpen = confirmationRequest !== null;
    prevConfirmationRequestRef.current = confirmationRequest;

    if (!wasOpen && isOpen) {
      selectionLogger.debug(() => 'Confirmation dialog opened');
    } else if (wasOpen && !isOpen) {
      selectionLogger.debug(() => 'Confirmation dialog closed');
    }
  }, [confirmationRequest]);
}
