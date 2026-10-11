/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getErrorMessage, isNodeError } from './errors.js';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import type * as Undici from 'undici';

const packageRequire = createRequire(
  createRequire(import.meta.url).resolve('undici/package.json'),
);
const {
  Agent,
  ProxyAgent,
  fetch: undiciFetch,
}: typeof Undici = packageRequire('./');

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
  private closing: Promise<void> | undefined;

  constructor(proxy?: string) {
    this.dispatcher = proxy === undefined ? new Agent() : new ProxyAgent(proxy);
  }

  readonly fetch: NetworkFetch = async (input, init) => {
    if (this.closing !== undefined) throw new Error('Root fetch is closed');
    const request = new Request(input, init);
    const response = await undiciFetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: request.body === null ? undefined : requestBody(request.body),
      duplex: 'half',
      signal: request.signal,
      redirect: request.redirect,
      dispatcher: this.dispatcher,
    });
    const native = new Response(
      response.status === 204 ||
      response.status === 205 ||
      response.status === 304
        ? null
        : responseBody(response.body),
      {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
      },
    );
    return withResponseMetadata(native, response);
  };

  dispose(): Promise<void> {
    this.closing ??= this.dispatcher.close();
    return this.closing;
  }
}

async function* requestBody(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function responseBody(
  body: Awaited<ReturnType<typeof undiciFetch>>['body'],
): ReadableStream<Uint8Array> | null {
  if (body === null) return null;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      const result = await reader.read();
      if (result.done) {
        reader.releaseLock();
        controller.close();
      } else {
        if (!(result.value instanceof Uint8Array))
          throw new Error('Expected response bytes');
        controller.enqueue(result.value);
      }
    },
    async cancel(reason: unknown): Promise<void> {
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

function withResponseMetadata(
  body: Response,
  metadata: Pick<Response, 'url' | 'redirected' | 'type'>,
): Response {
  return new Proxy(body, {
    get(target, property): unknown {
      if (property === 'url') return metadata.url;
      if (property === 'redirected') return metadata.redirected;
      if (property === 'type') return metadata.type;
      if (property === 'clone')
        return () => withResponseMetadata(target.clone(), metadata);
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
