/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4136: a configured reasoning setting that OpenAI Chat cannot put on
 * the wire must be reported to the user through the user-feedback channel
 * (interactive UI and headless stderr), once per session per setting, rather
 * than only through the debug logger.
 *
 * The provider runs its real request path; only `fetch` is stubbed at the
 * HTTP boundary so the request bodies can be inspected.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  CoreEvent,
  coreEvents,
  type UserFeedbackPayload,
} from '@vybestack/llxprt-code-core/utils/events.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { OpenAIProvider } from './OpenAIProvider.js';

const LOCAL_BASE_URL = 'http://127.0.0.1:8308/v1';
const LOCAL_MODEL = 'qwen3.8-27b';
const REASONING_BODY_KEYS: readonly string[] = [
  'reasoning',
  'thinking',
  'reasoning_effort',
  'chat_template_kwargs',
];

const originalFetch = globalThis.fetch;

function makeChatCompletionResponse(): Response {
  const encoder = new TextEncoder();
  const chunk = JSON.stringify({
    id: 'chatcmpl-issue4136',
    object: 'chat.completion.chunk',
    choices: [{ delta: { content: 'ok' }, index: 0, finish_reason: 'stop' }],
  });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonBody(
  init: RequestInit | undefined,
): Promise<Record<string, unknown>> {
  const raw = init?.body;
  if (raw === undefined || raw === null) {
    throw new Error('chat request was sent without a body');
  }
  const parsed: unknown = JSON.parse(await new Response(raw).text());
  if (!isRecord(parsed)) {
    throw new Error('chat request body is not a JSON object');
  }
  return parsed;
}

function reasoningFields(
  body: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => REASONING_BODY_KEYS.includes(key)),
  );
}

interface SessionHarness {
  readonly chatBodies: Array<Record<string, unknown>>;
  readonly feedback: UserFeedbackPayload[];
  sendTurn(): Promise<void>;
}

/**
 * One provider and one runtime stand for one user session; each sendTurn()
 * drives a full generateChatCompletion request through the provider.
 */
function createLocalSession(
  runtimeId: string,
  modelBehavior: Readonly<Record<string, unknown>>,
  feedback: UserFeedbackPayload[],
  chatBodies: Array<Record<string, unknown>>,
): SessionHarness {
  const provider = new OpenAIProvider('local-key', LOCAL_BASE_URL);
  const settings = new SettingsService();
  settings.setProviderSetting('openai', 'model', LOCAL_MODEL);
  for (const [key, value] of Object.entries(modelBehavior)) {
    settings.set(key, value);
  }
  const runtime = createProviderRuntimeContext({ runtimeId });

  return {
    chatBodies,
    feedback,
    async sendTurn(): Promise<void> {
      const options = createProviderCallOptions({
        providerName: 'openai',
        settings,
        runtime,
        resolved: {
          model: LOCAL_MODEL,
          baseURL: LOCAL_BASE_URL,
          authToken: 'local-key',
        },
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
        ],
      });
      for await (const _ of provider.generateChatCompletion(options)) {
        void _;
      }
    },
  };
}

describe('OpenAI Chat dropped reasoning settings reach the user (issue #4136)', () => {
  let feedback: UserFeedbackPayload[];
  let chatBodies: Array<Record<string, unknown>>;
  const recordFeedback = (payload: UserFeedbackPayload): void => {
    feedback.push(payload);
  };

  beforeEach(() => {
    feedback = [];
    chatBodies = [];
    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith('/chat/completions')) {
        throw new Error(`unexpected request to ${url}`);
      }
      chatBodies.push(await readJsonBody(init));
      return makeChatCompletionResponse();
    };
    coreEvents.on(CoreEvent.UserFeedback, recordFeedback);
  });

  afterEach(() => {
    coreEvents.off(CoreEvent.UserFeedback, recordFeedback);
    globalThis.fetch = originalFetch;
  });

  it('omits an undetectable effort and warns the user once across two requests', async () => {
    const session = createLocalSession(
      'issue4136-undetected-effort',
      { 'reasoning.effort': 'low' },
      feedback,
      chatBodies,
    );

    await session.sendTurn();
    await session.sendTurn();

    expect(chatBodies).toHaveLength(2);
    expect(chatBodies.map(reasoningFields)).toStrictEqual([{}, {}]);
    expect(feedback).toStrictEqual([
      {
        severity: 'warning',
        message:
          `reasoning.effort is set but was not sent to openai model ${LOCAL_MODEL} ` +
          'because the effort format could not be detected for this endpoint ' +
          '(effort-format-undetected). To send it, set ' +
          'reasoning.effortWireFormat to one of: openai, openrouter, ' +
          'anthropic-budget, template-kwargs.',
        error: undefined,
      },
    ]);
  });

  it('warns once for each dropped setting, naming the enabled wire format values', async () => {
    const session = createLocalSession(
      'issue4136-undetected-effort-and-enabled',
      { 'reasoning.effort': 'low', 'reasoning.enabled': true },
      feedback,
      chatBodies,
    );

    await session.sendTurn();
    await session.sendTurn();

    expect(chatBodies.map(reasoningFields)).toStrictEqual([{}, {}]);
    expect(feedback.map((entry) => entry.message)).toStrictEqual([
      `reasoning.effort is set but was not sent to openai model ${LOCAL_MODEL} ` +
        'because the effort format could not be detected for this endpoint ' +
        '(effort-format-undetected). To send it, set ' +
        'reasoning.effortWireFormat to one of: openai, openrouter, ' +
        'anthropic-budget, template-kwargs.',
      `reasoning.enabled is set but was not sent to openai model ${LOCAL_MODEL} ` +
        'because the enabled format could not be detected for this endpoint ' +
        '(enabled-format-undetected). To send it, set ' +
        'reasoning.enabledWireFormat to one of: openai, openrouter, ' +
        'thinking, template-kwargs.',
    ]);
  });

  it('tells each new session again rather than once per process', async () => {
    const first = createLocalSession(
      'issue4136-first-session',
      { 'reasoning.effort': 'low' },
      feedback,
      chatBodies,
    );
    const second = createLocalSession(
      'issue4136-second-session',
      { 'reasoning.effort': 'low' },
      feedback,
      chatBodies,
    );

    await first.sendTurn();
    await second.sendTurn();
    await first.sendTurn();

    expect(chatBodies.map(reasoningFields)).toStrictEqual([{}, {}, {}]);
    expect(feedback).toHaveLength(2);
    expect(feedback.map((entry) => entry.severity)).toStrictEqual([
      'warning',
      'warning',
    ]);
  });

  it('sends template kwargs effort and stays silent when the wire format is explicit', async () => {
    const session = createLocalSession(
      'issue4136-template-kwargs-control',
      {
        'reasoning.effort': 'low',
        'reasoning.effortWireFormat': 'template-kwargs',
      },
      feedback,
      chatBodies,
    );

    await session.sendTurn();
    await session.sendTurn();

    expect(chatBodies.map(reasoningFields)).toStrictEqual([
      { chat_template_kwargs: { reasoning_effort: 'low' } },
      { chat_template_kwargs: { reasoning_effort: 'low' } },
    ]);
    expect(feedback).toStrictEqual([]);
  });
});
