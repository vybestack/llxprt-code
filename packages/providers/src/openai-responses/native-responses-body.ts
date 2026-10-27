/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { UnsupportedMediaSummary } from '../utils/unsupported-media-summary.js';
import {
  isTextResponsePlan,
  nativeTextResponsePieces,
} from './native-responses-text-pieces.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { PDF_AGGREGATE_MAX_BYTES } from '../utils/mediaUtils.js';
import { CallerOwnedToolQuery } from '../utils/caller-owned-tool-query.js';
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
  reasoningDigitBytes,
} from './responses-unit-length.js';
import {
  responsesLengthRegistration,
  planStoredResponsesRequest,
} from './journal-responses-length.js';
import { responsesRequestParts } from './responses-disk-body.js';
import { responsesInputContext } from './responses-request-fields.js';
import { sanitizeDiagnosticData } from '../utils/mediaDiagnostics.js';
import { resolveRowsMedia } from './responses-row-media.js';
import { PROJECTION_REVISION } from '../runtime/promptEnvelopeProjections.js';
import { NativeResponsesEstimateProjection } from './native-responses-estimate.js';
import {
  NativeDumpBody,
  nativeDumpLiteral,
  nativeDumpValue,
  type NativeDumpPiece,
} from '../utils/native-dump-body.js';
import type { StreamedDumpBody } from '../utils/dumpSDKContext.js';
import type { DiskBodyMedia } from './responses-disk-body.js';
import {
  statefulResponsesSummary,
  statefulUnsupportedMedia,
  unsupportedMediaForRow,
} from './native-responses-selection.js';
import type { UnsupportedMediaEntry } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { toEstimationContents } from './openAIResponsesRequestState.js';
import type { StatefulConversation } from './openAIResponsesStateful.js';
import { assertRowIndex } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { findDanglingCalls } from './responses-dangling-calls.js';
import { SyntheticToolResponseHandler } from '../openai/syntheticToolResponses.js';
import { jsonValueByteLength } from '../utils/progressive-json-body.js';

export interface NativeResponsesSelection {
  readonly stateful: StatefulConversation;
  readonly skipRows: number;
  readonly inputOverride?: { readonly value: unknown };
}

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
  private readonly capture: NativeDumpBody;
  readonly dump: StreamedDumpBody;

  constructor(
    private readonly rows: ProviderRequestRows,
    private readonly options: ResponsesRequest,
    private readonly shell: ResponsesRequestShell,
    private readonly context: ResponsesInputBuildContext,
    readonly byteLength: number,
    readonly selection: NativeResponsesSelection,
    readonly unsupportedMedia: readonly UnsupportedMediaEntry[],
  ) {
    this.model = shell.request.model;
    this.estimate = new NativeResponsesEstimateProjection(this);
    this.capture = new NativeDumpBody(
      () => this.bodyPieces(shell.request),
      false,
    );
    this.dump = this.capture.dump;
  }

  toEstimatorProjection(): NativeResponsesEstimateProjection {
    this.requireOpen();
    return this.estimate;
  }

  private requireOpen(): void {
    this.options.invocation.signal?.throwIfAborted();
    if (this.closed) throw new Error('Native Responses prompt is closed');
  }

  private async *streamRows(estimation: boolean): AsyncGenerator<IContent> {
    const source = this.rows.openReader(this.options.invocation.signal);
    let current: IteratorResult<IContent> | undefined;
    try {
      for (;;) {
        current = await source.next();
        if (current.done === true) return;
        this.requireOpen();
        yield estimation
          ? toEstimationContents([current.value])[0]
          : current.value;
        current = undefined;
      }
    } finally {
      current = undefined;
      await source.return();
    }
  }

  private async *selectedRows(
    skipRows: number,
    estimation: boolean,
    endRows: number,
  ): AsyncGenerator<IContent> {
    if (
      skipRows === 0 &&
      endRows === this.rows.count &&
      this.rows.native !== undefined
    ) {
      yield* this.streamRows(estimation);
      return;
    }
    for (let index = skipRows; index < endRows; index++) {
      this.requireOpen();
      const row = await this.rows.readAt(index, this.options.invocation.signal);
      yield estimation ? toEstimationContents([row])[0] : row;
    }
  }

  async *items(
    skipRows = this.selection.skipRows,
    estimation = false,
    endRows = this.rows.count,
    counter = { value: 0 },
    pairSkipRows = skipRows,
  ): AsyncGenerator<ResponsesInputItem> {
    this.requireOpen();
    const indexed =
      this.rows.index ??
      this.rows.native?.indexed ??
      (await CallerOwnedToolQuery.create(this.rows));
    const selected = this.selectedRows(skipRows, estimation, endRows);
    const source = estimation
      ? selected
      : resolveRowsMedia(
          selected,
          {
            requestId: this.options.mediaRequestId,
            aggregateBudgetBytes: this.options.mediaBudgetBytes,
            resolver: this.options.mediaResolver,
          },
          this.shell.mediaRequest,
          this.options.invocation.signal,
          this.rows.native,
        );
    let current: IteratorResult<IContent> | undefined;
    try {
      for (;;) {
        current = await source.next();
        if (current.done === true) return;
        this.requireOpen();
        const pairs = await responsesUnitPairs(
          current.value,
          indexed,
          pairSkipRows,
        );
        yield* buildOpenAIResponsesUnit(
          current.value,
          this.context,
          pairs,
          () => `rs_${this.context.reasoningIdTime}_${counter.value++}`,
        );
        current = undefined;
      }
    } finally {
      current = undefined;
      await source.return(undefined);
    }
  }

  private async *nativeInputPieces(): AsyncGenerator<NativeDumpPiece> {
    const indexed = this.rows.native?.indexed;
    if (indexed === undefined) throw new Error('Missing native request index');
    let separator = '';
    const counter = { value: 0 };
    let ordinal = 0;
    for await (const plan of indexed.openPlans(
      this.options.invocation.signal,
    )) {
      const index = ordinal++;
      if (index < this.selection.skipRows) continue;
      this.requireOpen();
      if (isTextResponsePlan(plan)) {
        let emitted = false;
        for await (const piece of nativeTextResponsePieces(plan, separator)) {
          this.requireOpen();
          yield piece;
          emitted = true;
        }
        if (emitted) separator = ',';
      } else {
        for await (const item of this.items(
          index,
          false,
          index + 1,
          counter,
          this.selection.skipRows,
        )) {
          yield nativeDumpLiteral(separator);
          yield* nativeDumpValue(item);
          separator = ',';
        }
      }
    }
  }

  private async *inputPieces(): AsyncGenerator<NativeDumpPiece> {
    if (this.selection.inputOverride !== undefined) {
      yield* nativeDumpValue(this.selection.inputOverride.value);
      return;
    }
    yield nativeDumpLiteral('[');
    if (this.rows.native !== undefined) yield* this.nativeInputPieces();
    else {
      let separator = '';
      for await (const item of this.items()) {
        yield nativeDumpLiteral(separator);
        yield* nativeDumpValue(item);
        separator = ',';
      }
    }
    yield nativeDumpLiteral(']');
  }

  private async *bodyPieces(
    request: OpenAIResponsesRequest,
    diagnosticRequest = request,
  ): AsyncGenerator<NativeDumpPiece> {
    this.requireOpen();
    yield nativeDumpLiteral('{');
    let wireComma = '';
    let dumpComma = '';
    for (const key of Object.keys(request)) {
      this.requireOpen();
      const value: unknown = Reflect.get(request, key);
      if (value === undefined) continue;
      const diagnostic: unknown = Reflect.get(diagnosticRequest, key);
      const keep = diagnostic !== undefined;
      yield nativeDumpLiteral(
        `${wireComma}${JSON.stringify(key)}:`,
        keep ? `${dumpComma}${JSON.stringify(key)}:` : '',
      );
      if (key === 'input') yield* this.inputPieces();
      else
        yield* nativeDumpValue(value, () =>
          key === 'tools' ? sanitizeDiagnosticData(diagnostic) : diagnostic,
        );
      wireComma = ',';
      if (keep) dumpComma = ',';
    }
    yield nativeDumpLiteral('}');
  }

  async *inputBytes(media: DiskBodyMedia): AsyncGenerator<Uint8Array> {
    for await (const piece of this.inputPieces())
      yield media === 'dump' ? piece.diagnostic() : piece.wire;
  }

  async *body(
    request: OpenAIResponsesRequest,
    media: DiskBodyMedia = 'wire',
  ): AsyncGenerator<Uint8Array> {
    if (media === 'dump') {
      for await (const piece of this.bodyPieces(request)) {
        this.requireOpen();
        yield piece.diagnostic();
      }
    } else {
      for await (const bytes of this.capture.stream(() =>
        this.bodyPieces(request),
      )) {
        this.requireOpen();
        yield bytes;
      }
    }
  }

  async *frame(request: OpenAIResponsesRequest): AsyncGenerator<Uint8Array> {
    yield* this.capture.stream(() =>
      this.bodyPieces({ ...request, type: 'response.create' }, request),
    );
  }

  envelope(): OpenAIResponsesRequest {
    this.requireOpen();
    return this.shell.request;
  }

  async dispose(): Promise<void> {
    try {
      await this.capture.dispose();
    } finally {
      this.closed = true;
    }
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

interface PreparedHistory {
  readonly byteLength: number;
  readonly unsupportedMedia: readonly UnsupportedMediaEntry[];
}

async function historyByteLength(
  options: ResponsesRequest,
  shell: ResponsesRequestShell,
  reasoningIdTime: number,
  selection: NativeResponsesSelection,
): Promise<PreparedHistory> {
  const rows = options.requestRows;
  const native = rows?.native;
  if (rows === undefined)
    throw new Error('Native Responses requires request rows');
  if (rows.callerOwned === true || rows.index?.toolFree === true)
    return callerOwnedByteLength(
      options,
      shell,
      reasoningIdTime,
      selection,
      rows,
    );
  if (native === undefined)
    throw new Error('Native Responses requires journal rows');
  const settings = nativeSettings(options);
  const registration = responsesLengthRegistration(settings);
  const envelope = { ...shell.request, input: [] };
  const plan = await native.withFormat(registration, async (snapshot) => {
    const slot = requestFormatSlot(snapshot, settings);
    if (selection.stateful.parentId !== undefined) {
      const selected = await statefulResponsesSummary(
        native,
        snapshot,
        slot,
        settings,
        selection.skipRows,
      );
      return planStoredResponsesRequest(
        snapshot,
        settings,
        options.includeReasoningInContext ? 0 : 1,
        envelope,
        reasoningIdTime,
        selected,
      );
    }
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
      envelope,
      reasoningIdTime,
      { summary, pdfBytes },
    );
  });
  return {
    byteLength: plan.contentLength,
    unsupportedMedia: await statefulUnsupportedMedia(
      rows,
      selection.skipRows,
      options.pdfEnabled,
    ),
  };
}

async function callerOwnedByteLength(
  options: ResponsesRequest,
  shell: ResponsesRequestShell,
  reasoningIdTime: number,
  selection: NativeResponsesSelection,
  rows: ProviderRequestRows,
): Promise<PreparedHistory> {
  const query = rows.index ?? (await CallerOwnedToolQuery.create(rows));
  const settings = nativeSettings(options);
  const unsupportedMedia = new UnsupportedMediaSummary();
  let pdfBytes = 0;
  let bytes = 2;
  let items = 0;
  let generatedIds = 0;
  for (let at = selection.skipRows; at < rows.count; at++) {
    const row = await rows.readAt(at, options.invocation.signal);
    unsupportedMedia.addAll(unsupportedMediaForRow(row, options.pdfEnabled));
    const pairs = await responsesUnitPairs(row, query, selection.skipRows);
    const measured = responsesUnitLength(
      row,
      settings,
      options.includeReasoningInContext,
      pairs,
      selection.stateful.parentId !== undefined,
    );
    pdfBytes += measured.pdfBytes;
    bytes += measured.bytes + measured.count;
    items += measured.count;
    generatedIds += measured.generatedIds;
  }
  bytes -= Number(items > 0);
  bytes +=
    generatedIds * Buffer.byteLength(`,"id":"rs_${reasoningIdTime}_"`) +
    reasoningDigitBytes(generatedIds);
  if (pdfBytes > PDF_AGGREGATE_MAX_BYTES)
    throw new Error(
      `Native PDF input payload (${pdfBytes} bytes) exceeds the allowed ${PDF_AGGREGATE_MAX_BYTES} bytes (50 MB). Reduce the number or size of PDF files.`,
    );
  return {
    byteLength: overrideByteLength(shell.request, []) - 2 + bytes,
    unsupportedMedia: unsupportedMedia.entries(),
  };
}

function overrideByteLength(
  request: OpenAIResponsesRequest,
  value: unknown,
): number {
  let bytes = 0;
  for (const part of responsesRequestParts(request)) {
    if (part.kind === 'literal') bytes += part.bytes.byteLength;
    else
      bytes += jsonValueByteLength(part.key === 'input' ? value : part.value);
  }
  return bytes;
}

async function callerOwnedResponsesRows(
  rows: ProviderRequestRows,
  signal: AbortSignal | undefined,
): Promise<ProviderRequestRows> {
  const dangling = await findDanglingCalls(
    () => rows.openReader(signal),
    signal,
  );
  const missing = [...dangling.missing];
  const query = await CallerOwnedToolQuery.create(rows);
  if (!query.hasToolBlocks) return rows;
  const allowEmpty = (await query.normalizedCount(1, 1, 'call_')) > 0;
  const originalAt = async (
    at: number,
    readerSignal?: AbortSignal,
  ): Promise<IContent> => {
    const row = await rows.readAt(at, readerSignal);
    return allowEmpty || row.speaker !== 'ai'
      ? row
      : {
          ...row,
          blocks: row.blocks.filter(
            (block) => block.type !== 'tool_call' || block.id !== '',
          ),
        };
  };
  const count = rows.count + missing.length;
  const insertion = dangling.lastCallRow + 1;
  const readAt = (
    at: number,
    readerSignal?: AbortSignal,
  ): IContent | Promise<IContent> => {
    signal?.throwIfAborted();
    readerSignal?.throwIfAborted();
    assertRowIndex(at, count);
    if (at < insertion) return originalAt(at, readerSignal);
    if (at >= insertion + missing.length)
      return originalAt(at - missing.length, readerSignal);
    const [toolCallId, toolName] = missing[at - insertion];
    return SyntheticToolResponseHandler.createSyntheticResponses([
      { toolCallId, toolName },
    ])[0];
  };
  return {
    callerOwned: true,
    count,
    readAt,
    async *openReader(readerSignal) {
      for (let at = 0; at < count; at++) yield await readAt(at, readerSignal);
    },
  };
}

export async function prepareNativeResponsesPrompt(
  options: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  shell: ResponsesRequestShell,
  reasoningIdTime: number,
  selection: NativeResponsesSelection,
): Promise<NativeResponsesPrompt> {
  const supplied = options.requestRows;
  if (
    supplied === undefined ||
    (supplied.native === undefined &&
      supplied.index?.toolFree !== true &&
      supplied.callerOwned !== true)
  )
    throw new Error('Native Responses requires native request rows');
  const rows =
    supplied.callerOwned === true
      ? await callerOwnedResponsesRows(supplied, options.invocation.signal)
      : supplied;
  const preparedOptions = {
    ...options,
    requestRows: rows,
    contentCount: rows.count,
  };
  const prepared =
    selection.inputOverride === undefined
      ? await historyByteLength(
          preparedOptions,
          shell,
          reasoningIdTime,
          selection,
        )
      : {
          byteLength: overrideByteLength(
            shell.request,
            selection.inputOverride.value,
          ),
          unsupportedMedia: [],
        };
  return new NativeResponsesPrompt(
    rows,
    preparedOptions,
    shell,
    responsesInputContext(
      options,
      deps,
      selection.stateful.parentId !== undefined,
      reasoningIdTime,
    ),
    prepared.byteLength,
    selection,
    prepared.unsupportedMedia,
  );
}
