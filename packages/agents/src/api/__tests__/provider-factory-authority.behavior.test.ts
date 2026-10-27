import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useConsumerPromptDirectory } from './helpers/consumer-owner-primitives.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  ProviderManager,
  OpenAIProvider,
} from '@vybestack/llxprt-code-providers';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../session/session-client-owner.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import {
  createCapturedSessionOwner,
  ownerClients,
} from './helpers/session-client-capture.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { ProviderContentGenerator } from '@vybestack/llxprt-code-providers/ProviderContentGenerator.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { createAgent } from '../createAgent.js';
import { fromConfig } from '../fromConfig.js';
import type { Agent } from '../agent.js';
import { z } from 'zod';
import {
  collect,
  successful,
  withOwners,
} from './turn-revision-capture.fixture.js';

function tokenizerForBudget(scale: number): RuntimeTokenizerFactory {
  return {
    getTokenizer: () => ({
      countTokens: (text) => Math.ceil(String(text).length / 4),
    }),
    estimatePrompt: async (request) => ({
      count:
        Math.ceil(JSON.stringify(request.finalizedProjection).length / 4) *
        scale,
      method: 'exact',
      family: 'owner-text',
      estimatorVersion: '1',
      assetRevision: '1',
      projectionRevision: request.projectionRevision,
    }),
  };
}

async function budgetWire(): Promise<{
  endpoint: string;
  models: () => readonly string[];
  close: () => void;
}> {
  const schema = z.object({
    model: z.string(),
    stream: z.boolean().optional(),
  });
  let models: readonly string[] = [];
  const serve = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (request.method === 'GET') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [] }));
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const body: unknown = JSON.parse(raw);
    const captured = schema.parse(body);
    models = [...models, captured.model];
    const chunk = {
      id: 'factory-budget',
      object: 'chat.completion.chunk',
      created: 1,
      model: captured.model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'Completed.' },
          finish_reason: 'stop',
        },
      ],
    };
    response.setHeader('content-type', 'text/event-stream');
    response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  };
  const server = createServer((request, response) => {
    void serve(request, response).catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Local provider has no socket address');
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    models: () => models,
    close: (): void => {
      server.closeAllConnections();
      server.close();
    },
  };
}

const TIGHT_CONTEXT_LIMIT = 1000;

async function adoptForBudget(
  config: Config,
  endpoint: string,
  authority: CredentialAuthority,
  contextLimit: number,
  provider = 'openai',
  model = 'gpt-5.6',
): Promise<Agent> {
  const settingsService = new SettingsService();
  settingsService.set('context-limit', contextLimit);
  settingsService.set('maxOutputTokens', 128);
  return fromConfig(
    config,
    settingsService,
    {
      sessionId: 'same-factory-label',
      activation: {
        provider,
        model,
        cliOverrides: { key: 'local-factory-key', baseUrl: endpoint },
      },
    },
    authority,
  );
}

async function withConfig(
  run: (config: Config) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'factory-authority-'));
  const config = new Config({
    sessionId: 'same-factory-label',
    targetDir: directory,
    cwd: directory,
    debugMode: false,
    provider: 'openai',
    model: 'gpt-5.6',
    skillsSupport: false,
    enableHooks: false,
  });
  try {
    await run(config);
  } finally {
    await config.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

class GeminiTransport extends OpenAIProvider {
  override readonly name = 'gemini';
}

class SelectedGenerator extends ProviderContentGenerator {
  constructor(private readonly scale: number) {
    super();
  }
  override async countTokens(
    request: Parameters<ProviderContentGenerator['countTokens']>[0],
  ): ReturnType<ProviderContentGenerator['countTokens']> {
    const counted = await super.countTokens(request);
    return { totalTokens: counted.totalTokens * this.scale };
  }
}

const DETACHED_RECORDING = {
  transcriptPath: () => undefined,
  persistSemanticMediaPurge: async () => {},
};

interface SelectedGeneratorOwner {
  readonly owner: SessionClientOwner;
  close(): Promise<void>;
}

/**
 * A `SessionClientOwner` over the `gemini` transport (the provider whose
 * text generation runs on a detached client) with the content generator
 * factory and tokenizer the caller selected, as the owner's own parameters.
 */
async function openSelectedGeneratorOwner(
  config: Config,
  endpoint: string,
  authority: CredentialAuthority,
  scale: number,
): Promise<SelectedGeneratorOwner> {
  const settings = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settings);
  settingsOwner.bindTelemetry(config);
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settings,
    config,
    undefined,
    authority,
    settingsOwner,
  );
  manager.bindNetworkFetch((input, init) => globalThis.fetch(input, init));
  manager.registerProvider(
    new GeminiTransport('content-owner-local', endpoint),
  );
  manager.setActiveProvider('gemini');
  const policy = new RuntimePolicyOwner(config);
  const mcp = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    {},
    undefined,
    policy,
  );
  const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
  const owner = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    buildAgentClientFactory(),
    media.store,
    mcp.readInstructions,
    mcp.workspacePaths,
    settingsOwner,
    { createContentGenerator: () => new SelectedGenerator(scale) },
    tokenizerForBudget(1),
  );
  owner.bindMcpRuntime(mcp);
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= runCleanupSteps([
      () => owner.dispose(),
      () => manager.dispose(),
      () => settingsOwner.dispose(),
      () => media.dispose(),
      () => mcp.dispose(),
      () => policy.dispose(),
    ]));
  await mcp.initialize();
  await owner.clients.refreshAuth();
  await owner.initializeTools();
  const clients = ownerClients(owner);
  await clients[clients.length - 1].startChat();
  return { owner, close };
}

describe('public provider factory authority', () => {
  useConsumerPromptDirectory();
  const credentials = useOwnedCredentials();
  it('retains only an immutable factory selection declaration in Config', async () => {
    await withConfig(async (config) => {
      config.setContentGeneratorConfig({
        model: 'gpt-5.6',
        contentGeneratorFactory: {
          createContentGenerator: () => {
            throw new Error(
              'Config must not retain executable factory authority',
            );
          },
        },
      });
      const declaration = config.getContentGeneratorConfig();
      expect(declaration).toStrictEqual({ model: 'gpt-5.6' });
      expect(Object.isFrozen(declaration)).toBe(true);
    });
  });

  it('keeps tokenizer budget decisions isolated for same-label Agents sharing a Config', async () => {
    await withConfig(async (config) => {
      const firstWire = await budgetWire();
      const secondWire = await budgetWire();
      const owners: Agent[] = [];
      try {
        const first = await adoptForBudget(
          config,
          firstWire.endpoint,
          credentials().authority,
          100000,
        );
        owners.push(first);
        const second = await adoptForBudget(
          config,
          secondWire.endpoint,
          credentials().authority,
          TIGHT_CONTEXT_LIMIT,
        );
        owners.push(second);
        successful(await collect(first.stream('Return one sentence.')));
        const denied = await collect(second.stream('Return one sentence.'));
        expect(denied.rejection).toBeUndefined();
        expect(
          denied.events.filter((event) => event.type === 'done'),
        ).toStrictEqual([{ type: 'done', reason: 'context-overflow' }]);
        expect(firstWire.models()).toStrictEqual(['gpt-5.6']);
        expect(secondWire.models()).toStrictEqual([]);
        await second.dispose();
        successful(await collect(first.stream('Return another sentence.')));
        expect(firstWire.models()).toHaveLength(2);
        expect(secondWire.models()).toStrictEqual([]);
      } finally {
        await Promise.allSettled(owners.map((owner) => owner.dispose()));
        firstWire.close();
        secondWire.close();
      }
    });
  });
  it('keeps different provider selections on physical endpoints while sharing Config and labels', async () => {
    await withConfig(async (config) => {
      const firstWire = await budgetWire();
      const secondWire = await budgetWire();
      const agents: Agent[] = [];
      try {
        const first = await adoptForBudget(
          config,
          firstWire.endpoint,
          credentials().authority,
          100000,
        );
        agents.push(first);
        const second = await adoptForBudget(
          config,
          secondWire.endpoint,
          credentials().authority,
          100000,
          'kimi',
          'kimi-k3',
        );
        agents.push(second);
        successful(await collect(first.stream('First provider route')));
        successful(await collect(second.stream('Second provider route')));
        expect(firstWire.models()).toStrictEqual(['gpt-5.6']);
        expect(secondWire.models()).toStrictEqual(['kimi-k3']);
        await first.dispose();
        successful(await collect(second.stream('Surviving provider route')));
        expect(firstWire.models()).toStrictEqual(['gpt-5.6']);
        expect(secondWire.models()).toStrictEqual(['kimi-k3', 'kimi-k3']);
      } finally {
        await Promise.allSettled(agents.map((agent) => agent.dispose()));
        firstWire.close();
        secondWire.close();
      }
    });
  });
  it.each(['revoke', 'rotate'])(
    'observes live credential %s while an admitted 503 is held',
    async (change) => {
      await withOwners(
        async (agent, _other, endpoint, _otherEndpoint, start) => {
          const pending = start(agent, 'Held retry credential authority');
          await endpoint.entered;
          await agent.auth.keys.setRaw(
            change === 'rotate' ? 'rotated-local-only' : null,
          );
          endpoint.release();
          const result = await pending;
          expect(endpoint.requests()).toHaveLength(1);
          expect(
            result.rejection !== undefined ||
              result.events.some((event) => event.type === 'error'),
          ).toBe(true);
          if (change === 'revoke')
            await agent.auth.keys.setRaw('rotated-local-only');
          successful(
            await start(agent, 'Next turn accepts the live credential'),
          );
          expect(endpoint.requests()).toHaveLength(2);
          expect(endpoint.requests()[1].authorization).toBe(
            'Bearer rotated-local-only',
          );
        },
        false,
        false,
        1,
        1,
        false,
        503,
      );
    },
    30000,
  );
  it('keeps model replacement and detached history generation on the selected endpoint across Agents sharing a Config label', async () => {
    const wire = await budgetWire();
    const owners: Agent[] = [];
    const directories: string[] = [];
    try {
      for (let index = 0; index < 2; index++) {
        const directory = await mkdtemp(join(tmpdir(), 'content-owner-'));
        directories.push(directory);
        owners.push(
          await createAgent({
            provider: 'openai',
            model: 'gpt-5.6',
            workingDir: directory,
            sessionId: 'same-factory-label',
            auth: { apiKey: 'content-owner-local', baseUrl: wire.endpoint },
            credentialAuthority: credentials().authority,
            telemetry: { enabled: false },
            recording: { enabled: false },
            mcpEnabled: false,
            skillsSupport: false,
            tokenizerFactory: tokenizerForBudget(1),
          }),
        );
      }
      for (const owner of owners) {
        await owner.setModel('gpt-5.5');
        successful(
          await collect(
            owner.stream({ text: 'Physical generation after replacement' }),
          ),
        );
      }
      expect(wire.models()).toStrictEqual(['gpt-5.5', 'gpt-5.5']);
      for (const owner of owners) {
        await owner.restoreHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Prepare detached history' }],
          },
        ]);
        await owner.generate('Physical temporary generation', {
          readHistory: true,
        });
      }
      expect(wire.models()).toHaveLength(4);
      await owners[0].dispose();
      await owners[1].restoreHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Prepare surviving history' }],
        },
      ]);
      await owners[1].generate('Physical surviving temporary', {
        readHistory: true,
      });
      expect(wire.models()).toHaveLength(5);
    } finally {
      await Promise.allSettled(owners.map((owner) => owner.dispose()));
      wire.close();
      await Promise.all(
        directories.map((directory) =>
          rm(directory, { recursive: true, force: true }),
        ),
      );
    }
  });

  it('keeps explicitly selected content generators on detached clients of session owners sharing a Config', async () => {
    await withConfig(async (config) => {
      const wire = await budgetWire();
      const opened: SelectedGeneratorOwner[] = [];
      try {
        for (const scale of [2, 7])
          opened.push(
            await openSelectedGeneratorOwner(
              config,
              wire.endpoint,
              credentials().authority,
              scale,
            ),
          );
        const request = {
          model: 'gpt-5.6',
          contents: [
            {
              speaker: 'human' as const,
              blocks: [{ type: 'text' as const, text: 'sixteen letters!' }],
            },
          ],
        };
        for (const [index, { owner }] of opened.entries()) {
          const clients = ownerClients(owner);
          const primary = clients[clients.length - 1];
          await owner.clients.generateText(
            'Physical temporary generation',
            { readHistory: true },
            DETACHED_RECORDING,
          );
          const detached = ownerClients(owner).slice(-1).values().next().value;
          if (detached === undefined)
            throw new Error('Missing factory-captured temporary');
          expect(detached).not.toBe(primary);
          expect(detached.mediaStore).toBe(primary.mediaStore);
          const counted = await detached
            .getContentGenerator()
            .countTokens(request);
          expect(counted.totalTokens).toBe(index === 0 ? 8 : 28);
        }
        await opened[0].close();
        await opened[1].owner.clients.generateText(
          'Physical surviving temporary',
          { readHistory: true },
          DETACHED_RECORDING,
        );
        const surviving = ownerClients(opened[1].owner)
          .slice(-1)
          .values()
          .next().value;
        if (surviving === undefined)
          throw new Error('Missing surviving factory capture');
        expect(
          (await surviving.getContentGenerator().countTokens(request))
            .totalTokens,
        ).toBe(28);
      } finally {
        await Promise.allSettled(opened.map((entry) => entry.close()));
        wire.close();
      }
    });
  });

  it('rejects replacement tokenizer readiness before sending a changed model', async () => {
    const wire = await budgetWire();
    const directory = await mkdtemp(join(tmpdir(), 'replacement-owner-'));
    let owner: Agent | undefined;
    const tokenizerFactory = {
      ...tokenizerForBudget(1),
      prepareTokenizer: async (
        _provider: string,
        model?: string,
      ): Promise<void> => {
        if (model === 'gpt-5.5')
          throw new Error('Replacement tokenizer assets unavailable');
      },
    };
    try {
      owner = await createAgent({
        provider: 'openai',
        model: 'gpt-5.6',
        workingDir: directory,
        sessionId: 'same-factory-label',
        auth: { apiKey: 'replacement-local', baseUrl: wire.endpoint },
        credentialAuthority: credentials().authority,
        telemetry: { enabled: false },
        recording: { enabled: false },
        mcpEnabled: false,
        skillsSupport: false,
        tokenizerFactory,
      });
      successful(
        await collect(owner.stream({ text: 'Initial prepared model' })),
      );
      await expect(owner.setModel('gpt-5.5')).rejects.toThrow(
        'Replacement tokenizer assets unavailable',
      );
      expect(wire.models()).toStrictEqual(['gpt-5.6']);
    } finally {
      await owner?.dispose();
      wire.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not admit an Agent when its explicitly selected tokenizer cannot prepare', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'unprepared-owner-'));
    let admitted: Agent | undefined;
    const tokenizerFactory: RuntimeTokenizerFactory = {
      getTokenizer: () => undefined,
      estimatePrompt: async (request) => ({
        count: await request.legacyEstimate(),
        method: 'calibrated',
        family: 'owner',
        estimatorVersion: '1',
        assetRevision: '1',
        projectionRevision: request.projectionRevision,
      }),
      prepareTokenizer: async (): Promise<void> => {
        throw new Error('Owner tokenizer asset unavailable');
      },
    };
    try {
      await expect(
        createAgent({
          provider: 'openai',
          model: 'gpt-5.6',
          workingDir: directory,
          sessionId: 'same-factory-label',
          auth: { apiKey: 'unprepared-local' },
          credentialAuthority: credentials().authority,
          telemetry: { enabled: false },
          recording: { enabled: false },
          mcpEnabled: false,
          skillsSupport: false,
          tokenizerFactory,
        }).then((agent) => {
          admitted = agent;
        }),
      ).rejects.toThrow('Owner tokenizer asset unavailable');
    } finally {
      await admitted?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
