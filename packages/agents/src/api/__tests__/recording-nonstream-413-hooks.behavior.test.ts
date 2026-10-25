import {
  jsonlHookCommand,
  removeJsonlHook,
} from './helpers/jsonl-hook-command.js';
import { useRecordingPrompts } from './helpers/recording-owner-lifetime-fixture.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { HookControl } from '../control/hooks.js';
import {
  readHookDefinitions,
  hookSessionRuntime,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent, toConfigParameters } from '@vybestack/llxprt-code-agents';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { fromConfig } from '../fromConfig.js';
import type { AgentHooks } from '../config-types.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../core/subagent-cleanup.js';
import { CompressionStrategy } from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  MessageBusType,
  type HookExecutionRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import * as compressionFactory from '../../compression/compressionStrategyFactory.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

interface ContextLimitServer {
  readonly baseUrl: string;
  readonly requestCount: () => number;
  readonly close: () => Promise<void>;
}

/**
 * A local OpenAI-compatible endpoint that rejects every odd request with HTTP
 * 413 and answers every even request with a streamed completion.
 */
async function startContextLimitServer(): Promise<ContextLimitServer> {
  let requests = 0;
  const server = createServer((request, response) => {
    const number = ++requests;
    request.resume();
    request.once('end', () => {
      if (number % 2 === 1) {
        response.writeHead(413, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            error: { message: 'Request exceeds the maximum size' },
          }),
        );
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(
        `data: ${JSON.stringify({ id: 'recovered', object: 'chat.completion.chunk', model: 'wire-model', choices: [{ index: 0, delta: { content: 'recovered reply' }, finish_reason: 'stop' }] })}

data: [DONE]

`,
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing local provider port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requestCount: () => requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

interface HookedAgent {
  readonly agent: Agent;
  readonly config: Config;
}

/**
 * One agent built through `fromConfig` over the test's own `Config`
 * (`AgentConfig` carries no `enableHooks`), pointed at a local OpenAI-compatible
 * endpoint.
 */
async function openHookedAgent(
  directory: string,
  baseUrl: string,
  hooks: AgentHooks,
  authority: CredentialAuthority,
): Promise<HookedAgent> {
  const parameters = {
    ...toConfigParameters({
      provider: 'openai',
      model: 'wire-model',
      sessionId: randomUUID(),
      workingDir: directory,
      continueOnFailedApiCall: true,
      hooks,
    }),
    interactive: true,
    enableHooks: true,
  };
  parameters.includeDirectories = [
    ...(parameters.includeDirectories ?? []),
    process.cwd(),
  ];
  const config = new Config(parameters);
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  try {
    const agent = await fromConfig(
      config,
      settings,
      {
        activation: {
          provider: 'openai',
          model: 'wire-model',
          cliOverrides: { key: 'local-test-key', baseUrl },
        },
      },
      authority,
    );
    return { agent, config };
  } catch (primary) {
    return cleanupAfterFailure(primary, () => config.dispose());
  }
}

/**
 * Same four facade states as `exerciseFacades` over two independent agents
 * (own `Config`, client, history and journal) that share one working
 * directory and one hook command.
 */
async function exerciseIndependentFacades(
  event: HookEventName,
  baseUrl: string,
  authority: CredentialAuthority,
  drive: (agent: Agent) => Promise<void>,
): Promise<number> {
  const output = join(
    tmpdir(),
    `recording-nonstream-hooks-${randomUUID()}.jsonl`,
  );
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'recording-nonstream-agents-')),
  );
  const hooks: AgentHooks = {
    [event]: [
      {
        hooks: [{ type: HookType.Command, command: jsonlHookCommand(output) }],
      },
    ],
  };
  const opened: HookedAgent[] = [];
  try {
    const first = await openHookedAgent(directory, baseUrl, hooks, authority);
    opened.push(first);
    const second = await openHookedAgent(directory, baseUrl, hooks, authority);
    opened.push(second);
    const a = first.agent;
    const b = second.agent;
    const seed = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'seed' }],
      },
    ];
    await a.setHistory(seed);
    await b.setHistory(seed);
    await a.session.setRecording({ enabled: true });
    const aPath = pathOf(a);
    await b.session.setRecording({ enabled: true });
    const bPath = pathOf(b);
    await drive(a);
    await drive(b);
    await a.session.setRecording({ enabled: false });
    await drive(a);
    await a.session.resume('latest');
    const resumedPath = pathOf(a);
    await drive(a);
    const matched = (await inputsAt(output)).filter(
      (input) => input.hook_event_name === event,
    );
    expect(
      matched.map((input) => [input.transcript_path, input.session_id]),
    ).toStrictEqual([
      [aPath, a.getRuntimeId()],
      [bPath, b.getRuntimeId()],
      ['', a.getRuntimeId()],
      [resumedPath, a.getRuntimeId()],
    ]);
    expect(a.getRuntimeId()).not.toBe(b.getRuntimeId());
    return matched.length;
  } finally {
    await runCleanupSteps([
      ...[...opened].reverse().map(
        ({ agent }) =>
          () =>
            agent.dispose(),
      ),
      ...[...opened].reverse().map(
        ({ config }) =>
          () =>
            config.dispose(),
      ),
      () => removeJsonlHook(output),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  }
}

describe('shared client non-stream and context-size 413 hook owner', () => {
  useRecordingPrompts();
  const credentials = useOwnedCredentials();
  it('attributes PreCompress on real 413 context recovery and retries the original facade stream', async () => {
    const strategySpy = spyOn(
      compressionFactory,
      'getCompressionStrategy',
    ).mockReturnValue(strategy);
    const server = await startContextLimitServer();
    let surfaced413 = 0;
    let returnedContent = 0;
    try {
      await exerciseIndependentFacades(
        HookEventName.PreCompress,
        server.baseUrl,
        credentials().authority,
        async (agent) => {
          agent.setEphemeralSetting('context-limit', 200000);
          for await (const event of agent.stream('retry original request')) {
            if (event.type === 'error' && event.error.status === 413) {
              surfaced413++;
            }
            if (event.type === 'text') returnedContent++;
          }
        },
      );
      expect(server.requestCount()).toBe(8);
      expect(surfaced413).toBe(0);
      expect(returnedContent).toBeGreaterThanOrEqual(4);
    } finally {
      strategySpy.mockRestore();
      await server.close();
    }
  }, 30000);
});

describe('HookControl bus-mediated hook attribution', () => {
  it('runs an unbound mediated bus command without attributing either control transcript', async () => {
    const output = join(
      tmpdir(),
      `recording-unbound-hooks-${randomUUID()}.jsonl`,
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'recording-unbound-hooks-')),
    );
    const config = new Config({
      sessionId: 'unbound-mediated-hooks',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
      enableHooks: true,
      trustedFolder: true,
      hooks: {
        [HookEventName.BeforeTool]: [
          {
            hooks: [
              { type: HookType.Command, command: jsonlHookCommand(output) },
            ],
          },
        ],
      },
    });
    const bus = new MessageBus();
    const owner = new SessionHookOwner(
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
      true,
      bus,
    );
    const agentTranscript = join(directory, 'agent-transcript.jsonl');
    const siblingTranscript = join(directory, 'sibling-transcript.jsonl');
    const controlOver = (
      sessionId: string,
      transcriptPath: string,
    ): HookControl =>
      new HookControl({
        hookOperations: owner,
        observeRequests: (listener) =>
          bus.subscribe(MessageBusType.HOOK_EXECUTION_REQUEST, listener),
        observeResponses: (listener) =>
          bus.subscribe(MessageBusType.HOOK_EXECUTION_RESPONSE, listener),
        sessionId: () => sessionId,
        cwd: () => directory,
        transcriptPath: () => transcriptPath,
      });
    const control = controlOver('agent-session', agentTranscript);
    const sibling = controlOver('sibling-session', siblingTranscript);
    try {
      await owner.reloadDefinitions();
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
      expect(inputs[0].transcript_path).not.toBe(agentTranscript);
      expect(inputs[0].transcript_path).not.toBe(siblingTranscript);
    } finally {
      control.detach();
      sibling.detach();
      await runCleanupSteps([
        () => owner.dispose(),
        () => config.dispose(),
        () => removeJsonlHook(output),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  }, 30000);
});
