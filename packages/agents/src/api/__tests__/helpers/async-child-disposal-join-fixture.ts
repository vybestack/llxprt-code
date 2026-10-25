import { createSessionSettingsFixture } from './session-settings-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';

import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { createTestMcpRuntime } from './create-mcp-runtime.js';
import { openClientOwner } from './client-owner-session.js';

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
  createAgent,
  toConfigParameters,
  type Agent,
  type AgentConfig,
  type AgentSchedulerFactory,
} from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';

/** Captured at load so a scenario's fake timers cannot stall the observer. */
const realSetTimeout = globalThis.setTimeout;

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
  readonly agent: Agent;
  /** The working directory shared by the parent agent and its sibling. */
  readonly directory: string;
  /**
   * A second, independent agent over the same working directory. It owns its
   * own task manager and runs `sibling-child` against the sibling route.
   */
  readonly openSibling: () => Promise<Agent>;
  /**
   * The tool registry of a domain-level session client owner, for
   * hand-built child orchestrators. Opened on first use and closed at
   * teardown.
   */
  readonly parentTools: () => Promise<AgentClientContract['tools']>;
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

/** Canonical path so owned and expected directories agree on Windows 8.3 names. */
async function createFixtureDirectory(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'async-child-disposal-join-')));
}

function createParentMcpRuntime(config: Config): Promise<McpRuntimeOwner> {
  return createTestMcpRuntime({ oauth: createTestOAuthBinding(), config }, {});
}

/** Public inputs for the parent agent and its sibling over one directory. */
function agentInputs(
  directory: string,
  baseUrl: string,
  extraTools: readonly string[],
  sessionId: string,
): AgentConfig {
  return {
    provider: 'openai',
    model: 'parent-model',
    workingDir: directory,
    sessionId,
    approvalMode: ApprovalMode.YOLO,
    folderTrust: true,
    interactive: false,
    coreTools: ['task', 'check_async_tasks', ...extraTools],
    telemetry: { enabled: false },
    recording: { enabled: false },
    settings: {
      profileDirectory: join(directory, 'profiles'),
      subagentDirectory: join(directory, 'subagents'),
    },
    activation: {
      provider: 'openai',
      model: 'parent-model',
      cliOverrides: { key: 'local-test-key', baseUrl },
    },
    harness: {
      forceInteractive: false,
      forceConfirmations: false,
      includeProcessCwd: false,
    },
  };
}

/** The agents a scenario opens and the observers that follow them. */
class AgentHost {
  agent: Agent | undefined;
  private readonly siblings: Agent[] = [];
  private domainClient: Awaited<ReturnType<typeof openClientOwner>> | undefined;
  private observing = true;
  private status: Promise<string> | undefined;

  constructor(
    private readonly directory: string,
    private readonly baseUrl: string,
    private readonly extraTools: readonly string[],
    private readonly timeline: string[],
  ) {}

  inputs(sessionId: string): AgentConfig {
    return agentInputs(
      this.directory,
      this.baseUrl,
      this.extraTools,
      sessionId,
    );
  }

  readonly openSibling = async (): Promise<Agent> => {
    const sibling = await createAgent(
      this.inputs('async-child-sibling-session'),
    );
    this.siblings.push(sibling);
    return sibling;
  };

  readonly parentTools = async (): Promise<AgentClientContract['tools']> => {
    this.domainClient ??= await openClientOwner(
      new CredentialAuthority(),
      this.inputs('async-child-domain-session'),
      {
        provider: 'openai',
        model: 'parent-model',
        cliOverrides: { key: 'local-test-key', baseUrl: this.baseUrl },
      },
    );
    return this.domainClient.client.tools;
  };

  childStatus(agent: Agent): Promise<string> {
    this.status ??= observeTerminalTask(
      agent,
      this.timeline,
      () => !this.observing,
    );
    return this.status;
  }

  /** Releases in the order the scenario's resources depend on each other. */
  releases(external: HeldWork): ReadonlyArray<() => Promise<void>> {
    return [
      async (): Promise<void> => {
        if (external.signal() !== undefined) await external.workSettled;
      },
      async (): Promise<void> => {
        const agent = this.agent;
        if (
          external.signal() !== undefined &&
          agent?.tasks.list().some((task) => task.kind === 'subagent') === true
        )
          await this.childStatus(agent);
      },
      async (): Promise<void> => {
        this.observing = false;
      },
      async (): Promise<void> => this.agent?.dispose(),
      ...this.siblings.map(
        (sibling) => async (): Promise<void> => sibling.dispose(),
      ),
      async (): Promise<void> => this.domainClient?.close(),
    ];
  }
}

export async function withDisposalJoinFixture(
  scenario: (fixture: DisposalJoinFixture) => Promise<void>,
  toolSchedulerFactory?: AgentSchedulerFactory,
  extraTools: readonly string[] = [],
  credentialAuthority?: CredentialAuthority,
): Promise<void> {
  const directory = await createFixtureDirectory();
  const timeline: string[] = [];
  const { server, childRoute, siblingWork } = await startModelServer(timeline);
  const external = childRoute.work;
  const host = new AgentHost(directory, server.baseUrl, extraTools, timeline);
  let mcpRuntime: McpRuntimeOwner | undefined;
  let config: Config | undefined;
  const errors: unknown[] = [];
  try {
    config = await createChildConfig(directory, server.baseUrl, extraTools);
    mcpRuntime = await createParentMcpRuntime(config);
    await mcpRuntime.initialize();
    const settingsRoot = createSessionSettingsFixture(config);
    const parent = await createAgent({
      ...host.inputs('async-child-disposal-session'),
      toolSchedulerFactory,
      credentialAuthority,
    });
    host.agent = parent;
    const runtime = mcpRuntime;
    await scenario({
      agent: parent,
      directory,
      ...external,
      scriptChildRequests: childRoute.script,
      timeline,
      get childStatus(): Promise<string> {
        return host.childStatus(parent);
      },
      siblingWork,
      settingsOwner: settingsRoot.settingsOwner,
      config,
      openSibling: host.openSibling,
      parentTools: host.parentTools,
      workspaceTrust: runtime.trust,
      workspacePaths: runtime.workspacePaths,
      instructionReads: runtime.workspaceMemory.operations,
      readMcpInstructions: runtime.readInstructions,
    });
  } catch (error) {
    errors.push(error);
  } finally {
    childRoute.clearScript();
    external.releaseWork();
    siblingWork.releaseWork();
    await collectFixtureReleases(errors, [
      ...host.releases(external),
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
  return new Config({
    ...toConfigParameters(
      agentInputs(
        directory,
        baseUrl,
        extraTools,
        'async-child-disposal-domain',
      ),
    ),
    profileDirectory: join(directory, 'profiles'),
    subagentDirectory: join(directory, 'subagents'),
  });
}

/** Reports the status of the first subagent task the agent lists as no longer running. */
function observeTerminalTask(
  agent: Agent,
  timeline: string[],
  stopped: () => boolean,
): Promise<string> {
  const poll = async (): Promise<string> => {
    while (!stopped()) {
      const terminal = agent.tasks
        .list()
        .find((task) => task.kind === 'subagent' && task.status !== 'running');
      if (terminal !== undefined) {
        timeline.push(`task-terminal:${terminal.status}`);
        return terminal.status;
      }
      await new Promise<void>((resolve) => realSetTimeout(resolve, 5));
    }
    return 'observation-stopped';
  };
  return poll();
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
