import { fixtureAgentResources } from '../../../../agents/src/api/__tests__/helpers/agent-resource-capture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { withOwners } from '../../../../agents/src/api/__tests__/turn-revision-capture.fixture.js';
import { useRecordingPrompts } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { withGenerationOwner } from '../../../../agents/src/api/__tests__/helpers/generation-owner-fixture.js';
import {
  useCliGenerationEnvironment,
  servePromptChunks,
} from '../../__tests__/utility-generation-fixture.js';
import { generateAutoPrompt } from './autoPromptGenerator.js';

const expectedInstruction = (description: string): string =>
  `Generate a detailed system prompt for a subagent with the following purpose:\n\n${description}\n\nRequirements:\n- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior\n- Be specific and actionable\n- Use clear, professional language\n- Output ONLY the system prompt text, no explanations or metadata`;

describe('generateAutoPrompt', () => {
  useRecordingPrompts();
  useCliGenerationEnvironment();

  it('disables tools when generating the subagent prompt', async () => {
    await withOwners(
      async (agent, _peer, transport) => {
        transport.release();
        agent.setEphemeralSetting('utility-model', 'must-not-be-selected');
        expect(
          await generateAutoPrompt(
            'Review Python code',
            agent.generate.bind(agent),
          ),
        ).toBe('expanded system prompt');
        expect(transport.requests()).toHaveLength(1);
        expect(transport.requests()[0].model).toBe('capture-a');
        expect(transport.requests()[0].tools).toBeUndefined();
        expect(JSON.stringify(transport.requests()[0].messages)).toContain(
          JSON.stringify(expectedInstruction('Review Python code')).slice(
            1,
            -1,
          ),
        );
        expect(await agent.getHistory()).toStrictEqual([]);
      },
      false,
      false,
      0,
      0,
      false,
      413,
      'expanded system prompt',
    );
  });

  it('uses the live client for non-Gemini providers with an initialized client', async () => {
    const cleanup = await withGenerationOwner(
      async (owner, clients, provider) => {
        servePromptChunks(provider, ['anthropic ', 'prompt']);
        const primary = clients[1];
        expect(
          await generateAutoPrompt('Write tests', (input, options) =>
            owner.generate(input, options),
          ),
        ).toBe('anthropic prompt');
        expect(clients).toHaveLength(2);
        expect(primary.initialized).toBe(1);
        expect(primary.disposed).toBe(0);
        expect(provider.requests).toHaveLength(1);
        expect(provider.requests[0].tools).toStrictEqual([]);
        expect(provider.requests[0].metadata?.__logicalRequestId).toBe(
          'subagent-auto-prompt',
        );
      },
      'anthropic',
    );
    expect(cleanup).toStrictEqual([]);
  });

  it('uses an isolated detached client for Gemini providers', async () => {
    const cleanup = await withGenerationOwner(
      async (owner, clients, provider) => {
        servePromptChunks(provider, ['gemini ', 'prompt']);
        expect(
          await generateAutoPrompt('Plan migration', (input, options) =>
            owner.generate(input, options),
          ),
        ).toBe('gemini prompt');
        expect(clients).toHaveLength(3);
        expect(clients[2]).not.toBe(clients[1]);
        expect(clients[2].initialized).toBe(1);
        expect(clients[2].disposed).toBe(1);
        expect(clients[1].disposed).toBe(0);
        expect(provider.requests).toHaveLength(1);
        expect(provider.requests[0].tools).toStrictEqual([]);
        const nativeOwner = fixtureAgentResources(owner)
          .sessionOwners.values()
          .next().value;
        if (nativeOwner === undefined)
          throw new Error('Missing native generation owner');
        await nativeOwner.dispose();
        expect(clients[2].disposed).toBe(1);
      },
    );
    expect(cleanup).toStrictEqual([]);
  });

  it.each([
    [
      'uses an isolated detached client when the live client is unavailable',
      'No live client',
      ['fallback ', 'prompt'],
      'fallback prompt',
    ],
    [
      'uses an isolated detached client when the live client is undefined',
      'Undefined live client',
      ['undefined ', 'fallback prompt'],
      'undefined fallback prompt',
    ],
  ] satisfies ReadonlyArray<
    readonly [string, string, readonly string[], string]
  >)('%s', async (_title, description, chunks, expected) => {
    const cleanup = await withGenerationOwner(
      async (owner, clients, provider) => {
        servePromptChunks(provider, chunks);
        expect(clients).toHaveLength(2);
        expect(
          await generateAutoPrompt(description, (input, options) =>
            owner.generate(input, options),
          ),
        ).toBe(expected);
        expect(clients).toHaveLength(3);
        expect(clients[2].initialized).toBe(1);
        expect(clients[2].disposed).toBe(1);
        expect(clients[1].disposed).toBe(0);
        expect(provider.requests).toHaveLength(1);
      },
    );
    expect(cleanup).toStrictEqual([]);
  });

  it('throws when the model returns an empty response', async () => {
    await withOwners(
      async (agent, _peer, transport) => {
        transport.release();
        await expect(
          generateAutoPrompt('Empty', agent.generate.bind(agent)),
        ).rejects.toThrow('Model returned empty response');
        expect(transport.requests()).toHaveLength(1);
      },
      false,
      false,
      0,
      0,
      false,
      413,
      '  ',
    );
  });

  it('throws when no live or detached client is available', async () => {
    const cleanup = await withGenerationOwner(
      async (owner, clients, provider) => {
        const nativeOwner = fixtureAgentResources(owner)
          .sessionOwners.values()
          .next().value;
        if (nativeOwner === undefined)
          throw new Error('Missing native generation owner');
        await nativeOwner.dispose();
        await expect(
          generateAutoPrompt('No clients', (input, options) =>
            owner.generate(input, options),
          ),
        ).rejects.toThrow('Session client owner is disposed');
        expect(clients).toHaveLength(2);
        expect(provider.requests).toHaveLength(0);
      },
    );
    expect(cleanup).toStrictEqual([]);
  });

  it('propagates detached client creation failures', async () => {
    const cleanup = await withGenerationOwner(
      async (owner, clients, provider) => {
        await expect(
          generateAutoPrompt('Factory failure', (input, options) =>
            owner.generate(input, options),
          ),
        ).rejects.toThrow('factory exploded');
        expect(clients).toHaveLength(2);
        expect(provider.requests).toHaveLength(0);
      },
      'gemini',
      undefined,
      async () => {
        throw new Error('factory exploded');
      },
    );
    expect(cleanup).toStrictEqual([]);
  });

  it('disposes detached clients when generation fails', async () => {
    const cleanup = await withGenerationOwner(
      async (owner, clients, provider) => {
        provider.generating = async () => {
          throw new Error('network failed');
        };
        await expect(
          generateAutoPrompt('Failure', (input, options) =>
            owner.generate(input, options),
          ),
        ).rejects.toThrow('network failed');
        expect(clients[2].initialized).toBe(1);
        expect(clients[2].disposed).toBe(1);
        expect(clients[1].disposed).toBe(0);
        expect(provider.requests).toHaveLength(1);
      },
    );
    expect(cleanup).toStrictEqual([]);
  });
});
