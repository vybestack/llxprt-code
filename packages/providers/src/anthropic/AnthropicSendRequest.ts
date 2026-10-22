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
import {
  createSpooledAnthropicApiCall,
  type AnthropicApiCall,
} from './AnthropicApiExecution.js';
import type { AnthropicRequestFacts } from './AnthropicRequestPreparation.js';
import type { PreparedAnthropicRequest } from './native-anthropic-request.js';

/**
 * A request ready to send: the facts the transport and the response path
 * need, the headers' model and thinking inputs, how to post it, and what a
 * request dump records.
 */
export interface AnthropicSendRequest {
  readonly facts: AnthropicRequestFacts;
  readonly model: string;
  readonly thinking: unknown;
  /**
   * What a request dump records: the dump body streamed from the files written
   * with the spool. Absent when the request was prepared without a dump form.
   */
  readonly dump: StreamedDumpBody | undefined;
  readonly call: (
    client: Anthropic,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
  ) => AnthropicApiCall;
}

/** A request whose body is a sealed spool, posted without being read whole. */
export function sendRequestFromSpool(
  request: PreparedAnthropicRequest,
): AnthropicSendRequest {
  const { spool, envelope, facts } = request;
  return {
    facts,
    model: String(envelope['model']),
    thinking: envelope['thinking'],
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
