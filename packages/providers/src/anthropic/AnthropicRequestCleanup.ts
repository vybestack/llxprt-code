/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';

export function registerAnthropicRequestCleanup(
  mediaRequest: ResolvedMediaRequest,
  requestBody: Record<string, unknown>,
): void {
  mediaRequest.registerCleanup(() => {
    const messages = requestBody['messages'];
    if (Array.isArray(messages)) messages.splice(0);
    const tools = requestBody['tools'];
    if (Array.isArray(tools)) tools.splice(0);
    const system = requestBody['system'];
    if (Array.isArray(system)) system.splice(0);
  });
}

export function resolveAnthropicRequestBody(
  mediaRequest: ResolvedMediaRequest,
  requestBody: Record<string, unknown>,
  sanitizedBody: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (sanitizedBody === undefined) return requestBody;
  registerAnthropicRequestCleanup(mediaRequest, sanitizedBody);
  return sanitizedBody;
}
