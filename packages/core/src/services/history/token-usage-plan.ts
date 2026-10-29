/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NeutralTextStream } from '../../utils/neutral-text-stream.js';
import { estimateTokens } from '../../utils/toolOutputLimiter.js';
import type { JournalResponsePlan } from './journal-response-plan.js';
import type { ContentBlock, IContent } from './IContent.js';
import {
  measureRequestRow,
  serializeRequestRow,
  type RequestRowMeasurement,
  type TokenCountFn,
} from './token-usage-measurement.js';

export async function readTokenUsagePlan(
  plan: JournalResponsePlan,
): Promise<IContent> {
  const blocks: IContent['blocks'] = [];
  for await (const block of plan.openBlocks()) blocks.push(block);
  return { ...plan.header, blocks };
}

export async function* tokenUsagePlanText(
  plan: JournalResponsePlan,
): AsyncGenerator<Uint8Array> {
  if (plan.openCountingBlocks === undefined) {
    yield Buffer.from(serializeRequestRow(await readTokenUsagePlan(plan)));
    return;
  }
  let first = true;
  for await (const block of plan.openCountingBlocks()) {
    if (!first) yield Uint8Array.of(10);
    first = false;
    yield* block.text;
  }
}

function measurementBlock(block: ContentBlock): ContentBlock {
  switch (block.type) {
    case 'tool_call':
      return {
        type: 'tool_call',
        id: block.id,
        name: block.name,
        parameters: {},
      };
    case 'tool_response':
      return {
        type: 'tool_response',
        callId: block.callId,
        toolName: block.toolName,
        result: null,
      };
    default:
      return block;
  }
}

export async function measureTokenUsagePlan(
  plan: JournalResponsePlan,
  countTokens: TokenCountFn,
): Promise<RequestRowMeasurement> {
  if (countTokens !== estimateTokens || plan.openCountingBlocks === undefined)
    return measureRequestRow(await readTokenUsagePlan(plan), countTokens);
  const counter = new NeutralTextStream();
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  let length = 0;
  let tail = '';
  const state = { special: false };
  const append = (part: Uint8Array): void => {
    counter.append(part);
    const text = decoder.decode(part, { stream: true });
    length += text.length;
    const seam = tail + text;
    state.special ||=
      seam.includes('<|endoftext|>') || seam.includes('<|endofprompt|>');
    tail = seam.slice(-14);
  };
  const blocks: IContent['blocks'] = [];
  const toolResults: Array<RequestRowMeasurement['toolResults'][number]> = [];
  for await (const block of plan.openCountingBlocks()) {
    if (blocks.length > 0) append(Uint8Array.of(10));
    blocks.push(measurementBlock(block.content));
    if (block.content.type === 'tool_response')
      toolResults.push(
        ...measureRequestRow(
          { speaker: 'tool', blocks: [block.content] },
          countTokens,
        ).toolResults,
      );
    for await (const part of block.text) append(part);
  }
  length += decoder.decode().length;
  const measurement = measureRequestRow({ ...plan.header, blocks }, () => 0);
  const tokens = counter.finish();
  return {
    ...measurement,
    tokens: state.special ? Math.ceil(length / 3) : tokens,
    toolResults,
  };
}

export async function tokenUsagePlanPrefix(
  plan: JournalResponsePlan,
  budget: number,
): Promise<{ readonly text: string; readonly consumed: number }> {
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  let text = '';
  let consumed = 0;
  const append = (part: string): void => {
    if (text.length < budget) text += part.slice(0, budget - text.length);
    consumed += part.length;
  };
  for await (const part of tokenUsagePlanText(plan))
    append(decoder.decode(part, { stream: true }));
  append(decoder.decode());
  return { text, consumed };
}
