/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const selectionLogger = new DebugLogger('llxprt:ui:selection');

interface ConfirmationRequestLike {
  onConfirm: (value: boolean) => void;
}

interface UseConfirmationSelectionParams {
  confirmationRequest: ConfirmationRequestLike | null;
}

/**
 * @hook useConfirmationSelection
 * @description Provides confirmation selection callback with debug logging
 * @inputs confirmationRequest
 * @outputs handleConfirmationSelect callback
 */
export function useConfirmationSelection({
  confirmationRequest,
}: UseConfirmationSelectionParams): (value: boolean) => void {
  return useCallback(
    (value: boolean) => {
      if (!confirmationRequest) {
        return;
      }

      if (selectionLogger.enabled) {
        selectionLogger.debug(
          () =>
            `AppContainer.handleConfirmationSelect value=${value} hasRequest=${Boolean(
              confirmationRequest,
            )}`,
        );
      }

      confirmationRequest.onConfirm(value);
    },
    [confirmationRequest],
  );
}
