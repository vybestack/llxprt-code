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
  return structuredClone([
    ...rows.slice(0, lastCall + 1),
    ...synthetic,
    ...rows.slice(lastCall + 1),
  ]);
}
import {
  cachedOracle,
  type StripPolicy,
} from '../../anthropic/message-table/__tests__/support/wireBuilderHarness.js';
import { getMaxTokensForModel } from '../../anthropic/AnthropicModelData.js';
import { resolveAnthropicImageBudget } from '../../anthropic/AnthropicImageSanitizer.js';
import { recordBody, type CaseOutcome } from './frozenWire/frozenSend.js';
import type { FrozenFormat, FrozenSettings } from './frozenWire/frozenCases.js';

function stripPolicy(value: unknown): StripPolicy | undefined {
  if (value === 'none' || value === 'all' || value === 'allButLast')
    return value;
  return undefined;
}

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

function referenceAnthropicBody(
  settings: FrozenSettings,
  rows: readonly IContent[],
): string {
  const ephemerals = settings.ephemerals;
  const system = settings.systemInstruction ?? 'test system prompt';
  const cache = settings.providerSettings['prompt-caching'];
  const messages = cachedOracle(
    rows,
    {
      reasoningEnabled: ephemerals['reasoning.enabled'] === true,
      strip: stripPolicy(ephemerals['reasoning.stripFromContext']),
      includeInContext:
        typeof ephemerals['reasoning.includeInContext'] === 'boolean'
          ? ephemerals['reasoning.includeInContext']
          : undefined,
      currentModel: settings.model,
      currentBaseURL: 'https://api.anthropic.com',
      supportsUrlImages: true,
      imageBudget: resolveAnthropicImageBudget(ephemerals),
    },
    {
      ...(cache === '5m' || cache === '1h' ? { ttl: cache } : {}),
      mediaPurge:
        ephemerals['media.semantic-purge'] === 'remove' ||
        ephemerals['media.semantic-purge'] === 'summary',
    },
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
