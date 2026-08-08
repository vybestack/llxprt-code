/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ChronologyTraceEntry } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';

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
  /**
   * Client-side chronology trace for the history the request was built from
   * (#1721). This is a SIBLING of `request` and is deliberately never placed
   * inside `request.body`: the body must remain exactly what the provider
   * receives, and providers reject unknown fields with HTTP 400.
   */
  chronology?: readonly ChronologyTraceEntry[];
}

/**
 * Header names whose values must never reach a dump file. Dumps are written to
 * disk and routinely pasted into bug reports, and gateways and proxies echo
 * request credentials back on responses, so the same set applies in both
 * directions (issue #3140).
 */
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'set-cookie',
]);

/**
 * Redacts sensitive header values in place, preserving every header name so a
 * dump still shows which headers were present (e.g. `retry-after`).
 */
export function redactSensitiveHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  const redacted: Record<string, string> = { ...headers };
  for (const headerName of Object.keys(redacted)) {
    if (SENSITIVE_HEADER_NAMES.has(headerName.toLowerCase())) {
      redacted[headerName] = '[REDACTED]';
    }
  }
  return redacted;
}

/**
 * Redacts sensitive information from request data
 */
export function redactSensitiveData(request: DumpRequest): DumpRequest {
  const redacted: DumpRequest = {
    ...request,
    headers: redactSensitiveHeaders(request.headers),
  };

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
  chronology?: readonly ChronologyTraceEntry[],
): Promise<DumpRequestResult> {
  const dumpDir = path.join(Storage.getGlobalCacheDir(), 'dumps');
  await fs.mkdir(dumpDir, { recursive: true });

  const id = baseId ?? generateDumpBaseId(provider);
  const requestFilename = `${id}-request.json`;
  const filepath = path.join(dumpDir, requestFilename);

  const redactedRequest = redactSensitiveData(request);

  const data: DumpData = {
    provider,
    timestamp: new Date().toISOString(),
    request: redactedRequest,
    // Sibling of `request`, never inside `request.body` (#1721).
    ...(chronology ? { chronology } : {}),
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
  const dumpDir = path.join(Storage.getGlobalCacheDir(), 'dumps');
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
 * Dumps context to separate related request and response files in the global llxprt configuration directory (dumps/ subdirectory).
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
