/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
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
  useEffect(() => {
    if (!selectionLogger.enabled) {
      return;
    }

    if (confirmationRequest) {
      selectionLogger.debug(() => 'Confirmation dialog opened');
    } else {
      selectionLogger.debug(() => 'Confirmation dialog closed');
    }
  }, [confirmationRequest]);
}
