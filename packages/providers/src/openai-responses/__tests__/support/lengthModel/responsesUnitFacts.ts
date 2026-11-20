/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the per-unit stored facts of the OpenAI Responses length
 * model. They are produced by the real input builder in "count mode": the
 * builder's own items are measured, so key order and escaping are whatever it
 * emits. A unit here is a row of the unit stream; media references are
 * replaced by a content-free payload of the declared length first, as the
 * estimator does, so no stored object is read.
 */

import type {
  ContentBlock,
  IContent,
  MediaBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { jsonBytes } from '../../../../__tests__/support/lengthModel/bytes.js';
import {
  buildPdfDisabledNotice,
  buildUnsupportedMediaPlaceholder,
  classifyMediaBlock,
  inlineBase64ByteLength,
  normalizeMediaToDataUri,
  resolvePdfFilename,
} from '../../../../utils/mediaUtils.js';
import {
  buildOpenAIResponsesInput,
  type ResponsesInputBuildContext,
} from '../../../OpenAIResponsesInputBuilder.js';
import { toEstimationContents } from '../../../openAIResponsesRequestState.js';
import type { ResponsesContentPart } from '../../../OpenAIResponsesTypes.js';

export interface ResponsesSettings {
  /** `reasoning.includeInContext` (default true). */
  readonly includeReasoning: boolean;
  /** `media.pdf.enabled` (default true). */
  readonly pdfEnabled: boolean;
  /** The time component of generated reasoning ids: the pinned clock. */
  readonly reasoningIdTime: number;
}

export interface Item {
  readonly kind: 'plain' | 'reasoning' | 'call' | 'output';
  /** JSON bytes of the item, without a generated id for a reasoning item. */
  readonly bytes: number;
  /** Reasoning only: the block carries a genuine server id (already in bytes). */
  readonly genuineId?: boolean;
  /** Call and output: the provider-normalized id. */
  readonly normalizedId?: string;
  /** Call and output: the raw id the row stores. */
  readonly rawId?: string;
  /** Bytes an `input_file` part of this item adds to the PDF aggregate. */
  readonly pdfBytes: number;
}

/** The stored per-unit facts of a Responses row. */
export interface ResponsesUnit {
  readonly speaker: IContent['speaker'];
  readonly items: readonly Item[];
  /** A tool unit's media item: written when at least one output was written. */
  readonly media: Item | undefined;
  readonly callIds: readonly string[];
  readonly responseIds: readonly string[];
}

function buildContext(settings: ResponsesSettings): ResponsesInputBuildContext {
  return {
    includeReasoningInContext: settings.includeReasoning,
    outputLimits: Object.freeze(parseOutputLimits({})),
    debug: (): void => undefined,
    serverSideParentActive: true,
    mediaPdfEnabled: settings.pdfEnabled,
    reasoningIdTime: settings.reasoningIdTime,
  };
}

function mediaPart(
  media: MediaBlock,
  pdfEnabled: boolean,
): ResponsesContentPart {
  const kind = classifyMediaBlock(media);
  if (kind === 'image') {
    return { type: 'input_image', image_url: normalizeMediaToDataUri(media) };
  }
  if (kind === 'pdf') {
    if (!pdfEnabled) {
      return { type: 'input_text', text: buildPdfDisabledNotice(media) };
    }
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

function mediaItem(row: IContent, human: boolean, pdfEnabled: boolean): Item {
  const parts: ResponsesContentPart[] = [];
  let pdfBytes = 0;
  for (const block of row.blocks) {
    const text = block.type === 'text' && human && block.text !== '';
    if (block.type !== 'media' && !text) continue;
    const part: ResponsesContentPart =
      block.type === 'media'
        ? mediaPart(block, pdfEnabled)
        : { type: 'input_text', text: block.text };
    if (part.type === 'input_file') {
      pdfBytes += inlineBase64ByteLength(part.file_data);
    }
    parts.push(part);
  }
  return {
    kind: 'plain',
    bytes: jsonBytes({ role: 'user', content: parts }),
    pdfBytes,
  };
}

/** The text a row writes: human blocks join with a newline, AI blocks run on. */
function textOf(row: IContent): string {
  let text = '';
  let separator = '';
  for (const block of row.blocks) {
    if (block.type !== 'text') continue;
    text += separator + block.text;
    separator = row.speaker === 'human' ? '\n' : '';
  }
  return text;
}

function humanItems(row: IContent, settings: ResponsesSettings): Item[] {
  if (row.blocks.some((block) => block.type === 'media')) {
    return [mediaItem(row, true, settings.pdfEnabled)];
  }
  const text = textOf(row);
  if (text === '') return [];
  return [
    {
      kind: 'plain',
      bytes: jsonBytes({ role: 'user', content: text }),
      pdfBytes: 0,
    },
  ];
}

function reasoningItems(
  row: IContent,
  context: ResponsesInputBuildContext,
): Item[] {
  const items: Item[] = [];
  for (const block of row.blocks) {
    if (block.type !== 'thinking' || !block.encryptedContent) continue;
    const built = buildOpenAIResponsesInput(
      [{ speaker: 'ai', blocks: [block] }],
      context,
    );
    const providerId = block.providerMetadata?.['openai.responses.reasoningId'];
    const genuineId =
      typeof providerId === 'string' && providerId.startsWith('rs');
    for (const item of built) {
      items.push({
        kind: 'reasoning',
        bytes: jsonBytes(item),
        genuineId,
        pdfBytes: 0,
      });
    }
  }
  return items;
}

function callItem(call: ToolCallBlock): Item {
  const normalizedId = normalizeToOpenAIToolId(call.id);
  return {
    kind: 'call',
    normalizedId,
    rawId: call.id,
    bytes: jsonBytes({
      type: 'function_call',
      call_id: normalizedId,
      name: call.name,
      arguments: JSON.stringify(call.parameters),
    }),
    pdfBytes: 0,
  };
}

function aiItems(
  row: IContent,
  settings: ResponsesSettings,
  context: ResponsesInputBuildContext,
): Item[] {
  const items = settings.includeReasoning ? reasoningItems(row, context) : [];
  const text = textOf(row);
  if (text !== '') {
    items.push({
      kind: 'plain',
      bytes: jsonBytes({ role: 'assistant', content: text }),
      pdfBytes: 0,
    });
  }
  for (const block of row.blocks) {
    if (block.type === 'tool_call') items.push(callItem(block));
  }
  return items;
}

function outputItem(
  response: ToolResponseBlock,
  context: ResponsesInputBuildContext,
): Item {
  const built = buildOpenAIResponsesInput(
    [{ speaker: 'tool', blocks: [response] }],
    context,
  );
  if (built.length !== 1) {
    throw new Error('a tool response must build exactly one item');
  }
  return {
    kind: 'output',
    normalizedId: normalizeToOpenAIToolId(response.callId),
    rawId: response.callId,
    bytes: jsonBytes(built[0]),
    pdfBytes: 0,
  };
}

function toolItems(row: IContent, context: ResponsesInputBuildContext): Item[] {
  const blocks: readonly ContentBlock[] = row.blocks;
  return blocks.flatMap((block) =>
    block.type === 'tool_response' ? [outputItem(block, context)] : [],
  );
}

export function responsesUnitFacts(
  raw: IContent,
  settings: ResponsesSettings,
): ResponsesUnit {
  const [row] = toEstimationContents([structuredClone(raw)]);
  const context = buildContext(settings);
  let items: Item[];
  if (row.speaker === 'human') items = humanItems(row, settings);
  else if (row.speaker === 'ai') items = aiItems(row, settings, context);
  else items = toolItems(row, context);
  const media =
    row.speaker === 'tool' && row.blocks.some((block) => block.type === 'media')
      ? mediaItem(row, false, settings.pdfEnabled)
      : undefined;
  return {
    speaker: row.speaker,
    items,
    media,
    callIds: items.flatMap((item) =>
      item.kind === 'call' && item.normalizedId !== undefined
        ? [item.normalizedId]
        : [],
    ),
    responseIds: items.flatMap((item) =>
      item.kind === 'output' && item.normalizedId !== undefined
        ? [item.normalizedId]
        : [],
    ),
  };
}
