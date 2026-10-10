/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync } from 'node:fs';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  normalizeToHistoryToolId,
  normalizeToOpenAIToolId,
} from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import {
  buildOpenAIResponsesInput,
  type ResponsesInputBuildContext,
} from '../openai-responses/OpenAIResponsesInputBuilder.js';
import type {
  ResponsesContentPart,
  ResponsesInputItem,
} from '../openai-responses/OpenAIResponsesTypes.js';
import {
  buildPdfDisabledNotice,
  buildUnsupportedMediaPlaceholder,
  classifyMediaBlock,
  inlineBase64ByteLength,
  normalizeMediaToDataUri,
  PDF_AGGREGATE_MAX_BYTES,
  resolvePdfFilename,
} from '../utils/mediaUtils.js';
import { SyntheticToolResponseHandler } from '../openai/syntheticToolResponses.js';
import type { RequestScopedContents } from '../utils/requestScopedBody.js';
import type { PromptKeySink } from './prompt-key-tee-writer.js';
import { ToolPairIndex } from './responses-tool-pair-index.js';

export interface DanglingCalls {
  /** Index of the last assistant row carrying tool calls; -1 when none. */
  readonly lastCallRow: number;
  /** History ids of calls that never receive a response, in call order. */
  readonly missing: ReadonlyMap<string, string | undefined>;
}

function settleResponses(open: Set<string>, row: IContent): void {
  if (row.speaker !== 'tool') return;
  for (const block of row.blocks) {
    if (block.type === 'tool_response')
      open.delete(normalizeToHistoryToolId(block.callId));
  }
}

/**
 * Finds unanswered tool calls the way the array route's synthetic-response
 * patching does, holding only the currently open calls and the last call row's
 * names. Calls answered before they appear (rare) are settled by a second scan.
 */
export async function findDanglingCalls(
  rows: () => AsyncIterable<IContent>,
  signal?: AbortSignal,
): Promise<DanglingCalls> {
  const open = new Set<string>();
  let names = new Map<string, string>();
  let lastCallRow = -1;
  let index = 0;
  for await (const row of rows()) {
    signal?.throwIfAborted();
    const calls =
      row.speaker === 'ai'
        ? row.blocks.filter((block) => block.type === 'tool_call')
        : [];
    if (calls.length > 0) {
      lastCallRow = index;
      names = new Map();
    }
    for (const call of calls) {
      if (!call.id) continue;
      const id = normalizeToHistoryToolId(call.id);
      open.add(id);
      if (call.name) names.set(id, call.name);
    }
    settleResponses(open, row);
    index++;
  }
  if (open.size > 0) {
    for await (const row of rows()) {
      signal?.throwIfAborted();
      settleResponses(open, row);
    }
  }
  return {
    lastCallRow,
    missing: new Map([...open].map((id) => [id, names.get(id)])),
  };
}

function mediaPart(media: MediaBlock, enabled: boolean): ResponsesContentPart {
  const kind = classifyMediaBlock(media);
  if (kind === 'image')
    return { type: 'input_image', image_url: normalizeMediaToDataUri(media) };
  if (kind === 'pdf') {
    if (!enabled)
      return { type: 'input_text', text: buildPdfDisabledNotice(media) };
    return {
      type: 'input_file',
      file_data: normalizeMediaToDataUri(media),
      filename: resolvePdfFilename(media),
    };
  }
  return {
    type: 'input_text',
    text: buildUnsupportedMediaPlaceholder(media, 'OpenAI Responses'),
  };
}

/**
 * Dangling calls found over the whole stored history when the written rows
 * start after a stateful parent; indices in `calls` are whole-history indices.
 */
export interface HistoryDangling {
  readonly calls: DanglingCalls;
  readonly skipRows: number;
}

/** Scans pair membership on disk instead of retaining IDs or counterpart rows. */
export class ResponsesSourceInput {
  #separator = '';
  #reasoning = 0;
  #pdfBytes = 0;
  #dangling: DanglingCalls | undefined;
  #pairs: ToolPairIndex | undefined;
  readonly #skipRows: number;

  constructor(
    private readonly writer: PromptKeySink,
    private readonly context: ResponsesInputBuildContext,
    private readonly unsupportedPath: string,
    private readonly signal?: AbortSignal,
    history?: HistoryDangling,
  ) {
    this.#dangling = history?.calls;
    this.#skipRows = history?.skipRows ?? 0;
  }

  private start(): void {
    this.writer.append(this.#separator);
    this.#separator = ',';
  }
  private item(item: ResponsesInputItem): void {
    this.start();
    this.writer.value(item);
  }

  private media(row: IContent, human: boolean): void {
    this.start();
    this.writer.append('{"role":"user","content":[');
    let separator = '';
    for (const block of row.blocks) {
      if (
        block.type !== 'media' &&
        !(human && block.type === 'text' && block.text)
      )
        continue;
      const part: ResponsesContentPart =
        block.type === 'media'
          ? mediaPart(block, this.context.mediaPdfEnabled !== false)
          : {
              type: 'input_text',
              text: block.text,
            };
      if (part.type === 'input_file')
        this.#pdfBytes += inlineBase64ByteLength(part.file_data);
      this.writer.append(separator);
      this.writer.value(part);
      separator = ',';
    }
    this.writer.append(']}');
  }

  private text(row: IContent): void {
    let text = '';
    let separator = '';
    for (const block of row.blocks) {
      if (block.type !== 'text') continue;
      text += separator + block.text;
      separator = row.speaker === 'human' ? '\n' : '';
    }
    if (text)
      this.item({
        role: row.speaker === 'human' ? 'user' : 'assistant',
        content: text,
      });
  }

  private reasoning(row: IContent): void {
    if (!this.context.includeReasoningInContext) return;
    for (const block of row.blocks) {
      if (block.type !== 'thinking' || !block.encryptedContent) continue;
      const items = buildOpenAIResponsesInput(
        [{ speaker: 'ai', blocks: [block] }],
        this.context,
      );
      const providerId =
        block.providerMetadata?.['openai.responses.reasoningId'];
      const genuine =
        typeof providerId === 'string' && providerId.startsWith('rs');
      for (const item of items) {
        if (
          'type' in item &&
          item.type === 'reasoning' &&
          !genuine &&
          this.context.serverSideParentActive !== true
        )
          item.id = `rs_local_${this.#reasoning++}`;
        this.item(item);
      }
    }
  }

  /** Built on first need so histories without tool calls never replay the source. */
  private async pairs(owner: RequestScopedContents): Promise<ToolPairIndex> {
    this.#pairs ??= await ToolPairIndex.build(owner.stream(), this.signal);
    return this.#pairs;
  }

  private async assistant(
    row: IContent,
    owner: RequestScopedContents,
  ): Promise<void> {
    this.reasoning(row);
    this.text(row);
    for (const block of row.blocks) {
      if (block.type !== 'tool_call') continue;
      // Deferred so histories without tool calls never replay the source.
      this.#dangling ??= await findDanglingCalls(
        () => owner.stream(),
        this.signal,
      );
      const missing = this.#dangling;
      const id = normalizeToOpenAIToolId(block.id);
      const dangling =
        block.id !== '' &&
        missing.missing.has(normalizeToHistoryToolId(block.id));
      if (dangling || (await this.pairs(owner)).hasResponse(id))
        this.item({
          type: 'function_call',
          call_id: id,
          name: block.name,
          arguments: JSON.stringify(block.parameters),
        });
    }
  }

  private async tool(
    row: IContent,
    owner: RequestScopedContents,
  ): Promise<void> {
    let emitted = false;
    for (const block of row.blocks) {
      if (block.type !== 'tool_response') continue;
      const id = normalizeToOpenAIToolId(block.callId);
      const include =
        this.context.serverSideParentActive === true ||
        (await this.pairs(owner)).hasCall(id);
      if (include) {
        const items = buildOpenAIResponsesInput(
          [{ speaker: 'tool', blocks: [block] }],
          { ...this.context, serverSideParentActive: true },
        );
        for (const item of items) this.item(item);
        emitted = true;
      }
    }
    if (emitted && row.blocks.some((block) => block.type === 'media'))
      this.media(row, false);
  }

  private unsupported(row: IContent): void {
    for (const block of row.blocks) {
      if (block.type !== 'media') continue;
      const category = classifyMediaBlock(block);
      const supported =
        category === 'image' ||
        (category === 'pdf' && this.context.mediaPdfEnabled);
      if (!supported)
        appendFileSync(
          this.unsupportedPath,
          `${JSON.stringify({
            kind: 'unsupported',
            reason: `${category} input is not supported by this protocol and was replaced with a text placeholder`,
            mediaType: category,
          })}\n`,
        );
    }
  }
  private cancelledResponses(missing: DanglingCalls): void {
    const cancelled = [...missing.missing].map(([toolCallId, toolName]) => ({
      toolCallId,
      toolName,
    }));
    const rows =
      SyntheticToolResponseHandler.createSyntheticResponses(cancelled);
    for (const item of buildOpenAIResponsesInput(rows, {
      ...this.context,
      serverSideParentActive: true,
    }))
      this.item(item);
  }

  async write(owner: RequestScopedContents): Promise<void> {
    try {
      await this.writeRows(owner);
    } finally {
      const pairs = this.#pairs;
      this.#pairs = undefined;
      pairs?.close();
    }
  }

  private async writeRows(owner: RequestScopedContents): Promise<void> {
    this.writer.append('[');
    // Synthetic outputs for the stateful parent row itself precede every
    // written row.
    if (this.#dangling?.lastCallRow === this.#skipRows - 1)
      this.cancelledResponses(this.#dangling);
    let index = 0;
    for await (const row of owner.stream()) {
      this.signal?.throwIfAborted();
      this.unsupported(row);
      if (row.speaker === 'human') {
        if (row.blocks.some((block) => block.type === 'media'))
          this.media(row, true);
        else this.text(row);
      } else if (row.speaker === 'ai') await this.assistant(row, owner);
      else await this.tool(row, owner);
      if (index + this.#skipRows === this.#dangling?.lastCallRow)
        this.cancelledResponses(this.#dangling);
      index++;
    }
    this.writer.append(']');
    if (this.#pdfBytes > PDF_AGGREGATE_MAX_BYTES)
      throw new Error(
        `Native PDF input payload (${this.#pdfBytes} bytes) exceeds the allowed ${PDF_AGGREGATE_MAX_BYTES} bytes (50 MB). Reduce the number or size of PDF files.`,
      );
  }
}
