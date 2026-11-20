/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  OpenAIProvider,
  type NormalizedGenerateChatOptions,
} from '@vybestack/llxprt-code-providers';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import {
  createAgent,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';
import { awaitMcpDiscoveryReady } from './helpers/mcp-discovery-ready.js';
import { createGatedEchoMcp } from './helpers/gated-echo-mcp.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const MCP_SERVER = 'echo';
const TOOL_NAME = `mcp__${MCP_SERVER}__owner_record`;

class ScriptedOwnerProvider extends OpenAIProvider {
  constructor(
    private readonly answer: (
      options: NormalizedGenerateChatOptions,
    ) => AsyncIterableIterator<IContent>,
  ) {
    super('test-key', 'http://scripted-owner-provider.invalid/v1');
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    yield* this.answer(options);
  }
}

function scriptedProvider(
  alias: string,
  answer: (
    options: NormalizedGenerateChatOptions,
  ) => AsyncIterableIterator<IContent>,
): ProviderContributionRegistry {
  const providerId = `${alias}-provider`;
  return buildProviderContributionRegistry([
    {
      specifier: `memory:${providerId}`,
      manifest: {
        apiVersion: 1,
        id: providerId,
        providers: [
          {
            providerId,
            createProvider: (entry) => {
              const provider = new ScriptedOwnerProvider(answer);
              bindProviderAliasIdentity(provider, entry.alias);
              return provider;
            },
            builtinAliases: [
              {
                alias,
                config: {
                  baseProvider: providerId,
                  'base-url': 'http://scripted-owner-provider.invalid/v1',
                  'requires-auth': false,
                  defaultModel: 'scripted-model',
                  staticModels: [{ id: 'scripted-model', name: 'Scripted' }],
                },
              },
            ],
          },
        ],
      },
    },
  ]);
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

describe('Public Agent tool ownership (#2616 S1/S8, #2615 E)', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  const builtCredentials = useOwnedCredentials();
  async function exerciseOwners(sameLabel: boolean): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'llxprt-same-label-tools-'));
    const envKeys = [
      'LLXPRT_CONFIG_HOME',
      'LLXPRT_DATA_HOME',
      'LLXPRT_CACHE_HOME',
      'LLXPRT_LOG_HOME',
    ];
    const previous = envKeys.map((key) => [key, process.env[key]] as const);
    for (const key of envKeys) {
      process.env[key] = root;
    }
    const agents: Agent[] = [];
    const mcpCloses: Array<() => Promise<void>> = [];
    const releases: Array<() => void | Promise<void>> = [];
    const pending: Array<Promise<Observation>> = [];
    const abort = new AbortController();
    const label = `tool-owner-${randomUUID()}`;

    async function owner(name: string, sessionId: string) {
      const modelEntered = gate();
      const modelRelease = gate();
      const mcp = await createGatedEchoMcp({
        toolName: 'owner_record',
        serverName: MCP_SERVER,
        outputPrefix: `${name}-external-output`,
      });
      mcpCloses.push(mcp.close);
      releases.push(modelRelease.release, mcp.release);
      let requests: readonly IContent[][] = [];
      const approvals: string[] = [];

      const providerContributions = scriptedProvider(
        `scripted-${name}`,
        async function* (
          options: NormalizedGenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          requests = [
            ...requests,
            structuredClone(
              options.requestRows === undefined
                ? options.contents
                : await Array.fromAsync(
                    options.requestRows.openReader(options.invocation.signal),
                  ),
            ),
          ];
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
                  name: TOOL_NAME,
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
      const agent = await createAgent({
        provider: `scripted-${name}`,
        model: 'scripted-model',
        sessionId,
        workingDir: root,
        folderTrust: true,
        telemetry: { enabled: false },
        recording: { enabled: false },
        credentialAuthority: builtCredentials().authority,
        providerContributions,
        mcpServers: mcp.mcpServers,
        onApproval: (confirmation) => {
          approvals.push(confirmation.toolCallId);
          return ToolConfirmationOutcome.ProceedOnce;
        },
      });
      agents.push(agent);
      await awaitMcpDiscoveryReady(agent);
      return {
        agent,
        modelEntered,
        modelRelease,
        toolEntered: () => mcp.entered(),
        toolRelease: mcp.release,
        approvals,
        calls: mcp.calls,
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
      await reached(b.toolEntered(), second, 'beta tool');
      a.modelRelease.release();
      await reached(a.toolEntered(), first, 'alpha tool');
      await a.toolRelease();
      const firstResult = await first;
      successful(firstResult);
      const historyA = JSON.stringify(
        await Array.fromAsync(a.agent.streamHistory()),
      );
      await a.agent.dispose();
      await b.toolRelease();
      const secondResult = await second;
      successful(secondResult);

      for (const [current, other, result, name] of [
        [a, b, firstResult, 'alpha'],
        [b, a, secondResult, 'beta'],
      ] as const) {
        const invocation = `${name}-invocation-1`;
        expect(await current.calls()).toStrictEqual([invocation]);
        expect(current.approvals).toStrictEqual([invocation]);
        expect(
          result.events.filter((event) => event.type === 'tool-call'),
        ).toStrictEqual([
          {
            type: 'tool-call',
            call: {
              id: invocation,
              name: TOOL_NAME,
              args: { invocation },
            },
          },
        ]);
        const results = result.events.filter(
          (event) => event.type === 'tool-result',
        );
        expect(results).toHaveLength(1);
        expect(results[0]?.result).toMatchObject({
          id: invocation,
          name: TOOL_NAME,
          isError: false,
        });
        const ownOutput = `${name}-external-output:${invocation}`;
        const otherInvocation = (await other.calls())[0];
        expect(JSON.stringify(results)).toContain(ownOutput);
        expect(JSON.stringify(results)).not.toContain(otherInvocation);
        expect(current.requests()).toHaveLength(2);
        expect(JSON.stringify(current.requests()[1])).toContain(ownOutput);
        expect(JSON.stringify(current.requests()[1])).not.toContain(
          otherInvocation,
        );
      }
      const historyB = JSON.stringify(
        await Array.fromAsync(b.agent.streamHistory()),
      );
      expect(historyA).toContain('alpha-external-output:alpha-invocation-1');
      expect(historyA).not.toContain('beta-external-output');
      expect(historyB).toContain('beta-external-output:beta-invocation-1');
      expect(historyB).not.toContain('alpha-external-output');
      const next = await start(b.agent);
      successful(next);
      expect(await b.calls()).toStrictEqual([
        'beta-invocation-1',
        'beta-invocation-2',
      ]);
      expect(b.requests()).toHaveLength(4);
      expect(JSON.stringify(b.requests()[3])).toContain(
        'beta-external-output:beta-invocation-2',
      );
      expect(
        JSON.stringify(await Array.fromAsync(b.agent.streamHistory())),
      ).not.toContain('alpha-external-output');
    } finally {
      abort.abort();
      await Promise.all(releases.map((release) => release()));
      await Promise.all(pending);
      try {
        await Promise.all(agents.map((agent) => agent.dispose()));
      } finally {
        await runCleanupSteps(mcpCloses);
        restoreEnvironment(previous);
        await rm(root, { recursive: true, force: true });
      }
    }
  }

  usePromptFixture();

  it('keeps distinct-label owners isolated through execution and disposal', async () => {
    expect(await exerciseOwners(false)).toBeUndefined();
  }, 30_000);

  it('keeps same-label owners isolated through execution and disposal', async () => {
    expect(await exerciseOwners(true)).toBeUndefined();
  }, 30_000);
});
