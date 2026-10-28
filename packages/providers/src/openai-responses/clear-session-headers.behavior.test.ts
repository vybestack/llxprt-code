/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgent,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildResponsesHeaders } from './openAIResponsesHttpStream.js';
import { buildWebSocketHandshakeHeaders } from './openAIResponsesRequestDump.js';
import { captureResponsesRequest } from './responses-request.js';
import { buildNormalizedOptions } from './responses-request.test-helpers.js';
import type { ResponsesExecutorDeps } from './openAIResponsesExecutor.js';

/**
 * Two canned model replies. The agents package replays a JSONL fixture through
 * the LLXPRT_FAKE_RESPONSES production seam, so the case drives a real Agent
 * whose invocations carry the live session id.
 */
const FIXTURE_TURNS = [
  {
    chunks: [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'turn one reply' }] },
    ],
  },
  {
    chunks: [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'turn two reply' }] },
    ],
  },
];

async function drain(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('Codex headers after starting a new session', () => {
  let workingDir: string;
  let fixturePath: string;
  let previousFixture: string | undefined;
  const agents: Agent[] = [];

  beforeEach(async () => {
    workingDir = await mkdtemp(join(tmpdir(), 'clear-session-headers-'));
    fixturePath = join(workingDir, 'multi-turn-text.jsonl');
    await writeFile(
      fixturePath,
      FIXTURE_TURNS.map((turn) => JSON.stringify(turn)).join('\n'),
    );
    previousFixture = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fixturePath;
  });

  afterEach(async () => {
    for (const agent of agents.splice(0)) await agent.dispose();
    if (previousFixture === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousFixture;
    await rm(workingDir, { recursive: true, force: true });
  });

  it('uses the new session in real HTTP and WebSocket headers, including after a model change', async () => {
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir,
    });
    agents.push(agent);
    {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'first question' }],
        },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'first answer' }] },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'second question' }],
        },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'second answer' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const oldId = agent.session.getSessionId();
      await agent.session.startNewSession();
      const nextId = agent.session.getSessionId();
      const deps: ResponsesExecutorDeps = {
        providerName: 'openai-responses',
        logger: new DebugLogger('clear-headers-test'),
        isCodexMode: () => true,
        getCodexAccountId: async () => 'account',
        resolveAuthTokenForPrompt: async () => 'token',
        shouldRetryOnError: () => false,
        getUnallowedModelParameters: () => new Set<string>(),
      };
      const original = FakeProvider.prototype.generateChatCompletion;
      const headers: Array<Record<string, string>> = [];
      const capture = spyOn(
        FakeProvider.prototype,
        'generateChatCompletion',
      ).mockImplementation(async function* (this: FakeProvider, options) {
        if (Array.isArray(options) || options.invocation === undefined)
          throw new Error('Expected admitted invocation');
        const request = captureResponsesRequest(
          buildNormalizedOptions({ invocation: options.invocation }),
          'openai-responses',
          'https://example.com',
          undefined,
          'model',
        );
        headers.push(
          await buildResponsesHeaders(
            'token',
            'application/json',
            true,
            request,
            deps,
          ),
        );
        headers.push(
          await buildWebSocketHandshakeHeaders(
            { apiKey: 'token', normalizedOptions: request },
            deps,
          ),
        );
        yield* original.call(this, options);
      });
      try {
        await drain(agent.stream('after clear'));
        await agent.setModel('changed-model');
        await drain(agent.stream('after model change'));
        expect(headers).toHaveLength(4);
        expect(
          headers
            .filter((_, index) => index % 2 === 0)
            .map((header) => header.session_id),
        ).toStrictEqual([nextId, nextId]);
        expect(
          headers
            .filter((_, index) => index % 2 !== 0)
            .map((header) => [header['session-id'], header['thread-id']]),
        ).toStrictEqual([
          [nextId, nextId],
          [nextId, nextId],
        ]);
        expect(
          headers.flatMap((header) => Object.values(header)),
        ).not.toContain(oldId);
        expect(
          headers.flatMap((header) => Object.values(header)),
        ).not.toContain(`${nextId}#client`);
      } finally {
        capture.mockRestore();
      }
    }
  });
});
