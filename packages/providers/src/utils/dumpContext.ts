/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const logger = new DebugLogger('llxprt:core:dumpContext');

export type DumpMode = 'now' | 'status' | 'on' | 'error' | 'off';

export interface DumpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface DumpResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface DumpData {
  provider: string;
  timestamp: string;
  request?: DumpRequest;
  response?: DumpResponse;
  relatedRequestFile?: string;
}

/**
 * Redacts sensitive information from request data
 */
export function redactSensitiveData(request: DumpRequest): DumpRequest {
  const redacted: DumpRequest = {
    ...request,
    headers: request.headers ? { ...request.headers } : undefined,
  };

  if (redacted.headers) {
    for (const headerName of Object.keys(redacted.headers)) {
      const normalizedHeaderName = headerName.toLowerCase();
      if (
        normalizedHeaderName === 'authorization' ||
        normalizedHeaderName === 'x-api-key'
      ) {
        redacted.headers[headerName] = '[REDACTED]';
      }
    }
  }

  // Redact key query parameter in URL
  if (redacted.url.includes('?')) {
    const [baseUrl, queryString] = redacted.url.split('?');
    const params = new URLSearchParams(queryString);
    if (params.has('key')) {
      params.set('key', '[REDACTED]');
      // Decode the URL to prevent double-encoding of brackets
      redacted.url = decodeURIComponent(`${baseUrl}?${params.toString()}`);
    }
  }

  return redacted;
}

/**
 * Checks if dumping should occur based on mode and error status
 */
export function shouldDump(
  mode: DumpMode | undefined,
  isError: boolean,
): boolean {
  if (!mode || mode === 'off' || mode === 'status') {
    return false;
  }

  if (mode === 'now') {
    return false;
  }

  if (mode === 'on') {
    return true;
  }

  return isError;
}

export interface DumpRequestResult {
  baseId: string;
  requestFilename: string;
  dumpDir: string;
}

export interface DumpResponseResult {
  responseFilename: string;
  dumpDir: string;
}

/**
 * Generates a shared base id used to relate request and response dump files.
 */
export function generateDumpBaseId(provider: string): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${dateStr}-${timeStr}-${provider}-${randomStr}`;
}

/**
 * Writes a request-only dump file named {baseId}-request.json.
 * Returns the base id and filename so the caller can later write a related response.
 */
export async function dumpRequestContext(
  request: DumpRequest,
  provider: string,
  baseId?: string,
): Promise<DumpRequestResult> {
  const dumpDir = path.join(Storage.getGlobalLlxprtDir(), 'dumps');
  await fs.mkdir(dumpDir, { recursive: true });

  const id = baseId ?? generateDumpBaseId(provider);
  const requestFilename = `${id}-request.json`;
  const filepath = path.join(dumpDir, requestFilename);

  const redactedRequest = redactSensitiveData(request);

  const data = {
    provider,
    timestamp: new Date().toISOString(),
    request: redactedRequest,
  };

  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
  logger.debug(() => `Request context dumped to: ${filepath}`);

  return { baseId: id, requestFilename, dumpDir };
}

/**
 * Writes a response-only dump file named {baseId}-response.json.
 * Includes relatedRequestFile metadata linking back to the request file.
 */
export async function dumpResponseContext(
  baseId: string | undefined,
  response: DumpResponse,
  provider: string,
): Promise<DumpResponseResult> {
  const dumpDir = path.join(Storage.getGlobalLlxprtDir(), 'dumps');
  await fs.mkdir(dumpDir, { recursive: true });

  const id = baseId ?? generateDumpBaseId(provider);
  const responseFilename = `${id}-response.json`;
  const filepath = path.join(dumpDir, responseFilename);

  const data = {
    provider,
    timestamp: new Date().toISOString(),
    response,
    ...(baseId ? { relatedRequestFile: `${baseId}-request.json` } : {}),
  };

  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
  logger.debug(() => `Response context dumped to: ${filepath}`);

  return { responseFilename, dumpDir };
}

/**
 * Dumps context to separate related request and response files in ~/.llxprt/dumps/.
 * Returns the shared base id used by the generated filenames.
 */
export async function dumpContext(
  request: DumpRequest,
  response: DumpResponse | undefined,
  provider: string,
): Promise<string> {
  try {
    const baseId = generateDumpBaseId(provider);
    await dumpRequestContext(request, provider, baseId);
    if (response !== undefined) {
      await dumpResponseContext(baseId, response, provider);
    }

    logger.debug(() => `Context dumped with base id: ${baseId}`);
    return baseId;
  } catch (error) {
    logger.error(() => `Failed to dump context: ${error}`);
    throw error;
  }
}
