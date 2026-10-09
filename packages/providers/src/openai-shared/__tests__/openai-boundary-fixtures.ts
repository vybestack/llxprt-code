/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../../IProvider.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { OpenAIProvider } from '../../openai/OpenAIProvider.js';
import { OpenAIVercelProvider } from '../../openai-vercel/OpenAIVercelProvider.js';

export type BoundaryProvider = 'openai' | 'openai-vercel';
export const schema = {
  type: 'object',
  properties: {
    nested: {
      type: 'object',
      properties: {
        value: { type: ['string', 'null'], description: 'Nullable value' },
        choice: {
          anyOf: [{ type: 'string', minLength: 2 }, { type: 'null' }],
        },
        constrained: { allOf: [{ type: 'string' }, { maxLength: 4 }] },
      },
      required: ['value', 'choice', 'constrained'],
      additionalProperties: false,
    },
    alternate: {
      anyOf: [
        {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
  },
  required: ['nested', 'alternate'],
  additionalProperties: false,
};
export const tools: ToolDeclaration[] = [
  {
    name: 'inspect_values',
    description: 'Inspect values',
    parametersJsonSchema: schema,
  },
];
export function textAt(index: number, padding: number): string {
  return `row-${index}:"\\\n雪🧪:${'x'.repeat(padding)}`;
}
export function optionsFor(
  name: BoundaryProvider,
  contents: AsyncIterable<IContent>,
  declarations: ToolDeclaration[] | undefined,
): GenerateChatOptions {
  const settings = new SettingsService();
  const providerName = name === 'openai' ? 'openai' : 'openaivercel';
  settings.set('auth-key', 'boundary-key');
  settings.set('prompt-caching', 'off');
  settings.setProviderSetting(providerName, 'model', 'gpt-4o');
  const streaming = name === 'openai' ? 'disabled' : 'enabled';
  settings.setProviderSetting(providerName, 'streaming', streaming);
  const config = createRuntimeConfigStub(settings);
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: `boundary-${name}`,
    config,
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName,
    ephemeralsSnapshot: { 'prompt-caching': 'off', streaming, retries: 1 },
  });
  return {
    ...createProviderCallOptions({
      providerName,
      settings,
      runtime,
      config,
      invocation,
      contents,
      systemInstruction: 'Inspect rows.',
      tools: declarations,
    }),
    contents,
  };
}
export function providerFor(
  name: BoundaryProvider,
): OpenAIProvider | OpenAIVercelProvider {
  return name === 'openai'
    ? new OpenAIProvider('boundary-key', 'https://boundary.invalid/v1')
    : new OpenAIVercelProvider('boundary-key', 'https://boundary.invalid/v1');
}
export function responseFor(name: BoundaryProvider): Response {
  if (name === 'openai-vercel')
    return new Response(
      'data: {"id":"boundary","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"}}]}\n\ndata: {"id":"boundary","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  return Response.json({
    id: 'boundary',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}
