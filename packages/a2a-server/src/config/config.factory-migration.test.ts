/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260629-ISSUE2285.P04
 * @requirement:REQ-004
 *
 * Behavior verification for the public-factory migration of A2A config
 * construction. Proves that the `agentClientFactory` and
 * `toolSchedulerFactory` lambdas inside `createBaseConfigParameters(...)`
 * produce real agent clients / tool schedulers (with the PUBLIC dispatch
 * methods A2A actually calls) after migrating from
 * `new AgentClient(...)` / `new CoreToolScheduler(...)` to the curated
 * public factories `createAgentClient(...)` / `createToolScheduler(...)`.
 *
 * Anti-mock-theater: the sendMessageStream assertion drives the REAL
 * client.sendMessageStream method (through the real orchestrator and Turn)
 * with a stub injected at the model-response seam (the ChatSession), then
 * observes the ACTUAL emitted ServerGeminiStreamEvent content matching the
 * stub reply. It does not stub sendMessageStream itself or assert mock
 * call counts.
 */

import { tmpdir } from 'node:os';

import { describe, it, expect } from 'vitest';
import {
  Config,
  type ConfigParameters,
  ApprovalMode,
} from '@vybestack/llxprt-code-core/config/config.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentClient } from '@vybestack/llxprt-code-agents';
import { createToolScheduler } from '@vybestack/llxprt-code-agents';
import {
  GeminiEventType,
  type AgentClientContract,
  type ToolSchedulerContract,
  type ServerGeminiStreamEvent,
} from '@vybestack/llxprt-code-core';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import {
  StreamEventType,
  type StreamEvent,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

/**
 * The deterministic stub reply the model-provider seam returns. The test
 * asserts the factory-produced client's REAL sendMessageStream emits this
 * exact content.
 */
const STUB_MODEL_REPLY = 'OK';

/**
 * Builds a minimal but REAL Config (constructed via the same `new Config(...)`
 * path A2A's `loadConfig` uses — NOT a cast, NOT a mock object). Only the
 * fields the Config constructor requires are populated; optional fields are
 * omitted. This is the exact builder recorded by preflight (P01 section 3).
 */
function createRealConfig(): Config {
  const workspaceDir = tmpdir();
  const params: ConfigParameters = {
    sessionId: 'factory-migration-session',
    targetDir: workspaceDir,
    cwd: workspaceDir,
    debugMode: false,
    model: 'gemini-2.0-flash',
    embeddingModel: 'text-embedding-004',
    approvalMode: ApprovalMode.DEFAULT,
  };
  return new Config(params);
}

function createRealRuntimeState(): AgentRuntimeState {
  return createAgentRuntimeState({
    runtimeId: 'factory-migration-runtime',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    sessionId: 'factory-migration-session',
  });
}

/**
 * Injects a stub at the model-response seam: a ChatSession whose
 * sendMessageStream yields a single CHUNK containing the stub reply text,
 * plus a minimal ContentGenerator so the client reports as initialized.
 *
 * This stubs the MODEL PROVIDER boundary (the chat session is where the
 * provider response enters the agent runtime), NOT the client's
 * sendMessageStream dispatch method. The real sendMessageStream → orchestrator
 * → Turn pipeline executes end-to-end against this seam.
 */
function injectStubModelResponse(
  client: AgentClientContract,
  replyText: string,
): void {
  const internal = client as unknown as {
    chat?: unknown;
    contentGenerator?: ContentGenerator;
  };

  // A stub ContentGenerator so isInitialized() is true (chat + generator set).
  internal.contentGenerator = {
    generateContent: async () => ({}) as never,
    generateContentStream: async () => (async function* () {})() as never,
    countTokens: async () => ({ totalTokens: 0 }) as never,
    embedContent: async () => ({ embeddings: [] }) as never,
  };

  // A stub ChatSession whose sendMessageStream yields one CHUNK carrying the
  // stub reply, then completes. The Turn pipeline translates this CHUNK into
  // a ServerGeminiStreamEvent of type Content with the reply text. getConfig
  // returns undefined to disable the idle-timeout watchdog (0 ms = off).
  internal.chat = {
    getConfig: () => undefined,
    sendMessageStream: async () => {
      const chunkStreamEvent: StreamEvent = {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: { parts: [{ text: replyText }] },
              finishReason: 'STOP',
            },
          ],
        } as never,
      };
      return (async function* (): AsyncGenerator<StreamEvent> {
        yield chunkStreamEvent;
      })();
    },
    getHistory: () => [],
    setHistory: () => {},
    clearHistory: () => {},
    getHistoryService: () => null,
    wasRecentlyCompressed: () => false,
    performCompression: async () => PerformCompressionResult.SKIPPED_EMPTY,
    recordCompletedToolCalls: () => {},
    getLastPromptTokenCount: () => 0,
  };
}

describe('config factory migration — public factories produce real clients/schedulers', () => {
  it('createAgentClient produces a real agent client with a callable sendMessageStream dispatch method', () => {
    const config = createRealConfig();
    const runtimeState = createRealRuntimeState();

    const client: AgentClientContract = createAgentClient(config, runtimeState);

    // PUBLIC behavioral equivalence: the factory-produced client exposes the
    // ACTUAL dispatch method A2A calls (sendMessageStream — an async
    // generator). This proves the factory produced a real client, not a mock.
    expect(client).toBeDefined();
    expect(typeof client.sendMessageStream).toBe('function');
  });

  it('createToolScheduler produces a real scheduler with callable schedule/cancelAll/dispose methods', () => {
    const config = createRealConfig();

    const scheduler: ToolSchedulerContract = createToolScheduler({
      config,
      // The scheduler factory options mirror the shape A2A's config passes.
      // We provide minimal real dependencies, not mocks of the scheduler.
      messageBus: {
        subscribe: () => () => {},
        publish: () => {},
        respondToConfirmation: () => {},
        requestConfirmation: async () => true,
        removeAllListeners: () => {},
        listenerCount: () => 0,
      } as unknown as Parameters<typeof createToolScheduler>[0]['messageBus'],
      toolRegistry: {
        getAllTools: () => [],
        getAllToolNames: () => [],
        getToolsByServer: () => [],
        getTool: () => undefined,
      } as unknown as Parameters<typeof createToolScheduler>[0]['toolRegistry'],
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    // PUBLIC behavioral equivalence: the factory-produced scheduler exposes
    // the ACTUAL methods A2A's Task calls (schedule, cancelAll, dispose).
    expect(scheduler).toBeDefined();
    expect(typeof scheduler.schedule).toBe('function');
    expect(typeof scheduler.cancelAll).toBe('function');
    expect(typeof scheduler.dispose).toBe('function');
  });

  it('factory-produced client sendMessageStream drives the real dispatch pipeline and emits content matching the stub model reply', async () => {
    const config = createRealConfig();
    const runtimeState = createRealRuntimeState();
    const client = createAgentClient(config, runtimeState);

    // Inject the stub at the MODEL-PROVIDER seam (the chat session), NOT at
    // sendMessageStream. The real sendMessageStream → orchestrator → Turn
    // pipeline executes against this seam.
    injectStubModelResponse(client, STUB_MODEL_REPLY);

    // Drive the REAL dispatch method. Collect every emitted event.
    const collectedEvents: ServerGeminiStreamEvent[] = [];
    const stream = client.sendMessageStream(
      [{ text: 'factory-migration-probe' }],
      new AbortController().signal,
      'factory-migration-prompt',
    );
    try {
      for await (const event of stream) {
        collectedEvents.push(event);
      }
    } catch (err) {
      throw new Error(
        `sendMessageStream pipeline threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Observable behavior: the REAL dispatch pipeline emitted at least one
    // Content event whose value equals the stub model reply. This proves the
    // factory-produced client is a real, working client — not a mock that
    // merely has the method name.
    const contentEvents = collectedEvents.filter(
      (e) => e.type === GeminiEventType.Content,
    );
    expect(contentEvents.length).toBeGreaterThan(0);
    const emittedText = contentEvents
      .map((e) => (e as { value: string }).value)
      .join('');
    expect(emittedText).toContain(STUB_MODEL_REPLY);
  });
});
