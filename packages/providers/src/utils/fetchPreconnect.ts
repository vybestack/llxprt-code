/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

interface PreconnectOptions {
  readonly dns?: boolean;
  readonly tcp?: boolean;
  readonly http?: boolean;
  readonly https?: boolean;
}

type Preconnect = (url: string | URL, options?: PreconnectOptions) => void;

/**
 * Bun's `fetch.preconnect` is declared by `bun-types/globals`, which this
 * package does not load into its production program (see
 * bun-test-corrections.d.ts). Declaring the member locally keeps wrapper
 * fetches runtime-complete without importing Bun's ambient globals, which
 * would widen every type graph that reaches the global object.
 */
export function forwardPreconnect(resolveTransport: () => NetworkFetch): {
  readonly preconnect: Preconnect;
} {
  return {
    preconnect: (url, options) => {
      const transport = resolveTransport();
      if (
        'preconnect' in transport &&
        typeof transport.preconnect === 'function'
      )
        transport.preconnect(url, options);
    },
  };
}
