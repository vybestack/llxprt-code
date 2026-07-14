/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { GenerateChatOptions } from '../IProvider.js';

export function isAbortSignal(value: unknown): value is AbortSignal {
  if (typeof value !== 'object' || value === null) return false;
  if (!('aborted' in value) || typeof value.aborted !== 'boolean') return false;
  if (
    !('addEventListener' in value) ||
    typeof value.addEventListener !== 'function'
  ) {
    return false;
  }
  return (
    'removeEventListener' in value &&
    typeof value.removeEventListener === 'function'
  );
}

export function getRequestSignal(
  options: Pick<GenerateChatOptions, 'invocation' | 'metadata'>,
): AbortSignal | undefined {
  const invocationSignal = options.invocation?.signal;
  if (isAbortSignal(invocationSignal)) return invocationSignal;
  const metadataSignal = options.metadata?.abortSignal;
  return isAbortSignal(metadataSignal) ? metadataSignal : undefined;
}

export interface LinkedAbortController {
  readonly controller: AbortController;
  dispose(): void;
}

export function createLinkedAbortController(
  parent?: AbortSignal,
): LinkedAbortController {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted === true) {
    onAbort();
  } else {
    parent?.addEventListener('abort', onAbort, { once: true });
  }
  return {
    controller,
    dispose() {
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

export function withRequestSignal(
  options: GenerateChatOptions,
  signal: AbortSignal,
): GenerateChatOptions {
  return {
    ...options,
    invocation:
      options.invocation === undefined
        ? ({ signal } as GenerateChatOptions['invocation'])
        : ({
            ...options.invocation,
            signal,
          } as GenerateChatOptions['invocation']),
    metadata: { ...options.metadata, abortSignal: signal },
  };
}

export function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    const dispose = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        dispose();
        resolve(value);
      },
      (error: unknown) => {
        dispose();
        reject(error);
      },
    );
  });
}
