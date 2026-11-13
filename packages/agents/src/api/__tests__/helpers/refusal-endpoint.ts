/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalMode, createAgent } from '@vybestack/llxprt-code-agents';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { Storage } from '@vybestack/llxprt-code-settings';
import { startAnthropicEndpoint } from './anthropic-refusal-endpoint.js';

const PROMPT_TOKENS = 120;

/** What the local OpenAI-compatible endpoint answers to one request. */
export type EndpointReply =
  | { readonly kind: 'http-error'; readonly status: number }
  | {
      readonly kind: 'finish';
      readonly finishReason: string;
      readonly text?: string;
      readonly outputTokens: number;
    }
  | {
      readonly kind: 'todo-write';
      readonly content: string;
      /** End the stream with the refusal finish reason after the tool call. */
      readonly refused?: boolean;
    }
  | {
      readonly kind: 'tool-call';
      readonly name: string;
      readonly args: Readonly<Record<string, unknown>>;
    };

/** The endpoint rejects the request with this HTTP status. */
export function httpErrorReply(status: number): EndpointReply {
  return { kind: 'http-error', status };
}

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

/** A task-list tool call whose attempt ends with the refusal finish reason. */
export function refusedTodoReply(): EndpointReply {
  return {
    kind: 'todo-write',
    content: 'write the quarterly report',
    refused: true,
  };
}

/** The model asks the agent to run one tool with these arguments. */
export function toolCallReply(
  name: string,
  args: Readonly<Record<string, unknown>>,
): EndpointReply {
  return { kind: 'tool-call', name, args };
}

/** A task-list write that leaves one pending item, so a continuation is due. */
export function pendingTodoReply(): EndpointReply {
  return { kind: 'todo-write', content: 'write the quarterly report' };
}

export interface WireRequest {
  readonly model: string;
  readonly temperature?: number;
  readonly messages: ReadonlyArray<{ role: string; content?: unknown }>;
  readonly [key: string]: unknown;
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

function renderToolCall(
  name: string,
  args: object,
  finishReason: string,
): string {
  const call = {
    index: 0,
    id: `call-${name}-1`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
  return (
    chunk({ role: 'assistant', tool_calls: [call] }, finishReason) +
    usageChunk(8) +
    'data: [DONE]\n\n'
  );
}

function renderReply(
  reply: Exclude<EndpointReply, { kind: 'http-error' }>,
): string {
  if (reply.kind === 'tool-call') {
    return renderToolCall(reply.name, reply.args, 'tool_calls');
  }
  if (reply.kind === 'todo-write') {
    const todos = [{ id: '1', content: reply.content, status: 'pending' }];
    return renderToolCall(
      'todo_write',
      { todos },
      reply.refused === true ? 'refusal' : 'tool_calls',
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

/** Notes a client that hangs up before the reply ended, by request index. */
export function trackConnection(
  response: ServerResponse,
  index: number,
  disconnected: number[],
): RequestConnection {
  let notify: () => void = () => undefined;
  const clientClosed = new Promise<void>((resolve) => {
    notify = resolve;
  });
  response.on('close', () => {
    if (response.writableEnded) return;
    disconnected.push(index);
    notify();
  });
  return { clientClosed };
}

export interface ScriptedEndpoint {
  readonly url: string;
  requests(): readonly WireRequest[];
  /** Indexes of requests whose client hung up before the reply ended. */
  disconnectedRequests(): readonly number[];
  stop(): Promise<void>;
}

/** What a responder can learn about the connection a request arrived on. */
export interface RequestConnection {
  /** Settles when the client drops the connection before the reply ended. */
  readonly clientClosed: Promise<void>;
}

/** Chooses the reply to one request from what the endpoint received. */
export type ReplyResponder = (
  request: WireRequest,
  index: number,
  connection: RequestConnection,
) => EndpointReply | Promise<EndpointReply>;

/**
 * A local OpenAI-compatible chat endpoint answering request N with reply N, or
 * with whatever a responder decides from the request itself. A request beyond
 * the script is answered with a marker text and recorded, so an unwanted extra
 * request shows up in `requests()` and in the output.
 */
export async function startScriptedEndpoint(
  replies: readonly EndpointReply[] | ReplyResponder,
): Promise<ScriptedEndpoint> {
  const requests: WireRequest[] = [];
  const disconnected: number[] = [];
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const buffers: Buffer[] = [];
      for await (const part of request) buffers.push(Buffer.from(part));
      const body = JSON.parse(
        Buffer.concat(buffers).toString('utf8'),
      ) as WireRequest;
      requests.push(body);
      const index = requests.length - 1;
      const connection = trackConnection(response, index, disconnected);
      const scripted =
        typeof replies === 'function'
          ? await replies(body, index, connection)
          : replies.find((_, position) => position === index);
      const reply =
        scripted ??
        stopReply('UNSCRIPTED REQUEST: the agent asked for more than expected');
      if (reply.kind === 'http-error') {
        response.writeHead(reply.status, {
          'Content-Type': 'application/json',
        });
        response.end(
          JSON.stringify({ error: { message: 'scripted failure' } }),
        );
        return;
      }
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
    disconnectedRequests: () => disconnected,
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface ScriptedRun {
  readonly events: readonly AgentEvent[];
  /**
   * Backoff durations the agent requested before each resend, in order, as the
   * session journal recorded them.
   */
  readonly waits: readonly number[];
  readonly stats: ReturnType<Agent['getStats']>;
  readonly requests: readonly WireRequest[];
  readonly historyBefore: Awaited<ReturnType<Agent['getHistory']>>;
  readonly historyAfter: Awaited<ReturnType<Agent['getHistory']>>;
  readonly tokenRecords: ReadonlyArray<Record<string, unknown>>;
  readonly journalRecords: ReadonlyArray<Record<string, unknown>>;
}

export function readJsonl(path: string): Array<Record<string, unknown>> {
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
 * The backoff of every resend the journal recorded, in order. A reviewer
 * rewrite resends at once and so records 0.
 */
export function requestedWaits(
  journalRecords: ReadonlyArray<Record<string, unknown>>,
): number[] {
  return journalRecords
    .filter((record) => record['type'] === 'refusal')
    .map((record) => record['payload'] as { action: string; delayMs?: number })
    .filter((payload) => payload.action === 'retry')
    .map((payload) => payload.delayMs ?? Number.NaN);
}

/**
 * Whether `event` announces an identical resend after a backoff. The stream is
 * pull-based and the notice is yielded before the backoff starts, so a
 * consumer that acts when it sees this event acts before the wait begins.
 */
export function isBackoffNotice(event: AgentEvent): boolean {
  return (
    event.type === 'notice' &&
    event.message.includes('refused the request; retrying')
  );
}

export interface ScriptedRunOptions {
  /** Which wire protocol the local endpoint speaks. Default: openai. */
  readonly protocol?: 'openai' | 'anthropic';
  /**
   * Ephemeral settings applied before the first prompt. Refusal retries and
   * review are off unless a test turns them on (`undefined` restores the
   * default), so the issue #4036 phase 1 tests keep their single-request
   * shape.
   */
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly modelParams?: Readonly<Record<string, unknown>>;
  /**
   * Runs for every public event, and is awaited before the stream is pulled
   * again. A scenario that has to act during a refusal backoff does so when it
   * sees the backoff notice (`isBackoffNotice`).
   */
  readonly onEvent?: (event: AgentEvent, agent: Agent) => Promise<void>;
  /** Abort signal passed to every prompt. */
  readonly signal?: AbortSignal;
  /** Runs after the prompts while the agent is alive. */
  readonly inspect?: (agent: Agent) => Promise<void>;
}

/**
 * Runs prompts in order through a real public Agent talking to a local
 * endpoint that answers with `replies`, with the session journal recording.
 * Returns what a host can observe: the public events, the requests the
 * endpoint received, history before and after, the token-usage log and the
 * journal.
 */
export async function runScriptedPrompt(
  replies: readonly EndpointReply[],
  prompts: readonly string[] = ['please summarise the work'],
  options: ScriptedRunOptions = {},
): Promise<ScriptedRun> {
  const workingDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'llxprt-refusal-')),
  );
  const sessionId = `refusal-${randomUUID()}`;
  const anthropic = options.protocol === 'anthropic';
  const endpoint = anthropic
    ? await startAnthropicEndpoint(replies)
    : await startScriptedEndpoint(replies);
  let agent: Agent | undefined;
  try {
    agent = await createAgent({
      provider: anthropic ? 'anthropic' : 'openai',
      model: anthropic ? 'claude-opus-5-5' : 'scripted-model',
      workingDir,
      sessionId,
      approvalMode: ApprovalMode.YOLO,
      auth: { apiKey: 'local-test-key', baseUrl: endpoint.url },
    });
    for (const [key, value] of Object.entries({
      'refusal.retries': 0,
      'refusal.rewrite': false,
      ...options.settings,
    }))
      agent.setEphemeralSetting(key, value);
    for (const [key, value] of Object.entries(options.modelParams ?? {}))
      agent.setModelParam(key, value);
    const historyBefore = await agent.getHistory();
    await agent.session.setRecording({ enabled: true });
    const events: AgentEvent[] = [];
    for (const prompt of prompts) {
      for await (const event of agent.stream(
        prompt,
        options.signal === undefined ? undefined : { signal: options.signal },
      )) {
        events.push(event);
        await options.onEvent?.(event, agent);
      }
    }
    await options.inspect?.(agent);
    const historyAfter = await agent.getHistory();
    const journalPath = agent.session.getRecording().path ?? '';
    await agent.session.setRecording({ enabled: false });
    const journalRecords = readJsonl(journalPath);
    const projectTempDir = new Storage(workingDir).getProjectTempDir();
    return {
      events,
      waits: requestedWaits(journalRecords),
      stats: agent.getStats(),
      requests: [...endpoint.requests()],
      historyBefore,
      historyAfter,
      tokenRecords: readJsonl(
        join(projectTempDir, 'token-usage', `${sessionId}.jsonl`),
      ),
      journalRecords,
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
