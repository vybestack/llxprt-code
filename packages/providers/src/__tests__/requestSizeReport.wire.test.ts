/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * The size a provider reports for `api_request` is the exact number of body
 * bytes it hands to the transport. Each case drives the real provider against
 * the fake HTTP transport and compares the reported size with the bytes the
 * transport received, using text whose UTF-16 length is shorter than its
 * UTF-8 length.
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  type CapturedWireRequest,
  WIRE_ROUTES,
  buildRouteCallOptions,
  installFakeTransport,
  rowsSelection,
  singleModelRequest,
  type RowSource,
  type WireRoute,
} from './support/wireBodyCapture.js';
import { REQUEST_SIZE_SINK_KEY } from '../logging/requestSizeReport.js';

const rows: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'héllo 😀 日本語' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'grüße, 世界' }] },
  { speaker: 'human', blocks: [{ type: 'text', text: 'ok ✓' }] },
];

async function sendReporting(
  route: WireRoute,
  source: RowSource,
): Promise<{
  readonly reported: number[];
  readonly sent: CapturedWireRequest;
}> {
  const captured: CapturedWireRequest[] = [];
  const reported: number[] = [];
  const restore = installFakeTransport(route, captured);
  try {
    const base = buildRouteCallOptions(
      route,
      {},
      rows.map((row) => structuredClone(row)),
      new SettingsService(),
    );
    const options = {
      ...base,
      ...(source === 'rows'
        ? { requestRows: rowsSelection(rows), contentCount: rows.length }
        : {}),
      metadata: {
        ...base.metadata,
        [REQUEST_SIZE_SINK_KEY]: (bytes: number) => reported.push(bytes),
      },
    };
    for await (const chunk of route
      .createProvider()
      .generateChatCompletion(options)) {
      void chunk;
    }
  } finally {
    restore();
  }
  return { reported, sent: singleModelRequest(route, captured) };
}

const ROUTE_IDS = [
  'openai-chat-plain',
  'openai-responses',
  'anthropic-cache-off',
] as const;

describe('provider request size report', () => {
  for (const id of ROUTE_IDS) {
    for (const source of ['stream', 'rows'] as const) {
      it(`${id} reports the bytes it sends from ${source}`, async () => {
        const route = WIRE_ROUTES.find((entry) => entry.id === id);
        if (route === undefined) throw new Error(`no wire route ${id}`);

        const { reported, sent } = await sendReporting(route, source);

        const text = new TextDecoder().decode(sent.bytes);
        expect(text.length).toBeLessThan(sent.bytes.byteLength);
        expect(reported).toStrictEqual([sent.bytes.byteLength]);
      });
    }
  }
});
