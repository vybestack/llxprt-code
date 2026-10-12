/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  fromConfig,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolConfirmationOutcome,
  type ToolResult,
  type ToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-tools';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '@vybestack/llxprt-code-providers';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface InvocationParams {
  readonly invocation: string;
}

class ExternalInvocation extends BaseToolInvocation<
  InvocationParams,
  ToolResult
> {
  constructor(
    params: InvocationParams,
    private readonly executeExternal: (
      invocation: string,
    ) => Promise<ToolResult>,
  ) {
    super(params);
  }

  getDescription(): string {
    return `Read external record ${this.params.invocation}`;
  }

  override async shouldConfirmExecute(): Promise<ToolCallConfirmationDetails> {
    return {
      type: 'info',
      title: 'Read record',
      prompt: this.getDescription(),
      onConfirm: async () => {},
    };
  }

  execute(): Promise<ToolResult> {
    return this.executeExternal(this.params.invocation);
  }
}

class ExternalTool extends BaseDeclarativeTool<InvocationParams, ToolResult> {
  constructor(
    private readonly executeExternal: (
      invocation: string,
    ) => Promise<ToolResult>,
  ) {
    super(
      'owner_record',
      'Owner record',
      'Read an external record',
      Kind.Read,
      {
        type: 'object',
        properties: { invocation: { type: 'string' } },
        required: ['invocation'],
      },
    );
  }

  protected createInvocation(params: InvocationParams): ExternalInvocation {
    return new ExternalInvocation(params, this.executeExternal);
  }
}

interface Observation {
  readonly events: readonly AgentEvent[];
  readonly rejection?: unknown;
}

async function collect(
  agent: Agent,
  signal: AbortSignal,
): Promise<Observation> {
  const events: AgentEvent[] = [];
  const iterator = agent
    .stream('Read my external record', {
      signal,
      mcpDiscovery: 'skip',
    })
    [Symbol.asyncIterator]();
  try {
    let next = await iterator.next();
    while (next.done !== true) {
      events.push(next.value);
      next = await iterator.next();
    }
    return { events };
  } catch (rejection) {
    return { events, rejection };
  } finally {
    await iterator.return?.();
  }
}

function successful(result: Observation): void {
  expect(result.rejection).toBeUndefined();
  expect(result.events.filter((event) => event.type === 'error')).toStrictEqual(
    [],
  );
  expect(result.events.filter((event) => event.type === 'done')).toStrictEqual([
    { type: 'done', reason: 'stop' },
  ]);
}

async function reached(
  boundary: Promise<void>,
  operation: Promise<Observation>,
  name: string,
): Promise<void> {
  await Promise.race([
    boundary,
    operation.then((result) => {
      throw new Error(`${name} was not reached: ${JSON.stringify(result)}`);
    }),
  ]);
}

function restoreEnvironment(
  previous: ReadonlyArray<readonly [string, string | undefined]>,
): void {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function exerciseOwners(sameLabel: boolean): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'llxprt-same-label-tools-'));
  const envKeys = [
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_CACHE_HOME',
    'LLXPRT_LOG_HOME',
    'LLXPRT_FAKE_RESPONSES',
  ];
  const previous = envKeys.map((key) => [key, process.env[key]] as const);
  for (const key of envKeys.filter((key) => key !== 'LLXPRT_FAKE_RESPONSES')) {
    process.env[key] = root;
  }
  const configs: Array<Awaited<ReturnType<typeof buildCliStyleConfig>>> = [];
  const agents: Agent[] = [];
  const restores: Array<() => void> = [];
  const releases: Array<() => void> = [];
  const pending: Array<Promise<Observation>> = [];
  const abort = new AbortController();
  const label = `tool-owner-${randomUUID()}`;

  async function owner(name: string, sessionId: string) {
    const modelEntered = gate();
    const modelRelease = gate();
    const toolEntered = gate();
    const toolRelease = gate();
    releases.push(modelRelease.release, toolRelease.release);
    let calls: readonly string[] = [];
    let requests: readonly IContent[][] = [];
    const approvals: string[] = [];
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      sessionId,
      workingDir: root,
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    configs.push(built);
    const externalTool = new ExternalTool(async (invocation) => {
      calls = [...calls, invocation];
      toolEntered.release();
      await toolRelease.promise;
      return {
        llmContent: `${name}-external-output:${invocation}`,
        returnDisplay: `${name} record`,
      };
    });
    let provider: unknown = built.providerManager.getProviderByName('fake');
    while (
      typeof provider === 'object' &&
      provider !== null &&
      'wrappedProvider' in provider
    ) {
      provider = provider.wrappedProvider;
    }
    if (!(provider instanceof FakeProvider)) {
      throw new Error('Fixture requires the external FakeProvider boundary');
    }
    const model = spyOn(provider, 'generateChatCompletion').mockImplementation(
      async function* (
        options: GenerateChatOptions | IContent[],
      ): AsyncIterableIterator<IContent> {
        const contents = Array.isArray(options) ? options : options.contents;
        requests = [...requests, structuredClone(contents)];
        const request = requests.length;
        if (request === 1) {
          modelEntered.release();
          await modelRelease.promise;
        }
        if (request % 2 === 1) {
          const invocation = `${name}-invocation-${(request + 1) / 2}`;
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: invocation,
                name: 'owner_record',
                parameters: { invocation },
              },
            ],
          };
        } else {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: `${name} finished` }],
          };
        }
      },
    );
    restores.push(() => model.mockRestore());
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
      messageBus: built.messageBus,
      sessionId,
      prepareSessionTools: (_config, _bus, tools) =>
        tools.registerTool(externalTool),
      onApproval: (confirmation) => {
        approvals.push(confirmation.toolCallId);
        return ToolConfirmationOutcome.ProceedOnce;
      },
    });
    agents.push(agent);
    return {
      agent,
      callerClient: built.agentClient,
      modelEntered,
      modelRelease,
      toolEntered,
      toolRelease,
      approvals,
      calls: () => calls,
      requests: () => requests,
    };
  }

  function start(agent: Agent): Promise<Observation> {
    const operation = collect(agent, abort.signal);
    pending.push(operation);
    return operation;
  }

  try {
    const a = await owner('alpha', label);
    const b = await owner('beta', sameLabel ? label : `${label}-other`);
    const first = start(a.agent);
    await reached(a.modelEntered.promise, first, 'alpha model');
    const second = start(b.agent);
    await reached(b.modelEntered.promise, second, 'beta model');
    b.modelRelease.release();
    await reached(b.toolEntered.promise, second, 'beta tool');
    a.modelRelease.release();
    await reached(a.toolEntered.promise, first, 'alpha tool');
    a.toolRelease.release();
    const firstResult = await first;
    successful(firstResult);
    await a.agent.dispose();
    b.toolRelease.release();
    const secondResult = await second;
    successful(secondResult);

    for (const [current, other, result, name] of [
      [a, b, firstResult, 'alpha'],
      [b, a, secondResult, 'beta'],
    ] as const) {
      const invocation = `${name}-invocation-1`;
      expect(current.calls()).toStrictEqual([invocation]);
      expect(current.approvals).toStrictEqual([invocation]);
      expect(
        result.events.filter((event) => event.type === 'tool-call'),
      ).toStrictEqual([
        {
          type: 'tool-call',
          call: { id: invocation, name: 'owner_record', args: { invocation } },
        },
      ]);
      const results = result.events.filter(
        (event) => event.type === 'tool-result',
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.result).toMatchObject({
        id: invocation,
        name: 'owner_record',
        isError: false,
      });
      const ownOutput = `${name}-external-output:${invocation}`;
      const otherInvocation = other.calls()[0];
      expect(JSON.stringify(results)).toContain(ownOutput);
      expect(JSON.stringify(results)).not.toContain(otherInvocation);
      expect(current.requests()).toHaveLength(2);
      expect(JSON.stringify(current.requests()[1])).toContain(ownOutput);
      expect(JSON.stringify(current.requests()[1])).not.toContain(
        otherInvocation,
      );
    }
    const historyA = JSON.stringify(await a.callerClient.getHistory());
    const historyB = JSON.stringify(await b.agent.getHistory());
    expect(historyA).toContain('alpha-external-output:alpha-invocation-1');
    expect(historyA).not.toContain('beta-external-output');
    expect(historyB).toContain('beta-external-output:beta-invocation-1');
    expect(historyB).not.toContain('alpha-external-output');
    const next = await start(b.agent);
    successful(next);
    expect(b.calls()).toStrictEqual(['beta-invocation-1', 'beta-invocation-2']);
    expect(b.requests()).toHaveLength(4);
    expect(JSON.stringify(b.requests()[3])).toContain(
      'beta-external-output:beta-invocation-2',
    );
    expect(JSON.stringify(await b.agent.getHistory())).not.toContain(
      'alpha-external-output',
    );
  } finally {
    abort.abort();
    releases.forEach((release) => release());
    await Promise.all(pending);
    try {
      await Promise.all(agents.map((agent) => agent.dispose()));
    } finally {
      restores.forEach((restore) => restore());
      for (const built of [...configs].reverse()) {
        await built.config.dispose();
        await built.cleanup();
      }
      restoreEnvironment(previous);
      await rm(root, { recursive: true, force: true });
    }
  }
}

describe('Public Agent tool ownership (#2616 S1/S8, #2615 E)', () => {
  it('keeps distinct-label owners isolated through execution and disposal', async () => {
    expect(await exerciseOwners(false)).toBeUndefined();
  }, 30_000);

  it('keeps same-label owners isolated through execution and disposal', async () => {
    expect(await exerciseOwners(true)).toBeUndefined();
  }, 30_000);
});
