/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeToolDeclaration } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';

export const OUTPUT_CONFIG = {
  outputs: {
    alpha: 'first value',
    beta: 'second value',
    gamma: 'third value',
    delta: 'fourth value',
  },
};

export function toolCall(
  name: string,
  parameters: Readonly<Record<string, unknown>>,
  id = name,
): ContentBlock {
  return { type: 'tool_call', id, name, parameters };
}

export function emitCall(
  name: keyof typeof OUTPUT_CONFIG.outputs,
  value: string,
): ContentBlock {
  return toolCall(
    'self_emitvalue',
    { emit_variable_name: name, emit_variable_value: value },
    `emit-${name}`,
  );
}

export function nativeEmissions(
  entries: ReadonlyArray<readonly [keyof typeof OUTPUT_CONFIG.outputs, string]>,
): IContent {
  return {
    speaker: 'ai',
    blocks: entries.map(([name, value]) => emitCall(name, value)),
  };
}

export function hermesEmissions(
  entries: ReadonlyArray<readonly [keyof typeof OUTPUT_CONFIG.outputs, string]>,
): IContent {
  const text = entries
    .map(
      ([name, value]) =>
        `<tool_call>\n${JSON.stringify({ name: 'self_emitvalue', arguments: { emit_variable_name: name, emit_variable_value: value } })}\n</tool_call>`,
    )
    .join('\n');
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

export function stopped(text = 'Done.'): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

export function declarationsFrom(
  options: GenerateChatOptions,
): RuntimeToolDeclaration[] {
  if (options.tools === undefined) {
    throw new Error('Expected provider request tool declarations.');
  }
  return options.tools.flatMap((group) => group.functionDeclarations);
}

export async function requestText(
  options: GenerateChatOptions,
): Promise<string> {
  const rows: IContent[] = [];
  for await (const content of options.contents) {
    rows.push(content);
  }
  return rows
    .flatMap((content) => content.blocks)
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type !== 'tool_response') return '';
      return JSON.stringify(block.result);
    })
    .join('\n');
}

export async function findMissingOutputNudge(
  requests: readonly GenerateChatOptions[],
): Promise<GenerateChatOptions> {
  for (const candidate of requests) {
    if ((await requestText(candidate)).includes('not emitted')) {
      return candidate;
    }
  }
  throw new Error('Expected a missing-output nudge request.');
}
