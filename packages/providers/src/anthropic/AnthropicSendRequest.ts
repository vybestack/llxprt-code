/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type Anthropic from '@anthropic-ai/sdk';
import { shouldDumpSDKContext } from '../utils/dumpSDKContext.js';
import type { DumpMode } from '../utils/dumpContext.js';
import type { WireBodySpool } from '../utils/wire-body-spool.js';
import {
  createAnthropicApiCall,
  createSpooledAnthropicApiCall,
  type AnthropicApiCall,
} from './AnthropicApiExecution.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { acquireRequestScopedBody } from '../utils/requestScopedBody.js';
import type { PreparedAnthropicPromptEnvelope } from './AnthropicProviderInternals.js';
import type { AnthropicRequestFacts } from './AnthropicRequestPreparation.js';
import type { SpooledAnthropicRequest } from './AnthropicSpooledRequest.js';

/**
 * A request ready to send: the facts the transport and the response path
 * need, the headers' model and thinking inputs, how to post it, and the body
 * as an object for the two consumers that need one (a request dump, and image
 * recovery's sanitized retry).
 */
export interface AnthropicSendRequest {
  readonly facts: AnthropicRequestFacts;
  readonly model: string;
  readonly thinking: unknown;
  /**
   * The body as an object. For a built body this is the body itself; for a
   * spool it is the spool read back whole, so ask for it only when a dump or
   * a recovery retry needs the object.
   */
  readonly body: () => Promise<Record<string, unknown>>;
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
    call: (client, headers, signal) =>
      createAnthropicApiCall(client, requestBody, headers, signal),
  };
}

/**
 * A projected send uses the body its projection built. Issue #854 P05b4: that
 * wire body is owned by a request-scoped lease and the media request's finish
 * releases it. A source-route preparation already holds the lease for the one
 * body.
 */
export function sendRequestFromPrepared(
  prepared: PreparedAnthropicPromptEnvelope,
  mediaRequest: ResolvedMediaRequest,
): AnthropicSendRequest {
  const { requestContext } = prepared;
  if (prepared.bodyLease === undefined) {
    const requestBodyLease = acquireRequestScopedBody(
      'anthropic',
      requestContext.requestBody,
    );
    mediaRequest.registerCleanup(() => {
      void requestBodyLease.release();
    });
  }
  return sendRequestFromBody(requestContext, requestContext.requestBody);
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
 * The body object a request dump records. A spool is read back whole only
 * when `dumpcontext` asks for a dump on success or on failure.
 */
export function requestBodyForDump(
  dumpMode: DumpMode | undefined,
  request: AnthropicSendRequest,
): Promise<Record<string, unknown>> {
  return shouldDumpSDKContext(dumpMode, false) ||
    shouldDumpSDKContext(dumpMode, true)
    ? request.body()
    : Promise.resolve({ ...NO_DUMP_BODY });
}
