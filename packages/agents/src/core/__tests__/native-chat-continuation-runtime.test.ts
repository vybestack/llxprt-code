/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { OpenAIProvider } from '../../../../providers/src/openai/OpenAIProvider.js';
import {
  buildContinuationMessages,
  type ContinuationToolCall,
} from '../../../../providers/src/openai/OpenAIRequestBuilder.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { prepareRequestBody } from '../../../../providers/src/openai/__tests__/support/prepareRequestBody.js';
import { rowsSelection } from '../../../../providers/src/__tests__/support/wireBodyCapture.js';
import { createRuntimeTokenizerFactory } from '../../../../providers/src/composition/runtimeTokenizerFactory.js';
import { operationFileCreates } from '../../compression/__tests__/support/operation-file-creates.js';
import {
  loggingChatSession,
  readLoggingChatStream,
} from './support/chat-session-logging-fixture.js';

const calls: ContinuationToolCall[] = [
  {
    id: 'call_current',
    type: 'function',
    function: { name: 'read_file', arguments: '{"path":"雪","ratio":1.25}' },
  },
];
function reply(second: boolean, streaming: boolean): Response {
  if (!streaming)
    return Response.json({
      id: 'reply',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: second ? 'terminal 雪' : null,
            ...(second ? {} : { tool_calls: calls }),
          },
          finish_reason: 'stop',
        },
      ],
    });
  const delta = second
    ? { content: 'terminal 雪' }
    : { tool_calls: calls.map((call, index) => ({ index, ...call })) };
  return new Response(
    `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', model: 'gpt-4o', choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
describe('public native plain Chat automatic continuation HTTP', () => {
  const directory = useTempDir('native-chat-session-http-');
  it.each(
    ['none', 'all', 'allButLast'].flatMap((strip) =>
      [false, true].map((streaming) => ({ strip, streaming })),
    ),
  )(
    'continues $strip/stream=$streaming through public estimation, HTTP and durable commitment',
    async ({ strip, streaming }) => {
      const requests: string[] = [];
      const contentLengths: number[] = [];
      const prior = [
        {
          speaker: 'ai',
          blocks: [
            { type: 'thinking', thought: 'old '.repeat(100) },
            { type: 'text', text: 'older answer' },
          ],
        },
        { speaker: 'human', blocks: [{ type: 'text', text: 'prior' }] },
        {
          speaker: 'ai',
          blocks: [
            { type: 'thinking', thought: 'latest first' },
            { type: 'thinking', thought: 'latest second' },
            { type: 'text', text: 'answer' },
          ],
        },
      ] satisfies Array<
        import('@vybestack/llxprt-code-core/services/history/IContent.js').IContent
      >;
      const storedLengths: number[] = [];
      const estimates: number[] = [];
      const tokenizer = createRuntimeTokenizerFactory();
      const recording = JournalRecordingService.create({
        sessionId: 'native-chat-session',
        projectHash: 'chat-tail',
        chatsDir: directory(),
        workspaceDirs: [],
        provider: 'openai',
        model: 'gpt-4o',
      });
      const history = new HistoryService({ backend: 'journal', recording });
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request): Promise<Response> {
          requests.push(await request.text());
          contentLengths.push(Number(request.headers.get('content-length')));
          storedLengths.push(history.length());
          return reply(
            requests.length === 2,
            requests.length === 2 || streaming,
          );
        },
      });
      const baseURL = `http://127.0.0.1:${server.port}/v1`;
      const settings = new SettingsService();
      settings.setProviderSetting('openai', 'model', 'gpt-4o');
      settings.set('model', 'gpt-4o');
      settings.setProviderSetting('openai', 'base-url', baseURL);
      settings.setProviderSetting('openai', 'auth-key', 'test-key');
      settings.set('streaming', streaming ? 'enabled' : 'disabled');
      settings.set('reasoning.stripFromContext', strip);
      settings.set('reasoning.includeInContext', true);
      settings.set('token-usage-log', false);
      const provider = new OpenAIProvider('test-key', baseURL);
      provider.setRuntimeSettingsService(settings);
      const fixture = createChatSessionRuntime({
        provider,
        settingsService: settings,
        configOverrides: {
          getTelemetryLogPromptsEnabled: () => false,
          getUsageStatisticsEnabled: () => false,
        },
      });
      const owner = new SessionSettingsOwner(settings);
      const runtime = createAgentRuntimeContext({
        promptEstimator: {
          ...tokenizer,
          async estimatePrompt(request) {
            const result = await tokenizer.estimatePrompt(request);
            estimates.push(result.count);
            return result;
          },
        },
        readRuntimeSettings: () => owner.readRuntimePolicy(),
        prepareProviderInvocation: (name, parameters, signal) =>
          owner.prepareProviderInvocation(
            'native-chat-session',
            name,
            parameters,
            signal,
          ),
        state: {
          runtimeId: 'native-chat-session',
          sessionId: 'native-chat-session',
          provider: 'openai',
          model: 'gpt-4o',
          updatedAt: Date.now(),
          baseUrl: baseURL,
        },
        history,
        settings: { contextLimit: 1_000_000 },
        providerRuntime: fixture.runtime,
        provider: { getActiveProvider: () => provider, setActiveProvider() {} },
        tools: { listToolNames: () => [], getToolMetadata: () => undefined },
        telemetry: {
          logApiRequest() {},
          logApiResponse() {},
          logApiError() {},
        },
      });
      const chat = loggingChatSession(runtime, provider, {
        systemInstruction: 'system',
      });
      try {
        await history.addBatch(prior);
        await history.waitForCommit();
        const reference = await prepareRequestBody(
          {
            contents: [],
            requestRows: rowsSelection([
              ...prior,
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'new user 雪' }],
              },
            ]),
            metadata: {},
            systemInstruction: 'system',
            invocation: createRuntimeInvocationContext({
              runtimeId: 'reference',
              providerName: 'openai',
              ephemeralsSnapshot: {
                streaming: streaming ? 'enabled' : 'disabled',
                'reasoning.stripFromContext': strip,
                'reasoning.includeInContext': true,
              },
            }),
            resolved: { model: 'gpt-4o', baseURL, authToken: 'test-key' },
          },
          'gpt-4o',
          undefined,
          new DebugLogger('native-chat-reference'),
          'openai',
        );
        const expectedTokens = estimateTokens(
          JSON.stringify({ messages: reference.messagesWithSystem }),
        );
        let output = '';
        const receipt = await operationFileCreates(async () => {
          output = await readLoggingChatStream(
            chat,
            {
              message: {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'new user 雪' }],
              },
            },
            'native-chat-session',
          );
        }, true);
        expect(output).toBe('terminal 雪');
        expect(receipt).toStrictEqual({ files: [], directories: [] });
        expect(requests).toHaveLength(2);
        expect(requests[1]).toBe(
          JSON.stringify({
            ...reference.requestBody,
            messages: buildContinuationMessages(
              calls,
              reference.messagesWithSystem,
              'openai',
            ),
            stream: true,
          }),
        );
        expect(requests[0]).toBe(JSON.stringify(reference.requestBody));
        expect(expectedTokens).toBeGreaterThan(0);
        expect(estimates.length).toBeGreaterThan(0);
        for (const tokens of estimates) {
          expect(tokens).toBeGreaterThan(0);
          expect(Math.abs(tokens - expectedTokens)).toBeLessThanOrEqual(16);
        }
        expect(JSON.parse(requests[0]).messages).toStrictEqual(
          reference.messagesWithSystem,
        );
        expect(contentLengths).toStrictEqual(
          requests.map((body) => Buffer.byteLength(body)),
        );
        expect(requests[0].includes('old old old')).toBe(strip === 'none');
        expect(JSON.parse(requests[0]).messages[3].reasoning_content).toBe(
          strip === 'all'
            ? undefined
            : ['latest first', 'latest second'].join('\n'),
        );
        expect(storedLengths).toStrictEqual([3, 3]);
        expect(JSON.parse(requests[0]).model).toBe('gpt-4o');
        await history.waitForCommit();
        const committed = await history.openDumpSnapshot();
        try {
          const messages: string[] = [];
          const committedCalls: unknown[] = [];
          const synthetic: unknown[] = [];
          for await (const row of committed.rows()) {
            committedCalls.push(
              ...row.blocks.filter((block) => block.type === 'tool_call'),
            );
            synthetic.push(
              ...row.blocks.filter((block) => block.type === 'tool_response'),
            );
            messages.push(
              `${row.speaker}:${row.blocks
                .flatMap((block) => (block.type === 'text' ? [block.text] : []))
                .join('')}`,
            );
          }
          expect(committedCalls).toStrictEqual([
            {
              type: 'tool_call',
              id: 'hist_tool_current',
              name: 'read_file',
              parameters: { path: '雪', ratio: 1.25 },
            },
          ]);
          expect(synthetic).toStrictEqual([]);
          expect(messages).toStrictEqual([
            'ai:older answer',
            'human:prior',
            'ai:answer',
            'human:new user 雪',
            'ai:terminal 雪',
          ]);
        } finally {
          await committed.close();
        }
      } finally {
        await server.stop(true);
        await history.dispose();
        await recording.dispose();
        await owner.dispose();
      }
    },
  );
});
