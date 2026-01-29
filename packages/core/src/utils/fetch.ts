/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getErrorMessage, isNodeError } from './errors.js';
import { URL } from 'node:url';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^127\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

export class FetchError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export function isPrivateIp(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return PRIVATE_IP_RANGES.some((range) => range.test(hostname));
  } catch (_e) {
    return false;
  }
}

export async function fetchWithTimeout(
  url: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const onAbort = () => {
    clearTimeout(timeoutId);
    controller.abort();
  };

  // If an external signal is provided, listen to it
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      signal.addEventListener('abort', onAbort);
    }
  }

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } catch (error: unknown) {
    if (
      (isNodeError(error) && error.code === 'ABORT_ERR') ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      // Check if it was our timeout or the external signal
      if (signal?.aborted) {
        throw new FetchError('Request aborted by user', 'ABORT_ERR');
      }
      throw new FetchError(`Request timed out after ${timeout}ms`, 'ETIMEDOUT');
    }
    throw new FetchError(getErrorMessage(error));
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

export function setGlobalProxy(proxy: string) {
  setGlobalDispatcher(new ProxyAgent(proxy));
}
