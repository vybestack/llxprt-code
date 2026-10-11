import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { HookControl } from '../control/hooks.js';
import {
  readHookDefinitions,
  hookSessionRuntime,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { CompressionStrategy } from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  MessageBusType,
  type HookExecutionRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { HookSystem } from '@vybestack/llxprt-code-core/hooks/hookSystem.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import * as compressionFactory from '../../compression/compressionStrategyFactory.js';
import { createRecordingExecution } from '../recordingExecution.js';
import { SessionControl } from '../control/sessionControl.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';
import type { BuiltCliConfig } from './helpers/buildCliStyleConfig.js';

interface CommandInput {
  hook_event_name: string;
  session_id: string;
  transcript_path: string;
}

function pathOf(agent: Agent): string {
  const path = agent.session.getRecording().path;
  if (!path) throw new Error('Missing recording path');
  return path;
}

function executionFor(agent: Agent): AgentChatRecordingExecution {
  if (!(agent.session instanceof SessionControl)) {
    throw new Error('Expected a real recording session');
  }
  if (!(agent.hooks instanceof HookControl))
    throw new Error('Expected real hook control');
  return createRecordingExecution(
    agent.session,
    () => agent.getRuntimeId(),
    agent.hooks,
  );
}

async function inputsAt(path: string): Promise<CommandInput[]> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

const strategy: CompressionStrategy = {
  name: 'one-shot',
  requiresLLM: false,
  trigger: { mode: 'threshold', defaultThreshold: 0.8 },
  compress: async (context) => ({
    kind: 'applied',
    newHistory: [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'short summary' }],
        metadata: { reason: 'compression-state-snapshot' },
      },
    ],
    metadata: {
      originalMessageCount: context.history.length,
      compressedMessageCount: 1,
      strategyUsed: 'one-shot',
      llmCallMade: false,
    },
  }),
};

async function exerciseFacades(
  event: HookEventName,
  drive: (agent: Agent, config: BuiltCliConfig['config']) => Promise<void>,
): Promise<number> {
  let observedCount = 0;
  const output = join(
    tmpdir(),
    `recording-nonstream-hooks-${randomUUID()}.jsonl`,
  );
  try {
    await withRecordingLifetimeFixture(
      async ({ agent: a, config, borrow }) => {
        const b = await borrow();
        expect(a.getMessageBus()).toBe(b.getMessageBus());
        expect(a.agentClient).toBeDefined();
        await a.agentClient.startChat();
        await a.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
        ]);
        await a.session.setRecording({ enabled: true });
        const aPath = pathOf(a);
        await b.session.setRecording({ enabled: true });
        const bPath = pathOf(b);
        await drive(a, config);
        await drive(b, config);
        await a.session.setRecording({ enabled: false });
        await drive(a, config);
        await a.session.resume('latest');
        const resumedPath = pathOf(a);
        await drive(a, config);
        const matched = (await inputsAt(output)).filter(
          (input) => input.hook_event_name === event,
        );
        observedCount = matched.length;
        expect(
          matched.map((input) => [input.transcript_path, input.session_id]),
        ).toStrictEqual([
          [aPath, a.getRuntimeId()],
          [bPath, b.getRuntimeId()],
          ['', a.getRuntimeId()],
          [resumedPath, a.getRuntimeId()],
        ]);
        expect(a.getRuntimeId()).not.toBe(b.getRuntimeId());
      },
      undefined,
      {
        hooks: {
          [event]: [
            {
              hooks: [
                {
                  type: HookType.Command,
                  command: `cat >> '${output}'; printf '\\n' >> '${output}'`,
                },
              ],
            },
          ],
        },
      },
      'recording-remaining-hooks.jsonl',
    );
    return observedCount;
  } finally {
    await rm(output, { force: true });
  }
}

describe('shared client non-stream and context-size 413 hook owner', () => {
  it('routes non-stream tool selection through the invoking facade without a shared owner slot', async () => {
    expect(
      await exerciseFacades(
        HookEventName.BeforeToolSelection,
        async (agent) => {
          const client = agent.agentClient;
          await client
            .getChat()
            .sendMessage(
              { message: 'non-stream' },
              `non-stream-${randomUUID()}`,
              executionFor(agent),
            );
        },
      ),
    ).toBe(4);
  }, 30000);

  it('routes non-stream automatic provider-content PreCompress through the invoking facade', async () => {
    const strategySpy = spyOn(
      compressionFactory,
      'getCompressionStrategy',
    ).mockReturnValue(strategy);
    try {
      expect(
        await exerciseFacades(HookEventName.PreCompress, async (agent) => {
          agent.setEphemeralSetting('context-limit', 4096);
          await agent.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'history '.repeat(9000) }],
            },
          ]);
          await agent.agentClient
            .getChat()
            .sendMessage(
              { message: 'short prompt' },
              `non-stream-compress-${randomUUID()}`,
              executionFor(agent),
            );
        }),
      ).toBe(4);
    } finally {
      strategySpy.mockRestore();
    }
  }, 30000);

  it('attributes PreCompress on real 413 context recovery and retries the original facade stream', async () => {
    const strategySpy = spyOn(
      compressionFactory,
      'getCompressionStrategy',
    ).mockReturnValue(strategy);
    let transportRequests = 0;
    let surfaced413 = 0;
    let returnedContent = 0;
    let restoreTransport: (() => void) | undefined;
    try {
      await exerciseFacades(
        HookEventName.PreCompress,
        async (agent, config) => {
          agent.setEphemeralSetting('context-limit', 200000);
          const manager = agent.providerManager;

          const provider = manager.getActiveProvider();
          if (!provider) throw new Error('Missing active fixture provider');
          if (transportRequests === 0) {
            const original = provider.generateChatCompletion.bind(provider);
            const descriptor = Object.getOwnPropertyDescriptor(
              provider,
              'generateChatCompletion',
            );
            spyOn(config, 'getContinueOnFailedApiCall').mockReturnValue(true);
            Object.defineProperty(provider, 'generateChatCompletion', {
              configurable: true,
              async *value(options: RuntimeGenerateChatOptions) {
                transportRequests++;
                if (transportRequests % 2 === 1) {
                  throw Object.assign(
                    new Error('Request exceeds the maximum size'),
                    { status: 413 },
                  );
                }
                yield* original(options);
              },
            });
            restoreTransport = () => {
              if (descriptor) {
                Object.defineProperty(
                  provider,
                  'generateChatCompletion',
                  descriptor,
                );
              } else {
                Reflect.deleteProperty(provider, 'generateChatCompletion');
              }
            };
          }
          for await (const event of agent.stream('retry original request')) {
            if (event.type === 'error' && event.error.status === 413) {
              surfaced413++;
            }
            if (event.type === 'text') returnedContent++;
          }
        },
      );
      expect(transportRequests).toBe(8);
      expect(surfaced413).toBe(0);
      expect(returnedContent).toBeGreaterThanOrEqual(4);
    } finally {
      restoreTransport?.();
      strategySpy.mockRestore();
    }
  }, 30000);

  it('runs an unbound mediated bus command without attributing a sibling transcript', async () => {
    const output = join(
      tmpdir(),
      `recording-unbound-hooks-${randomUUID()}.jsonl`,
    );
    try {
      await withRecordingLifetimeFixture(
        async ({ agent, config, borrow }) => {
          const sibling = await borrow();
          await agent.setHistory([
            { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
          ]);
          await agent.session.setRecording({ enabled: true });
          await sibling.session.setRecording({ enabled: true });
          const bus = agent.getMessageBus();
          const mediated = new HookSystem(
            readHookDefinitions(config),
            hookSessionRuntime(
              config,
              new WorkspaceTrustLifecycle({
                localTrust: config.initialWorkspaceTrust,
              }),
              RootTelemetry.prepare({
                enabled: false,
                sessionId: 'isolated-caller-fixture',
                maxBytes: 1024,
                maxFiles: 1,
              }),
            ),
            bus,
          );
          await mediated.initialize();
          const correlationId = randomUUID();
          const response = new Promise<boolean>((resolve) => {
            const unsubscribe = bus.subscribe(
              MessageBusType.HOOK_EXECUTION_RESPONSE,
              (message) => {
                if (
                  message.type === MessageBusType.HOOK_EXECUTION_RESPONSE &&
                  message.payload.correlationId === correlationId
                ) {
                  unsubscribe();
                  resolve(message.payload.success);
                }
              },
            );
          });
          const payload = {
            eventName: HookEventName.BeforeTool,
            input: { tool_name: 'read_file', tool_input: { path: 'x' } },
            correlationId,
          };
          const request: HookExecutionRequest = {
            type: MessageBusType.HOOK_EXECUTION_REQUEST,
            payload,
          };
          bus.publish(request);
          expect(await response).toBe(true);
          const inputs = await inputsAt(output);
          expect(inputs).toHaveLength(1);
          expect(inputs[0].transcript_path).toBe('');
          expect(inputs[0].transcript_path).not.toBe(pathOf(agent));
          expect(inputs[0].transcript_path).not.toBe(pathOf(sibling));
          await mediated.dispose();
        },
        undefined,
        {
          hooks: {
            [HookEventName.BeforeTool]: [
              {
                hooks: [
                  {
                    type: HookType.Command,
                    command: `cat >> '${output}'; printf '\\n' >> '${output}'`,
                  },
                ],
              },
            ],
          },
        },
      );
    } finally {
      await rm(output, { force: true });
    }
  }, 30000);
});
