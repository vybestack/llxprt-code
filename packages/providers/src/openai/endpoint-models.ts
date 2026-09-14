/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { ImageBackendError } from './imageBackendResponse.js';
import { normalizeBaseUrl } from './codexBaseUrl.js';

const modelListSchema = z.object({
  data: z.array(z.object({ id: z.string() })).optional(),
});

/**
 * List model IDs from an OpenAI-compatible endpoint.
 * @param baseUrl API root, including any version prefix.
 * @param headers Optional authentication and provider headers.
 * @param options Optional fetch transport for embedding or tests.
 * @returns Model IDs in endpoint order.
 * @throws ImageBackendError on transport, timeout, or response errors.
 */
export async function listOpenAiCompatibleModels(
  baseUrl: string,
  headers?: Record<string, string>,
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<string[]> {
  const signal = AbortSignal.timeout(5000);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(
      `${normalizeBaseUrl(baseUrl)}/models`,
      {
        method: 'GET',
        headers,
        signal,
        redirect: 'error',
      },
    );
  } catch {
    throw new ImageBackendError(
      signal.aborted ? 'timeout' : 'server_error',
      'Model listing request failed.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ImageBackendError(
      'server_error',
      'Model listing endpoint failed.',
      response.status,
    );
  }
  try {
    const body: unknown = await response.json();
    return (modelListSchema.parse(body).data ?? []).map((model) => model.id);
  } catch {
    throw new ImageBackendError(
      signal.aborted ? 'timeout' : 'invalid_response',
      'Model listing returned an unreadable response.',
      response.status,
    );
  }
}
