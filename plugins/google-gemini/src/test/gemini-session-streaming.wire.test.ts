/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { GeminiProvider } from '../gemini/GeminiProvider.js';
import { createProviderCallOptions } from './testSupport.js';

it('uses the admitted session streaming policy rather than provider configuration', async () => {
  const routes: string[] = [];
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      const streaming =
        request.url?.includes(':streamGenerateContent') === true;
      routes.push(streaming ? 'stream' : 'single');
      const body = JSON.stringify({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'done' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      });
      response.writeHead(200, {
        'content-type': streaming ? 'text/event-stream' : 'application/json',
      });
      response.end(streaming ? `data: ${body}\n\n` : body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const left = new SettingsService();
  const right = new SettingsService();
  const leftOwner = new SessionSettingsOwner(left);
  const rightOwner = new SessionSettingsOwner(right);
  try {
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing loopback address');
    const provider = new GeminiProvider(
      'loopback-key',
      `http://127.0.0.1:${address.port}`,
    );
    for (const store of [left, right])
      store.setProviderSetting('gemini', 'model', 'gemini-2.5-pro');
    left.set('streaming', 'disabled');
    right.set('streaming', 'enabled');
    const leftInvocation = leftOwner.prepareProviderInvocation(
      'same-label',
      'gemini',
    );
    left.set('streaming', 'enabled');
    for (const [store, invocation] of [
      [left, leftInvocation],
      [right, rightOwner.prepareProviderInvocation('same-label', 'gemini')],
    ] as const) {
      const output = [];
      for await (const content of provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: 'gemini',
          settings: store,
          invocation,
          systemInstruction: 'Answer briefly.',
          contents: [
            { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
          ],
        }),
      ))
        output.push(content);
      expect(
        output.some((content) =>
          content.blocks.some(
            (block) => block.type === 'text' && block.text === 'done',
          ),
        ),
      ).toBe(true);
    }
    expect(routes).toEqual(['single', 'stream']);
  } finally {
    leftOwner.dispose();
    rightOwner.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
