/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Task } from './task.js';
import { RequestContext } from '@a2a-js/sdk/server';
import { fileURLToPath } from 'node:url';
import { createTaskAgent } from '../config/config.js';
import { createTaskRuntime } from './task-runtime.js';

describe('A2A worker data and turn ports', () => {
  it('maps metadata and reads the current model without receiving an Agent or provider manager', () => {
    let model = 'initial';
    const task = new Task('task', 'context', {
      async *stream() {},
      injectSteer: () => undefined,
      getModel: () => model,
      getProvider: () => 'local',
      listTools: () => [
        {
          name: 'read',
          description: 'Read content',
          enabled: true,
          source: 'builtin',
        },
      ],
      listMcpServers: () => [
        {
          name: 'files',
          config: { command: 'local' },
          status: 'connected',
          tools: ['read'],
        },
      ],
      respondToConfirmation: () => undefined,
    });
    expect(task.getMetadata()).toMatchObject({
      model: 'initial',
      mcpServers: [
        {
          name: 'files',
          tools: [{ name: 'read', description: 'Read content' }],
        },
      ],
    });
    model = 'replacement';
    expect(task.getMetadata().model).toBe('replacement');
  });
  it('retains the actual A2A provider response after projecting the public task Agent', async () => {
    const previous = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
        import.meta.url,
      ),
    );
    const agent = await createTaskAgent({}, [], 'port-proof');
    try {
      const port = createTaskRuntime(agent);
      expect(
        ['providerManager', 'agentClient', 'sessionClient', 'dispose'].filter(
          (key) => key in port,
        ),
      ).toStrictEqual([]);
      const task = new Task('port-proof', 'context', port);
      const request = new RequestContext(
        {
          kind: 'message',
          role: 'user',
          messageId: 'request',
          parts: [{ kind: 'text', text: 'Retain the provider response' }],
        },
        'port-proof',
        'context',
      );
      const text: string[] = [];
      const types: string[] = [];
      for await (const event of task.acceptUserMessage(
        request,
        new AbortController().signal,
      )) {
        types.push(event.type);
        if (event.type === 'text') text.push(event.text);
      }
      expect(text.join('')).toContain('a plain text reply');
      expect(types[types.length - 1]).toBe('done');
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previous;
    }
  });
});
