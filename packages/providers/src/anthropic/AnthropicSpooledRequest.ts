/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  inMemoryRequestSelection,
  type ProviderRequestRows,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { providerRowsOf } from '../utils/providerRows.js';
import { StreamedSegment, writeEnvelope } from '../utils/envelope-writer.js';
import { formatContextPrefix } from '../utils/systemPromptPlacement.js';
import { WireBodySpool } from '../utils/wire-body-spool.js';
import {
  buildRequestEnvelope,
  planAnthropicRequest,
  requestFactsOf,
  type AnthropicRequestFacts,
  type AnthropicRequestPlan,
  type AnthropicPlanParams,
} from './AnthropicRequestPreparation.js';
import { writeTableMessages } from './message-table/emit.js';
import { finishWireRequest } from './message-table/finish.js';
import { MessageTable } from './message-table/message-table.js';
import {
  buildValidatedWireTable,
  type MediaStage,
} from './message-table/wire-builder.js';

/**
 * A prepared Anthropic request whose body is a sealed file on scratch disk.
 * The messages exist only as bytes in the spool; `envelope` holds the small
 * members (model, thinking, tools, system, ...) with an empty `messages`.
 */
export interface SpooledAnthropicRequest {
  readonly facts: AnthropicRequestFacts;
  readonly envelope: Readonly<Record<string, unknown>>;
  /** The sealed body; its size is the Content-Length. */
  readonly spool: WireBodySpool;
  /** Disposes the spool and removes the message table. Idempotent. */
  release(): void;
}

/**
 * The rows a send reads. A call with `requestRows` reads that selection. A
 * call whose caller handed over a history array (normalization collected it
 * before the transport saw the call) reads that array in place; nothing is
 * copied and no array is built here.
 */
export function anthropicRowsOf(
  options: NormalizedGenerateChatOptions,
): Promise<ProviderRequestRows> {
  return options.requestRows === undefined
    ? Promise.resolve(inMemoryRequestSelection(options.contents))
    : providerRowsOf(options);
}

/** The formatted system instruction when placement puts it in the context. */
function contextPrefixOf(
  params: AnthropicPlanParams,
  systemInstruction: string | undefined,
): string | undefined {
  if (params.placement !== 'context-prefix') return undefined;
  const instruction = systemInstruction ?? '';
  return instruction === '' ? undefined : formatContextPrefix(instruction);
}

function finishTable(
  table: MessageTable,
  plan: AnthropicRequestPlan,
  params: AnthropicPlanParams,
) {
  return finishWireRequest(table, {
    reasoningEnabled: plan.conversion.reasoningEnabled,
    currentModel: plan.conversion.currentModel,
    logger: params.logger,
    cacheLogger: params.cacheLogger,
    contextPrefix: contextPrefixOf(params, params.options.systemInstruction),
    caching: plan.wantCaching
      ? {
          ttl: plan.requestSettings.ttl,
          mediaPurgeBoundary: plan.wantMediaPurgeCacheAnchor,
        }
      : undefined,
  });
}

/**
 * Prepares a request without building its message array: the rows are read
 * into the indexed message table one row at a time, the table is finished
 * (validation passes, context prefix, cache controls), and the body is written
 * to a request-scoped spool with `messages` streamed from the table. A failure
 * disposes the spool and the table.
 */
export async function prepareSpooledAnthropicRequest(
  params: AnthropicPlanParams,
  rows: ProviderRequestRows,
  mediaStage: MediaStage | undefined,
): Promise<SpooledAnthropicRequest> {
  const plan = planAnthropicRequest(params);
  const signal = getRequestSignal(params.options);
  const spool = WireBodySpool.create('anthropic-messages', { signal });
  const table = new MessageTable();
  const release = (): void => {
    try {
      spool.dispose();
    } finally {
      table.close();
    }
  };
  try {
    await buildValidatedWireTable(table, rows, {
      ...plan.conversion,
      imageBudget: plan.imageBudget,
      ...(mediaStage === undefined ? {} : { mediaStage }),
      ...(signal === undefined ? {} : { signal }),
    });
    const evidence = finishTable(table, plan, params);
    const envelope = buildRequestEnvelope(plan, params);
    const messages = new StreamedSegment((sink) =>
      writeTableMessages(table, sink),
    );
    await writeEnvelope(spool, { ...envelope, messages });
    spool.seal();
    return {
      facts: requestFactsOf(plan, params.cacheLogger, evidence),
      envelope,
      spool,
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
