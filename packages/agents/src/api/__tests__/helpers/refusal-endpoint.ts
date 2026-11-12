/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalMode, createAgent } from '@vybestack/llxprt-code-agents';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { Storage } from '@vybestack/llxprt-code-settings';
import { drain } from './agentHarness.js';

const PROMPT_TOKENS = 120;

/** What the local OpenAI-compatible endpoint answers to one request. */
export type EndpointReply =
  | {
      readonly kind: 'finish';
      readonly finishReason: string;
      readonly text?: string;
      readonly outputTokens: number;
    }
  | {
      readonly kind: 'todo-write';
      readonly content: string;
    };

/** An answer that ends normally with the given text. */
export function stopReply(text: string): EndpointReply {
  return { kind: 'finish', finishReason: 'stop', text, outputTokens: 12 };
}

/** Anthropic-shaped refusal: no content, a refusal finish reason, no output. */
export function emptyRefusalReply(): EndpointReply {
  return { kind: 'finish', finishReason: 'refusal', outputTokens: 0 };
}

/** A refusal that streamed visible text before ending with the refusal reason. */
export function textRefusalReply(text: string): EndpointReply {
  return { kind: 'finish', finishReason: 'refusal', text, outputTokens: 6 };
}

/** An empty answer ending with the given non-refusal finish reason. */
export function emptyFinishReply(finishReason: string): EndpointReply {
  return { kind: 'finish', finishReason, outputTokens: 0 };
}

/** A task-list write that leaves one pending item, so a continuation is due. */
export function pendingTodoReply(): EndpointReply {
  return { kind: 'todo-write', content: 'write the quarterly report' };
}

export interface WireRequest {
  readonly model: string;
  readonly temperature?: number;
  readonly messages: ReadonlyArray<{ role: string; content?: unknown }>;
}

function chunk(delta: object, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: 'scripted',
    object: 'chat.completion.chunk',
    model: 'scripted-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function usageChunk(outputTokens: number): string {
  return `data: ${JSON.stringify({
    id: 'scripted',
    object: 'chat.completion.chunk',
    model: 'scripted-model',
    choices: [],
    usage: {
      prompt_tokens: PROMPT_TOKENS,
      completion_tokens: outputTokens,
      total_tokens: PROMPT_TOKENS + outputTokens,
    },
  })}\n\n`;
}

function renderReply(reply: EndpointReply): string {
  if (reply.kind === 'todo-write') {
    const todos = [{ id: '1', content: reply.content, status: 'pending' }];
    const call = {
      index: 0,
      id: 'call-todo-1',
      type: 'function',
      function: { name: 'todo_write', arguments: JSON.stringify({ todos }) },
    };
    return (
      chunk({ role: 'assistant', tool_calls: [call] }, 'tool_calls') +
      usageChunk(8) +
      'data: [DONE]\n\n'
    );
  }
  const delta =
    reply.text === undefined
      ? { role: 'assistant' }
      : { role: 'assistant', content: reply.text };
  return (
    chunk(delta, reply.finishReason) +
    usageChunk(reply.outputTokens) +
    'data: [DONE]\n\n'
  );
}

interface ScriptedEndpoint {
  readonly url: string;
  requests(): readonly WireRequest[];
  stop(): Promise<void>;
}

/**
 * A local OpenAI-compatible chat endpoint answering request N with reply N.
 * A request beyond the script is answered with a marker text and recorded, so
 * an unwanted extra request shows up in `requests()` and in the output.
 */
async function startScriptedEndpoint(
  replies: readonly EndpointReply[],
): Promise<ScriptedEndpoint> {
  const requests: WireRequest[] = [];
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const buffers: Buffer[] = [];
      for await (const part of request) buffers.push(Buffer.from(part));
      const body = JSON.parse(
        Buffer.concat(buffers).toString('utf8'),
      ) as WireRequest;
      requests.push(body);
      const reply =
        replies[requests.length - 1] ??
        stopReply('UNSCRIPTED REQUEST: the agent asked for more than expected');
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(renderReply(reply));
    })().catch((error: unknown) =>
      response.destroy(error instanceof Error ? error : undefined),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing local endpoint port');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface ScriptedRun {
  readonly events: readonly AgentEvent[];
  readonly stats: ReturnType<Agent['getStats']>;
  readonly requests: readonly WireRequest[];
  readonly historyBefore: Awaited<ReturnType<Agent['getHistory']>>;
  readonly historyAfter: Awaited<ReturnType<Agent['getHistory']>>;
  readonly tokenRecords: ReadonlyArray<Record<string, unknown>>;
  readonly journalRecords: ReadonlyArray<Record<string, unknown>>;
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Runs prompts in order through a real public Agent talking to a local
 * OpenAI-compatible endpoint that answers with `replies`, with the session
 * journal recording. Returns what a host can observe: the public events, the
 * requests the endpoint received, history before and after, the token-usage
 * log and the journal.
 */
export async function runScriptedPrompt(
  replies: readonly EndpointReply[],
  prompts: readonly string[] = ['please summarise the work'],
): Promise<ScriptedRun> {
  const workingDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'llxprt-refusal-')),
  );
  const sessionId = `refusal-${randomUUID()}`;
  const endpoint = await startScriptedEndpoint(replies);
  let agent: Agent | undefined;
  try {
    agent = await createAgent({
      provider: 'openai',
      model: 'scripted-model',
      workingDir,
      sessionId,
      approvalMode: ApprovalMode.YOLO,
      auth: { apiKey: 'local-test-key', baseUrl: endpoint.url },
    });
    const historyBefore = await agent.getHistory();
    await agent.session.setRecording({ enabled: true });
    const events: AgentEvent[] = [];
    for (const prompt of prompts)
      events.push(...(await drain(agent.stream(prompt))));
    const historyAfter = await agent.getHistory();
    const journalPath = agent.session.getRecording().path ?? '';
    await agent.session.setRecording({ enabled: false });
    const projectTempDir = new Storage(workingDir).getProjectTempDir();
    return {
      events,
      stats: agent.getStats(),
      requests: [...endpoint.requests()],
      historyBefore,
      historyAfter,
      tokenRecords: readJsonl(
        join(projectTempDir, 'token-usage', `${sessionId}.jsonl`),
      ),
      journalRecords: readJsonl(journalPath),
    };
  } finally {
    await agent?.dispose();
    await endpoint.stop();
    rmSync(workingDir, { recursive: true, force: true });
  }
}

/** Token-log records that describe one provider attempt. */
export function turnRecords(
  records: ReadonlyArray<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return records.filter((record) => record['record_type'] === 'turn');
}

export function aiTexts(history: ScriptedRun['historyAfter']): string[] {
  return history
    .filter((message) => message.speaker === 'ai')
    .flatMap((message) => message.blocks)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []));
}
