/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  dumpContext,
  shouldDump,
  dumpRequestContext,
  dumpResponseContext,
  type DumpRequest,
  type DumpRequestResult,
} from './dumpContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const logger = new DebugLogger('llxprt:core:dumpSDKContext');

/**
 * Transport that carried the SDK request being dumped (#3159). The shared
 * helper synthesizes HTTP-like defaults when no real transport is observed, so an
 * explicit WebSocket marker is the only way a dump can say "this was a Codex
 * WebSocket frame, not an HTTP POST".
 */
type RequestDumpTransport =
  | { type: 'http' }
  | { type: 'websocket'; frameType: string };

/** Optional observed request metadata recorded verbatim (credentials redacted on write). */
export interface RequestDumpMetadata {
  headers?: Record<string, string>;
  transport?: RequestDumpTransport;
}

function resolveDumpHeaders(
  metadata: RequestDumpMetadata | undefined,
): Record<string, string> {
  if (metadata?.headers !== undefined) {
    return metadata.headers;
  }
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'llxprt-code',
  };
}

function buildSDKDumpUrl(
  providerName: string,
  endpoint: string,
  baseURL?: string,
): string {
  if (!baseURL) {
    return `https://api.${providerName}.com${endpoint}`;
  }

  if (baseURL.endsWith('/') && endpoint.startsWith('/')) {
    return `${baseURL}${endpoint.slice(1)}`;
  }

  return `${baseURL}${endpoint}`;
}

type DumpFailureLogger = Pick<DebugLogger, 'debug'>;

function logDumpFailure(
  operation: string,
  providerName: string,
  error: unknown,
  log: DumpFailureLogger = logger,
): void {
  const message = error instanceof Error ? error.message : String(error);
  log.debug(
    () =>
      `Best-effort dump failed for ${providerName} ${operation}: ${message}`,
  );
}

export async function bestEffortDump<T>(
  operation: string,
  providerName: string,
  action: () => Promise<T>,
  log?: DumpFailureLogger,
): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    logDumpFailure(operation, providerName, error, log);
    return undefined;
  }
}

/**
 * Builds the request envelope shared by both dump writers (#3159): the
 * transport decides the method (WebSocket frames are SEND, HTTP is POST) and
 * the header map; keeping this in one builder stops the two paths from
 * drifting apart.
 */
function buildSDKDumpRequest(
  url: string,
  requestParams: unknown,
  metadata: RequestDumpMetadata | undefined,
): DumpRequest {
  return {
    url,
    method: metadata?.transport?.type === 'websocket' ? 'SEND' : 'POST',
    headers: resolveDumpHeaders(metadata),
    ...(metadata?.transport ? { transport: metadata.transport } : {}),
    body: requestParams,
  };
}

/**
 * Dumps SDK-level request/response data by synthesizing HTTP-like structure
 * This captures the actual SDK parameters and responses, which is more useful
 * for debugging than raw HTTP dumps.
 * Returns the shared dump base id, not a dump filename.
 */
export async function dumpSDKContext(
  providerName: string,
  endpoint: string,
  requestParams: unknown,
  response: unknown,
  isError: boolean,
  baseURL?: string,
  metadata?: RequestDumpMetadata,
): Promise<string> {
  const url = buildSDKDumpUrl(providerName, endpoint, baseURL);

  const request = buildSDKDumpRequest(url, requestParams, metadata);

  const dumpResponse = {
    status: isError ? 500 : 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: response,
  };

  logger.debug(
    () =>
      `Dumping SDK context for ${providerName}: endpoint=${endpoint}, isError=${isError}`,
  );

  return dumpContext(request, dumpResponse, providerName);
}

// Re-export shouldDump as shouldDumpSDKContext for backwards compatibility
export { shouldDump as shouldDumpSDKContext };

/**
 * Writes a request-only SDK dump file. Returns the base id so the caller
 * can later call dumpSDKResponseContext with the same base id to produce
 * a related response file.
 */
export async function dumpSDKRequestContext(
  providerName: string,
  endpoint: string,
  requestParams: unknown,
  baseURL?: string,
  metadata?: RequestDumpMetadata,
): Promise<DumpRequestResult> {
  const url = buildSDKDumpUrl(providerName, endpoint, baseURL);

  const request = buildSDKDumpRequest(url, requestParams, metadata);

  logger.debug(
    () =>
      `Dumping SDK request context for ${providerName}: endpoint=${endpoint}`,
  );

  return dumpRequestContext(request, providerName);
}

/**
 * Writes a response-only SDK dump file related to the given request base id.
 */
export async function dumpSDKResponseContext(
  baseId: string | undefined,
  providerName: string,
  response: unknown,
  isError: boolean,
): Promise<string> {
  const dumpResponse = {
    status: isError ? 500 : 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: response,
  };

  logger.debug(
    () =>
      `Dumping SDK response context for ${providerName}: isError=${isError}`,
  );

  const result = await dumpResponseContext(baseId, dumpResponse, providerName);
  return result.responseFilename;
}

/**
 * Wraps a streaming AsyncIterable so that chunks pass through unchanged while
 * being accumulated. After the stream completes, errors, or is closed early,
 * writes one linked response dump file containing the accumulated chunks.
 *
 * The response dump body is shaped as:
 * - { streaming: true, chunks, completed: true } on normal completion
 * - { streaming: true, chunks, error, completed: false } on stream error
 * - { streaming: true, chunks, completed: false } when the consumer closes the
 *   stream early
 *
 * Used by providers that support streaming to capture the full response for
 * debugging without buffering the stream consumer.
 */
export function wrapStreamWithDump<T>(
  stream: AsyncIterable<T>,
  baseId: string,
  providerName: string,
  dumpResponse: typeof dumpSDKResponseContext = dumpSDKResponseContext,
): AsyncIterable<T> {
  const accumulated: T[] = [];
  let dumped = false;

  async function dumpOnce(
    operation: string,
    body: Record<string, unknown>,
    isError: boolean,
  ): Promise<void> {
    if (dumped) {
      return;
    }
    dumped = true;
    await bestEffortDump(operation, providerName, () =>
      dumpResponse(baseId, providerName, body, isError),
    );
  }

  async function* iterate(): AsyncGenerator<T> {
    let completed = false;
    let failed = false;
    try {
      for await (const chunk of stream) {
        accumulated.push(chunk);
        yield chunk;
      }
      completed = true;
    } catch (error) {
      failed = true;
      await dumpOnce(
        'stream-error-response',
        {
          streaming: true,
          chunks: [...accumulated],
          error: String(error),
          completed: false,
        },
        true,
      );
      throw error;
    } finally {
      if (!failed) {
        await dumpOnce(
          completed ? 'stream-response' : 'stream-cancelled-response',
          {
            streaming: true,
            chunks: [...accumulated],
            completed,
          },
          false,
        );
      }
    }
  }

  return {
    [Symbol.asyncIterator]() {
      return iterate()[Symbol.asyncIterator]();
    },
  };
}

export async function dumpSDKErrorRequestResponse(
  providerName: string,
  endpoint: string,
  requestParams: unknown,
  errorResponse: unknown,
  baseURL?: string,
  dumpRequest: typeof dumpSDKRequestContext = dumpSDKRequestContext,
  dumpResponse: typeof dumpSDKResponseContext = dumpSDKResponseContext,
  metadata?: RequestDumpMetadata,
): Promise<void> {
  const reqResult = await bestEffortDump('error-request', providerName, () =>
    dumpRequest(providerName, endpoint, requestParams, baseURL, metadata),
  );

  await bestEffortDump('error-response', providerName, () =>
    dumpResponse(reqResult?.baseId, providerName, errorResponse, true),
  );
}

/**
 * Wraps a streaming AsyncIterable when there is no pre-request dump base id.
 * Chunks pass through unchanged; if iteration throws, writes best-effort
 * separate related request and error response dumps.
 */
export function wrapStreamWithSDKErrorDump<T>(
  stream: AsyncIterable<T>,
  providerName: string,
  endpoint: string,
  requestParams: unknown,
  baseURL: string | undefined,
  dumpRequest: typeof dumpSDKRequestContext = dumpSDKRequestContext,
  dumpResponse: typeof dumpSDKResponseContext = dumpSDKResponseContext,
  metadata?: RequestDumpMetadata,
): AsyncIterable<T> {
  const accumulated: T[] = [];

  async function* iterate(): AsyncGenerator<T> {
    try {
      for await (const chunk of stream) {
        accumulated.push(chunk);
        yield chunk;
      }
    } catch (error) {
      await dumpSDKErrorRequestResponse(
        providerName,
        endpoint,
        requestParams,
        {
          streaming: true,
          chunks: [...accumulated],
          error: String(error),
          completed: false,
        },
        baseURL,
        dumpRequest,
        dumpResponse,
        metadata,
      );
      throw error;
    }
  }

  return {
    [Symbol.asyncIterator]() {
      return iterate()[Symbol.asyncIterator]();
    },
  };
}
