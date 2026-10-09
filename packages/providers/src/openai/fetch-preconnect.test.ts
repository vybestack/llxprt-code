/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { createReaderBasedStreamFetch } from './openaiStreamFetchSafety.js';
import { createDeveloperRoleToSystemFetch } from '../openai-vercel/vercelDeveloperRoleFetch.js';
import {
  createCaptureBuffer,
  createReasoningCaptureFetch,
} from '../openai-vercel/vercelReasoningCapture.js';

function transport(endpoints: string[]): typeof fetch {
  return Object.assign(async () => new Response(null, { status: 204 }), {
    preconnect(url: string | URL): void {
      endpoints.push(String(url));
    },
  });
}

describe('wrapped fetch connection preparation', () => {
  it('delegates reader and developer wrappers to their supplied transport', () => {
    const endpoints: string[] = [];
    const inner = transport(endpoints);
    createReaderBasedStreamFetch(inner).preconnect('https://chat.test');
    createDeveloperRoleToSystemFetch(inner).preconnect('https://vercel.test');
    expect(endpoints.map((url) => new URL(url).hostname)).toStrictEqual([
      'chat.test',
      'vercel.test',
    ]);
  });

  it('resolves the global transport lazily for reader and reasoning wrappers', () => {
    const saved = globalThis.fetch;
    const endpoints: string[] = [];
    const reader = createReaderBasedStreamFetch();
    const reasoning = createReasoningCaptureFetch(
      createCaptureBuffer(),
      new DebugLogger('fetch-preconnect-test'),
    );
    try {
      globalThis.fetch = transport(endpoints);
      reader.preconnect(new URL('https://reader.test'));
      reasoning.preconnect('https://reasoning.test');
      expect(endpoints.map((url) => new URL(url).hostname)).toStrictEqual([
        'reader.test',
        'reasoning.test',
      ]);
    } finally {
      globalThis.fetch = saved;
    }
  });
});
