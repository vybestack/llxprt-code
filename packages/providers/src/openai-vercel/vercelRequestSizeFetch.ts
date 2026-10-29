/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { forwardPreconnect } from '../utils/fetchPreconnect.js';
import { reportRequestSize } from '../logging/requestSizeReport.js';

/**
 * Reports the size of the JSON body the AI SDK is about to post. The SDK hands
 * `fetch` the body as one string, so its byte length is already in hand. A
 * call that carries no string body (a GET) reports nothing.
 */
export function withRequestSizeReport(
  innerFetch: NetworkFetch,
  metadata: Record<string, unknown> | undefined,
): NetworkFetch & ReturnType<typeof forwardPreconnect> {
  return Object.assign(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body === 'string') {
        reportRequestSize(metadata, Buffer.byteLength(init.body, 'utf8'));
      }
      return innerFetch(input, init);
    },
    forwardPreconnect(() => innerFetch),
  );
}
