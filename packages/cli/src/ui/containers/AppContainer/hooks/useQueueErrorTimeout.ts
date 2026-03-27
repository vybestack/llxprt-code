/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

interface UseQueueErrorTimeoutParams {
  queueErrorMessage: string | null;
  setQueueErrorMessage: (message: string | null) => void;
  timeoutMs: number;
}

/**
 * @hook useQueueErrorTimeout
 * @description Clears temporary queue error message after timeout
 * @inputs queueErrorMessage, setQueueErrorMessage, timeoutMs
 * @outputs void
 * @sideEffects Timeout while message is visible
 * @cleanup Clears timeout on unmount / message change
 */
export function useQueueErrorTimeout({
  queueErrorMessage,
  setQueueErrorMessage,
  timeoutMs,
}: UseQueueErrorTimeoutParams): void {
  useEffect(() => {
    if (!queueErrorMessage) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setQueueErrorMessage(null);
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [queueErrorMessage, setQueueErrorMessage, timeoutMs]);
}
