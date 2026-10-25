/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { withOwners } from '../../../../agents/src/api/__tests__/turn-revision-capture.fixture.js';
import { useRecordingPrompts } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  createGenerationProvider,
  type GenerationProvider,
} from '../../../../agents/src/api/__tests__/helpers/generation-provider.js';
import {
  ownerTextGenerator,
  withGenerationClientOwner,
  type GenerationClientOwnerOptions,
  type GenerationClientOwner,
} from '../../../../agents/src/api/__tests__/helpers/generation-client-owner.js';
import { useCliGenerationEnvironment } from '../../__tests__/utility-generation-fixture.js';
import { generateAutoPrompt } from './autoPromptGenerator.js';

const expectedInstruction = (description: string): string =>
  `Generate a detailed system prompt for a subagent with the following purpose:\n\n${description}\n\nRequirements:\n- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior\n- Be specific and actionable\n- Use clear, professional language\n- Output ONLY the system prompt text, no explanations or metadata`;

describe('generateAutoPrompt', () => {
  useRecordingPrompts();
  useCliGenerationEnvironment();
  const credentials = useOwnedCredentials();
  const withPromptOwner = (
    alias: string,
    run: (
      opened: GenerationClientOwner,
      provider: GenerationProvider,
    ) => Promise<void>,
    options: {
      readonly chunks?: readonly string[];
      readonly prepareTokenizer?: GenerationClientOwnerOptions['prepareTokenizer'];
    } = {},
  ): Promise<readonly unknown[]> => {
    const provider = createGenerationProvider({
      alias,
      replies: options.chunks === undefined ? undefined : [options.chunks],
    });
    return withGenerationClientOwner(
      {
        authority: credentials().authority,
        provider,
        prepareTokenizer: options.prepareTokenizer,
      },
      (opened) => run(opened, provider),
    );
  };

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
    const cleanup = await withPromptOwner(
      'generation-local',
      async ({ owner, clients }, provider) => {
        const primary = clients[1];
        expect(
          await generateAutoPrompt('Write tests', ownerTextGenerator(owner)),
        ).toBe('anthropic prompt');
        expect(clients).toHaveLength(2);
        expect(primary.initialized).toBe(1);
        expect(primary.disposed).toBe(0);
        expect(provider.requests).toHaveLength(1);
        expect(provider.requests[0].tools).toStrictEqual([]);
        expect(provider.requests[0].metadata.__logicalRequestId).toBe(
          'subagent-auto-prompt',
        );
      },
      { chunks: ['anthropic ', 'prompt'] },
    );
    expect(cleanup).toStrictEqual([]);
  });

  it('uses an isolated detached client for Gemini providers', async () => {
    const cleanup = await withPromptOwner(
      'gemini',
      async ({ owner, clients }, provider) => {
        expect(
          await generateAutoPrompt('Plan migration', ownerTextGenerator(owner)),
        ).toBe('gemini prompt');
        expect(clients).toHaveLength(3);
        expect(clients[2]).not.toBe(clients[1]);
        expect(clients[2].initialized).toBe(1);
        expect(clients[2].disposed).toBe(1);
        expect(clients[1].disposed).toBe(0);
        expect(provider.requests).toHaveLength(1);
        expect(provider.requests[0].tools).toStrictEqual([]);
        await owner.dispose();
        expect(clients[2].disposed).toBe(1);
      },
      { chunks: ['gemini ', 'prompt'] },
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
    const cleanup = await withPromptOwner(
      'gemini',
      async ({ owner, clients }, provider) => {
        expect(clients).toHaveLength(2);
        expect(
          await generateAutoPrompt(description, ownerTextGenerator(owner)),
        ).toBe(expected);
        expect(clients).toHaveLength(3);
        expect(clients[2].initialized).toBe(1);
        expect(clients[2].disposed).toBe(1);
        expect(clients[1].disposed).toBe(0);
        expect(provider.requests).toHaveLength(1);
      },
      { chunks },
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
    const cleanup = await withPromptOwner(
      'gemini',
      async ({ owner, clients }, provider) => {
        await owner.dispose();
        await expect(
          generateAutoPrompt('No clients', ownerTextGenerator(owner)),
        ).rejects.toThrow('disposed');
        expect(clients).toHaveLength(2);
        expect(provider.requests).toHaveLength(0);
      },
    );
    expect(cleanup).toStrictEqual([]);
  });

  it('propagates detached client creation failures', async () => {
    const cleanup = await withPromptOwner(
      'gemini',
      async ({ owner, clients }, provider) => {
        await expect(
          generateAutoPrompt('Factory failure', ownerTextGenerator(owner)),
        ).rejects.toThrow('factory exploded');
        expect(clients).toHaveLength(2);
        expect(provider.requests).toHaveLength(0);
      },
      {
        prepareTokenizer: async () => {
          throw new Error('factory exploded');
        },
      },
    );
    expect(cleanup).toStrictEqual([]);
  });

  it('disposes detached clients when generation fails', async () => {
    const cleanup = await withPromptOwner(
      'gemini',
      async ({ owner, clients }, provider) => {
        provider.generating = async () => {
          throw new Error('network failed');
        };
        await expect(
          generateAutoPrompt('Failure', ownerTextGenerator(owner)),
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
