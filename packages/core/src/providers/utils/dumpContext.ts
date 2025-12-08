/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DebugLogger } from '../../debug/index.js';

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
  request: DumpRequest;
  response?: DumpResponse;
}

/**
 * Redacts sensitive information from request data
 */
export function redactSensitiveData(request: DumpRequest): DumpRequest {
  const redacted: DumpRequest = {
    ...request,
    headers: request.headers ? { ...request.headers } : undefined,
  };

  // Redact Authorization header
  if (redacted.headers?.Authorization) {
    redacted.headers.Authorization = '[REDACTED]';
  }

  // Redact x-api-key header
  if (redacted.headers?.['x-api-key']) {
    redacted.headers['x-api-key'] = '[REDACTED]';
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
 * Generates a unique filename for the dump
 */
function generateFilename(provider: string): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${dateStr}-${timeStr}-${provider}-${randomStr}.json`;
}

/**
 * Dumps context (request and response) to a file in ~/.llxprt/dumps/
 * Returns the filename of the created dump file
 */
export async function dumpContext(
  request: DumpRequest,
  response: DumpResponse | undefined,
  provider: string,
): Promise<string> {
  try {
    const dumpDir = path.join(os.homedir(), '.llxprt', 'dumps');
    await fs.mkdir(dumpDir, { recursive: true });

    const redactedRequest = redactSensitiveData(request);

    const dumpData: DumpData = {
      provider,
      timestamp: new Date().toISOString(),
      request: redactedRequest,
      response,
    };

    const filename = generateFilename(provider);
    const filepath = path.join(dumpDir, filename);

    await fs.writeFile(filepath, JSON.stringify(dumpData, null, 2), 'utf-8');

    logger.debug(() => `Context dumped to: ${filepath}`);
    return filename;
  } catch (error) {
    logger.error(() => `Failed to dump context: ${error}`);
    throw error;
  }
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
    return true; // Special case handled by command
  }

  if (mode === 'on') {
    return true;
  }

  if (mode === 'error' && isError) {
    return true;
  }

  return false;
}
