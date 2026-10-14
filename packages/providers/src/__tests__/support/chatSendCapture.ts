/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 D3c/D4: drives the real OpenAI chat provider against the fake HTTP
 * transport of the golden corpus for the two sends the one-request corpus
 * cannot see: the continuation request that follows a tool call with no text,
 * and the request dump file written when `dumpcontext` is on.
 */

import { expect } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import {
  WIRE_ROUTES,
  buildRouteCallOptions,
  installFakeTransport,
  recordOf,
  rowsSelection,
  type CapturedWireRequest,
  type MediaBinding,
  type RowSource,
  type WireBodyRecord,
  type WireRoute,
} from './wireBodyCapture.js';
import type { HistoryCase } from './wireBodyHistories.js';
import type { GenerateChatOptions } from '../../IProvider.js';

/** The three OpenAI chat routes (plain, Kimi ids, Mistral ids). */
export const CHAT_ROUTES: readonly WireRoute[] = WIRE_ROUTES.filter((route) =>
  route.id.startsWith('openai-chat-'),
);

const TOOL_CALL_ID = 'call_continuation';

function sse(...events: readonly unknown[]): Response {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function chunk(
  delta: Record<string, unknown>,
  finishReason: string | null,
): unknown {
  return {
    id: 'chatcmpl-continuation',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'golden',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/**
 * First response: one tool call and no text, which makes the provider issue
 * the continuation request. Second response: the text that ends the turn.
 */
function continuationResponder(): () => Response {
  let calls = 0;
  return () => {
    calls++;
    if (calls === 1) {
      return sse(
        chunk(
          {
            tool_calls: [
              {
                index: 0,
                id: TOOL_CALL_ID,
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"SF"}' },
              },
            ],
          },
          null,
        ),
        chunk({}, 'stop'),
      );
    }
    return sse(chunk({ content: 'done' }, null), chunk({}, 'stop'));
  };
}

function callOptions(
  route: WireRoute,
  history: HistoryCase,
  source: RowSource,
): GenerateChatOptions {
  const options = buildRouteCallOptions(
    route,
    history,
    history.rows.map((row) => structuredClone(row)),
    new SettingsService(),
  );
  if (source === 'stream') return options;
  return {
    ...options,
    requestRows: rowsSelection(history.rows),
    contentCount: history.rows.length,
  };
}

async function send(
  route: WireRoute,
  history: HistoryCase,
  source: RowSource,
  media: MediaBinding | undefined,
  captured: CapturedWireRequest[],
): Promise<void> {
  const restore = installFakeTransport(route, captured);
  try {
    const created = route.createProvider();
    const provider =
      media === undefined || history.usesMediaReferences !== true
        ? created
        : bindProviderMedia(created, media.resolver, media.budgetBytes);
    for await (const item of provider.generateChatCompletion(
      callOptions(route, history, source),
    )) {
      void item;
    }
  } finally {
    restore();
  }
}

export interface ContinuationRecords {
  readonly first: WireBodyRecord;
  readonly continuation: WireBodyRecord;
}

/** Sends a streaming request whose response asks for a continuation. */
export async function captureContinuation(
  route: WireRoute,
  history: HistoryCase,
  source: RowSource,
  media: MediaBinding | undefined,
): Promise<ContinuationRecords> {
  const streaming: WireRoute = {
    ...route,
    ephemerals: { ...route.ephemerals, streaming: 'enabled' },
    respond: continuationResponder(),
  };
  const captured: CapturedWireRequest[] = [];
  await send(streaming, history, source, media, captured);
  const requests = captured.filter((request) =>
    new URL(request.url).pathname.endsWith(route.endpoint),
  );
  if (requests.length !== 2) {
    throw new Error(
      `route ${route.id} / ${history.id}: expected a request and its continuation, saw ${requests.length}`,
    );
  }
  return {
    first: recordOf(requests[0]),
    continuation: recordOf(requests[1]),
  };
}

const TIMESTAMP = /"timestamp": "[^"]*"/;

/** A response the provider reports as a failed request. */
export function rejectedResponse(): Response {
  return Response.json(
    { error: { message: 'rejected', type: 'invalid_request_error' } },
    { status: 400 },
  );
}

/**
 * Sends with `dumpcontext` set to `mode` and returns the request dump file
 * text, its timestamp replaced by a constant. Dumps go to a private cache
 * directory. Mode `error` dumps only when the request fails.
 */
export async function captureRequestDump(
  route: WireRoute,
  history: HistoryCase,
  source: RowSource,
  media: MediaBinding | undefined,
  mode: 'on' | 'error',
  respond: () => Response = route.respond,
): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'chat-dump-golden-'));
  const saved = {
    config: process.env['LLXPRT_CONFIG_HOME'],
    cache: process.env['LLXPRT_CACHE_HOME'],
  };
  delete process.env['LLXPRT_CACHE_HOME'];
  process.env['LLXPRT_CONFIG_HOME'] = home;
  try {
    const dumping: WireRoute = {
      ...route,
      ephemerals: { ...route.ephemerals, dumpcontext: mode },
      respond,
    };
    const captured: CapturedWireRequest[] = [];
    if (mode === 'error') {
      await expect(
        send(dumping, history, source, media, captured),
      ).rejects.toBeDefined();
    } else {
      await send(dumping, history, source, media, captured);
    }
    const dumpDir = join(Storage.getGlobalCacheDir(), 'dumps');
    const requestFiles = (await readdir(dumpDir)).filter((name) =>
      name.endsWith('-request.json'),
    );
    if (requestFiles.length !== 1) {
      throw new Error(
        `route ${route.id} / ${history.id}: expected one request dump, found ${requestFiles.length}`,
      );
    }
    const text = await readFile(join(dumpDir, requestFiles[0]), 'utf8');
    return text.replace(TIMESTAMP, '"timestamp": "<timestamp>"');
  } finally {
    if (saved.config === undefined) delete process.env['LLXPRT_CONFIG_HOME'];
    else process.env['LLXPRT_CONFIG_HOME'] = saved.config;
    if (saved.cache !== undefined)
      process.env['LLXPRT_CACHE_HOME'] = saved.cache;
    await rm(home, { recursive: true, force: true });
  }
}
