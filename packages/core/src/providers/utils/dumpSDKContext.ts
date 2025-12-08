/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { dumpContext, type DumpMode } from './dumpContext.js';
import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:core:dumpSDKContext');

/**
 * Dumps SDK-level request/response data by synthesizing HTTP-like structure
 * This captures the actual SDK parameters and responses, which is more useful
 * for debugging than raw HTTP dumps.
 */
export async function dumpSDKContext(
  providerName: string,
  endpoint: string,
  requestParams: unknown,
  response: unknown,
  isError: boolean,
  baseURL?: string,
): Promise<string> {
  const url = baseURL
    ? `${baseURL}${endpoint}`
    : `https://api.${providerName}.com${endpoint}`;

  const request = {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'llxprt-code',
    },
    body: requestParams,
  };

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

  return await dumpContext(request, dumpResponse, providerName);
}

/**
 * Determines if dumping should occur based on ephemeral settings
 */
export function shouldDumpSDKContext(
  mode: DumpMode | string | undefined,
  isError: boolean,
): boolean {
  if (!mode || mode === 'off' || mode === 'status') {
    return false;
  }

  if (mode === 'now' || mode === 'on') {
    return true;
  }

  if (mode === 'error' && isError) {
    return true;
  }

  return false;
}
