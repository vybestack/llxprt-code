/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { forwardPreconnect } from './fetchPreconnect.js';

export const REFUSAL_AUDIT_TIMING_KEY = '__llxprtRefusalAuditTiming';

export interface RefusalAuditTiming {
  firstByteAt: number | null;
}

function hasFirstByteAt(value: object): value is RefusalAuditTiming {
  return (
    'firstByteAt' in value &&
    (value.firstByteAt === null || typeof value.firstByteAt === 'number')
  );
}

function isRefusalAuditTiming(value: unknown): value is RefusalAuditTiming {
  return typeof value === 'object' && value !== null && hasFirstByteAt(value);
}

export function readRefusalAuditTiming(
  metadata: Readonly<Record<string, unknown>> | undefined,
): RefusalAuditTiming | undefined {
  const candidate = metadata?.[REFUSAL_AUDIT_TIMING_KEY];
  return isRefusalAuditTiming(candidate) ? candidate : undefined;
}

export function observeFirstResponseByte(
  fetcher: NetworkFetch,
  timing: RefusalAuditTiming | undefined,
): NetworkFetch {
  if (timing === undefined) return fetcher;
  const observed: NetworkFetch = async (input, init, options) => {
    const response = await fetcher(input, init, options);
    if (response.body === null) return response;
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          return;
        }
        if (chunk.value.byteLength > 0 && timing.firstByteAt === null) {
          timing.firstByteAt = performance.now();
        }
        controller.enqueue(chunk.value);
      },
      async cancel(reason: unknown): Promise<void> {
        await reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  return Object.assign(
    observed,
    forwardPreconnect(() => fetcher),
  );
}
