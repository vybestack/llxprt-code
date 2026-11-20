/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { buildMessagesWithReasoning } from '../../openai/OpenAIRequestBuilder.js';
import { buildOpenAIResponsesInput } from '../../openai-responses/OpenAIResponsesInputBuilder.js';

import {
  buildAnthropicNativeReasoningConfig,
  readAnthropicReasoningSettings,
} from '../../anthropic/anthropic-reasoning-config.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';

function referenceResponsesRows(rows: readonly IContent[]): IContent[] {
  const calls = rows.flatMap((row) =>
    row.speaker === 'ai'
      ? row.blocks.filter((block) => block.type === 'tool_call')
      : [],
  );
  const responses = new Set(
    rows.flatMap((row) =>
      row.speaker === 'tool'
        ? row.blocks
            .filter((block) => block.type === 'tool_response')
            .map((block) => normalizeToHistoryToolId(block.callId))
        : [],
    ),
  );
  const missing = [
    ...new Set(
      calls
        .filter((call) => call.id !== '')
        .map((call) => normalizeToHistoryToolId(call.id)),
    ),
  ].filter((id) => !responses.has(id));
  const lastCall = rows.reduce(
    (last, row, index) =>
      row.speaker === 'ai' &&
      row.blocks.some((block) => block.type === 'tool_call')
        ? index
        : last,
    -1,
  );
  const names = new Map(
    lastCall < 0
      ? []
      : rows[lastCall].blocks.flatMap((block) =>
          block.type === 'tool_call' && block.name !== ''
            ? [[normalizeToHistoryToolId(block.id), block.name]]
            : [],
        ),
  );
  const synthetic: IContent[] = missing.map((callId) => ({
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName: names.get(callId) ?? 'unknown',
        result: 'Tool execution cancelled by user',
        error: 'Cancelled by user',
      },
    ],
  }));
  const original = rows.map((row) =>
    row.speaker !== 'ai' || responses.has(normalizeToHistoryToolId(''))
      ? row
      : {
          ...row,
          blocks: row.blocks.filter(
            (block) => block.type !== 'tool_call' || block.id !== '',
          ),
        },
  );
  return structuredClone([
    ...original.slice(0, lastCall + 1),
    ...synthetic,
    ...original.slice(lastCall + 1),
  ]);
}
import { frozenSettingsInputs } from '../../anthropic/__tests__/wire-reference/support/lengthModel/frozenInputs.js';
import { policyOf } from '../../anthropic/__tests__/wire-reference/support/lengthModel/lengthChecks.js';
import { referenceRun } from '../../anthropic/__tests__/wire-reference/support/lengthModel/referenceFinish.js';
import {
  unitFacts,
  unitOf,
  type UnitFact,
} from '../../anthropic/__tests__/wire-reference/support/lengthModel/unitFacts.js';
import {
  conversionOptions,
  type WireSettings,
} from '../../anthropic/__tests__/wire-reference/support/wireBuilderHarness.js';
import { getMaxTokensForModel } from '../../anthropic/AnthropicModelData.js';
import { recordBody, type CaseOutcome } from './frozenWire/frozenSend.js';
import type { FrozenFormat, FrozenSettings } from './frozenWire/frozenCases.js';

export function referenceSeedBody(
  format: FrozenFormat,
  settings: FrozenSettings,
  rows: readonly IContent[],
): string {
  const system = settings.systemInstruction ?? 'test system prompt';
  const ephemerals = settings.ephemerals;
  if (format.family === 'chat') {
    let toolFormat: 'kimi' | 'mistral' | 'openai' = 'openai';
    if (format.id === 'openai-chat-kimi') toolFormat = 'kimi';
    if (format.id === 'openai-chat-mistral') toolFormat = 'mistral';
    const messages = buildMessagesWithReasoning(
      structuredClone([...rows]),
      { invocation: { ephemerals } },
      toolFormat,
      parseOutputLimits(ephemerals),
    );
    return JSON.stringify({
      model: settings.model,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: false,
      ...(toolFormat === 'kimi'
        ? { prompt_cache_key: 'wire-body-golden.openai-chat-kimi' }
        : {}),
    });
  }
  if (format.family === 'responses') {
    const input = buildOpenAIResponsesInput(referenceResponsesRows(rows), {
      includeReasoningInContext:
        ephemerals['reasoning.includeInContext'] !== false,
      outputLimits: parseOutputLimits(ephemerals),
      debug: (): void => undefined,
      mediaPdfEnabled: ephemerals['media.pdf.enabled'] !== false,
    });
    return JSON.stringify({
      model: settings.model,
      input,
      stream: true,
      instructions: system,
    });
  }
  return referenceAnthropicBody(settings, rows);
}

function referenceBlockOrder(block: IContent['blocks'][number]): number {
  if (block.type === 'thinking' && block.sourceField === 'thinking') return 0;
  if (block.type === 'text' || block.type === 'code') return 1;
  return block.type === 'tool_call' ? 3 : 2;
}

function referenceAnthropicUnits(
  rows: readonly IContent[],
  settings: WireSettings,
): UnitFact[] {
  const units = unitFacts(rows, settings);
  const output: UnitFact[] = [];
  for (let index = 0; index < units.length; index++) {
    let end = index;
    if (units[index].chainStart) {
      while (end + 1 < units.length && units[end + 1].speaker === 'ai') end++;
    }
    const chain = units.slice(index, end + 1);
    if (end > index && chain.some((unit) => unit.hasResponses)) {
      const blocks = chain.flatMap((unit) => unit.row.blocks);
      const merged: IContent = {
        ...units[end].row,
        blocks: [0, 1, 2, 3].flatMap((category) =>
          blocks.filter((block) => referenceBlockOrder(block) === category),
        ),
      };
      output.push(
        unitOf(output.length, merged, settings, conversionOptions(settings)),
      );
      index = end;
    } else {
      output.push({ ...units[index], index: output.length });
    }
  }
  return output;
}

function referenceAnthropicBody(
  settings: FrozenSettings,
  rows: readonly IContent[],
): string {
  const ephemerals = settings.ephemerals;
  const system = settings.systemInstruction ?? 'test system prompt';
  const cache = settings.providerSettings['prompt-caching'];
  const inputs = frozenSettingsInputs(settings);
  const messages = referenceRun(
    referenceAnthropicUnits(rows, inputs.wire),
    policyOf(inputs.wire),
    inputs.wire,
    inputs.cache,
  ).json;
  const systemValue =
    cache === '5m' || cache === '1h'
      ? [
          {
            type: 'text',
            text: system,
            cache_control: { type: 'ephemeral', ttl: cache },
          },
        ]
      : system;
  const reasoning = buildAnthropicNativeReasoningConfig({
    settings: readAnthropicReasoningSettings(
      {},
      { enabled: ephemerals['reasoning.enabled'] },
    ),
    modelParams: {},
    model: settings.model,
    providerName: 'anthropic',
    logger: new DebugLogger('native-seed-reference'),
  });
  const suffix = JSON.stringify({
    system: systemValue,
    ...(reasoning.thinking === undefined
      ? {}
      : { thinking: reasoning.thinking }),
    ...(reasoning.outputConfig === undefined
      ? {}
      : { output_config: reasoning.outputConfig }),
  }).slice(1);
  return `{"model":${JSON.stringify(settings.model)},"messages":${messages},"max_tokens":${getMaxTokensForModel(settings.model)},"stream":false,${suffix}`;
}

export function referenceSeedOutcome(
  format: FrozenFormat,
  settings: FrozenSettings,
  rows: readonly IContent[],
): CaseOutcome {
  try {
    return recordBody(
      Buffer.from(referenceSeedBody(format, settings, rows)),
      format.historyMember,
    );
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}
