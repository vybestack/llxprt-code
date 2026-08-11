/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProcessTerminationResult } from './processTermination.js';

export interface SubprocessSettlement {
  settled: boolean;
  terminationPromise: Promise<ProcessTerminationResult> | null;
}

export interface AbortHandlerRef {
  handler: () => void;
}

export function createSettleFn(
  settlement: SubprocessSettlement,
  abortSignal: AbortSignal,
  abortHandlerRef: AbortHandlerRef,
  reject: (error: Error) => void,
  lifecycleErrorCtor: new (message: string) => Error,
  command: string,
): (action: () => void) => void {
  return (action: () => void) => {
    if (settlement.settled) return;
    void (async () => {
      try {
        if (settlement.terminationPromise !== null) {
          const result = await settlement.terminationPromise;
          if (
            !settlement.settled &&
            (result.outcome === 'timeout' || result.outcome === 'failure')
          ) {
            settlement.settled = true;
            abortSignal.removeEventListener('abort', abortHandlerRef.handler);
            reject(
              new lifecycleErrorCtor(
                `${command} termination ${result.outcome}`,
              ),
            );
            return;
          }
        }
        if (settlement.settled) return;
        settlement.settled = true;
        abortSignal.removeEventListener('abort', abortHandlerRef.handler);
        action();
      } catch (err) {
        settlement.settled = true;
        abortSignal.removeEventListener('abort', abortHandlerRef.handler);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  };
}
