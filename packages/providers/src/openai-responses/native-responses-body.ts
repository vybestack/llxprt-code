/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { requestFormatSlot } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { SlotSummary } from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import type { JournalResponsePlan } from '@vybestack/llxprt-code-core/services/history/journal-response-plan.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponsesRequest } from './responses-request.js';
import type {
  ResponsesExecutorDeps,
  ResponsesRequestShell,
} from './openAIResponsesExecutor.js';
import {
  buildOpenAIResponsesUnit,
  type ResponsesInputBuildContext,
} from './OpenAIResponsesInputBuilder.js';
import type {
  OpenAIResponsesRequest,
  ResponsesInputItem,
} from './OpenAIResponsesTypes.js';
import {
  responsesUnitPairs,
  responsesUnitLength,
  responsesUnitSummary,
} from './responses-unit-length.js';
import {
  responsesLengthRegistration,
  planStoredResponsesRequest,
} from './journal-responses-length.js';
import { responsesRequestParts } from './responses-disk-body.js';
import { responsesInputContext } from './responses-request-fields.js';
import { jsonValueBytes } from '../utils/progressive-json-body.js';
import { resolveRowsMedia } from './responses-row-media.js';
import { PROJECTION_REVISION } from '../runtime/promptEnvelopeProjections.js';
import { NativeResponsesEstimateProjection } from './native-responses-estimate.js';
import { sanitizeDiagnosticData } from '../utils/mediaDiagnostics.js';
import type { DiskBodyMedia } from './responses-disk-body.js';

async function overlaySummary(
  plans: AsyncIterable<JournalResponsePlan>,
  rows: ProviderRequestRows,
  settings: RowFormatSettings,
): Promise<{ readonly summary: SlotSummary; readonly pdfBytes: number }> {
  const indexed = rows.native?.indexed;
  if (indexed === undefined)
    throw new Error('Native Responses requires journal rows');
  let summary = identitySlotSummary('responses');
  let pdfBytes = 0;
  for await (const plan of plans) {
    const blocks: IContent['blocks'] = [];
    for await (const block of plan.openBlocks()) blocks.push(block);
    const unit = { ...plan.header, blocks };
    const pairs = await responsesUnitPairs(unit, indexed);
    const kept = responsesUnitLength(unit, settings, true, pairs);
    pdfBytes += kept.pdfBytes;
    summary = composeSlotSummaries(summary, {
      kind: 'responses',
      variants: [
        responsesUnitSummary(kept),
        responsesUnitSummary(responsesUnitLength(unit, settings, false, pairs)),
      ],
    });
  }
  return { summary, pdfBytes };
}

export class NativeResponsesPrompt {
  readonly protocol = 'openai-responses';
  readonly method = 'responses/v1';
  readonly projectionRevision = PROJECTION_REVISION;
  readonly model: string;
  readonly estimate: NativeResponsesEstimateProjection;
  private closed = false;

  constructor(
    private readonly rows: ProviderRequestRows,
    private readonly options: ResponsesRequest,
    private readonly shell: ResponsesRequestShell,
    private readonly context: ResponsesInputBuildContext,
    readonly byteLength: number,
  ) {
    this.model = shell.request.model;
    this.estimate = new NativeResponsesEstimateProjection(this);
  }

  toEstimatorProjection(): NativeResponsesEstimateProjection {
    this.requireOpen();
    return this.estimate;
  }

  private requireOpen(): void {
    this.options.invocation.signal?.throwIfAborted();
    if (this.closed) throw new Error('Native Responses prompt is closed');
  }

  async *items(): AsyncGenerator<ResponsesInputItem> {
    this.requireOpen();
    const indexed = this.rows.native?.indexed;
    if (indexed === undefined)
      throw new Error('Native Responses requires journal rows');
    let counter = 0;
    const source = resolveRowsMedia(
      this.rows.openReader(this.options.invocation.signal),
      {
        requestId: this.options.mediaRequestId,
        aggregateBudgetBytes: this.options.mediaBudgetBytes,
        resolver: this.options.mediaResolver,
      },
      this.shell.mediaRequest,
      this.options.invocation.signal,
      this.rows.native,
    );
    for await (const row of source) {
      this.requireOpen();
      const pairs = await responsesUnitPairs(row, indexed);
      yield* buildOpenAIResponsesUnit(
        row,
        this.context,
        pairs,
        () => `rs_${this.context.reasoningIdTime}_${counter++}`,
      );
    }
  }

  async *inputBytes(media: DiskBodyMedia): AsyncGenerator<Uint8Array> {
    yield Buffer.from('[');
    let separator = '';
    for await (const item of this.items()) {
      yield Buffer.from(separator);
      yield* jsonValueBytes(
        media === 'dump' ? sanitizeDiagnosticData(item) : item,
      );
      separator = ',';
    }
    yield Buffer.from(']');
  }

  async *body(
    request: OpenAIResponsesRequest,
    media: DiskBodyMedia = 'wire',
  ): AsyncGenerator<Uint8Array> {
    this.requireOpen();
    for (const part of responsesRequestParts(
      request,
      this.options.invocation.signal,
    )) {
      if (part.kind === 'literal') yield part.bytes;
      else if (part.key === 'input') yield* this.inputBytes(media);
      else
        yield* jsonValueBytes(
          media === 'dump' && part.key === 'tools'
            ? sanitizeDiagnosticData(part.value)
            : part.value,
        );
    }
  }

  envelope(): OpenAIResponsesRequest {
    this.requireOpen();
    return this.shell.request;
  }

  dispose(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function nativeSettings(options: ResponsesRequest): RowFormatSettings {
  return {
    formatId: 'responses',
    formatRev: 1,
    model: options.resolved.model,
    endpoint: options.resolved.baseURL,
    isOAuth: false,
    toolNameTransform: 'none',
    supportsUrlImages: true,
    reasoningEnabled: false,
    reasoningFieldName: 'reasoning_content',
    mediaPdfEnabled: options.pdfEnabled,
    unsupportedMedia: 'notice',
    outputLimits: options.outputLimits,
  };
}

export async function prepareNativeResponsesPrompt(
  options: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  shell: ResponsesRequestShell,
  reasoningIdTime: number,
): Promise<NativeResponsesPrompt> {
  const rows = options.requestRows;
  const native = rows?.native;
  if (rows === undefined || native === undefined)
    throw new Error('Native Responses requires journal rows');
  const settings = nativeSettings(options);
  const registration = responsesLengthRegistration(settings);
  const plan = await native.withFormat(registration, async (snapshot) => {
    const slot = requestFormatSlot(snapshot, settings);
    let pdfBytes = snapshot.version?.aggregate.pdfBytes[slot] ?? 0;
    for (const changed of native.indexed.viewPlan.changedSources) {
      const original = await snapshot.entryByLabel(changed.entry.label);
      pdfBytes -= original?.media.pdfBytes[slot] ?? 0;
    }
    const summary = await native.indexed.formatSummary(
      snapshot,
      slot,
      async (plans) => {
        const measured = await overlaySummary(plans, rows, settings);
        pdfBytes += measured.pdfBytes;
        return measured.summary;
      },
    );
    return planStoredResponsesRequest(
      snapshot,
      settings,
      options.includeReasoningInContext ? 0 : 1,
      shell.request,
      reasoningIdTime,
      { summary, pdfBytes },
    );
  });
  const prompt = new NativeResponsesPrompt(
    rows,
    options,
    shell,
    responsesInputContext(options, deps, false, reasoningIdTime),
    plan.contentLength,
  );
  return prompt;
}
