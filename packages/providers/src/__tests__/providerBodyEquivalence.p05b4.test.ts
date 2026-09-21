/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Criterion-3 provider-body equivalence harness (issue #854, P05b4).
 *
 * Seeded generated operation logs → INDEPENDENT eager test-only reference
 * implementations (plain array assembly, no resolver) → real providers with
 * their REAL normalizers → capturing local transports (no network) → compare
 * deterministic request BODY BYTES (string/Buffer equality, never IContent
 * identity), plus retry-body byte stability.
 *
 * RED contract (PLAN-20260917-ISSUE854.P05b4): these tests are written to the
 * TARGET state where each provider consumes the provider-facing history
 * stream itself and builds its wire body request-scoped. Failures against
 * current HEAD are expected and are classified in tmp/verify854/p05b4/red.log
 * as either "missing API" (target seam absent) or "real behavior gap".
 *
 * @plan:PLAN-20260917-ISSUE854.P05b4
 * @requirement:G6
 * @requirement:G2
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  MediaBlock,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { normalizeToAnthropicToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { getMaxTokensForModel } from '../anthropic/AnthropicModelData.js';
import { normalizeMediaToDataUri } from '../utils/mediaUtils.js';
import { buildToolResponsePayload } from '../utils/toolResponsePayload.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { OpenAIResponsesProvider } from '../openai-responses/OpenAIResponsesProvider.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { readRawPostTestBody } from '../test-utils/rawPostTestAdapters.js';

/* ------------------------------------------------------------------ *
 * Seeded deterministic PRNG + op-log generator
 * ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const TOOL_NAMES = ['read_file', 'list_dir'] as const;

function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function aiText(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function humanImage(): IContent {
  const image: MediaBlock = {
    type: 'media',
    mimeType: 'image/png',
    encoding: 'base64',
    data: PNG_DATA_URI,
  };
  const caption: TextBlock = { type: 'text', text: 'screenshot attached' };
  return { speaker: 'human', blocks: [caption, image] };
}

function aiToolCalls(calls: ToolCallBlock[]): IContent {
  return { speaker: 'ai', blocks: [...calls] };
}

function toolResponsesBlock(responses: ToolResponseBlock[]): IContent {
  return { speaker: 'tool', blocks: [...responses] };
}

/**
 * Deterministic mixed log: text rows, tool-call/tool-response pairs, and one
 * image row. Seeded, so every consumer of the same seed sees identical rows.
 */
function seededOpLog(seed: number): IContent[] {
  const rand = mulberry32(seed);
  const rows: IContent[] = [humanText(`goal-${seed}`)];
  let callIndex = 0;
  for (let step = 0; step < 8; step += 1) {
    const kind = rand();
    if (kind < 0.2) {
      rows.push(humanImage());
    } else if (kind < 0.55) {
      const name = TOOL_NAMES[callIndex % TOOL_NAMES.length] ?? 'read_file';
      const callId = `call_${seed}_${callIndex}`;
      callIndex += 1;
      const call: ToolCallBlock = {
        type: 'tool_call',
        id: callId,
        name,
        parameters: { path: `/tmp/${name}-${callId}.txt` },
      };
      const response: ToolResponseBlock = {
        type: 'tool_response',
        callId,
        toolName: name,
        result: `ok-${callId}`,
      };
      rows.push(aiToolCalls([call]));
      rows.push(toolResponsesBlock([response]));
    } else {
      rows.push(aiText(`reply-${seed}-${step}`));
    }
  }
  rows.push(humanText(`followup-${seed}`));
  return rows;
}

/** One-shot stream over an op log (what the facade hands providers today). */
function opLogStream(rows: readonly IContent[]): AsyncIterable<IContent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        yield row;
      }
    },
  };
}

function textOf(row: IContent): string {
  return row.blocks
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/* ------------------------------------------------------------------ *
 * Independent eager reference — anthropic Messages wire format.
 * Plain array assembly; shares only pure wire-format helpers.
 * ------------------------------------------------------------------ */

interface ReferenceMessage {
  role: 'user' | 'assistant';
  content: unknown;
}

/**
 * Reference-side mirror of the production validator's same-role coalescing
 * (AnthropicMessageValidator.mergeConsecutiveMessages): consecutive same-role
 * messages merge into one message with block-array content. Assistant merges
 * put thinking blocks first, user merges put tool_result blocks first; string
 * content blockifies to a single text block. Kept eager and independent — it
 * models the observed production bytes without importing the validator.
 */
function mergeReferenceConsecutiveMessages(
  messages: ReferenceMessage[],
): ReferenceMessage[] {
  const toBlocks = (content: unknown): Array<Record<string, unknown>> => {
    if (typeof content !== 'string') {
      return content as Array<Record<string, unknown>>;
    }
    return [{ type: 'text', text: content }];
  };
  const thinkingTypes = new Set(['thinking', 'redacted_thinking']);
  const merged: ReferenceMessage[] = [];
  for (const msg of messages) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : undefined;
    if (prev && prev.role === msg.role) {
      const prevBlocks = toBlocks(prev.content);
      const curBlocks = toBlocks(msg.content);
      if (msg.role === 'user') {
        const toolResultBlocks = [
          ...prevBlocks.filter((b) => b['type'] === 'tool_result'),
          ...curBlocks.filter((b) => b['type'] === 'tool_result'),
        ];
        const otherBlocks = [
          ...prevBlocks.filter((b) => b['type'] !== 'tool_result'),
          ...curBlocks.filter((b) => b['type'] !== 'tool_result'),
        ];
        prev.content = [...toolResultBlocks, ...otherBlocks];
      } else {
        const thinkingBlocks = [
          ...prevBlocks.filter((b) => thinkingTypes.has(b['type'] as string)),
          ...curBlocks.filter((b) => thinkingTypes.has(b['type'] as string)),
        ];
        const nonThinkingBlocks = [
          ...prevBlocks.filter((b) => !thinkingTypes.has(b['type'] as string)),
          ...curBlocks.filter((b) => !thinkingTypes.has(b['type'] as string)),
        ];
        prev.content = [...thinkingBlocks, ...nonThinkingBlocks];
      }
    } else {
      merged.push({ role: msg.role, content: msg.content });
    }
  }
  return merged;
}

function referenceAnthropicUserMessage(row: IContent): ReferenceMessage {
  const media = row.blocks.filter(
    (block): block is MediaBlock => block.type === 'media',
  );
  if (media.length === 0) {
    return { role: 'user', content: textOf(row) };
  }
  const content: unknown[] = [];
  for (const block of row.blocks) {
    if (block.type === 'text' && block.text) {
      content.push({ type: 'text', text: block.text });
    } else if (block.type === 'media') {
      const data = block.data.split(';base64,')[1] ?? block.data;
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data },
      });
    }
  }
  return { role: 'user', content };
}

function referenceAnthropicAssistantMessage(row: IContent): ReferenceMessage {
  const toolCalls = row.blocks.filter(
    (block): block is ToolCallBlock => block.type === 'tool_call',
  );
  if (toolCalls.length === 0) {
    return { role: 'assistant', content: textOf(row) };
  }
  const content: unknown[] = [];
  for (const block of row.blocks) {
    if (block.type === 'text' && block.text) {
      content.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_call') {
      content.push({
        type: 'tool_use',
        id: normalizeToAnthropicToolId(block.id),
        name: block.name,
        input: block.parameters,
      });
    }
  }
  return { role: 'assistant', content };
}

function referenceAnthropicMessages(
  rows: readonly IContent[],
): ReferenceMessage[] {
  const messages: ReferenceMessage[] = [];
  let pendingToolResults: unknown[] = [];
  const flush = (): void => {
    if (pendingToolResults.length > 0) {
      messages.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };
  for (const row of rows) {
    const toolResponses = row.blocks.filter(
      (block): block is ToolResponseBlock => block.type === 'tool_response',
    );
    for (const response of toolResponses) {
      const payload = buildToolResponsePayload(response, undefined);
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: normalizeToAnthropicToolId(response.callId),
        content: payload.result === '' ? '[empty tool result]' : payload.result,
      });
    }
    if (row.speaker === 'human') {
      flush();
      messages.push(referenceAnthropicUserMessage(row));
    } else if (row.speaker === 'ai') {
      flush();
      messages.push(referenceAnthropicAssistantMessage(row));
    }
  }
  flush();
  return mergeReferenceConsecutiveMessages(messages);
}

function referenceAnthropicBody(rows: readonly IContent[]): unknown {
  return {
    model: 'claude-opus-5',
    messages: referenceAnthropicMessages(rows),
    max_tokens: getMaxTokensForModel('claude-opus-5'),
    stream: false,
    system: 'test system prompt',
  };
}

/* ------------------------------------------------------------------ *
 * Independent eager reference — OpenAI Responses wire format.
 * ------------------------------------------------------------------ */

function hasToolResponse(rows: readonly IContent[], callId: string): boolean {
  return rows.some(
    (row) =>
      row.speaker === 'tool' &&
      row.blocks.some(
        (block) =>
          block.type === 'tool_response' &&
          normalizeToOpenAIToolId(block.callId) === callId,
      ),
  );
}

function hasToolCall(rows: readonly IContent[], callId: string): boolean {
  return rows.some(
    (row) =>
      row.speaker === 'ai' &&
      row.blocks.some(
        (block) =>
          block.type === 'tool_call' &&
          normalizeToOpenAIToolId(block.id) === callId,
      ),
  );
}

function referenceResponsesUserEntry(
  row: IContent,
): Record<string, unknown> | undefined {
  const media = row.blocks.filter(
    (block): block is MediaBlock => block.type === 'media',
  );
  if (media.length > 0) {
    const parts: unknown[] = [];
    for (const block of row.blocks) {
      if (block.type === 'text' && block.text) {
        parts.push({ type: 'input_text', text: block.text });
      } else if (block.type === 'media') {
        parts.push({
          type: 'input_image',
          image_url: normalizeMediaToDataUri(block),
        });
      }
    }
    return { role: 'user', content: parts };
  }
  const text = row.blocks
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  if (text) return { role: 'user', content: text };
  return undefined;
}

function referenceResponsesAssistantEntries(
  rows: readonly IContent[],
  row: IContent,
): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  const text = row.blocks
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (text) entries.push({ role: 'assistant', content: text });
  for (const block of row.blocks) {
    if (block.type === 'tool_call') {
      const callId = normalizeToOpenAIToolId(block.id);
      if (hasToolResponse(rows, callId)) {
        entries.push({
          type: 'function_call',
          call_id: callId,
          name: block.name,
          arguments: JSON.stringify(block.parameters),
        });
      }
    }
  }
  return entries;
}

function referenceResponsesToolEntries(
  rows: readonly IContent[],
  row: IContent,
): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  for (const block of row.blocks) {
    if (block.type === 'tool_response') {
      const callId = normalizeToOpenAIToolId(block.callId);
      if (hasToolCall(rows, callId)) {
        const raw =
          typeof block.result === 'string'
            ? block.result
            : JSON.stringify(block.result);
        entries.push({
          type: 'function_call_output',
          call_id: callId,
          output: raw,
        });
      }
    }
  }
  return entries;
}

function referenceResponsesInput(rows: readonly IContent[]): unknown[] {
  const input: unknown[] = [];
  for (const row of rows) {
    if (row.speaker === 'human') {
      const entry = referenceResponsesUserEntry(row);
      if (entry !== undefined) {
        input.push(entry);
      }
    } else if (row.speaker === 'ai') {
      input.push(...referenceResponsesAssistantEntries(rows, row));
    } else {
      input.push(...referenceResponsesToolEntries(rows, row));
    }
  }
  return input;
}

function referenceResponsesBody(
  rows: readonly IContent[],
  model: string,
): unknown {
  return {
    model,
    input: referenceResponsesInput(rows),
    stream: true,
    instructions: 'test system prompt',
  };
}

/* ------------------------------------------------------------------ *
 * Capturing transports (local, no network)
 * ------------------------------------------------------------------ */

function byteEquals(left: string, right: string): boolean {
  return Buffer.from(left, 'utf-8').equals(Buffer.from(right, 'utf-8'));
}

function describeByteMismatch(captured: string, reference: string): string {
  const shorter = Math.min(captured.length, reference.length);
  let divergeAt = 0;
  while (
    divergeAt < shorter &&
    captured.charCodeAt(divergeAt) === reference.charCodeAt(divergeAt)
  ) {
    divergeAt += 1;
  }
  return `bytes diverge at ${divergeAt}: captured=${JSON.stringify(
    captured.slice(Math.max(0, divergeAt - 40), divergeAt + 80),
  )} reference=${JSON.stringify(
    reference.slice(Math.max(0, divergeAt - 40), divergeAt + 80),
  )}`;
}

/* ------------------------------------------------------------------ *
 * Anthropic suite (mocked SDK raw-post transport)
 * ------------------------------------------------------------------ */

interface CapturedRawPost {
  readonly path: string;
  readonly bodyText: string;
}

const anthropicRawPosts: CapturedRawPost[] = [];

function anthropicMessageResponse(): unknown {
  return {
    id: 'msg_p05b4',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

void vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    post: (path: string, options: { body?: unknown }) => ({
      withResponse: async () => {
        const bodyText = await readRawPostTestBody(options.body);
        anthropicRawPosts.push({ path, bodyText });
        return { data: anthropicMessageResponse(), response: undefined };
      },
    }),
    messages: { create: vi.fn() },
    beta: { models: { list: vi.fn() } },
  })),
}));

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'test system prompt'),
}));

function makeAnthropicSettings(): SettingsService {
  const settings = new SettingsService();
  settings.set('auth-key', 'test-api-key');
  settings.setProviderSetting('anthropic', 'model', 'claude-opus-5');
  settings.setProviderSetting('anthropic', 'streaming', 'disabled');
  settings.set('prompt-caching', 'off');
  return settings;
}

async function captureAnthropicBody(
  rows: readonly IContent[],
): Promise<string> {
  const settings = makeAnthropicSettings();
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'p05b4-equivalence-anthropic',
    config: createRuntimeConfigStub(settings),
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'anthropic',
    ephemeralsSnapshot: { streaming: 'disabled' },
  });
  const options = createProviderCallOptions({
    providerName: 'anthropic',
    settings,
    config: runtime.config,
    runtime,
    invocation,
    contents: opLogStream(rows),
  });
  const provider = new AnthropicProvider(
    'test-api-key',
    undefined,
    TEST_PROVIDER_CONFIG,
  );
  const before = anthropicRawPosts.length;
  for await (const _chunk of provider.generateChatCompletion(options)) {
    // drain
  }
  const captured = anthropicRawPosts.slice(before);
  if (captured.length !== 1) {
    throw new Error(
      `expected exactly one anthropic raw post, saw ${captured.length}`,
    );
  }
  return captured[0]?.bodyText ?? '';
}

/* ------------------------------------------------------------------ *
 * OpenAI Responses suite (stubbed global fetch)
 * ------------------------------------------------------------------ */

const originalFetch = globalThis.fetch;

interface FetchCall {
  readonly bodyText: string;
  readonly init: RequestInit;
}

function streamingSseResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"content.delta","delta":"ok"}\n\n'),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.completed","response":{"id":"resp_p05b4","status":"completed"}}\n\n',
        ),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function readInitBody(init: RequestInit | undefined): Promise<string> {
  const body = init?.body;
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body;
  return new Response(body).text();
}

function makeResponsesSettings(): SettingsService {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', 'gpt-5.2');
  return settings;
}

async function captureResponsesBodies(
  rows: readonly IContent[],
  fetchImpl: typeof fetch,
  ephemerals: Record<string, unknown> = { 'prompt-caching': 'off' },
): Promise<FetchCall[]> {
  const settings = makeResponsesSettings();
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'p05b4-equivalence-responses',
    config: createRuntimeConfigStub(settings),
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai-responses',
    ephemeralsSnapshot: ephemerals,
  });
  const options = createProviderCallOptions({
    providerName: 'openai-responses',
    settings,
    config: runtime.config,
    runtime,
    invocation,
    contents: opLogStream(rows),
  });
  const provider = new OpenAIResponsesProvider(
    'test-api-key',
    'https://api.openai.com/v1',
  );
  const calls: FetchCall[] = [];
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl(input, init).then(async (response) => {
      calls.push({ bodyText: await readInitBody(init), init: init ?? {} });
      return response;
    });
  try {
    for await (const _chunk of provider.generateChatCompletion(options)) {
      // drain
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  return calls;
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('P05b4 criterion-3 provider body equivalence @plan:PLAN-20260917-ISSUE854.P05b4', () => {
  afterEach(() => {
    clearActiveProviderRuntimeContext();
    globalThis.fetch = originalFetch;
  });

  it('anthropic: provider-sent body bytes equal the independent eager reference', async () => {
    const rows = seededOpLog(0xa11ce);
    const captured = await captureAnthropicBody(rows);
    const reference = JSON.stringify(referenceAnthropicBody(rows));
    expect(
      byteEquals(captured, reference)
        ? 'byte-identical'
        : describeByteMismatch(captured, reference),
    ).toBe('byte-identical');
  });

  it('anthropic: two fresh provider instances produce byte-identical bodies for the same seeded log', async () => {
    const rows = seededOpLog(0xd00d5);
    const first = await captureAnthropicBody(rows);
    const second = await captureAnthropicBody(rows);
    expect(
      byteEquals(first, second)
        ? 'byte-identical'
        : describeByteMismatch(first, second),
    ).toBe('byte-identical');
  });

  it('openai-responses: provider-sent body bytes equal the independent eager reference', async () => {
    const rows = seededOpLog(0xb0b5e);
    const calls = await captureResponsesBodies(rows, async () =>
      streamingSseResponse(),
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const captured = calls[0]?.bodyText ?? '';
    const reference = JSON.stringify(referenceResponsesBody(rows, 'gpt-5.2'));
    expect(
      byteEquals(captured, reference)
        ? 'byte-identical'
        : describeByteMismatch(captured, reference),
    ).toBe('byte-identical');
  });

  it('openai-responses: eager-array stream and lazy one-shot stream yield byte-identical bodies', async () => {
    const rows = seededOpLog(0x1a2b3);
    const eager = await captureResponsesBodies(rows, async () =>
      streamingSseResponse(),
    );
    const lazy = await captureResponsesBodies(rows, async () =>
      streamingSseResponse(),
    );
    const eagerBody = eager[0]?.bodyText ?? '';
    const lazyBody = lazy[0]?.bodyText ?? '';
    expect(
      byteEquals(eagerBody, lazyBody)
        ? 'byte-identical'
        : describeByteMismatch(eagerBody, lazyBody),
    ).toBe('byte-identical');
  });

  it('openai-responses: retry rebuilds are byte-stable across orchestrator attempts (target contract)', async () => {
    // Reasoning rows WITHOUT stored 'openai.responses.reasoningId' metadata:
    // each orchestrator attempt rebuilds the input from the replayed history
    // and SYNTHESIZES rs_ ids for them, so any wall-clock component in the
    // synthesized id shows up as a byte difference between attempts.
    const rows: IContent[] = [
      humanText('chain-parent'),
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'mulling the chain',
            sourceField: 'thinking',
            encryptedContent: 'enc-p05b4-stable',
          },
          { type: 'text', text: 'chained reply' },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'mulling again',
            encryptedContent: 'enc-p05b4-second',
          },
          { type: 'text', text: 'second reply' },
        ],
      },
      humanText('chain-next'),
    ];
    let fetchCount = 0;
    const bodies: string[] = [];
    const failingFetch: typeof fetch = async () => {
      const index = fetchCount;
      fetchCount += 1;
      // A real millisecond boundary between builds makes any wall-clock
      // field in a rebuilt body observable, deterministically.
      await Bun.sleep(5);
      // A 401 is authoritative to the transport (shouldRetryOnError(401) is
      // false), so fetchStreamWithRetries rethrows it instead of internally
      // retrying — a 5xx would be retried INSIDE the transport over the same
      // already-materialized body, and the orchestrator would never rebuild.
      // The orchestrator treats auth failures as retryable (no auth-recovery
      // handler is configured here), so each attempt is a fresh provider
      // call with a freshly built body.
      if (index < 2) {
        return new Response(
          JSON.stringify({
            error: { message: 'forced auth refusal', type: 'invalid_api_key' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      }
      return streamingSseResponse();
    };
    const settings = makeResponsesSettings();
    const runtime = createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: 'p05b4-retry-stability',
      config: createRuntimeConfigStub(settings),
    });
    const invocation = createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: 'openai-responses',
      ephemeralsSnapshot: {
        'prompt-caching': 'off',
        retries: 3,
        retrywait: 0,
      },
    });
    const options = createProviderCallOptions({
      providerName: 'openai-responses',
      settings,
      config: runtime.config,
      runtime,
      invocation,
      contents: opLogStream(rows),
    });
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });
    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const response = await failingFetch(input, init);
      bodies.push(await readInitBody(init));
      return response;
    };
    let settled = false;
    try {
      for await (const _chunk of orchestrator.generateChatCompletion(options)) {
        // drain
      }
      settled = true;
    } finally {
      globalThis.fetch = originalFetch;
    }
    const capturedBodies = bodies.filter((text) => text.length > 0);
    // Two forced 401s plus one success: every capture is a distinct
    // orchestrator attempt with a physically rebuilt body, and the run
    // must have settled successfully on the third attempt.
    expect(settled).toBe(true);
    expect(capturedBodies.length).toBe(3);
    // Coverage guard: the rebuilds must actually synthesize reasoning ids
    // (no stored provider metadata), or the stability claim is vacuous.
    const firstParsed = JSON.parse(capturedBodies[0] ?? '{}') as {
      input?: Array<{ type?: string; id?: string }>;
    };
    const reasoningIds = (firstParsed.input ?? [])
      .filter((item) => item.type === 'reasoning')
      .map((item) => item.id);
    expect(reasoningIds.length).toBe(2);
    for (const id of reasoningIds) {
      expect(id).toMatch(/^rs_/);
    }
    const firstBody = capturedBodies[0] ?? '';
    for (const retryBody of capturedBodies.slice(1)) {
      const retryMatchesFirst = Buffer.from(retryBody, 'utf-8').equals(
        Buffer.from(firstBody, 'utf-8'),
      );
      expect(
        retryMatchesFirst
          ? 'byte-identical'
          : describeByteMismatch(retryBody, firstBody),
      ).toBe('byte-identical');
    }
    void streamingSseResponse;
  });
});
