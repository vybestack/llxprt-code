/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 E6: drives the real Anthropic provider against the fake HTTP
 * transport of the golden corpus with a scripted sequence of responses, so a
 * request that Anthropic rejects for an image dimension is followed by the
 * recovery retry, and every body the transport saw is recorded.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RetryOrchestrator } from '../../RetryOrchestrator.js';
import {
  RETRY_REQUEST_CONTEXT_KEY,
  attachTransportAttemptBudget,
} from '../../transportAttemptBudget.js';
import type { GenerateChatOptions, IProvider } from '../../IProvider.js';
import {
  buildRouteCallOptions,
  installFakeTransport,
  recordOf,
  rowsSelection,
  type CapturedWireRequest,
  type RowSource,
  type WireBodyRecord,
  type WireRoute,
} from './wireBodyCapture.js';
import type { HistoryCase } from './wireBodyHistories.js';

const DIMENSION_MESSAGE =
  'At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels';

/** A 400 the service sends for an oversized image. */
export function imageDimensionResponse(): Response {
  return Response.json(
    {
      type: 'error',
      error: { type: 'invalid_request_error', message: DIMENSION_MESSAGE },
    },
    { status: 400, headers: { 'request-id': 'req_recovery' } },
  );
}

/** A 429 whose retry the outer orchestrator owns. */
export function rateLimitedResponse(): Response {
  return Response.json(
    {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Rate limit exceeded' },
    },
    {
      status: 429,
      headers: { 'request-id': 'req_429', 'retry-after': '0' },
    },
  );
}

/** A base64 PNG that is only its header: enough to state its dimensions. */
export function pngHeaderBase64(width: number, height: number): string {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return Buffer.from(bytes).toString('base64');
}

export function imageRow(
  width: number,
  height: number,
  ...text: string[]
): IContent {
  return {
    speaker: 'human',
    blocks: [
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: pngHeaderBase64(width, height),
      },
      ...text.map((value) => ({ type: 'text' as const, text: value })),
    ],
  };
}

export interface RecoverySend {
  /** Every model request the transport saw, in order. */
  readonly requests: readonly WireBodyRecord[];
  readonly raw: readonly CapturedWireRequest[];
  /** The error the send ended with, when it did not succeed. */
  readonly error: unknown;
}

function optionsFor(
  route: WireRoute,
  history: HistoryCase,
  source: RowSource,
  retries: number | undefined,
): GenerateChatOptions {
  const shape = {
    ...history,
    ephemerals: {
      ...history.ephemerals,
      ...(retries === undefined ? {} : { retries, retrywait: 0 }),
    },
  };
  const options = buildRouteCallOptions(
    route,
    shape,
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

/**
 * Sends the history. `script` answers the model requests in order; the last
 * entry answers every request after it. With `orchestrated` the provider runs
 * under the outer retry orchestrator with that many attempts.
 */
export async function sendWithScript(
  route: WireRoute,
  history: HistoryCase,
  source: RowSource,
  script: ReadonlyArray<() => Response>,
  orchestrated?: number,
  projected = false,
): Promise<RecoverySend> {
  let calls = 0;
  const scripted: WireRoute = {
    ...route,
    respond: () => {
      const next = script[Math.min(calls, script.length - 1)];
      calls += 1;
      return next();
    },
  };
  const raw: CapturedWireRequest[] = [];
  const restore = installFakeTransport(scripted, raw);
  let error: unknown;
  try {
    const created: IProvider = route.createProvider();
    const provider =
      orchestrated === undefined
        ? created
        : new RetryOrchestrator(created, {
            maxAttempts: orchestrated,
            initialDelayMs: 0,
          });
    const options = optionsFor(route, history, source, orchestrated);
    const projection = projected
      ? await provider.projectPromptEnvelope?.(options)
      : undefined;
    if (projected && projection === undefined) {
      throw new Error(`${provider.name} projected no prompt envelope`);
    }
    for await (const chunk of provider.generateChatCompletion(
      projection === undefined
        ? options
        : {
            ...options,
            promptEnvelopeTransportToken: projection.transportToken,
          },
    )) {
      void chunk;
    }
  } catch (caught) {
    error = caught;
  } finally {
    restore();
  }
  const modelRequests = raw.filter((request) =>
    new URL(request.url).pathname.endsWith(route.endpoint),
  );
  return { requests: modelRequests.map(recordOf), raw: modelRequests, error };
}

const TIMESTAMP = /"timestamp": "[^"]*"/;
const DROPPED = 'Image dropped';

/** Dumps without the placeholder first, then shorter before longer. */
function compareDumps(a: string, b: string): number {
  const droppedA = a.includes(DROPPED);
  if (droppedA !== b.includes(DROPPED)) return droppedA ? 1 : -1;
  return a.length - b.length;
}

/**
 * Sends with `dumpcontext` on and returns the text of each request dump file,
 * the rejected request first and the retry after it, timestamps replaced.
 */
export async function recoveryRequestDumps(
  route: WireRoute,
  history: HistoryCase,
  script: ReadonlyArray<() => Response>,
): Promise<readonly string[]> {
  const home = await mkdtemp(join(tmpdir(), 'recovery-dump-golden-'));
  const saved = {
    config: process.env['LLXPRT_CONFIG_HOME'],
    cache: process.env['LLXPRT_CACHE_HOME'],
  };
  delete process.env['LLXPRT_CACHE_HOME'];
  process.env['LLXPRT_CONFIG_HOME'] = home;
  try {
    const dumping: WireRoute = {
      ...route,
      ephemerals: { ...route.ephemerals, dumpcontext: 'on' },
    };
    await sendWithScript(dumping, history, 'rows', script);
    const dumpDir = join(Storage.getGlobalCacheDir(), 'dumps');
    const files = (await readdir(dumpDir)).filter((name) =>
      name.endsWith('-request.json'),
    );
    const texts = await Promise.all(
      files.map(async (name) =>
        (await readFile(join(dumpDir, name), 'utf8')).replace(
          TIMESTAMP,
          '"timestamp": "<timestamp>"',
        ),
      ),
    );
    return texts.sort(compareDumps);
  } finally {
    if (saved.config === undefined) delete process.env['LLXPRT_CONFIG_HOME'];
    else process.env['LLXPRT_CONFIG_HOME'] = saved.config;
    if (saved.cache !== undefined)
      process.env['LLXPRT_CACHE_HOME'] = saved.cache;
    await rm(home, { recursive: true, force: true });
  }
}

export interface RetainedBodyProbe {
  /** Settled JS heap bytes while each model request was in flight. */
  readonly heapAtRequest: readonly number[];
  readonly requestCount: number;
}

/**
 * Sends the history through the outer orchestrator with a transport that keeps
 * nothing: each request body is read and dropped, and the settled heap is read
 * while the request is in flight. With `holdFirstBody` the transport itself
 * keeps the parsed first body, which is what a retained copy of the rejected
 * request looks like to the reading (the probe's control).
 */
export async function probeHeapAcrossAttempts(
  route: WireRoute,
  history: HistoryCase,
  script: ReadonlyArray<() => Response>,
  settledHeap: () => Promise<number>,
  holdFirstBody: boolean,
): Promise<RetainedBodyProbe> {
  const heapAtRequest: number[] = [];
  const held: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const body = init?.body ?? (input instanceof Request ? input.body : null);
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const isFirst = heapAtRequest.length === 0;
      heapAtRequest.push(await settledHeap());
      if (holdFirstBody && isFirst) {
        held.push(JSON.parse(new TextDecoder().decode(bytes)));
      }
      const next =
        script[Math.min(heapAtRequest.length - 1, script.length - 1)];
      return next();
    },
    { preconnect: original.preconnect },
  );
  try {
    const provider = new RetryOrchestrator(route.createProvider(), {
      maxAttempts: script.length,
      initialDelayMs: 0,
    });
    const options = optionsFor(route, history, 'rows', script.length);
    for await (const chunk of provider.generateChatCompletion(options)) {
      void chunk;
    }
  } finally {
    globalThis.fetch = original;
  }
  return { heapAtRequest, requestCount: heapAtRequest.length };
}

/**
 * Sends the history once under a shared retry context and returns that
 * context, the object that survives from one attempt to the next.
 */
export async function sendAndReadRetryContext(
  route: WireRoute,
  history: HistoryCase,
  script: ReadonlyArray<() => Response>,
): Promise<Readonly<Record<string, unknown>>> {
  const attached = attachTransportAttemptBudget(
    optionsFor(route, history, 'rows', undefined),
    script.length,
  );
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const body = init?.body ?? (input instanceof Request ? input.body : null);
      await new Response(body).arrayBuffer();
      const next = script[Math.min(calls, script.length - 1)];
      calls += 1;
      return next();
    },
    { preconnect: original.preconnect },
  );
  try {
    for await (const chunk of route
      .createProvider()
      .generateChatCompletion(attached.options)) {
      void chunk;
    }
  } finally {
    globalThis.fetch = original;
    attached.release();
  }
  const context = attached.options.metadata?.[RETRY_REQUEST_CONTEXT_KEY];
  if (typeof context !== 'object' || context === null) {
    throw new Error('the call carried no retry context');
  }
  return Object.fromEntries(Object.entries(context));
}
