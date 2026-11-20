/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4068: `token-usage-log` is a next-turn setting. Changing it with
 * `/set` must change what an existing chat writes from its next request, not
 * only for chats created afterwards.
 *
 * One real ChatSession per test, its runtime context reading the live policy
 * of a real SessionSettingsOwner, and the real token-usage logger the session
 * builds for itself under the project temp dir. The level is changed the way
 * `/set token-usage-log <value>` changes it: the `/set` parser, then a user
 * write on the owner. Only the provider is scripted; it captures what each
 * request carried.
 */

import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { RAW_TOKEN_DELTA_SINK_KEY } from '@vybestack/llxprt-code-providers';
import { parseEphemeralSettingValue } from '@vybestack/llxprt-code-settings/settings/ephemeral-settings.js';
import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSessionPolicyFixture } from './__tests__/session-policy-fixture.js';
import { createTokenSyncTestFixture } from './__tests__/helpers/tokenSyncTestFixture.js';
import { ChatSession } from './chatSession.js';
import { chatSessionPorts } from './chatSessionPorts.js';

const SESSION_ID = 'level-switch-session';

/** Fields written only at the debug level. */
const DEBUG_ONLY_KEYS = [
  'tool_calls',
  'instructions_tokens',
  'tools_schema_tokens',
  'history_tokens',
  'estimator',
  'tiktoken_tokens',
  'effective_actual_tokens',
  'chunk_count',
];

type JsonRecord = Record<string, unknown>;

interface ProviderRequest {
  readonly metadata: Record<string, unknown> | undefined;
}

const tempDirs: string[] = [];

/**
 * A provider that answers request `n` with `script[n]` and calls the raw
 * token-delta sink first when the request carried one. Every reply reports
 * usage so each logged request yields a turn record.
 */
function scriptedProvider(script: readonly ContentBlock[][]) {
  const requests: ProviderRequest[] = [];
  const provider = {
    name: 'anthropic',
    async *generateChatCompletion(options: {
      metadata?: Record<string, unknown>;
    }) {
      const index = requests.length;
      requests.push({ metadata: options.metadata });
      const sink = options.metadata?.[RAW_TOKEN_DELTA_SINK_KEY];
      if (typeof sink === 'function') sink();
      yield {
        speaker: 'ai' as const,
        blocks: script[index],
        metadata: {
          usage: {
            promptTokens: 4000 + index * 100,
            completionTokens: 20,
            totalTokens: 4020 + index * 100,
          },
        },
      };
    },
    // Projected so every request gets the real send-seam estimate a turn
    // record needs.
    async projectPromptEnvelope(options: { contents: unknown }) {
      const tokenCount = Math.ceil(JSON.stringify(options.contents).length / 4);
      return {
        model: 'claude-3-5-sonnet-20241022',
        protocol: 'anthropic-messages',
        method: 'messages/v1',
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken: Object.freeze({}),
        legacyEstimate: () => Promise.resolve(tokenCount),
      };
    },
  };
  return { provider, requests };
}

function toolCall(id: string): ContentBlock[] {
  return [{ type: 'tool_call', id, name: 'read_file', parameters: { id } }];
}

function toolResult(callId: string, lines: number): ContentBlock[] {
  return [
    {
      type: 'tool_response',
      callId,
      toolName: 'read_file',
      result: `contents of ${callId}\n`.repeat(lines),
    },
  ];
}

function buildChat(script: readonly ContentBlock[][]) {
  const fixture = createTokenSyncTestFixture();
  const projectTempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'token-usage-switch-'),
  );
  tempDirs.push(projectTempDir);
  // The session resolves its log file under the project temp dir.
  Object.assign(fixture.mockConfig, {
    getProjectTempDir: () => projectTempDir,
  });
  const policy = createSessionPolicyFixture(
    fixture.runtimeSetup.settingsService,
    fixture.providerRuntimeSnapshot.runtimeId,
  );
  const { provider, requests } = scriptedProvider(script);
  const view = createAgentRuntimeContext({
    ...policy,
    state: createAgentRuntimeState({
      runtimeId: 'level-switch-runtime',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      sessionId: SESSION_ID,
    }),
    history: fixture.historyService,
    scratchRoots: fixture.historyService.scratchRoots,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 200000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
    },
    provider: createProviderAdapterFromManager({
      getActiveProvider: () => provider,
    } as unknown as Parameters<typeof createProviderAdapterFromManager>[0]),
    telemetry: createTelemetryAdapter(
      fixture.mockConfig,
      RootTelemetry.prepare({
        enabled: false,
        sessionId: 'level-switch-telemetry',
        maxBytes: 1024,
        maxFiles: 1,
      }),
    ),
    tools: createToolRegistryViewFromRegistry(),
    providerRuntime: fixture.providerRuntimeSnapshot,
    promptEstimator: {
      estimatePrompt: async (request) => ({
        count: await request.legacyEstimate(),
        method: 'calibrated',
        family: 'legacy-unregistered',
        estimatorVersion: 'core-estimate-tokens-v1',
        assetRevision: 'none',
        projectionRevision: request.projectionRevision,
      }),
    },
  });
  const chat = new ChatSession(
    chatSessionPorts(view),
    fixture.mockConfig,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fixture.mockContentGenerator,
    {},
    [],
  );
  const logPath = path.join(
    projectTempDir,
    'token-usage',
    `${SESSION_ID}.jsonl`,
  );

  /** `/set token-usage-log <typed>`: the /set parser, then a user write. */
  const setLevel = (typed: string): void => {
    const parsed = parseEphemeralSettingValue('token-usage-log', typed);
    if (!parsed.success) throw new Error(parsed.message);
    policy.owner.writeUserParameter('token-usage-log', parsed.value);
  };

  let sent = 0;
  const send = async (message: string | ContentBlock[]): Promise<void> => {
    sent += 1;
    const stream = await chat.sendMessageStream(
      { message },
      `${SESSION_ID}#prompt-${sent}`,
    );
    for await (const _event of stream) {
      // drain
    }
    await fixture.historyService.waitForTokenUpdates();
  };

  const records = (): JsonRecord[] => {
    if (!fs.existsSync(logPath)) return [];
    return fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as JsonRecord)
      .filter((record) => record.record_type === 'turn');
  };

  return { setLevel, send, records, requests };
}

function expectSummaryShape(record: JsonRecord): void {
  for (const key of DEBUG_ONLY_KEYS)
    expect(Object.keys(record)).not.toContain(key);
  expect(Object.values(record).some((value) => Array.isArray(value))).toBe(
    false,
  );
}

function expectDebugShape(record: JsonRecord): void {
  for (const key of DEBUG_ONLY_KEYS.filter((k) => k !== 'tool_calls')) {
    expect(Object.keys(record)).toContain(key);
  }
}

function newToolCallIds(record: JsonRecord): unknown[] {
  if (!Array.isArray(record.tool_calls)) {
    throw new Error('debug record has no tool_calls array');
  }
  return record.tool_calls.map((call: { call_id?: unknown }) => call.call_id);
}

describe('/set token-usage-log on an existing chat (#4068)', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('summary, then off writes nothing, then debug and summary write their own shapes', async () => {
    const chat = buildChat([
      toolCall('call-1'),
      toolCall('call-2'),
      toolCall('call-3'),
      [{ type: 'text', text: 'Done.' }],
    ]);

    await chat.send('Read the config.');
    expect(chat.records()).toHaveLength(1);
    expectSummaryShape(chat.records()[0]);

    chat.setLevel('off');
    await chat.send(toolResult('call-1', 10));
    expect(chat.records()).toHaveLength(1);

    chat.setLevel('debug');
    await chat.send(toolResult('call-2', 20));
    const afterDebug = chat.records();
    expect(afterDebug).toHaveLength(2);
    const debugRecord = afterDebug[1];
    expect(debugRecord.prompt_id).toBe(`${SESSION_ID}#prompt-3`);
    expectDebugShape(debugRecord);
    // call-1 was sent while logging was off, so this request cannot tell new
    // results from carried ones; the split is omitted rather than guessed.
    expect(Object.keys(debugRecord)).not.toContain('tool_calls');
    expect(Object.keys(debugRecord)).not.toContain('new_tool_result_tokens');
    expect(Object.keys(debugRecord)).not.toContain(
      'carried_tool_result_tokens',
    );

    chat.setLevel('summary');
    await chat.send(toolResult('call-3', 40));
    const all = chat.records();
    expect(all).toHaveLength(3);
    const summaryRecord = all[2];
    expectSummaryShape(summaryRecord);
    expect(summaryRecord.new_tool_result_count).toBe(1);
    // call-1 and call-2 (30 lines) were both in the observed debug request,
    // so they are carried; call-3 (40 lines) is the only new result.
    expect(summaryRecord.carried_tool_result_tokens).toBeGreaterThan(0);
    expect(summaryRecord.new_tool_result_tokens).toBeGreaterThan(
      summaryRecord.carried_tool_result_tokens as number,
    );
  });

  it('keeps new versus carried tool attribution across summary, debug and summary', async () => {
    const chat = buildChat([
      toolCall('call-1'),
      toolCall('call-2'),
      [{ type: 'text', text: 'Done.' }],
    ]);

    await chat.send('Read the config.');
    chat.setLevel('debug');
    await chat.send(toolResult('call-1', 10));
    chat.setLevel('summary');
    await chat.send(toolResult('call-2', 30));

    const [first, second, third] = chat.records();
    expectSummaryShape(first);
    expect(first.new_tool_result_count).toBe(0);
    expect(first.carried_tool_result_tokens).toBe(0);

    expectDebugShape(second);
    expect(newToolCallIds(second)).toStrictEqual(['call-1']);
    expect(second.new_tool_result_count).toBe(1);
    expect(second.carried_tool_result_tokens).toBe(0);

    expectSummaryShape(third);
    expect(third.new_tool_result_count).toBe(1);
    expect(third.carried_tool_result_tokens).toBe(
      second.new_tool_result_tokens,
    );
  });

  it('installs the raw timing sink only for requests sent while logging is on', async () => {
    const chat = buildChat([
      [{ type: 'text', text: 'one' }],
      [{ type: 'text', text: 'two' }],
      [{ type: 'text', text: 'three' }],
    ]);

    chat.setLevel('off');
    await chat.send('first');
    chat.setLevel('summary');
    await chat.send('second');
    chat.setLevel('off');
    await chat.send('third');

    const sinks = chat.requests.map(
      (request) => typeof request.metadata?.[RAW_TOKEN_DELTA_SINK_KEY],
    );
    expect(sinks).toStrictEqual(['undefined', 'function', 'undefined']);

    // The request sent after switching on is timed from its own start: its
    // raw delta stamped the token window.
    const records = chat.records();
    expect(records).toHaveLength(1);
    expect(records[0].prompt_id).toBe(`${SESSION_ID}#prompt-2`);
    expect(records[0].timing_source).toBe('raw');
    expect(typeof records[0].ttft_ms).toBe('number');
    expect(typeof records[0].provider_request_ms).toBe('number');
  });
});
