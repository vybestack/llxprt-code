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
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-policy/confirmation-bus/types.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { ProviderContentGenerator } from '@vybestack/llxprt-code-providers/ProviderContentGenerator.js';
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

async function adoptForBudget(
  config: Config,
  endpoint: string,
  scale: number,
  provider = 'openai',
  model = 'gpt-5.6',
): Promise<Agent> {
  const settingsService = new SettingsService();
  settingsService.set('context-limit', 100000);
  settingsService.set('maxOutputTokens', 128);
  return fromConfig({
    config,
    settingsService,
    tokenizerFactory: tokenizerForBudget(scale),
    sessionId: 'same-factory-label',
    activation: {
      provider,
      model,
      cliOverrides: { key: 'local-factory-key', baseUrl: endpoint },
    },
  });
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

describe('public provider factory authority', () => {
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

  it('uses the caller policy bus without retiring its caller authority', async () => {
    await withConfig(async (config) => {
      const policy = new RuntimePolicyOwner(config);
      const wire = await budgetWire();
      let agent: Agent | undefined;
      try {
        agent = await fromConfig({
          config,
          settingsService: new SettingsService(),
          policyOwner: policy,
          messageBus: policy.session.messageBus,
          activation: {
            provider: 'openai',
            model: 'gpt-5.6',
            cliOverrides: { key: 'local-only', baseUrl: wire.endpoint },
          },
        });
        expect(agent.getMessageBus()).toBe(policy.session.messageBus);
        successful(await collect(agent.stream('Return one sentence.')));
        let confirmation: ToolConfirmationRequest | undefined;
        const release =
          policy.session.messageBus.subscribe<ToolConfirmationRequest>(
            MessageBusType.TOOL_CONFIRMATION_REQUEST,
            (request) => {
              confirmation = request;
            },
          );
        let settled = false;
        const pending = policy.session.messageBus.requestConfirmation(
          { name: 'unregistered_privileged_tool' },
          {},
        );
        void pending.then(() => {
          settled = true;
        });
        await agent.dispose();
        await Promise.resolve();
        expect(settled).toBe(false);
        if (confirmation === undefined)
          throw new Error('Caller confirmation was not published');
        policy.session.messageBus.publish({
          type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
          correlationId: confirmation.correlationId,
          confirmed: true,
        });
        expect(await pending).toBe(true);
        release();
        expect(
          policy.session.decisions.evaluate('read_file', {}),
        ).toBeDefined();
        expect(wire.models()).toStrictEqual(['gpt-5.6']);
      } finally {
        await agent?.dispose();
        await policy.dispose();
        wire.close();
      }
    });
  });
  it('keeps tokenizer budget decisions isolated for same-label Agents sharing a Config', async () => {
    await withConfig(async (config) => {
      const firstWire = await budgetWire();
      const secondWire = await budgetWire();
      const owners: Agent[] = [];
      try {
        const first = await adoptForBudget(config, firstWire.endpoint, 1);
        owners.push(first);
        const second = await adoptForBudget(
          config,
          secondWire.endpoint,
          100000,
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
        const first = await adoptForBudget(config, firstWire.endpoint, 1);
        agents.push(first);
        const second = await adoptForBudget(
          config,
          secondWire.endpoint,
          1,
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
  it('keeps explicitly selected content generators through model replacement and detached creation on shared Config', async () => {
    await withConfig(async (config) => {
      const wire = await budgetWire();
      const owners: Agent[] = [];
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
      try {
        for (const scale of [2, 7]) {
          owners.push(
            await fromConfig({
              config,
              settingsService: new SettingsService(),
              sessionId: 'same-factory-label',
              tokenizerFactory: tokenizerForBudget(1),
              contentGeneratorFactory: {
                createContentGenerator: () => new SelectedGenerator(scale),
              },
              activation: {
                provider: 'openai',
                model: 'gpt-5.6',
                cliOverrides: {
                  key: 'content-owner-local',
                  baseUrl: wire.endpoint,
                },
              },
            }),
          );
        }
        const request = {
          model: 'gpt-5.6',
          contents: [
            {
              speaker: 'human' as const,
              blocks: [{ type: 'text' as const, text: 'sixteen letters!' }],
            },
          ],
        };
        for (const [index, owner] of owners.entries()) {
          await owner.setModel('gpt-5.5');
          const detached =
            await owner.sessionClient.createDetachedAgentClient();
          await detached.restoreHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Prepare detached history' }],
            },
          ]);
          const counted = await detached
            .getContentGenerator()
            .countTokens(request);
          expect(counted.totalTokens).toBe(index === 0 ? 8 : 28);
          successful(
            await collect(
              owner.stream({ text: 'Physical generation after replacement' }),
            ),
          );
        }
        expect(wire.models()).toStrictEqual(['gpt-5.5', 'gpt-5.5']);
        await owners[0].dispose();
        const surviving =
          await owners[1].sessionClient.createDetachedAgentClient();
        await surviving.restoreHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Prepare surviving history' }],
          },
        ]);
        expect(
          (await surviving.getContentGenerator().countTokens(request))
            .totalTokens,
        ).toBe(28);
      } finally {
        await Promise.allSettled(owners.map((owner) => owner.dispose()));
        wire.close();
      }
    });
  });

  it('rejects replacement tokenizer readiness before sending a changed model', async () => {
    await withConfig(async (config) => {
      const wire = await budgetWire();
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
        owner = await fromConfig({
          config,
          settingsService: new SettingsService(),
          sessionId: 'same-factory-label',
          tokenizerFactory,
          activation: {
            provider: 'openai',
            model: 'gpt-5.6',
            cliOverrides: { key: 'replacement-local', baseUrl: wire.endpoint },
          },
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
      }
    });
  });

  it('does not admit an Agent when its explicitly selected tokenizer cannot prepare', async () => {
    await withConfig(async (config) => {
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
      const options = {
        config,
        settingsService: new SettingsService(),
        sessionId: 'same-factory-label',
        tokenizerFactory,
      };
      try {
        await expect(
          fromConfig(options).then((agent) => {
            admitted = agent;
          }),
        ).rejects.toThrow('Owner tokenizer asset unavailable');
      } finally {
        await admitted?.dispose();
      }
    });
  });
});
