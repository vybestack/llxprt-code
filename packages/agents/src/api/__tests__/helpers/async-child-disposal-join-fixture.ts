import {
  captureAgentAdoption,
  fixtureAgentResources,
} from './agent-resource-capture.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { createSessionSettingsFixture } from './session-settings-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';

import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ApprovalMode,
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

/** A held model request observed at the local responder. */
export interface HeldWork {
  readonly entered: ReturnType<typeof gate>;
  readonly releaseWork: () => void;
  readonly workSettled: Promise<void>;
  readonly isWorkSettled: () => boolean;
  readonly signal: () => AbortSignal | undefined;
  /** Settles once the child's connection to the held route has closed. */
  readonly aborted: Promise<void>;
}

/** A child model request as the local responder received it. */
export interface ChildModelRequest {
  readonly body: string;
  /** Aborts when the child closes its connection before the response ends. */
  readonly signal: AbortSignal;
}

export type ChildModelScript = (
  request: ChildModelRequest,
) => Promise<Response>;

type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export interface DisposalJoinFixture extends HeldWork {
  readonly manager: AsyncTaskManager;
  readonly agent: Agent;
  readonly client: AgentClientContract;
  readonly adoptSibling: () => Promise<Agent>;
  readonly siblingWork: HeldWork;
  /**
   * Answers child model requests from the script instead of holding them.
   * The returned function removes the script; teardown removes it too.
   */
  readonly scriptChildRequests: (script: ChildModelScript) => () => void;
  readonly config: Config;
  readonly settingsOwner: ReturnType<
    typeof createSessionSettingsFixture
  >['settingsOwner'];
  readonly workspacePaths: McpRuntimeOwner['workspacePaths'];
  readonly workspaceTrust: McpRuntimeOwner['trust'];
  readonly instructionReads: McpRuntimeOwner['workspaceMemory']['operations'];
  readonly readMcpInstructions: McpRuntimeOwner['readInstructions'];
  readonly childStatus: Promise<string>;
  readonly timeline: string[];
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(z.instanceof(Uint8Array).parse(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The signal aborts when the client drops the connection before the response
 * is written, which is how a child's own network reports a cancelled request.
 */
function watchClientAbort(
  request: IncomingMessage,
  response: ServerResponse,
): AbortSignal {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  response.once('close', () => {
    if (!response.writableFinished) abort();
  });
  request.socket.once('close', abort);
  return controller.signal;
}

async function writeWebResponse(
  response: ServerResponse,
  webResponse: Response,
): Promise<void> {
  const text = await webResponse.text();
  if (response.destroyed) return;
  response.writeHead(
    webResponse.status,
    Object.fromEntries(webResponse.headers),
  );
  response.end(text);
}

/**
 * Holds a model request at a real local route until the test releases it, so
 * the request travels over the child's own root network.
 */
function createHeldRoute(timeline: string[]): {
  work: HeldWork;
  handle: RouteHandler;
} {
  const entered = gate();
  const released = gate();
  const settled = gate();
  const aborted = gate();
  let workSettled = false;
  let signal: AbortSignal | undefined;
  const handle: RouteHandler = async (request, response) => {
    const body = z
      .object({ model: z.literal('child-model') })
      .parse(JSON.parse(await readRequestBody(request)));
    timeline.push(`fetch-entered:${body.model}`);
    const requestSignal = watchClientAbort(request, response);
    signal = requestSignal;
    const onAbort = (): void => {
      timeline.push('fetch-abort-observed');
    };
    requestSignal.addEventListener('abort', onAbort, { once: true });
    requestSignal.addEventListener('abort', aborted.release, { once: true });
    entered.release();
    try {
      await released.promise;
      if (!requestSignal.aborted) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(responseChunk(true, false));
      }
    } finally {
      requestSignal.removeEventListener('abort', onAbort);
      workSettled = true;
      timeline.push('fetch-settled');
      settled.release();
    }
  };
  return {
    work: {
      entered,
      releaseWork: (): void => {
        timeline.push('fetch-release');
        released.release();
      },
      workSettled: settled.promise,
      isWorkSettled: (): boolean => workSettled,
      signal: (): AbortSignal | undefined => signal,
      aborted: aborted.promise,
    },
    handle,
  };
}

interface ChildModelRoute {
  readonly handle: RouteHandler;
  readonly work: HeldWork;
  readonly script: (script: ChildModelScript) => () => void;
  readonly clearScript: () => void;
}

/** The child's model route: held by default, scripted when a test asks. */
function createChildModelRoute(timeline: string[]): ChildModelRoute {
  const held = createHeldRoute(timeline);
  let scripted: ChildModelScript | undefined;
  return {
    work: held.work,
    handle: async (request, response): Promise<void> => {
      if (scripted === undefined) {
        await held.handle(request, response);
        return;
      }
      const body = await readRequestBody(request);
      const signal = watchClientAbort(request, response);
      await writeWebResponse(response, await scripted({ body, signal }));
    },
    script: (script): (() => void) => {
      scripted = script;
      return (): void => {
        if (scripted === script) scripted = undefined;
      };
    },
    clearScript: (): void => {
      scripted = undefined;
    },
  };
}

async function startModelServer(timeline: string[]): Promise<{
  server: Awaited<ReturnType<typeof createParentServer>>;
  childRoute: ChildModelRoute;
  siblingWork: HeldWork;
}> {
  const childRoute = createChildModelRoute(timeline);
  const siblingRoute = createHeldRoute([]);
  const server = await createParentServer(
    new Map<string, RouteHandler>([
      ['/v1/child/chat/completions', childRoute.handle],
      ['/v1/sibling/chat/completions', siblingRoute.handle],
    ]),
  );
  return { server, childRoute, siblingWork: siblingRoute.work };
}

async function createParentServer(
  routes: ReadonlyMap<string, RouteHandler>,
): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  let requests = 0;
  const server = createServer((request, response) => {
    void (async () => {
      const route = routes.get(
        new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
      );
      if (route !== undefined) {
        await route(request, response);
        return;
      }
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

function createDisposalSettings(
  config: Config,
  runtime: McpRuntimeOwner,
  siblings: Agent[],
  manager: AsyncTaskManager,
): {
  settingsRoot: ReturnType<typeof createSessionSettingsFixture>;
  adoptSibling: DisposalJoinFixture['adoptSibling'];
} {
  const settingsRoot = createSessionSettingsFixture(config);
  return {
    settingsRoot,
    adoptSibling: adoptSibling.bind(
      undefined,
      config,
      runtime,
      siblings,
      manager,
      settingsRoot,
    ),
  };
}

/** Canonical path so owned and expected directories agree on Windows 8.3 names. */
async function createFixtureDirectory(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'async-child-disposal-join-')));
}

export async function withDisposalJoinFixture(
  scenario: (fixture: DisposalJoinFixture) => Promise<void>,
  toolSchedulerFactory?: AgentSchedulerFactory,
  extraTools: readonly string[] = [],
): Promise<void> {
  const directory = await createFixtureDirectory();
  const timeline: string[] = [];
  const { server, childRoute, siblingWork } = await startModelServer(timeline);
  const external = childRoute.work;
  const siblings: Agent[] = [];
  const manager = new AsyncTaskManager(5);
  let mcpRuntime: McpRuntimeOwner | undefined;
  let config: Config | undefined;
  let agent: Agent | undefined;
  let childStatus: Promise<string> | undefined;
  const errors: unknown[] = [];
  try {
    config = await createChildConfig(directory, server.baseUrl, extraTools);
    mcpRuntime = await McpRuntimeOwner.create(createTestOAuthBinding(), config);
    const { settingsRoot, adoptSibling } = createDisposalSettings(
      config,
      mcpRuntime,
      siblings,
      manager,
    );
    agent = await adoptParent(
      config,
      mcpRuntime,
      manager,
      settingsRoot,
      server.baseUrl,
      toolSchedulerFactory,
    );
    childStatus = observeTerminalTask(manager, timeline);
    await scenario({
      agent,
      client: fixtureAgentResources(agent).publishedClient(agent),
      manager,
      ...external,
      scriptChildRequests: childRoute.script,
      timeline,
      childStatus,
      siblingWork,
      settingsOwner: settingsRoot.settingsOwner,
      config,
      adoptSibling,
      workspaceTrust: mcpRuntime.trust,
      workspacePaths: mcpRuntime.workspacePaths,
      instructionReads: mcpRuntime.workspaceMemory.operations,
      readMcpInstructions: mcpRuntime.readInstructions,
    });
  } catch (error) {
    errors.push(error);
  } finally {
    childRoute.clearScript();
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
  const sibling = await captureAgentAdoption(
    config,
    siblingSettings.settingsService,
    { mcpOwnership: 'caller' },
    siblingSettings.settingsOwner,
    undefined,
    undefined,
    undefined,
    mcpRuntime,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    manager,
  );
  siblings.push(sibling);
  return sibling;
}

async function createChildConfig(
  directory: string,
  baseUrl: string,
  extraTools: readonly string[],
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
      coreTools: ['task', 'check_async_tasks', ...extraTools],
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
  return captureAgentAdoption(
    config,
    settingsRoot.settingsService,
    {
      activation: {
        provider: 'openai',
        model: 'parent-model',
        cliOverrides: { key: 'local-test-key', baseUrl },
      },
      mcpOwnership: 'caller',
    },
    settingsRoot.settingsOwner,
    undefined,
    undefined,
    undefined,
    mcpRuntime,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    manager,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    toolSchedulerFactory,
  );
}
