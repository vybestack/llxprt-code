/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for accepted issue #3157 review findings.
 *
 * Finding 1 (Blocker-Fix): The re-render port must re-render but never
 * originate. Blank systemInstruction (empty or whitespace) is "missing" per
 * systemPromptPlacement.ts, so the assembler must not be invoked and no prompt
 * may be synthesized — the original invalid value is preserved for the
 * delegate's established fail-fast guard.
 *
 * Finding 2 (In-scope-Fix): Legacy LoadBalancerSubProfile modelId predicates
 * must agree. Whitespace-only modelId means no override for BOTH prompt
 * re-rendering and resolved.model, keeping the parent prompt and model aligned.
 */

import { describe, it, expect } from 'bun:test';
import { optionsWithSelectedModelPrompt } from './selectedModelPrompt.js';
import { resolveSubProfileModel } from './subProfileHelpers.js';
import {
  buildRoundRobinResolvedOptions,
  type OptionsBuildContext,
} from './resolvedOptionsBuilder.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { LoadBalancerSubProfile } from './loadBalancerTypes.js';

const noopLogger = {
  debug: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
} as unknown as import('@vybestack/llxprt-code-core/debug/DebugLogger.js').DebugLogger;

function trackingAssembler(render: (model: string) => string): {
  assembler: { assemble: (model: string) => Promise<string> };
  invocations: string[];
} {
  const invocations: string[] = [];
  return {
    assembler: {
      assemble: async (model: string): Promise<string> => {
        invocations.push(model);
        return render(model);
      },
    },
    invocations,
  };
}

function makeCtx(): OptionsBuildContext {
  return {
    lbProfileEphemeralSettings: undefined,
    lbProfileModelParams: undefined,
    logger: noopLogger,
    providerName: 'load-balancer',
    getEffectiveContextLimit: () => undefined,
  };
}

describe('optionsWithSelectedModelPrompt — blank systemInstruction (issue #3157 review)', () => {
  it('empty-string systemInstruction: assembler not invoked and original value preserved', async () => {
    const { assembler, invocations } = trackingAssembler((m) => `[model=${m}]`);
    const options: GenerateChatOptions = {
      contents: [],
      systemInstruction: '',
      systemPromptAssembler: assembler,
    };

    const result = await optionsWithSelectedModelPrompt(options, 'model-a');

    expect(invocations).toEqual([]);
    expect(result.systemInstruction).toBe('');
  });

  it('whitespace-only systemInstruction: assembler not invoked and original value preserved', async () => {
    const { assembler, invocations } = trackingAssembler((m) => `[model=${m}]`);
    const options: GenerateChatOptions = {
      contents: [],
      systemInstruction: '   ',
      systemPromptAssembler: assembler,
    };

    const result = await optionsWithSelectedModelPrompt(options, 'model-a');

    expect(invocations).toEqual([]);
    expect(result.systemInstruction).toBe('   ');
  });
});

describe('legacy whitespace modelId keeps parent prompt and model aligned (issue #3157 review)', () => {
  it('whitespace-only modelId: parent model inherited, prompt untouched, assembler never invoked', async () => {
    const { assembler, invocations } = trackingAssembler((m) => `[model=${m}]`);
    const parentOptions: GenerateChatOptions = {
      contents: [],
      resolved: { model: 'parent-model' },
      systemInstruction: '[model=parent-model]',
      systemPromptAssembler: assembler,
    };

    const subProfile: LoadBalancerSubProfile = {
      name: 'legacy',
      providerName: 'openai',
      modelId: '   ',
    };

    const selectedModel = resolveSubProfileModel(subProfile);
    const promptOptions = await optionsWithSelectedModelPrompt(
      parentOptions,
      selectedModel,
    );
    const resolved = buildRoundRobinResolvedOptions(
      subProfile,
      promptOptions,
      makeCtx(),
    );

    // Parent model inherited — not overridden with whitespace.
    expect(resolved.resolved?.model).toBe('parent-model');
    // Prompt untouched — still names the parent model.
    expect(resolved.systemInstruction).toBe('[model=parent-model]');
    // Assembler never invoked — no re-render for a whitespace modelId.
    expect(invocations).toEqual([]);
  });
});
