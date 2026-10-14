/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  inMemoryRequestSelection,
  type ProviderRequestRows,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { providerRowsOf } from '../utils/providerRows.js';
import { wantsRequestDump } from '../utils/dumpContext.js';
import type { StreamedDumpBody } from '../utils/dumpSDKContext.js';
import { envelopeDumpBody } from '../utils/envelopeDumpBody.js';
import { StreamedSegment, writeEnvelope } from '../utils/envelope-writer.js';
import type { PromptEstimatorFiles } from '../runtime/prompt-estimator-files.js';
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
import {
  createAnthropicEstimatorFiles,
  type AnthropicPromptEstimate,
} from './AnthropicEstimatorFiles.js';
import { writeTableMessages } from './message-table/emit.js';
import { finishWireRequest } from './message-table/finish.js';
import { MessageTable } from './message-table/message-table.js';
import { sanitizeTableImages } from './message-table/recovery-images.js';
import {
  buildValidatedWireTable,
  type MediaStage,
} from './message-table/wire-builder.js';

/**
 * A prepared Anthropic request whose body is a sealed file on scratch disk.
 * The messages exist only as bytes in the spool; `envelope` holds the small
 * members (model, thinking, tools, system, ...) with an empty `messages`.
 * A projected request also carries the estimator form of its prompt keys, and
 * a request whose `dumpcontext` asks for a dump carries the dump body, both
 * written in the same pass as the spool.
 */
export interface SpooledAnthropicRequest {
  readonly facts: AnthropicRequestFacts;
  readonly envelope: Readonly<Record<string, unknown>>;
  /** The sealed body; its size is the Content-Length. */
  readonly spool: WireBodySpool;
  /** Present for a projected request; its projection owns the files. */
  readonly estimate: AnthropicPromptEstimate | undefined;
  /** What a request dump records; present when `dumpcontext` asks for one. */
  readonly dump: StreamedDumpBody | undefined;
  /** Images the recovery budget replaced; 0 when the request had none. */
  readonly recoveredImages: number;
  /**
   * Disposes the spool, the message table and the prompt files. Idempotent.
   * A projection built from the prompt files is disposed by its own owner.
   */
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
 * Writes the body: the envelope's small members as `JSON.stringify` would and
 * the messages streamed from the table. The prompt files get `system` first,
 * then the messages in the same walk, then `tools`, the request's key order.
 */
async function writeBody(
  spool: WireBodySpool,
  table: MessageTable,
  envelope: Readonly<Record<string, unknown>>,
  files: PromptEstimatorFiles | undefined,
): Promise<void> {
  await files?.writeSystem(envelope['system']);
  const messages = new StreamedSegment(async (sink) => {
    if (files === undefined) {
      writeTableMessages(table, sink);
      return;
    }
    await files.writeMessages((estimate) => {
      writeTableMessages(table, sink, estimate);
      return Promise.resolve();
    });
  });
  await writeEnvelope(spool, { ...envelope, messages });
  spool.seal();
  await files?.writeTools(envelope['tools']);
}

/** What a call to {@link prepareSpooledAnthropicRequest} asks for besides the request. */
export interface SpooledRequestOptions {
  /** Also write the estimator form of the prompt keys in the same pass. */
  readonly estimate?: boolean;
  /**
   * The image-dimension recovery's budget: oversized images of the finished
   * table are replaced before the body is written (see `sanitizeTableImages`).
   */
  readonly recoveryBudget?: ImageDimensionBudget;
}

/**
 * Prepares a request without building its message array: the rows are read
 * into the indexed message table one row at a time, the table is finished
 * (validation passes, context prefix, cache controls), and the body is written
 * to a request-scoped spool with `messages` streamed from the table. With a
 * `recoveryBudget` the table's oversized images are replaced after the cache
 * controls, which is what the image-dimension retry sends. With
 * `estimate` the estimator form of the prompt keys is written in the same
 * pass, with the media the endpoint cannot carry listed as the rows pass. A
 * failure disposes the spool, the table and the prompt files.
 */
export async function prepareSpooledAnthropicRequest(
  params: AnthropicPlanParams,
  rows: ProviderRequestRows,
  mediaStage: MediaStage | undefined,
  { estimate = false, recoveryBudget }: SpooledRequestOptions = {},
): Promise<SpooledAnthropicRequest> {
  const plan = planAnthropicRequest(params);
  const signal = getRequestSignal(params.options);
  const dump = wantsRequestDump(
    params.options.invocation.ephemerals.dumpcontext,
  );
  const spool = WireBodySpool.create('anthropic-messages', { signal });
  const table = new MessageTable();
  let files: PromptEstimatorFiles | undefined;
  const release = (): void => {
    try {
      spool.dispose();
    } finally {
      try {
        table.close();
      } finally {
        files?.discard();
      }
    }
  };
  try {
    if (estimate || dump) {
      files = createAnthropicEstimatorFiles(
        plan.requestSettings.currentModel,
        signal,
        dump,
        params.options.resolved.baseURL,
      );
    }
    await buildValidatedWireTable(table, rows, {
      ...plan.conversion,
      imageBudget: plan.imageBudget,
      ...(mediaStage === undefined ? {} : { mediaStage }),
      ...(files === undefined
        ? {}
        : { observeRow: (row) => files?.recordUnsupportedMedia(row) }),
      ...(signal === undefined ? {} : { signal }),
    });
    const evidence = finishTable(table, plan, params);
    const recoveredImages =
      recoveryBudget === undefined
        ? 0
        : sanitizeTableImages(table, recoveryBudget);
    const envelope = buildRequestEnvelope(plan, params);
    await writeBody(spool, table, envelope, files);
    return {
      facts: requestFactsOf(plan, params.cacheLogger, evidence),
      envelope,
      spool,
      estimate: estimate ? files?.seal() : undefined,
      dump:
        dump && files !== undefined
          ? envelopeDumpBody(envelope, files.dumpMessagesFile())
          : undefined,
      recoveredImages,
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * The prepared body belongs to the media request: finishing the request, on
 * any outcome, disposes the spool, the message table, the prompt files and the
 * projection built from them. A failure to register releases the request.
 */
export function registerSpooledRequestCleanup(
  mediaRequest: ResolvedMediaRequest,
  spooled: SpooledAnthropicRequest,
): void {
  try {
    mediaRequest.registerCleanup(spooled.release);
    const projection = spooled.estimate?.projection;
    if (projection !== undefined) {
      mediaRequest.registerCleanup(() => projection.dispose());
    }
  } catch (error) {
    spooled.release();
    throw error;
  }
}
