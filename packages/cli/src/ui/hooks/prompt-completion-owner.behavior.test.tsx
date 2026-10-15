/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo, act } from 'react';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import type { IContent, ModelOutput } from '@vybestack/llxprt-code-core';
import { describe, expect, it, vi, afterEach } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { useCommandCompletion } from './useCommandCompletion.js';

function useOwnedCompletion(owner: Agent, invocationAgent: Agent) {
  const buffer = useTextBuffer({
    initialText: 'Create a guide for',
    initialCursorOffset: 18,
    viewport: { width: 80, height: 20 },
    isValidPath: () => false,
    onChange: () => {},
  });
  const invocation = createMockCommandContext({
    services: {
      agent: invocationAgent,
      config: {
        getEnablePromptCompletion: () => true,
        getUtilityModel: () => 'fake-model',
      },
    },
  });
  const generateContent = useMemo(() => {
    const provider = owner.providerManager.getActiveProvider();
    if (!provider) throw new Error('Fixture provider missing');
    return async (contents: IContent[]): Promise<ModelOutput> => {
      const blocks: IContent['blocks'] = [];
      for await (const chunk of provider.generateChatCompletion(contents))
        blocks.push(...chunk.blocks);
      return { content: { speaker: 'ai', blocks } };
    };
  }, [owner]);
  return useCommandCompletion(
    true,
    buffer,
    owner.workspace.getWorkingDirectory(),
    [],
    invocation,
    false,
    false,
    invocation.services.config ?? undefined,
    generateContent,
  ).promptCompletion;
}

describe('prompt completion ownership', () => {
  const makeOwner = useCommandOwners();
  afterEach(() => vi.useRealTimers());

  it('uses the registered generator and leaves sibling completion usable after disposal', async () => {
    const files = await makeOwner('files');
    const root = files.workspace.getWorkingDirectory();
    const ownerResponses = join(root, 'owner.jsonl');
    const siblingResponses = join(root, 'sibling.jsonl');
    const writeResponse = (path: string, suffix: string) =>
      writeFile(
        path,
        JSON.stringify({
          chunks: [
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: `Create a guide for ${suffix}` }],
            },
          ],
        }) + '\n',
      );
    await writeResponse(ownerResponses, 'registered workspace');
    await writeResponse(siblingResponses, 'sibling workspace');
    process.env.LLXPRT_FAKE_RESPONSES = ownerResponses;
    const owner = await makeOwner('owner');
    process.env.LLXPRT_FAKE_RESPONSES = siblingResponses;
    const sibling = await makeOwner('sibling');
    vi.useFakeTimers();
    const first = renderHook(() => useOwnedCompletion(owner, sibling));
    await act(async () => {
      await advanceTimersByTimeAsync(251);
    });
    expect(first.result.current.text).toBe(
      'Create a guide for registered workspace',
    );
    first.unmount();
    await owner.dispose();
    const second = renderHook(() => useOwnedCompletion(sibling, owner));
    await act(async () => {
      await advanceTimersByTimeAsync(251);
    });
    expect(second.result.current.text).toBe(
      'Create a guide for sibling workspace',
    );
    second.unmount();
  });
});
