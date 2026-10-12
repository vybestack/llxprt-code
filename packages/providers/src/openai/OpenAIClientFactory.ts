/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * OpenAI client factory and infrastructure utilities.
 * Extracted from OpenAIProvider to reduce god-object complexity.
 *
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */

import OpenAI from 'openai';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import type * as Undici from 'undici';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { OPENAI_TRANSPORT_SELECTOR_KEYS } from './openaiModelPolicy.js';
import { createReaderBasedStreamFetch } from './openaiStreamFetchSafety.js';

// Bun's 'undici' shim does not apply dispatcher headersTimeout; load the
// installed package's public entry instead of the shim.
const undiciRequire = createRequire(
  createRequire(import.meta.url).resolve('undici/package.json'),
);
const { request: undiciRequest } = undiciRequire('./') as typeof Undici;

/**
 * Create HTTP/HTTPS agents with socket configuration for local AI servers
 * Returns undefined if no socket settings are configured
 *
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-003
 * Pure function - caller resolves settings before calling
 */
export function createHttpAgents(
  settings: Record<string, unknown>,
): { httpAgent: http.Agent; httpsAgent: https.Agent } | undefined {
  // Check if any socket settings are explicitly configured
  const hasSocketSettings =
    'socket-timeout' in settings ||
    'socket-keepalive' in settings ||
    'socket-nodelay' in settings;

  // Only create custom agents if socket settings are configured
  if (!hasSocketSettings) {
    return undefined;
  }

  // Socket configuration with defaults for when settings ARE configured
  const socketTimeoutRaw = settings['socket-timeout'];
  const socketTimeout =
    typeof socketTimeoutRaw === 'number' &&
    socketTimeoutRaw !== 0 &&
    !Number.isNaN(socketTimeoutRaw)
      ? socketTimeoutRaw
      : 60000; // 60 seconds default
  const socketKeepAlive = settings['socket-keepalive'] !== false; // true by default
  const socketNoDelay = settings['socket-nodelay'] !== false; // true by default

  // Create HTTP agent with socket options
  const httpAgent = new http.Agent({
    keepAlive: socketKeepAlive,
    keepAliveMsecs: 1000,
    timeout: socketTimeout,
  });

  // Create HTTPS agent with socket options
  const httpsAgent = new https.Agent({
    keepAlive: socketKeepAlive,
    keepAliveMsecs: 1000,
    timeout: socketTimeout,
  });

  // Apply TCP_NODELAY if enabled (reduces latency for local servers)
  if (socketNoDelay) {
    const originalCreateConnection = httpAgent.createConnection;
    httpAgent.createConnection = function (options, callback) {
      const socket = originalCreateConnection.call(this, options, callback);
      if (socket instanceof net.Socket) {
        socket.setNoDelay(true);
      }
      return socket;
    };

    const originalHttpsCreateConnection = httpsAgent.createConnection;
    httpsAgent.createConnection = function (options, callback) {
      const socket = originalHttpsCreateConnection.call(
        this,
        options,
        callback,
      );
      if (socket instanceof net.Socket) {
        socket.setNoDelay(true);
      }
      return socket;
    };
  }

  return { httpAgent, httpsAgent };
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-002
 * Extract model parameters from normalized options instead of settings service
 */
export function extractModelParamsFromOptions(
  options: NormalizedGenerateChatOptions,
): Record<string, unknown> | undefined {
  const modelParams = { ...options.invocation.modelParams };

  // Transport-selector keys are control-plane settings, not model params
  for (const selectorKey of OPENAI_TRANSPORT_SELECTOR_KEYS) {
    delete modelParams[selectorKey];
  }

  // Translate generic maxOutputTokens ephemeral to OpenAI's max_tokens
  const rawMaxOutput = options.modelParameters
    ? options.modelParameters.genericMaxOutputTokens
    : options.invocation.ephemerals['maxOutputTokens'];
  const genericMaxOutput =
    typeof rawMaxOutput === 'number' &&
    Number.isFinite(rawMaxOutput) &&
    rawMaxOutput > 0
      ? rawMaxOutput
      : undefined;
  if (
    genericMaxOutput !== undefined &&
    modelParams['max_tokens'] === undefined
  ) {
    modelParams['max_tokens'] = genericMaxOutput;
  }

  return Object.keys(modelParams).length > 0 ? modelParams : undefined;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-003
 * Resolve runtime key from normalized options for client scoping
 */
export function resolveRuntimeKey(
  options: NormalizedGenerateChatOptions,
): string {
  if (options.invocation.runtimeId) {
    return options.invocation.runtimeId;
  }

  const metadataRuntimeId = options.metadata.runtimeId as string | undefined;
  if (typeof metadataRuntimeId === 'string' && metadataRuntimeId.trim()) {
    return metadataRuntimeId.trim();
  }

  const callId = options.invocation.getEphemeral('call-id');
  if (typeof callId === 'string' && callId.trim()) {
    return `call:${callId.trim()}`;
  }

  return 'openai.runtime.unscoped';
}

function fetchWithHeadersTimeout(headersTimeoutMs: number): typeof fetch {
  if (!Number.isSafeInteger(headersTimeoutMs) || headersTimeoutMs <= 0) {
    throw new Error('openai-headers-timeout-ms must be a positive integer');
  }
  return async (input, init) => {
    if (input instanceof Request) {
      throw new Error('Scoped OpenAI transport requires a URL');
    }
    const body = init?.body;
    if (
      body !== undefined &&
      body !== null &&
      typeof body !== 'string' &&
      !(body instanceof ReadableStream)
    ) {
      throw new Error('Scoped OpenAI transport requires a JSON body');
    }
    const result = await undiciRequest(String(input), {
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers)),
      body:
        body instanceof ReadableStream
          ? Readable.fromWeb(
              body as unknown as Parameters<typeof Readable.fromWeb>[0],
            )
          : body,
      signal: init?.signal ?? undefined,
      headersTimeout: headersTimeoutMs,
    });
    const headers = new Headers();
    for (const [key, value] of Object.entries(result.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else if (value !== undefined) {
        headers.append(key, String(value));
      }
    }
    return new Response(
      result.statusCode === 204
        ? null
        : (Readable.toWeb(result.body) as ReadableStream<Uint8Array>),
      { status: result.statusCode, headers },
    );
  };
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P09
 * @requirement:REQ-SP4-002
 * Instantiates a fresh OpenAI client per call to preserve stateless behaviour.
 */
export function instantiateClient(
  authToken: string,
  baseURL?: string,
  agents?: { httpAgent: http.Agent; httpsAgent: https.Agent },
  headers?: Record<string, string>,
  transport?: {
    headersTimeoutMs?: number;
    requestTimeoutMs?: number;
    fetch?: typeof fetch;
  },
): OpenAI {
  const clientOptions: Record<string, unknown> = {
    apiKey: authToken || '',
    maxRetries: 0,
  };
  if (transport?.requestTimeoutMs !== undefined) {
    if (
      !Number.isSafeInteger(transport.requestTimeoutMs) ||
      transport.requestTimeoutMs <= 0
    ) {
      throw new Error('openai-request-timeout-ms must be a positive integer');
    }
    clientOptions.timeout = transport.requestTimeoutMs;
  }

  const scopedFetch =
    transport?.headersTimeoutMs === undefined
      ? transport?.fetch
      : fetchWithHeadersTimeout(transport.headersTimeoutMs);
  clientOptions.fetch = createReaderBasedStreamFetch(scopedFetch);

  if (headers && Object.keys(headers).length > 0) {
    // Ensure headers like User-Agent are applied even if the SDK call-site
    // headers option is not forwarded by the OpenAI client implementation.
    clientOptions.defaultHeaders = headers;
  }

  if (baseURL && baseURL.trim() !== '') {
    clientOptions.baseURL = baseURL;
  }

  if (agents) {
    clientOptions.httpAgent = agents.httpAgent;
    clientOptions.httpsAgent = agents.httpsAgent;
  }

  return new OpenAI(
    clientOptions as unknown as ConstructorParameters<typeof OpenAI>[0],
  );
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P09
 * @requirement:REQ-SP4-002
 * @requirement:REQ-LOCAL-001
 * Merges invocation headers with base headers.
 * Local endpoints (localhost, private IPs) are allowed without authentication
 * to support local AI servers like Ollama.
 */
export function mergeInvocationHeaders(
  options: NormalizedGenerateChatOptions,
  baseHeaders?: Record<string, string>,
): Record<string, string> | undefined {
  const invocationHeadersRaw =
    options.invocation.getEphemeral('custom-headers');
  const invocationHeaders =
    invocationHeadersRaw !== null &&
    invocationHeadersRaw !== undefined &&
    typeof invocationHeadersRaw === 'object'
      ? (invocationHeadersRaw as Record<string, string>)
      : undefined;

  const invocationUserAgent = options.invocation.getEphemeral('user-agent');

  const hasHeaders =
    baseHeaders !== undefined ||
    invocationHeaders !== undefined ||
    (typeof invocationUserAgent === 'string' && invocationUserAgent !== '');
  return hasHeaders
    ? {
        ...(baseHeaders ?? {}),
        ...(invocationHeaders ?? {}),
        ...(typeof invocationUserAgent === 'string' &&
        invocationUserAgent.trim() !== ''
          ? { 'User-Agent': invocationUserAgent.trim() }
          : {}),
      }
    : undefined;
}
