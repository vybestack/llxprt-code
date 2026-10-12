import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';
import { afterEach as closeInvocationRoots } from 'bun:test';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
const retainedInvocationOwners: SessionSettingsOwner[] = [];
closeInvocationRoots(async () => {
  for (const owner of retainedInvocationOwners.splice(0)) await owner.dispose();
});
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test helpers for stream-pipeline characterization tests (P06).
 *
 * Provides the REAL agent-loop machinery with ONLY the provider
 * AsyncIterable<IContent> mocked:
 *
 * Full-loop harness: REAL Turn → ChatSession → TurnProcessor →
 *    StreamProcessor → HistoryService, with a mock provider whose
 *    generateChatCompletion yields IContent chunks.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P06
 */

import type {
  ToolDeclaration,
  CanonicalFinishReason,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { vi, type Mock } from 'bun:test';
import { ChatSession } from '../chatSession.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from '../turn.js';
import type { ServerAgentStreamEvent, ServerFinishedEvent } from '../turn.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { TestRuntimeProviderManager } from '../../test-utils/runtimeProviderManager.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ContentBlock,
  ThinkingBlock,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createConfigParams } from '../chatSession-runtime-helpers.js';

// ---------------------------------------------------------------------------
// IContent chunk factories — the ONLY mock boundary
// ---------------------------------------------------------------------------

export function textIContent(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
  };
}

export function thinkingIContent(
  thought: string,
  signature?: string,
): IContent {
  const block: ThinkingBlock = {
    type: 'thinking',
    thought,
    isHidden: true,
    sourceField: 'thought',
  };
  if (signature !== undefined) {
    block.signature = signature;
  }
  return { speaker: 'ai', blocks: [block] };
}

export function toolCallIContent(
  id: string,
  name: string,
  args: Record<string, unknown>,
): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id, name, parameters: args }],
  };
}

export function terminalIContent(
  text: string | undefined,
  finishReason: CanonicalFinishReason,
  usage?: Partial<UsageStats>,
): IContent {
  const blocks: ContentBlock[] = [];
  if (text !== undefined) {
    blocks.push({ type: 'text', text });
  }
  const content: IContent = {
    speaker: 'ai',
    blocks,
    metadata: { finishReason },
  };
  if (usage) {
    content.metadata!.usage = {
      ...usage,
      promptTokens: usage.promptTokens ?? 0,
      completionTokens: usage.completionTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
    };
  }
  return content;
}

/**
 * Creates an async generator that yields the given IContent chunks.
 * This is the provider-side stream — the ONLY mock in the tests.
 */
export async function* makeProviderStream(
  chunks: IContent[],
): AsyncGenerator<IContent> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ---------------------------------------------------------------------------
// Full-loop harness: REAL Turn + ChatSession with mock provider
// ---------------------------------------------------------------------------

export interface FullLoopHarness {
  chat: ChatSession;
  turn: Turn;
  historyService: HistoryService;
  provider: IProvider;
  generateChatCompletionMock: Mock<
    (...args: never[]) => AsyncIterableIterator<IContent>
  >;
  config: Config;
}

export function createFullLoopHarness(
  generateChatCompletionMock: Mock<
    (...args: never[]) => AsyncIterableIterator<IContent>
  >,
  options?: {
    tools?: ToolDeclaration[];
    hookConfig?: Config;
    historyService?: HistoryService;
  },
): FullLoopHarness {
  const settingsService = new SettingsService();
  const config = new Config(createConfigParams(settingsService));

  seedStubProviderSettings(settingsService);

  const providerRuntime = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'test.runtime',
    metadata: { source: 'p06.characterization' },
  });

  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  configureProviderRuntimeFactories(config, manager);

  const provider = scriptedStreamProvider(generateChatCompletionMock);

  manager.registerProvider(provider);

  const runtimeState = createAgentRuntimeState({
    runtimeId: 'runtime-test',
    provider: provider.name,
    model: config.getModel(),
    sessionId: config.getSessionId(),
  });
  const historyService = options?.historyService ?? new HistoryService();
  const effectiveConfig = options?.hookConfig ?? config;
  const invocationOwner = createSessionSettingsFixture(config).settingsOwner;
  retainedInvocationOwners.push(invocationOwner);
  const view = createAgentRuntimeContext({
    prepareProviderInvocation: (name, parameters, signal) =>
      invocationOwner.prepareProviderInvocation(
        runtimeState.runtimeId,
        name,
        parameters,
        signal,
      ),
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 128000,
      preserveThreshold: 0.2,
      telemetry: {
        enabled: true,
        target: null,
      },
      'reasoning.includeInContext': true,
    },
    provider: createProviderAdapterFromManager(manager),
    telemetry: createTelemetryAdapter(config, invocationOwner.telemetry),
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    providerRuntime: { ...providerRuntime, config: effectiveConfig },
  });

  const generationConfig: Record<string, unknown> = {};
  if (options?.tools) {
    generationConfig['tools'] = options.tools;
  }

  const chat = new ChatSession(
    view,
    {} as unknown as ContentGenerator,
    generationConfig,
    [],
  );

  const turn = new Turn(chat, 'prompt-p06', DEFAULT_AGENT_ID, 'stub');

  return {
    chat,
    turn,
    historyService,
    provider,
    generateChatCompletionMock,
    config,
  };
}

/**
 * Drives the full loop (Turn.run → ChatSession.sendMessageStream →
 * StreamProcessor → provider) and collects all emitted
 * ServerAgentStreamEvent values.
 */
export async function runFullLoop(
  turn: Turn,
  message: string,
  signal?: AbortSignal,
): Promise<ServerAgentStreamEvent[]> {
  const events: ServerAgentStreamEvent[] = [];
  const iterator = turn.run(
    [{ text: message }],
    signal ?? new AbortController().signal,
  );
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Event extraction helpers (observable only — no {candidates}/.parts)
// ---------------------------------------------------------------------------

export function findFinished(
  events: ServerAgentStreamEvent[],
): ServerFinishedEvent | undefined {
  return events.find(
    (event): event is ServerFinishedEvent =>
      event.type === AgentEventType.Finished,
  );
}

function isThoughtSummaryValue(
  value: unknown,
): value is { subject?: string; description?: string } {
  return value !== null && typeof value === 'object';
}

function thoughtSummaryToText(value: {
  subject?: string;
  description?: string;
}): string {
  return [value.subject, value.description]
    .filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    )
    .join('\n');
}

export function extractContentText(events: ServerAgentStreamEvent[]): string {
  return events
    .filter((e) => e.type === AgentEventType.Content)
    .map((e) => (e as { value: string }).value)
    .join('');
}

export function extractThoughtText(events: ServerAgentStreamEvent[]): string[] {
  return events
    .filter((e) => e.type === AgentEventType.Thought)
    .map((e) => {
      const val = (e as { value: unknown }).value;
      if (typeof val === 'string') return val;
      if (isThoughtSummaryValue(val)) {
        return thoughtSummaryToText(val);
      }
      return String(val);
    });
}

export function extractToolCallRequests(
  events: ServerAgentStreamEvent[],
): Array<{ callId: string; name: string; args: unknown }> {
  return events
    .filter((e) => e.type === AgentEventType.ToolCallRequest)
    .map((e) => {
      const val = (e as { value: unknown }).value as {
        callId: string;
        name: string;
        args: unknown;
      };
      return { callId: val.callId, name: val.name, args: val.args };
    });
}

export function extractEventTypes(events: ServerAgentStreamEvent[]): string[] {
  return events.map((e) => e.type);
}

function seedStubProviderSettings(settingsService: SettingsService): void {
  settingsService.set('providers.stub.base-url', 'https://stub.example.com');
  settingsService.set('providers.stub.auth-key', 'stub-api-key');
  settingsService.set('providers.stub.model', 'stub-model');
}

function scriptedStreamProvider(
  generateChatCompletionMock: FullLoopHarness['generateChatCompletionMock'],
): IProvider {
  return {
    name: 'stub',
    isDefault: true,
    getModels: vi.fn(async () => []),
    getDefaultModel: () => 'stub-model',
    generateChatCompletion: generateChatCompletionMock,
  };
}
