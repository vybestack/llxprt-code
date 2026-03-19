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
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

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
  const socketTimeout = (settings['socket-timeout'] as number) || 60000; // 60 seconds default
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
  const modelParams = { ...(options.invocation?.modelParams ?? {}) };

  // Translate generic maxOutputTokens ephemeral to OpenAI's max_tokens
  const rawMaxOutput = options.settings?.get('maxOutputTokens');
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
export function resolveRuntimeKey(options: NormalizedGenerateChatOptions): string {
  if (options.runtime?.runtimeId) {
    return options.runtime.runtimeId;
  }

  const metadataRuntimeId = options.metadata?.runtimeId;
  if (typeof metadataRuntimeId === 'string' && metadataRuntimeId.trim()) {
    return metadataRuntimeId.trim();
  }

  const callId = options.settings.get('call-id');
  if (typeof callId === 'string' && callId.trim()) {
    return `call:${callId.trim()}`;
  }

  return 'openai.runtime.unscoped';
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
): OpenAI {
  const clientOptions: Record<string, unknown> = {
    apiKey: authToken || '',
    maxRetries: 0,
  };

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
    invocationHeadersRaw && typeof invocationHeadersRaw === 'object'
      ? (invocationHeadersRaw as Record<string, string>)
      : undefined;

  const invocationUserAgent = options.invocation.getEphemeral('user-agent');

  return baseHeaders || invocationHeaders || invocationUserAgent
    ? {
        ...(baseHeaders ?? {}),
        ...(invocationHeaders ?? {}),
        ...(typeof invocationUserAgent === 'string' &&
        invocationUserAgent.trim()
          ? { 'User-Agent': invocationUserAgent.trim() }
          : {}),
      }
    : undefined;
}
