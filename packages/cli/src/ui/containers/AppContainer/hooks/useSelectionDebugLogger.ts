/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { DialogStore } from '../../../stores/dialog/dialogStore.js';
import { useStoreSelector } from '../../../stores/useStoreSelector.js';

const selectionLogger = new DebugLogger('llxprt:ui:selection');

interface UseSelectionDebugLoggerParams {
  store: DialogStore;
}

/**
 * @hook useSelectionDebugLogger
 * @description Emits debug logs when confirmation dialog opens/closes
 * @inputs DialogStore
 * @outputs void
 */
export function useSelectionDebugLogger({
  store,
}: UseSelectionDebugLoggerParams): void {
  const confirmationRequest = useStoreSelector(
    store.store,
    (state) => state.confirmationRequest,
  );
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
