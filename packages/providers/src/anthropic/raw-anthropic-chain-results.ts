/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { normalizeToAnthropicToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { buildToolResponsePayload } from '../utils/toolResponsePayload.js';
import { StreamJsonString, quotedChunks } from '../utils/streamJsonString.js';
import {
  buildAnthropicToolResultContent,
  convertBlockToAnthropicPart,
  type AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';
import type { AnthropicMessageConversionOptions } from './AnthropicMessageConversionOptions.js';
import type { AnthropicRepairRows } from './anthropic-repair-source.js';
import type { AnthropicWirePiece } from './anthropic-wire-media.js';

type Range = { readonly start: number; readonly end: number };
const descriptors = new WeakMap<
  AnthropicMessageBlock,
  () => AsyncGenerator<string>
>();

async function* chainBlocks(
  query: AnthropicRepairRows,
  range: Range,
): AsyncGenerator<ContentBlock> {
  for (let at = range.start; at <= range.end; at++)
    yield* (await query.readAt(at)).blocks;
}

async function hasMedia(
  query: AnthropicRepairRows,
  range: Range,
): Promise<boolean> {
  for await (const block of chainBlocks(query, range))
    if (block.type === 'media') return true;
  return false;
}

async function* prefixText(
  query: AnthropicRepairRows,
  range: Range,
  options: AnthropicMessageConversionOptions,
): AsyncGenerator<string> {
  for await (const block of chainBlocks(query, range)) {
    if (block.type !== 'text' && block.type !== 'code') continue;
    const converted = convertBlockToAnthropicPart(block, 0, false, options);
    if (converted?.type === 'text') yield converted.text;
  }
}

function resultText(
  query: AnthropicRepairRows,
  range: Range,
  options: AnthropicMessageConversionOptions,
  payload: string,
): StreamJsonString {
  return new StreamJsonString(async function* () {
    let leading = true;
    for await (const text of prefixText(query, range, options)) {
      const value = leading ? text.trimStart() : text;
      if (value === '') continue;
      leading = false;
      yield value;
    }
    if (!leading) yield '\n';
    yield leading && payload === '' ? '[empty tool result]' : payload;
  });
}

async function* mediaBytes(
  query: AnthropicRepairRows,
  range: Range,
  options: AnthropicMessageConversionOptions,
): AsyncGenerator<string> {
  for await (const block of chainBlocks(query, range)) {
    if (block.type !== 'media') continue;
    const converted = buildAnthropicToolResultContent(
      '',
      [block],
      options.supportsUrlImages ?? true,
    );
    if (typeof converted !== 'string') yield ',' + JSON.stringify(converted[1]);
  }
}

export async function rawChainResults(
  query: AnthropicRepairRows,
  row: IContent,
  range: Range,
  options: AnthropicMessageConversionOptions,
): Promise<readonly AnthropicMessageBlock[]> {
  const media = await hasMedia(query, range);
  return row.blocks
    .filter((block) => block.type === 'tool_response')
    .map((block) => {
      const payload = buildToolResponsePayload(block, options.config);
      const text = resultText(
        query,
        range,
        options,
        payload.limitMessage
          ? `${payload.result}\n${payload.limitMessage}`
          : payload.result,
      );
      const result: AnthropicMessageBlock = {
        type: 'tool_result',
        tool_use_id: normalizeToAnthropicToolId(block.callId),
        content: '',
        ...(payload.status === 'error' ? { is_error: true } : {}),
      };
      descriptors.set(result, async function* () {
        yield '{"type":"tool_result","tool_use_id":' +
          JSON.stringify(result.tool_use_id) +
          ',"content":';
        if (media) yield '[{"type":"text","text":';
        yield* quotedChunks(text);
        if (media) {
          yield '}';
          yield* mediaBytes(query, range, options);
          yield ']';
        }
        if (payload.status === 'error') yield ',"is_error":true';
        yield '}';
      });
      return result;
    });
}

export async function* rawAnthropicWireBytes(
  pieces: AsyncIterable<AnthropicWirePiece>,
): AsyncGenerator<Uint8Array> {
  for await (const piece of pieces) {
    const descriptor =
      typeof piece === 'string' ? undefined : descriptors.get(piece);
    if (descriptor === undefined)
      yield Buffer.from(
        typeof piece === 'string' ? piece : JSON.stringify(piece),
      );
    else for await (const chunk of descriptor()) yield Buffer.from(chunk);
  }
}
