/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionCallingConfigMode } from '@google/genai';
import type { AgentClientContract } from '@vybestack/llxprt-code-core';
import type { AutoPromptRuntime } from './autoPromptGenerator.js';

const runWithScopeMock = vi.hoisted(() => vi.fn());
const createDetachedAutoPromptClientMock = vi.hoisted(() => vi.fn());

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeBridge: () => ({
    runWithScope: runWithScopeMock,
  }),
}));

vi.mock('../../runtime/autoPromptDetachedClient.js', () => ({
  createDetachedAutoPromptClient: createDetachedAutoPromptClientMock,
}));

const { generateAutoPrompt } = await import('./autoPromptGenerator.js');

function makeClient(text = 'generated prompt'): AgentClientContract {
  return {
    generateDirectMessage: vi.fn(async () => ({ text })),
    clearTools: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AgentClientContract;
}

function makeRuntime(
  provider: string | undefined,
  client: AgentClientContract | null | undefined,
): AutoPromptRuntime {
  return {
    getProvider: () => provider,
    getAgentClient: () => client,
  } as AutoPromptRuntime;
}

describe('generateAutoPrompt', () => {
  beforeEach(() => {
    runWithScopeMock.mockReset();
    runWithScopeMock.mockImplementation((callback: () => unknown) =>
      callback(),
    );
    createDetachedAutoPromptClientMock.mockReset();
  });

  it('disables tools when generating the subagent prompt', async () => {
    const liveClient = makeClient('live prompt');
    const detachedClient = makeClient('expanded system prompt');
    createDetachedAutoPromptClientMock.mockReturnValue(detachedClient);

    await expect(
      generateAutoPrompt(
        makeRuntime('gemini', liveClient),
        'Review Python code',
      ),
    ).resolves.toBe('expanded system prompt');

    expect(detachedClient.generateDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Review Python code'),
        config: expect.objectContaining({
          serverTools: [],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.NONE,
            },
          },
        }),
      }),
      'subagent-auto-prompt',
    );
    expect(detachedClient.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses runtime scope and live client for non-Gemini providers with an initialized client', async () => {
    const client = makeClient('anthropic prompt');

    await expect(
      generateAutoPrompt(makeRuntime('anthropic', client), 'Write tests'),
    ).resolves.toBe('anthropic prompt');

    expect(runWithScopeMock).toHaveBeenCalledTimes(1);
    expect(createDetachedAutoPromptClientMock).not.toHaveBeenCalled();
    expect(client.generateDirectMessage).toHaveBeenCalledTimes(1);
    expect(client.generateDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          serverTools: [],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.NONE,
            },
          },
        }),
      }),
      'subagent-auto-prompt',
    );
  });

  it('uses an isolated detached client for Gemini providers', async () => {
    const liveClient = makeClient('live prompt');
    const detachedClient = makeClient('gemini prompt');
    const runtime = makeRuntime('gemini', liveClient);
    createDetachedAutoPromptClientMock.mockReturnValue(detachedClient);

    await expect(generateAutoPrompt(runtime, 'Plan migration')).resolves.toBe(
      'gemini prompt',
    );

    expect(runWithScopeMock).not.toHaveBeenCalled();
    expect(createDetachedAutoPromptClientMock).toHaveBeenCalledWith(runtime);
    expect(liveClient.generateDirectMessage).not.toHaveBeenCalled();
    expect(detachedClient.generateDirectMessage).toHaveBeenCalledTimes(1);
    expect(detachedClient.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses an isolated detached client when the live client is unavailable', async () => {
    const detachedClient = makeClient('fallback prompt');
    const runtime = makeRuntime('anthropic', null);
    createDetachedAutoPromptClientMock.mockReturnValue(detachedClient);

    await expect(generateAutoPrompt(runtime, 'No live client')).resolves.toBe(
      'fallback prompt',
    );

    expect(runWithScopeMock).not.toHaveBeenCalled();
    expect(createDetachedAutoPromptClientMock).toHaveBeenCalledWith(runtime);
    expect(detachedClient.generateDirectMessage).toHaveBeenCalledTimes(1);
    expect(detachedClient.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses an isolated detached client when the live client is undefined', async () => {
    const detachedClient = makeClient('undefined fallback prompt');
    const runtime = makeRuntime('anthropic', undefined);
    createDetachedAutoPromptClientMock.mockReturnValue(detachedClient);

    await expect(
      generateAutoPrompt(runtime, 'Undefined live client'),
    ).resolves.toBe('undefined fallback prompt');

    expect(runWithScopeMock).not.toHaveBeenCalled();
    expect(createDetachedAutoPromptClientMock).toHaveBeenCalledWith(runtime);
    expect(detachedClient.generateDirectMessage).toHaveBeenCalledTimes(1);
    expect(detachedClient.dispose).toHaveBeenCalledTimes(1);
  });

  it('falls back to a direct request when runtime scope is unavailable', async () => {
    runWithScopeMock.mockImplementation(() => {
      throw new Error('scope unavailable');
    });
    const client = makeClient('fallback success');

    await expect(
      generateAutoPrompt(makeRuntime('anthropic', client), 'Fallback'),
    ).resolves.toBe('fallback success');

    expect(runWithScopeMock).toHaveBeenCalledTimes(1);
    expect(client.generateDirectMessage).toHaveBeenCalledTimes(1);
  });

  it('falls back to a direct request when runtime scope rejects asynchronously', async () => {
    runWithScopeMock.mockImplementation(() =>
      Promise.reject(new Error('scope rejected')),
    );
    const client = makeClient('async fallback success');

    await expect(
      generateAutoPrompt(makeRuntime('anthropic', client), 'Async reject'),
    ).resolves.toBe('async fallback success');

    expect(runWithScopeMock).toHaveBeenCalledTimes(1);
    expect(client.generateDirectMessage).toHaveBeenCalledTimes(1);
  });

  it('throws when the model returns an empty response', async () => {
    await expect(
      generateAutoPrompt(makeRuntime('anthropic', makeClient('  ')), 'Empty'),
    ).rejects.toThrow('Model returned empty response');
  });

  it('throws when no live or detached client is available', async () => {
    createDetachedAutoPromptClientMock.mockReturnValue(undefined);

    await expect(
      generateAutoPrompt(makeRuntime('gemini', null), 'No clients'),
    ).rejects.toThrow('Unable to access Gemini client');
  });

  it('propagates detached client creation failures', async () => {
    createDetachedAutoPromptClientMock.mockImplementation(() => {
      throw new Error('factory exploded');
    });

    await expect(
      generateAutoPrompt(makeRuntime('gemini', null), 'Factory failure'),
    ).rejects.toThrow('factory exploded');
  });

  it('disposes detached clients when generation fails', async () => {
    const detachedClient = makeClient('unused');
    vi.mocked(detachedClient.generateDirectMessage).mockRejectedValueOnce(
      new Error('network failed'),
    );
    createDetachedAutoPromptClientMock.mockReturnValue(detachedClient);

    await expect(
      generateAutoPrompt(makeRuntime('gemini', makeClient()), 'Failure'),
    ).rejects.toThrow('network failed');

    expect(detachedClient.dispose).toHaveBeenCalledTimes(1);
  });
});
