/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getErrorMessage, isNodeError } from './errors.js';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import type * as Undici from 'undici';
import { dispatchOwnedFetch } from './owned-fetch-request.js';

const packageRequire = createRequire(
  createRequire(import.meta.url).resolve('undici/package.json'),
);
const { Agent, ProxyAgent }: typeof Undici = packageRequire('./');

export type NetworkFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

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
  } catch {
    // Invalid URL - not a private IP
    return false;
  }
}

export async function fetchWithTimeout(
  url: string,
  timeout: number,
  signal?: AbortSignal,
  init?: RequestInit,
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
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } catch (error: unknown) {
    if (
      (isNodeError(error) && error.code === 'ABORT_ERR') ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      // Check if it was our timeout or the external signal
      if (signal?.aborted === true) {
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

export class OwnedFetch {
  private readonly dispatcher;
  private readonly cancellation = new AbortController();
  private closing: Promise<void> | undefined;

  constructor(proxy?: string) {
    this.dispatcher = proxy === undefined ? new Agent() : new ProxyAgent(proxy);
  }

  readonly fetch: NetworkFetch = async (input, init) => {
    if (this.closing !== undefined || this.cancellation.signal.aborted)
      throw new Error('Root fetch is closed');
    const request = new Request(input, init);
    return dispatchOwnedFetch(
      this.dispatcher,
      request,
      AbortSignal.any([request.signal, this.cancellation.signal]),
      captureReplayableBody(init?.body),
    );
  };

  closeAdmissionAndAbort(): void {
    this.cancellation.abort();
  }

  dispose(): Promise<void> {
    this.closing ??= this.dispatcher.close();
    return this.closing;
  }
}

function captureReplayableBody(
  body: RequestInit['body'],
): string | Uint8Array | undefined {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body))
    return new Uint8Array(
      body.buffer,
      body.byteOffset,
      body.byteLength,
    ).slice();
  return undefined;
}
