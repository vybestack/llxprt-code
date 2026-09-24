/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  MessageBusType,
  ToolConfirmationOutcome,
  type Config,
  type ToolConfirmationRequest,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { bootstrapRuntimeAndConfig } from './cliSessionBootstrap.js';
import { LoadedSettings } from './config/settings.js';
import { parseArguments } from './config/cliArgParser.js';
import { createForegroundAgent } from './cliAgentBootstrap.js';
import { buildUiRuntimeFromSource } from './ui/cliUiRuntime.js';
import { __resetCleanupStateForTesting } from './utils/cleanup.js';

const originalArgv = process.argv;
const originalFakeResponses = process.env.LLXPRT_FAKE_RESPONSES;
const cleanups: Array<() => Promise<void>> = [];

async function bootstrap(): Promise<{
  config: Config;
  agent: Agent;
}> {
  const cwd = await mkdtemp(join(tmpdir(), 'cli-approval-b2-'));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
    new URL(
      '../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
      import.meta.url,
    ),
  );
  process.argv = [
    'bun',
    'llxprt',
    '--provider',
    'fake',
    '--model',
    'fake-model',
    '--prompt-interactive',
    'approve',
  ];
  const argv = await parseArguments({});
  const empty = { settings: {}, path: cwd };
  const settings = new LoadedSettings(
    empty,
    empty,
    empty,
    {
      settings: { security: { disableOsKeyring: true } },
      path: cwd,
    },
    true,
  );
  const { config, messageBus } = await bootstrapRuntimeAndConfig(
    settings,
    argv,
    cwd,
  );
  config.adoptSessionId('same-label');
  cleanups.push(() => config.dispose());
  cleanups.push(async () => {
    messageBus.removeAllListeners();
  });
  const agent = await createForegroundAgent({ config, messageBus });
  cleanups.push(() => agent.dispose());
  expect(agent.getMessageBus()).toBe(messageBus);
  return { config, agent };
}

async function pendingApproval(
  config: Config,
  agent: Agent,
  executed: string[],
): Promise<{ request: ToolConfirmationRequest; completed: Promise<void> }> {
  const bus = agent.getMessageBus();
  agent.getToolRegistry().registerTool(
    new MockTool({
      name: 'approval_probe',
      messageBus: bus,
      shouldConfirmExecute: async () => ({
        type: 'exec',
        title: 'probe',
        command: 'probe',
        rootCommand: 'probe',
        rootCommands: ['probe'],
        onConfirm: async () => {},
      }),
      execute: async () => {
        executed.push('executed');
        return { llmContent: 'completed', returnDisplay: 'completed' };
      },
    }),
  );
  const request = new Promise<ToolConfirmationRequest>((resolveRequest) => {
    const unsubscribe = bus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (message) => {
        unsubscribe();
        resolveRequest(message);
      },
    );
  });
  let finish: () => void;
  const completed = new Promise<void>((resolveCompletion) => {
    finish = resolveCompletion;
  });
  const ui = buildUiRuntimeFromSource(config, agent);
  const scheduler = await ui.scheduler.getOrCreateScheduler(
    { label: 'same-label' },
    'session',
    {
      onAllToolCallsComplete: async () => {
        finish();
      },
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    },
    { interactiveMode: true },
  );
  await scheduler.schedule(
    [
      {
        callId: 'same-call',
        name: 'approval_probe',
        args: {},
        isClientInitiated: false,
        prompt_id: 'same-prompt',
      },
    ],
    new AbortController().signal,
  );
  return { request: await request, completed };
}

function approve(agent: Agent, request: ToolConfirmationRequest): void {
  agent.getMessageBus().publish({
    type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
    correlationId: request.correlationId,
    outcome: ToolConfirmationOutcome.ProceedOnce,
  } satisfies ToolConfirmationResponse);
}

describe('CLI session approval bus ownership', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    process.argv = originalArgv;
    if (originalFakeResponses === undefined) {
      delete process.env.LLXPRT_FAKE_RESPONSES;
    } else {
      process.env.LLXPRT_FAKE_RESPONSES = originalFakeResponses;
    }
    __resetCleanupStateForTesting();
  });
  it('executes a UI approval through the bootstrapped Agent own bus after Config adoption', async () => {
    const { config, agent } = await bootstrap();
    const executed: string[] = [];
    const pending = await pendingApproval(config, agent, executed);
    expect(executed).toStrictEqual([]);
    approve(agent, pending.request);
    await pending.completed;
    expect(executed).toStrictEqual(['executed']);
  });

  it('keeps same-label sessions isolated after disposing one', async () => {
    const first = await bootstrap();
    const second = await bootstrap();
    const firstExecuted: string[] = [];
    const secondExecuted: string[] = [];
    const a = await pendingApproval(first.config, first.agent, firstExecuted);
    const b = await pendingApproval(
      second.config,
      second.agent,
      secondExecuted,
    );
    approve(first.agent, b.request);
    expect(secondExecuted).toStrictEqual([]);
    await first.agent.dispose();
    await a.completed;
    approve(second.agent, b.request);
    await b.completed;
    expect(firstExecuted).toStrictEqual([]);
    expect(secondExecuted).toStrictEqual(['executed']);
    const next = await pendingApproval(
      second.config,
      second.agent,
      secondExecuted,
    );
    approve(second.agent, next.request);
    await next.completed;
    expect(secondExecuted).toStrictEqual(['executed', 'executed']);
  });

  it('does not retain an implicit approval bus on the adopted Config', async () => {
    const { config } = await bootstrap();
    expect(Reflect.has(config, 'runtimeMessageBus')).toBe(false);
    expect(Reflect.has(config, 'getRuntimeMessageBus')).toBe(false);
    expect(Reflect.has(config, 'setRuntimeMessageBus')).toBe(false);
  });
});
