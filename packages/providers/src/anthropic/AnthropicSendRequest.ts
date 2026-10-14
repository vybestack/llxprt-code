/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  shouldDumpSDKContext,
  type StreamedDumpBody,
} from '../utils/dumpSDKContext.js';
import type { DumpMode } from '../utils/dumpContext.js';
import type { WireBodySpool } from '../utils/wire-body-spool.js';
import {
  createAnthropicApiCall,
  createSpooledAnthropicApiCall,
  type AnthropicApiCall,
} from './AnthropicApiExecution.js';
import type { AnthropicRequestFacts } from './AnthropicRequestPreparation.js';
import type { SpooledAnthropicRequest } from './AnthropicSpooledRequest.js';

/**
 * A request ready to send: the facts the transport and the response path
 * need, the headers' model and thinking inputs, how to post it, what a request
 * dump records, and the body as an object for the one consumer that needs it
 * (image recovery's sanitized retry).
 */
export interface AnthropicSendRequest {
  readonly facts: AnthropicRequestFacts;
  readonly model: string;
  readonly thinking: unknown;
  /**
   * The body as an object. For a built body this is the body itself; for a
   * spool it is the spool read back whole, so ask for it only when a recovery
   * retry needs the object.
   */
  readonly body: () => Promise<Record<string, unknown>>;
  /**
   * What a request dump records: the body object, or for a spool the dump
   * body streamed from the files written with it. Absent when the request was
   * prepared without a dump form.
   */
  readonly dump: Record<string, unknown> | StreamedDumpBody | undefined;
  readonly call: (
    client: Anthropic,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
  ) => AnthropicApiCall;
}

/** A request whose body is an already built object. */
export function sendRequestFromBody(
  facts: AnthropicRequestFacts,
  requestBody: Record<string, unknown>,
): AnthropicSendRequest {
  return {
    facts,
    model: String(requestBody['model']),
    thinking: requestBody['thinking'],
    body: () => Promise.resolve(requestBody),
    dump: requestBody,
    call: (client, headers, signal) =>
      createAnthropicApiCall(client, requestBody, headers, signal),
  };
}

/** Reads a sealed spool back as the JSON object it holds. */
export async function readSpooledBody(
  spool: WireBodySpool,
): Promise<Record<string, unknown>> {
  const handle = spool.openStream();
  try {
    const parsed: unknown = JSON.parse(
      await new Response(handle.stream).text(),
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new TypeError('Anthropic request body is not a JSON object');
    }
    return parsed as Record<string, unknown>;
  } finally {
    handle.dispose();
  }
}

/** A request whose body is a sealed spool, posted without being read whole. */
export function sendRequestFromSpool(
  request: SpooledAnthropicRequest,
): AnthropicSendRequest {
  const { spool, envelope, facts } = request;
  return {
    facts,
    model: String(envelope['model']),
    thinking: envelope['thinking'],
    body: () => readSpooledBody(spool),
    dump: request.dump,
    call: (client, headers, signal) =>
      createSpooledAnthropicApiCall(
        client,
        spool,
        facts.streamingEnabled,
        headers,
        signal,
      ),
  };
}

/** What a dump records when no dump was asked for; never read. */
const NO_DUMP_BODY: Readonly<Record<string, unknown>> = Object.freeze({});

/**
 * The body a request dump records. Nothing is read unless `dumpcontext` asks
 * for a dump on success or on failure, and a spool is never read back whole.
 */
export function requestBodyForDump(
  dumpMode: DumpMode | undefined,
  request: AnthropicSendRequest,
): Record<string, unknown> | StreamedDumpBody {
  if (
    !shouldDumpSDKContext(dumpMode, false) &&
    !shouldDumpSDKContext(dumpMode, true)
  ) {
    return { ...NO_DUMP_BODY };
  }
  if (request.dump === undefined) {
    throw new Error(
      'Anthropic dump requested but the request was prepared without a dump form',
    );
  }
  return request.dump;
}
