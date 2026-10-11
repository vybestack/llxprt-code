import { createSessionSettingsFixture } from './session-settings-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';

import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';

import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ApprovalMode,
  fromConfig,
  toConfigParameters,
  type Agent,
  type AgentSchedulerFactory,
} from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';

export function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function responseChunk(child: boolean, launch: boolean): string {
  const delta = launch
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'launch-real-child',
            type: 'function',
            function: {
              name: 'task',
              arguments: JSON.stringify({
                subagent_name: 'disposal-child',
                goal_prompt: 'Return the word completed.',
                async: true,
              }),
            },
          },
        ],
      }
    : { role: 'assistant', content: child ? 'child completed' : 'launched' };
  return (
    [
      {
        id: child ? 'child-response' : 'parent-response',
        object: 'chat.completion.chunk',
        model: child ? 'child-model' : 'parent-model',
        choices: [{ index: 0, delta, finish_reason: null }],
      },
      {
        id: child ? 'child-response' : 'parent-response',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: launch ? 'tool_calls' : 'stop',
          },
        ],
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  );
}

export interface DisposalJoinFixture {
  readonly manager: AsyncTaskManager;
  readonly agent: Agent;
  readonly adoptSibling: () => Promise<Agent>;
  readonly siblingWork: ReturnType<typeof createHeldFetch>;
  readonly config: Config;
  readonly settingsOwner: ReturnType<
    typeof createSessionSettingsFixture
  >['settingsOwner'];
  readonly workspacePaths: McpRuntimeOwner['workspacePaths'];
  readonly workspaceTrust: McpRuntimeOwner['trust'];
  readonly instructionReads: McpRuntimeOwner['workspaceMemory']['operations'];
  readonly readMcpInstructions: McpRuntimeOwner['readInstructions'];
  readonly entered: ReturnType<typeof gate>;
  readonly releaseWork: () => void;
  readonly workSettled: Promise<void>;
  readonly childStatus: Promise<string>;
  readonly timeline: string[];
  readonly isWorkSettled: () => boolean;
  readonly signal: () => AbortSignal | undefined;
}

function createHeldFetch(
  childUrl: string,
  timeline: string[],
): Omit<
  DisposalJoinFixture,
  | 'manager'
  | 'agent'
  | 'childStatus'
  | 'timeline'
  | 'adoptSibling'
  | 'siblingWork'
  | 'settingsOwner'
  | 'config'
  | 'workspacePaths'
  | 'workspaceTrust'
  | 'instructionReads'
  | 'readMcpInstructions'
> & {
  restore: () => void;
} {
  const original = globalThis.fetch;
  const entered = gate();
  const released = gate();
  const settled = gate();
  let workSettled = false;
  let signal: AbortSignal | undefined;
  const heldFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${childUrl}/chat/completions`) return original(input, init);
    const body = z
      .object({ model: z.literal('child-model') })
      .parse(await new Request(input, init).json());
    timeline.push(`fetch-entered:${body.model}`);
    signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal === undefined)
      throw new Error('Child fetch has no abort signal');
    const onAbort = (): void => {
      timeline.push('fetch-abort-observed');
    };
    signal.addEventListener('abort', onAbort, { once: true });
    entered.release();
    try {
      await released.promise;
      if (signal.aborted) throw signal.reason;
      return new Response(responseChunk(true, false), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    } finally {
      signal.removeEventListener('abort', onAbort);
      workSettled = true;
      timeline.push('fetch-settled');
      settled.release();
    }
  };
  globalThis.fetch = heldFetch;
  return {
    entered,
    releaseWork: (): void => {
      timeline.push('fetch-release');
      released.release();
    },
    workSettled: settled.promise,
    isWorkSettled: (): boolean => workSettled,
    signal: (): AbortSignal | undefined => signal,
    restore: (): void => {
      globalThis.fetch = original;
    },
  };
}

async function createParentServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  let requests = 0;
  const server = createServer((request, response) => {
    void (async () => {
      for await (const _chunk of request) {
        // Consume the request before returning a keep-alive response.
      }
      requests += 1;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(responseChunk(false, requests === 1));
    })().catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('No HTTP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: async (): Promise<void> => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function bindSibling(
  config: Config,
  runtime: McpRuntimeOwner,
  siblings: Agent[],
  manager: AsyncTaskManager,
  settingsRoot: ReturnType<typeof createSessionSettingsFixture>,
): DisposalJoinFixture['adoptSibling'] {
  return adoptSibling.bind(
    undefined,
    config,
    runtime,
    siblings,
    manager,
    settingsRoot,
  );
}

export async function withDisposalJoinFixture(
  scenario: (fixture: DisposalJoinFixture) => Promise<void>,
  toolSchedulerFactory?: AgentSchedulerFactory,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'async-child-disposal-join-'));
  const server = await createParentServer();
  const timeline: string[] = [];
  const external = createHeldFetch(`${server.baseUrl}/child`, timeline);
  const siblingWork = createHeldFetch(`${server.baseUrl}/sibling`, []);
  const siblings: Agent[] = [];
  const manager = new AsyncTaskManager(5);
  let mcpRuntime: McpRuntimeOwner | undefined;
  let config: Config | undefined;
  let agent: Agent | undefined;
  let childStatus: Promise<string> | undefined;
  const errors: unknown[] = [];
  try {
    config = await createChildConfig(directory, server.baseUrl);
    mcpRuntime = await McpRuntimeOwner.create(createTestOAuthBinding(), config);
    const settingsRoot = createSessionSettingsFixture(config);
    agent = await adoptParent(
      config,
      mcpRuntime,
      manager,
      settingsRoot,
      server.baseUrl,
      toolSchedulerFactory,
    );
    childStatus = observeTerminalTask(manager, timeline);
    const adopt = bindSibling(
      config,
      mcpRuntime,
      siblings,
      manager,
      settingsRoot,
    );
    await scenario({
      agent,
      manager,
      ...external,
      timeline,
      childStatus,
      siblingWork,
      settingsOwner: settingsRoot.settingsOwner,
      config,
      adoptSibling: adopt,
      workspaceTrust: mcpRuntime.trust,
      workspacePaths: mcpRuntime.workspacePaths,
      instructionReads: mcpRuntime.workspaceMemory.operations,
      readMcpInstructions: mcpRuntime.readInstructions,
    });
  } catch (error) {
    errors.push(error);
  } finally {
    external.releaseWork();
    siblingWork.releaseWork();
    await collectFixtureReleases(errors, [
      async (): Promise<void> => {
        if (external.signal()) await external.workSettled;
      },
      async (): Promise<void> => {
        if (external.signal()) await childStatus;
      },
      async (): Promise<void> => agent?.dispose(),
      ...siblings.map(
        (sibling) => async (): Promise<void> => sibling.dispose(),
      ),
      async (): Promise<void> => mcpRuntime?.dispose(),
      async (): Promise<void> => config?.dispose(),
      async (): Promise<void> => server.close(),
      async (): Promise<void> =>
        rm(directory, { recursive: true, force: true }),
    ]);
    siblingWork.restore();
    external.restore();
  }
  if (errors.length > 0)
    throw new AggregateError(errors, 'Disposal join fixture failed');
}

async function adoptSibling(
  config: Config,
  mcpRuntime: McpRuntimeOwner,
  siblings: Agent[],
  manager: AsyncTaskManager,
  parentSettings: ReturnType<typeof createSessionSettingsFixture>,
): Promise<Agent> {
  const siblingSettings = createSessionSettingsFixture(
    config,
    parentSettings.settingsOwner.createChildStore(),
  );
  const sibling = await fromConfig({
    settingsOwner: siblingSettings.settingsOwner,
    settingsService: siblingSettings.settingsService,
    config,
    asyncTaskManager: manager,
    mcpRuntime,
    mcpOwnership: 'caller',
  });
  siblings.push(sibling);
  return sibling;
}

async function createChildConfig(
  directory: string,
  baseUrl: string,
): Promise<Config> {
  const profiles = new ProfileManager(join(directory, 'profiles'));
  await profiles.saveProfile('disposal-child', {
    version: 1,
    provider: 'openai',
    model: 'child-model',
    modelParams: {},
    ephemeralSettings: {
      'auth-key': 'local-test-key',
      'base-url': `${baseUrl}/child`,
    },
  });
  const subagents = new SubagentManager(join(directory, 'subagents'), profiles);
  await subagents.saveSubagent(
    'disposal-child',
    'disposal-child',
    'Complete the requested task.',
  );
  await profiles.saveProfile('sibling-child', {
    version: 1,
    provider: 'openai',
    model: 'child-model',
    modelParams: {},
    ephemeralSettings: {
      'auth-key': 'local-test-key',
      'base-url': `${baseUrl}/sibling`,
    },
  });
  await subagents.saveSubagent(
    'sibling-child',
    'sibling-child',
    'Complete the requested task.',
  );
  const config = new Config({
    ...toConfigParameters({
      provider: 'openai',
      model: 'parent-model',
      workingDir: directory,
      approvalMode: ApprovalMode.YOLO,
      folderTrust: true,
      interactive: false,
      coreTools: ['task', 'check_async_tasks'],
      telemetry: { enabled: false },
      recording: { enabled: false },
    }),
    profileDirectory: join(directory, 'profiles'),
    subagentDirectory: join(directory, 'subagents'),
    sessionId: 'async-child-disposal-session',
  });
  return config;
}

function observeTerminalTask(
  manager: AsyncTaskManager,
  timeline: string[],
): Promise<string> {
  return new Promise<string>((resolve) => {
    const terminal = (task: { status: string }): void => {
      timeline.push(`task-terminal:${task.status}`);
      resolve(task.status);
    };
    manager.onTaskCompleted(terminal);
    manager.onTaskFailed(terminal);
    manager.onTaskCancelled(terminal);
  });
}

async function collectFixtureReleases(
  errors: unknown[],
  releases: ReadonlyArray<() => Promise<void>>,
): Promise<void> {
  for (const release of releases) {
    await release().catch((error: unknown) => {
      errors.push(error);
    });
  }
}

async function adoptParent(
  config: Config,
  mcpRuntime: McpRuntimeOwner,
  manager: AsyncTaskManager,
  settingsRoot: ReturnType<typeof createSessionSettingsFixture>,
  baseUrl: string,
  toolSchedulerFactory?: AgentSchedulerFactory,
): Promise<Agent> {
  return fromConfig({
    config,
    mcpRuntime,
    toolSchedulerFactory,
    asyncTaskManager: manager,
    settingsOwner: settingsRoot.settingsOwner,
    settingsService: settingsRoot.settingsService,
    mcpOwnership: 'caller',
    activation: {
      provider: 'openai',
      model: 'parent-model',
      cliOverrides: { key: 'local-test-key', baseUrl },
    },
  });
}
