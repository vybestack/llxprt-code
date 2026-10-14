/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'bun:test';
import type {
  AgentClientContract,
  ContentGeneratorConfig,
} from '@vybestack/llxprt-code-core';
import { createUiSessionOwner } from '../../__tests__/uiSessionOwner.js';

const createDetachedAutoPromptClientMock = vi.fn();

void vi.mock('../../runtime/autoPromptDetachedClient.js', () => ({
  createDetachedAutoPromptClient: createDetachedAutoPromptClientMock,
}));

const { bindAutoPromptGeneration } = await import('./autoPromptGeneration.js');
type PromptOwner = {
  readonly getProvider: () => string;
  readonly agentClient: AgentClientContract | null | undefined;
  readonly createDetached: () => Promise<AgentClientContract>;
};
const generateAutoPrompt = (
  owner: PromptOwner,
  description: string,
  config: ContentGeneratorConfig | undefined,
): Promise<string> =>
  bindAutoPromptGeneration(
    owner.getProvider,
    () => owner.agentClient,
    owner.createDetached,
    () => config,
  )(description);

async function makeClient(
  text = 'generated prompt',
): Promise<AgentClientContract> {
  const client = (await createUiSessionOwner()).agentClient;
  vi.spyOn(client, 'generateDirectMessage').mockImplementation(async () => ({
    content: { speaker: 'ai', blocks: [{ type: 'text', text }] },
  }));
  vi.spyOn(client, 'dispose');
  return client;
}

async function makeRuntime(
  provider: string,
  client: AgentClientContract | null | undefined,
): Promise<PromptOwner> {
  const session = await createUiSessionOwner();
  return {
    createDetached: () => session.sessionClient.createDetachedAgentClient(),
    getProvider: () => provider,
    agentClient: client,
  };
}

describe('generateAutoPrompt', () => {
  beforeEach(() => {
    createDetachedAutoPromptClientMock.mockReset();
  });

  it('disables tools when generating the subagent prompt', async () => {
    const liveClient = await makeClient('live prompt');
    const detachedClient = await makeClient('expanded system prompt');
    createDetachedAutoPromptClientMock.mockReturnValue(detachedClient);

    await expect(
      generateAutoPrompt(
        await makeRuntime('gemini', liveClient),
        'Review Python code',
        { model: 'auto-prompt-test' },
      ),
    ).resolves.toBe('expanded system prompt');

    expect(detachedClient.generateDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Review Python code'),
        config: expect.objectContaining({
          toolConfig: {
            functionCallingConfig: {
              mode: 'NONE',
            },
          },
        }),
      }),
      'subagent-auto-prompt',
    );
    expect(detachedClient.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses the live client for non-Gemini providers with an initialized client', async () => {
    const client = await makeClient('anthropic prompt');

    await expect(
      generateAutoPrompt(
        await makeRuntime('anthropic', client),
        'Write tests',
        {
          model: 'auto-prompt-test',
        },
      ),
    ).resolves.toBe('anthropic prompt');

    expect(createDetachedAutoPromptClientMock).not.toHaveBeenCalled();
    expect(client.generateDirectMessage).toHaveBeenCalledTimes(1);
    expect(client.generateDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          toolConfig: {
            functionCallingConfig: {
              mode: 'NONE',
            },
          },
        }),
      }),
      'subagent-auto-prompt',
    );
  });

  it('uses an isolated detached client for Gemini providers', async () => {
    const liveClient = await makeClient('live prompt');
    const detachedClient = await makeClient('gemini prompt');
    const runtime = await makeRuntime('gemini', liveClient);
    createDetachedAutoPromptClientMock.mockReturnValue(detachedClient);

    await expect(
      generateAutoPrompt(runtime, 'Plan migration', {
        model: 'auto-prompt-test',
      }),
    ).resolves.toBe('gemini prompt');

    expect(createDetachedAutoPromptClientMock).toHaveBeenCalledWith(
      runtime.createDetached,
      {
        model: 'auto-prompt-test',
      },
    );
    expect(liveClient.generateDirectMessage).not.toHaveBeenCalled();
    expect(detachedClient.generateDirectMessage).toHaveBeenCalledTimes(1);
    expect(detachedClient.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses an isolated detached client when the live client is unavailable', async () => {
    const detachedClient = await makeClient('fallback prompt');
    const runtime = await makeRuntime('anthropic', null);
    createDetachedAutoPromptClientMock.mockReturnValue(detachedClient);

    await expect(
      generateAutoPrompt(runtime, 'No live client', {
        model: 'auto-prompt-test',
      }),
    ).resolves.toBe('fallback prompt');

    expect(createDetachedAutoPromptClientMock).toHaveBeenCalledWith(
      runtime.createDetached,
      {
        model: 'auto-prompt-test',
      },
    );
    expect(detachedClient.generateDirectMessage).toHaveBeenCalledTimes(1);
    expect(detachedClient.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses an isolated detached client when the live client is undefined', async () => {
    const detachedClient = await makeClient('undefined fallback prompt');
    const runtime = await makeRuntime('anthropic', undefined);
    createDetachedAutoPromptClientMock.mockReturnValue(detachedClient);

    await expect(
      generateAutoPrompt(runtime, 'Undefined live client', {
        model: 'auto-prompt-test',
      }),
    ).resolves.toBe('undefined fallback prompt');

    expect(createDetachedAutoPromptClientMock).toHaveBeenCalledWith(
      runtime.createDetached,
      {
        model: 'auto-prompt-test',
      },
    );
    expect(detachedClient.generateDirectMessage).toHaveBeenCalledTimes(1);
    expect(detachedClient.dispose).toHaveBeenCalledTimes(1);
  });

  it('throws when the model returns an empty response', async () => {
    await expect(
      generateAutoPrompt(
        await makeRuntime('anthropic', await makeClient('  ')),
        'Empty',
        {
          model: 'auto-prompt-test',
        },
      ),
    ).rejects.toThrow('Model returned empty response');
  });

  it('throws when no live or detached client is available', async () => {
    createDetachedAutoPromptClientMock.mockReturnValue(undefined);

    await expect(
      generateAutoPrompt(await makeRuntime('gemini', null), 'No clients', {
        model: 'auto-prompt-test',
      }),
    ).rejects.toThrow('Unable to access the AI client');
  });

  it('propagates detached client creation failures', async () => {
    createDetachedAutoPromptClientMock.mockImplementation(() => {
      throw new Error('factory exploded');
    });

    await expect(
      generateAutoPrompt(await makeRuntime('gemini', null), 'Factory failure', {
        model: 'auto-prompt-test',
      }),
    ).rejects.toThrow('factory exploded');
  });

  it('disposes detached clients when generation fails', async () => {
    const detachedClient = await makeClient('unused');
    (
      detachedClient.generateDirectMessage as Mock<
        typeof detachedClient.generateDirectMessage
      >
    ).mockRejectedValueOnce(new Error('network failed'));
    createDetachedAutoPromptClientMock.mockReturnValue(detachedClient);

    await expect(
      generateAutoPrompt(
        await makeRuntime('gemini', await makeClient()),
        'Failure',
        {
          model: 'auto-prompt-test',
        },
      ),
    ).rejects.toThrow('network failed');

    expect(detachedClient.dispose).toHaveBeenCalledTimes(1);
  });
});
