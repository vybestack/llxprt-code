/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { readJournalFileFacts } from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';
import { SessionLockManager } from '@vybestack/llxprt-code-core/recording/SessionLockManager.js';
import { send, type WholeProductFixture } from './whole-product-fixture.js';
import {
  activePath,
  nativeRows,
  recordingArtifacts,
} from './whole-product-observer.js';

interface ChildObservation {
  readonly path: string;
  readonly id: string;
  readonly count: number;
}

async function observeChild(parent: string): Promise<ChildObservation> {
  const chats = dirname(parent);
  const children = [];
  for (const name of await readdir(chats)) {
    if (!name.endsWith('.llxj')) continue;
    const path = join(chats, name);
    const found = await readJournalFileFacts(path);
    if (found?.facts.start.kind === 'subagent') children.push({ path, found });
  }
  expect(children).toHaveLength(1);
  const child = children[0];
  const id = child.found.facts.sessionId;
  expect(child.found.facts).toMatchObject({
    provider: 'openai',
    model: 'w24-child-model',
    start: { parentSessionId: 'w24-source', kind: 'subagent' },
  });
  expect(id).not.toBe('w24-source');
  expect(child.path).not.toBe(parent);
  expect(await SessionLockManager.isLocked(chats, id)).toBe(true);
  const rows = await nativeRows(child.path);
  expect(rows.length).toBe(child.found.rows);
  return { path: child.path, id, count: rows.length };
}

function response(root: string, tool: boolean): string {
  const delta = tool
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'child-receipt',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                file_path: join(root, 'child-receipt.txt'),
                content: 'child execution receipt\n',
              }),
            },
          },
        ],
      }
    : { role: 'assistant', content: 'Child receipt complete.' };
  return (
    [
      {
        id: 'w24-child-response',
        object: 'chat.completion.chunk',
        model: 'w24-child-model',
        choices: [{ index: 0, delta, finish_reason: null }],
      },
      {
        id: 'w24-child-response',
        object: 'chat.completion.chunk',
        choices: [
          { index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' },
        ],
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  );
}

async function childServer(
  root: string,
  parent: string,
): Promise<{
  url: string;
  observations: ChildObservation[];
  errors: unknown[];
  close(): Promise<void>;
}> {
  const observations: ChildObservation[] = [];
  const errors: unknown[] = [];
  const server = createServer((request, reply) => {
    void (async (): Promise<void> => {
      expect(request.url).toBe('/v1/chat/completions');
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const parsed = z
        .object({
          model: z.string(),
          messages: z.array(z.object({ role: z.string() }).passthrough()),
        })
        .parse(JSON.parse(body));
      expect(parsed.model).toBe('w24-child-model');
      const observation = await observeChild(parent);
      observations.push(observation);
      if (observations.length === 2) {
        expect(parsed.messages.some((message) => message.role === 'tool')).toBe(
          true,
        );
        const rows = await nativeRows(observation.path);
        expect(rows.map((row) => row.speaker)).toStrictEqual([
          'human',
          'ai',
          'tool',
        ]);
        const calls = rows.flatMap((row) =>
          row.blocks.filter((block) => block.type === 'tool_call'),
        );
        const results = rows.flatMap((row) =>
          row.blocks.filter((block) => block.type === 'tool_response'),
        );
        expect(calls.map((block) => block.name)).toStrictEqual(['write_file']);
        expect(
          results.map((block) => ({
            id: block.callId,
            name: block.toolName,
            error: block.error,
          })),
        ).toStrictEqual(
          calls.map((block) => ({
            id: block.id,
            name: block.name,
            error: undefined,
          })),
        );
      }
      reply.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.end(response(root, observations.length === 1));
    })().catch((error: unknown) => {
      errors.push(error);
      reply.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing child transport address');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    observations,
    errors,
    close: async (): Promise<void> => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function runChild(
  fixture: WholeProductFixture,
  parent: string,
): Promise<void> {
  const server = await childServer(fixture.root, parent);
  const priorResponses = process.env.LLXPRT_FAKE_RESPONSES;
  const browserWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    await fixture.live.workspace.profileWrites.saveProfile('w24-child', {
      version: 1,
      provider: 'openai',
      model: 'w24-child-model',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'local-test-key',
        'base-url': server.url,
      },
    });
    await fixture.live.workspace.subagentWrites.saveSubagent(
      'w24-child',
      'w24-child',
      'Create the requested receipt and report completion.',
    );
    delete process.env.LLXPRT_FAKE_RESPONSES;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: undefined,
    });
    const events = await send(
      fixture.live,
      'Delegate the separate child receipt to w24-child.',
    );
    expect(server.errors).toStrictEqual([]);
    expect(
      events
        .filter((event) => event.type === 'tool-call')
        .map((event) => event.call.name),
    ).toContain('task');
    const results = events
      .filter((event) => event.type === 'tool-result')
      .filter((event) => event.result.name === 'task');
    expect(results).toHaveLength(1);
    expect(results[0].result.isError === true).toBe(false);
    expect(
      await readFile(join(fixture.root, 'child-receipt.txt'), 'utf8'),
    ).toBe('child execution receipt\n');
    expect(server.observations).toHaveLength(2);
    const child = server.observations[1];
    expect(child.count).toBeGreaterThan(server.observations[0].count);
    expect(existsSync(child.path)).toBe(false);
    expect(await SessionLockManager.isLocked(dirname(parent), child.id)).toBe(
      false,
    );
    expect(
      await activePath(fixture.live, fixture.clientFor(fixture.live)),
    ).toBe(parent);
    await recordingArtifacts(parent);
    await writeFile(
      join(fixture.root, 'child-proof.json'),
      JSON.stringify(
        {
          pid: process.pid,
          parent,
          observations: server.observations,
          released: !existsSync(child.path),
        },
        null,
        2,
      ),
    );
  } finally {
    if (priorResponses === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = priorResponses;
    if (browserWindow === undefined)
      Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', browserWindow);
    await server.close();
  }
}
