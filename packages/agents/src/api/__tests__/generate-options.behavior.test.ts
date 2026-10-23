/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  ProfileManager,
  type LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import { withOwners } from './turn-revision-capture.fixture.js';
import { useRecordingPrompts } from './helpers/recording-owner-lifetime-fixture.js';
import {
  withGenerationOwner,
  generationGate,
} from './helpers/generation-owner-fixture.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentInput } from '../agent.js';
import { buildAgentFromContent } from './helpers/agentHarness.js';

describe('Agent.generate request options', () => {
  useRecordingPrompts();
  it('translates neutral reasoning and explicit tool declarations without changing caller configuration', async () => {
    const config = {
      reasoning: { budgetTokens: 128, effort: 'low', includeInOutput: false },
      tools: [
        {
          name: 'request_tool',
          description: 'request-owned declaration',
          parametersJsonSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
          },
        },
      ],
    };
    const before = structuredClone(config);
    const cleanup = await withGenerationOwner(
      async (owner, _clients, provider) => {
        expect(await owner.generate('neutral configuration', { config })).toBe(
          'turn one reply',
        );
        expect(provider.requests[0].invocation?.modelBehavior).toMatchObject({
          'reasoning.enabled': true,
          'reasoning.budgetTokens': 128,
          'reasoning.effort': 'low',
        });
        expect(provider.requests[0].invocation?.cliSettings).toMatchObject({
          'reasoning.includeInResponse': false,
        });
        expect(provider.requests[0].tools).toStrictEqual(config.tools);
        expect(config).toStrictEqual(before);
      },
      'fake',
    );
    expect(cleanup).toStrictEqual([]);
  });
  it('preserves configured load-balancer member identity and request-local utility overrides', async () => {
    await withOwners(async (agent, _peer, transport) => {
      const profiles = new ProfileManager();
      await profiles.saveProfile('generation-member', {
        version: 1,
        provider: 'openai',
        model: 'member-model',
        modelParams: { temperature: 0.6, max_tokens: 300 },
        ephemeralSettings: {
          'base-url': transport.url,
          'auth-key': 'turn-capture-local-only',
          'reasoning.enabled': true,
          'reasoning.budgetTokens': 4096,
          'reasoning.enabledWireFormat': 'thinking',
        },
      });
      const profile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
        profiles: ['generation-member'],
        policy: 'roundrobin',
      };
      await agent.profiles.applySnapshot(profile);
      transport.release();
      expect(await agent.generate('member default')).toBe(
        'Transport completed.',
      );
      expect(
        await agent.generate('member utility', {
          model: 'utility-model-x',
          config: {
            temperature: 0.3,
            maxOutputTokens: 16000,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      ).toBe('Transport completed.');
      expect(
        transport.requests().map(({ model, temperature, max_tokens }) => ({
          model,
          temperature,
          max_tokens,
        })),
      ).toStrictEqual([
        { model: 'member-model', temperature: 0.6, max_tokens: 300 },
        { model: 'utility-model-x', temperature: 0.3, max_tokens: 16000 },
      ]);
      expect(
        transport.requests().map((request) => request.thinking),
      ).toStrictEqual([{ type: 'enabled' }, { type: 'disabled' }]);
      expect(await agent.generate('member unchanged')).toBe(
        'Transport completed.',
      );
      expect(transport.requests()[2]).toMatchObject({
        model: 'member-model',
        temperature: 0.6,
        max_tokens: 300,
      });
    });
  });
  it('preserves an explicitly empty prompt ID in the provider request', async () => {
    const cleanup = await withGenerationOwner(
      async (owner, _clients, provider) => {
        expect(await owner.generate('empty ID request', { promptId: '' })).toBe(
          'turn one reply',
        );
        expect(provider.requests[0].metadata?.__logicalRequestId).toBe('');
      },
      'fake',
    );
    expect(cleanup).toStrictEqual([]);
  });
  it('owns nested input and configuration before held Gemini acquisition and preserves the prompt ID and supported request fields', async () => {
    const entered = generationGate();
    const held = generationGate();
    const input = { text: 'admitted input' };
    const config = {
      temperature: 0.3,
      topP: 0.8,
      topK: 12,
      maxOutputTokens: 16000,
      thinkingConfig: { thinkingBudget: 0 },
      toolConfig: {
        functionCallingConfig: {
          mode: 'NONE',
          allowedFunctionNames: ['read_file'],
        },
      },
      systemInstruction: 'admitted system instruction',
    };
    const cleanup = await withGenerationOwner(
      async (owner, _clients, provider) => {
        const pending = owner.generate(input, {
          config,
          model: 'utility-model-x',
          promptId: 'subagent-auto-prompt',
        });
        await entered.promise;
        input.text = 'later input mutation';
        config.thinkingConfig.thinkingBudget = 900;
        config.toolConfig.functionCallingConfig.allowedFunctionNames.push(
          'write_file',
        );
        config.temperature = 0.9;
        held.release();
        expect(await pending).toBe('turn one reply');
        const request = provider.requests[0];
        expect(request.resolved?.model).toBe('utility-model-x');
        expect(request.invocation?.modelParams).toMatchObject({
          temperature: 0.3,
          top_p: 0.8,
          top_k: 12,
        });
        expect(request.modelParameters?.genericMaxOutputTokens).toBe(16000);
        expect(request.invocation?.modelBehavior['reasoning.enabled']).toBe(
          false,
        );
        expect(request.tools).toStrictEqual([]);
        expect(request.systemInstruction).toBe('admitted system instruction');
        expect(request.metadata?.__logicalRequestId).toBe(
          'subagent-auto-prompt',
        );
        expect(request.metadata?.geminiDirectOverrides).toStrictEqual({
          toolConfig: {
            functionCallingConfig: {
              mode: 'NONE',
              allowedFunctionNames: ['read_file'],
            },
          },
        });
        expect(request.contents.map((turn) => turn.blocks)).toStrictEqual([
          [{ type: 'text', text: 'admitted input' }],
        ]);
        expect(input.text).toBe('later input mutation');
        expect(config.temperature).toBe(0.9);
      },
      'gemini',
      undefined,
      async () => {
        entered.release();
        await held.promise;
      },
    );
    expect(cleanup).toStrictEqual([]);
  });

  const forms: AgentInput[] = [
    'normalized input',
    { text: 'normalized input' },
    [{ text: 'normalized input' }].map(
      ({ text }): ContentBlock => ({ type: 'text', text }),
    ),
    [{ type: 'text', text: 'normalized input' }],
    { speaker: 'human', blocks: [{ type: 'text', text: 'normalized input' }] },
    [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'normalized input' }],
      },
    ],
  ];
  it.each(forms)(
    'normalizes supplied input without fabricating history %j',
    async (input) => {
      const cleanup = await withGenerationOwner(
        async (owner, _clients, provider) => {
          expect(await owner.generate(input, undefined)).toBe('turn one reply');
          expect(
            provider.requests[0].contents.map(({ speaker, blocks }) => ({
              speaker,
              blocks,
            })),
          ).toStrictEqual([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'normalized input' }],
            },
          ]);
        },
        'fake',
      );
      expect(cleanup).toStrictEqual([]);
    },
  );

  it('preserves supplied human, AI and tool turns in their original order', async () => {
    const input: AgentInput = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'human boundary' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'original-call',
            name: 'read_file',
            parameters: { path: 'x' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'original-call',
            toolName: 'read_file',
            result: 'original result',
          },
        ],
      },
    ];
    const cleanup = await withGenerationOwner(
      async (owner, _clients, provider) => {
        await owner.generate(input, undefined);
        expect(
          provider.requests[0].contents.map(({ speaker, blocks }) => ({
            speaker,
            blocks,
          })),
        ).toStrictEqual([...input]);
      },
      'fake',
    );
    expect(cleanup).toStrictEqual([]);
  });

  it('does not acquire or request for empty input and does not execute tool-only output', async () => {
    const cleanup = await withGenerationOwner(
      async (owner, clients, provider) => {
        expect(await owner.generate([], { writeHistory: true })).toBe('');
        expect(provider.requests).toStrictEqual([]);
        expect(clients).toHaveLength(2);
      },
    );
    expect(cleanup).toStrictEqual([]);
    const built = await buildAgentFromContent(
      JSON.stringify({
        chunks: [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'must-not-run',
                name: 'list_directory',
                parameters: { path: '.' },
              },
            ],
          },
        ],
      }),
    );
    try {
      let updates = 0;
      const unsubscribe = built.agent.tools.onToolUpdate(() => {
        updates += 1;
      });
      expect(await built.agent.generate('Return only a tool call')).toBe('');
      expect(updates).toBe(0);
      unsubscribe();
      expect(await built.agent.getHistory()).toStrictEqual([]);
    } finally {
      await built.cleanup();
    }
  });

  it('routes utility overrides on the HTTP wire without changing the selected model or concurrent default request', async () => {
    await withOwners(
      async (agent, _peer, transport) => {
        agent.setModelParam('max_tokens', 300);
        agent.setEphemeralSetting('reasoning.enabled', true);
        agent.setEphemeralSetting('reasoning.budgetTokens', 4096);
        agent.setEphemeralSetting('reasoning.enabledWireFormat', 'thinking');
        const pending = agent.generate('Complete the prompt', {
          model: 'utility-model-x',
          config: {
            temperature: 0.3,
            maxOutputTokens: 16000,
            thinkingConfig: { thinkingBudget: 0 },
          },
          readHistory: false,
          writeHistory: false,
        });
        await transport.entered;
        const normal = agent.generate('A concurrent default');
        transport.release();
        expect(await pending).toBe('a sufficiently long prompt continuation');
        expect(await normal).toBe('a sufficiently long prompt continuation');
        expect(
          transport.requests().map(({ model, temperature, max_tokens }) => ({
            model,
            temperature,
            max_tokens,
          })),
        ).toStrictEqual([
          { model: 'utility-model-x', temperature: 0.3, max_tokens: 16000 },
          { model: 'capture-a', temperature: 0.2, max_tokens: 300 },
        ]);
        expect(
          transport.requests().map((request) => request.thinking),
        ).toStrictEqual([{ type: 'disabled' }, { type: 'enabled' }]);
        expect(agent.getModel()).toBe('capture-a');
      },
      false,
      false,
      1,
      0,
      false,
      413,
      'a sufficiently long prompt continuation',
    );
  });

  it('preserves zero sampling and disables actual request tools for the full autoprompt instruction', async () => {
    await withOwners(async (agent, _peer, transport) => {
      transport.release();
      agent.setEphemeralSetting('utility-model', 'different-utility');
      const instruction = `Generate a detailed system prompt for a subagent with the following purpose:

Review Python code

Requirements:
- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior
- Be specific and actionable
- Use clear, professional language
- Output ONLY the system prompt text, no explanations or metadata`;
      expect(
        await agent.generate(instruction, {
          promptId: 'subagent-auto-prompt',
          config: {
            temperature: 0,
            toolConfig: { functionCallingConfig: { mode: 'NONE' } },
          },
          readHistory: false,
          writeHistory: false,
        }),
      ).toBe('Transport completed.');
      const [request] = transport.requests();
      expect(request.model).toBe('capture-a');
      expect(request.temperature).toBe(0);
      expect(request.tools).toBeUndefined();
      expect(JSON.stringify(request.messages)).toContain(
        JSON.stringify(instruction),
      );
      expect(await agent.getHistory()).toStrictEqual([]);
    });
  });
});
