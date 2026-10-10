/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { json } from 'node:stream/consumers';
import { z } from 'zod';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { fromConfig, type Agent } from '../index.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { collect, successful } from './turn-revision-capture.fixture.js';

const requestSchema = z.object({
  stream: z.boolean().optional(),
  model: z.string(),
  temperature: z.number().optional(),
  tools: z
    .array(
      z.object({
        function: z.object({
          name: z.string(),
          parameters: z.record(z.unknown()),
        }),
      }),
    )
    .optional(),
  messages: z.array(z.unknown()),
});

async function modelWire() {
  let nextResponseDelayMs = 0;
  let requests: ReadonlyArray<
    z.infer<typeof requestSchema> & { readonly authorization?: string }
  > = [];
  const server = createServer((request, response) => {
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [] }));
      return;
    }
    void json(request)
      .then(async (body: unknown) => {
        const captured = requestSchema.parse(body);
        requests = [
          ...requests,
          { ...captured, authorization: request.headers.authorization },
        ];
        const delayMs = nextResponseDelayMs;
        nextResponseDelayMs = 0;
        if (delayMs > 0)
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        const chunk = {
          id: 'settings-owner-wire',
          object: 'chat.completion.chunk',
          created: 1,
          model: captured.model,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Request completed.' },
              finish_reason: 'stop',
            },
          ],
        };
        if (captured.stream !== true) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              ...chunk,
              object: 'chat.completion',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Request completed.' },
                  finish_reason: 'stop',
                },
              ],
            }),
          );
          return;
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
      })
      .catch((cause: unknown) => {
        response.destroy(new Error('Invalid model request', { cause }));
      });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected loopback address');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    delayNext: (ms: number): void => {
      nextResponseDelayMs = ms;
    },
    close: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

async function createWorkspace(config: Config): Promise<McpRuntimeOwner> {
  const policy = new RuntimePolicyOwner(config);
  return McpRuntimeOwner.create(
    {
      openBrowser: async () => {
        throw new Error('Unexpected browser');
      },
      tokenStorage: new MCPOAuthTokenStorage({
        getCredentials: async () => null,
        setCredentials: async () => {
          throw new Error('Unexpected credential write');
        },
        deleteCredentials: async () => {},
        listServers: async () => [],
        getAllCredentials: async () => new Map(),
        clearAll: async () => {},
      }),
    },
    config,
    policy.session.messageBus,
    undefined,
    undefined,
    undefined,
    policy,
    'runtime',
  );
}

async function withSharedConfig(
  run: (
    config: Config,
    endpoint: Awaited<ReturnType<typeof modelWire>>,
    adopt: (settings: SettingsService) => Promise<Agent>,
  ) => Promise<void>,
): Promise<void> {
  const root = join(tmpdir(), 'llxprt-session-settings-fixtures');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'owner-'));
  const environment = {
    LLXPRT_CONFIG_HOME: process.env.LLXPRT_CONFIG_HOME,
    LLXPRT_DATA_HOME: process.env.LLXPRT_DATA_HOME,
    LLXPRT_PROMPTS_DIR: process.env.LLXPRT_PROMPTS_DIR,
  };
  process.env.LLXPRT_CONFIG_HOME = join(directory, 'home');
  process.env.LLXPRT_DATA_HOME = join(directory, 'data');
  process.env.LLXPRT_PROMPTS_DIR = join(root, 'prompts');
  const endpoint = await modelWire();
  const fetchTransport = globalThis.fetch;
  const loopbackOnly = spyOn(globalThis, 'fetch').mockImplementation(
    (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== new URL(endpoint.url).origin)
        throw new Error(`Unexpected non-loopback model request: ${url.origin}`);
      return fetchTransport(input, init);
    },
  );
  const config = new Config(
    toConfigParameters({
      provider: 'openai',
      model: 'settings-model',
      workingDir: directory,
      sessionId: 'same-settings-owner-label',
      mcpEnabled: false,
      skillsSupport: false,
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
      harness: {
        forceInteractive: false,
        forceConfirmations: false,
        includeProcessCwd: false,
      },
    }),
  );
  const workspace = await createWorkspace(config);
  let agents: readonly Agent[] = [];
  const adopt = async (settings: SettingsService): Promise<Agent> => {
    const options = {
      config,
      mcpRuntime: workspace,
      settingsService: settings,
      sessionId: 'same-settings-owner-label',
      activation: {
        provider: 'openai',
        model: 'settings-model',
        cliOverrides: { key: 'loopback-only', baseUrl: endpoint.url },
      },
    };
    const agent = await fromConfig(options);
    agents = [...agents, agent];
    return agent;
  };
  try {
    await run(config, endpoint, adopt);
  } finally {
    await Promise.all(agents.map((agent) => agent.dispose()));
    await workspace.dispose();
    await config.dispose();
    await endpoint.close();
    loopbackOnly.mockRestore();
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

describe('explicit adopted session settings on a shared Config', () => {
  it('limits physical file results through the requesting session scheduler policy', async () => {
    await withSharedConfig(async (config, _endpoint, adopt) => {
      const path = join(config.getTargetDir(), 'output-policy.txt');
      const content =
        'Physical file output survives in the unrestricted peer.\n'.repeat(900);
      await writeFile(path, content);
      const first = await adopt(new SettingsService());
      const second = await adopt(new SettingsService());
      first.setEphemeralSetting('tool-output-max-tokens', 50);
      second.setEphemeralSetting('tool-output-max-tokens', false);
      const execute = async (agent: Agent, callId: string): Promise<string> => {
        let output = '';
        const channel = agent.tools.openClientChannel((calls) => {
          output = JSON.stringify(
            calls.map((call) => call.response.responseParts),
          );
        });
        try {
          await channel.ready;
          await channel.schedule(
            {
              callId,
              name: 'read_file',
              args: { absolute_path: path },
              isClientInitiated: true,
              prompt_id: callId,
            },
            new AbortController().signal,
          );
          return output;
        } finally {
          await channel.release();
        }
      };
      const limited = await execute(first, 'session-limited-read');
      const unrestricted = await execute(second, 'session-unrestricted-read');
      expect(limited).toContain('exceeded token limit');
      expect(unrestricted).toContain('Physical file output survives');
      expect(unrestricted.length).toBeGreaterThan(limited.length * 10);
    });
  });

  it('uses only the live session first-response watchdog when both sessions share a declaration', async () => {
    const oldTimeout = process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS;
    delete process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS;
    try {
      await withSharedConfig(async (_config, endpoint, adopt) => {
        const firstSettings = new SettingsService();
        const secondSettings = new SettingsService();
        const first = await adopt(firstSettings);
        const second = await adopt(secondSettings);
        firstSettings.set('stream-first-response-timeout-ms', 10);
        secondSettings.set('stream-first-response-timeout-ms', 1000);
        endpoint.delayNext(150);
        const firstExpired = await collect(
          first.stream('Expired first response'),
        );
        expect(
          firstExpired.events.filter((event) => event.type === 'idle-timeout'),
        ).toHaveLength(1);
        endpoint.delayNext(150);
        successful(await collect(second.stream('Peer still permits response')));
        firstSettings.set('stream-first-response-timeout-ms', 1000);
        secondSettings.set('stream-first-response-timeout-ms', 10);
        endpoint.delayNext(150);
        successful(await collect(first.stream('Changed first response')));
        endpoint.delayNext(150);
        const secondExpired = await collect(
          second.stream('Changed peer timeout'),
        );
        expect(
          secondExpired.events.filter((event) => event.type === 'idle-timeout'),
        ).toHaveLength(1);
      });
    } finally {
      if (oldTimeout === undefined)
        delete process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS;
      else process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = oldTimeout;
    }
  });

  it('applies live prompt-turn limits independently without retaining shared defaults', async () => {
    await withSharedConfig(async (_config, _endpoint, adopt) => {
      const firstSettings = new SettingsService();
      const secondSettings = new SettingsService();
      const first = await adopt(firstSettings);
      const second = await adopt(secondSettings);
      firstSettings.set('maxTurnsPerPrompt', 1);
      const limited = await collect(first.stream('Limited prompt'));
      const allowed = await collect(second.stream('Unrestricted peer prompt'));
      expect(
        limited.events.filter((event) => event.type === 'done'),
      ).toMatchObject([{ reason: 'loop-detected' }]);
      successful(allowed);
      firstSettings.set('maxTurnsPerPrompt', -1);
      secondSettings.set('maxTurnsPerPrompt', 1);
      successful(await collect(first.stream('Updated unrestricted prompt')));
      const peerLimited = await collect(
        second.stream('Updated limited prompt'),
      );
      expect(
        peerLimited.events.filter((event) => event.type === 'done'),
      ).toMatchObject([{ reason: 'loop-detected' }]);
    });
  });

  it('reads live citation policy from only the selected borrowed store', async () => {
    await withSharedConfig(async (_config, _endpoint, adopt) => {
      const firstSettings = new SettingsService();
      const secondSettings = new SettingsService();
      const first = await adopt(firstSettings);
      const second = await adopt(secondSettings);
      firstSettings.set('ui.showCitations', true);
      secondSettings.set('ui.showCitations', false);
      const observations = [
        await collect(first.stream('First citation policy')),
        await collect(second.stream('Second citation policy')),
      ];
      firstSettings.set('ui.showCitations', false);
      secondSettings.set('ui.showCitations', true);
      observations.push(
        await collect(first.stream('Changed first citation policy')),
        await collect(second.stream('Changed second citation policy')),
      );
      for (const observation of observations) successful(observation);
      expect(
        observations.map(
          ({ events }) =>
            events.filter((event) => event.type === 'citation').length,
        ),
      ).toStrictEqual([1, 0, 0, 1]);
    });
  });

  it('retains caller-supplied provider parameters when adopting a store without an active selection', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const firstSettings = new SettingsService();
      const secondSettings = new SettingsService();
      firstSettings.setProviderSetting('openai', 'temperature', 0.25);
      secondSettings.setProviderSetting('openai', 'temperature', 0.65);
      const first = await adopt(firstSettings);
      const second = await adopt(secondSettings);
      successful(
        await collect(first.stream('Initially supplied first parameters')),
      );
      successful(
        await collect(second.stream('Initially supplied second parameters')),
      );
      expect(
        endpoint.requests().map((request) => request.temperature),
      ).toStrictEqual([0.25, 0.65]);
    });
  });

  it('reads externally selected models from each borrowed store without declaration leakage', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const firstSettings = new SettingsService();
      const secondSettings = new SettingsService();
      const first = await adopt(firstSettings);
      const second = await adopt(secondSettings);
      firstSettings.setProviderSetting(
        'openai',
        'model',
        'externally-selected-first',
      );
      secondSettings.setProviderSetting(
        'openai',
        'model',
        'externally-selected-second',
      );
      expect([first.getModel(), second.getModel()]).toStrictEqual([
        'externally-selected-first',
        'externally-selected-second',
      ]);
      await first.sessionClient.refreshAuth();
      await second.sessionClient.refreshAuth();
      successful(
        await collect(first.stream('Externally selected first model')),
      );
      successful(
        await collect(second.stream('Externally selected second model')),
      );
      expect(endpoint.requests().map((request) => request.model)).toStrictEqual(
        ['externally-selected-first', 'externally-selected-second'],
      );
    });
  });

  it('uses each selected session model and parameters for detached generation', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const first = await adopt(new SettingsService());
      const second = await adopt(new SettingsService());
      await first.setModel('detached-first-model');
      await second.setModel('detached-second-model');
      first.setModelParam('temperature', 0.15);
      second.setModelParam('temperature', 0.65);
      expect(await first.generate('Detached first')).toContain(
        'Request completed.',
      );
      expect(await second.generate('Detached second')).toContain(
        'Request completed.',
      );
      expect(first.agentClient.getContentGeneratorConfig()?.model).toBe(
        'detached-first-model',
      );
      expect(second.agentClient.getContentGeneratorConfig()?.model).toBe(
        'detached-second-model',
      );
      expect(
        endpoint
          .requests()
          .map(({ model, temperature }) => ({ model, temperature })),
      ).toStrictEqual([
        { model: 'detached-first-model', temperature: 0.15 },
        { model: 'detached-second-model', temperature: 0.65 },
      ]);
    });
  });

  it('applies a profile transaction without changing a peer model or parameter authority', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const firstSettings = new SettingsService();
      const secondSettings = new SettingsService();
      const first = await adopt(firstSettings);
      const second = await adopt(secondSettings);
      expect(firstSettings.getProviderSettings('openai')['base-url']).toBe(
        endpoint.url,
      );
      second.setEphemeralSetting('tool-output-max-tokens', 131);
      second.setModelParam('temperature', 0.6);
      await first.profiles.applySnapshot({
        version: 1,
        provider: 'openai',
        model: 'profile-owned-model',
        modelParams: { temperature: 0.25 },
        ephemeralSettings: {
          'base-url': endpoint.url,
          'auth-key': 'profile-loopback',
          'tool-output-max-tokens': 89,
        },
      });
      expect(first.getEphemeralSetting('tool-output-max-tokens')).toBe(89);
      expect(second.getEphemeralSetting('tool-output-max-tokens')).toBe(131);
      expect(firstSettings.get('base-url')).toBe(endpoint.url);
      expect(secondSettings.getProviderSettings('openai')['base-url']).toBe(
        endpoint.url,
      );
      successful(await collect(first.stream('Profile request')));
      successful(await collect(second.stream('Peer request')));
      expect(
        endpoint
          .requests()
          .map(({ model, temperature }) => ({ model, temperature })),
      ).toStrictEqual([
        { model: 'profile-owned-model', temperature: 0.25 },
        { model: 'settings-model', temperature: 0.6 },
      ]);
      expect(
        endpoint.requests().map(({ authorization }) => authorization),
      ).toStrictEqual(['Bearer profile-loopback', 'Bearer loopback-only']);
    });
  });

  it('captures profiles and diagnostics from each session instead of the shared declaration', async () => {
    await withSharedConfig(async (_config, _endpoint, adopt) => {
      const first = await adopt(new SettingsService());
      const second = await adopt(new SettingsService());
      first.setEphemeralSetting('maxOutputTokens', 83);
      second.setEphemeralSetting('maxOutputTokens', 127);
      const profile = z.object({ ephemeralSettings: z.record(z.unknown()) });
      expect(
        profile.parse(first.captureProfile()).ephemeralSettings.maxOutputTokens,
      ).toBe(83);
      expect(
        profile.parse(second.captureProfile()).ephemeralSettings
          .maxOutputTokens,
      ).toBe(127);
      expect(
        first.getRuntimeDiagnosticsSnapshot().ephemeralSettings.maxOutputTokens,
      ).toBe(83);
      expect(
        second.getRuntimeDiagnosticsSnapshot().ephemeralSettings
          .maxOutputTokens,
      ).toBe(127);
    });
  });

  it('rejects settings commands synchronously when disposal starts and retains the borrowed store', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const settings = new SettingsService();
      const first = await adopt(settings);
      const second = await adopt(new SettingsService());
      first.setEphemeralSetting('maxOutputTokens', 51);
      const closing = first.dispose();
      expect(() => first.getEphemeralSetting('maxOutputTokens')).toThrow(
        'Session settings owner is closed',
      );
      expect(() => first.setEphemeralSetting('maxOutputTokens', 99)).toThrow(
        'Session settings owner is closed',
      );
      await closing;
      expect({
        provider: settings.get('activeProvider'),
        model: settings.getProviderSettings('openai').model,
        output: settings.get('maxOutputTokens'),
      }).toStrictEqual({
        provider: 'openai',
        model: 'settings-model',
        output: 51,
      });
      settings.set('maxOutputTokens', 63);
      expect(settings.get('maxOutputTokens')).toBe(63);
      successful(
        await collect(second.stream('Peer survives synchronous close')),
      );
      expect(endpoint.requests()).toHaveLength(1);
    });
  });

  it('changes the active model through the selected store without changing a peer model', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const firstSettings = new SettingsService();
      const secondSettings = new SettingsService();
      const first = await adopt(firstSettings);
      const second = await adopt(secondSettings);
      await first.setModel('first-owned-model');
      await second.setModel('second-owned-model');
      expect(firstSettings.getProviderSettings('openai').model).toBe(
        'first-owned-model',
      );
      expect(secondSettings.getProviderSettings('openai').model).toBe(
        'second-owned-model',
      );
      successful(await collect(first.stream('First model')));
      successful(await collect(second.stream('Second model')));
      expect(endpoint.requests().map((request) => request.model)).toStrictEqual(
        ['first-owned-model', 'second-owned-model'],
      );
    });
  });

  it('refreshes credentials through the explicit owner without invalidating a peer', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const settings = new SettingsService();
      const first = await adopt(settings);
      const second = await adopt(new SettingsService());
      successful(await collect(first.stream('Initial credential')));
      successful(await collect(second.stream('Peer credential')));
      settings.set('auth-key', 'replacement-loopback-only');
      settings.setProviderSetting(
        'openai',
        'auth-key',
        'replacement-loopback-only',
      );
      successful(await collect(first.stream('Updated credential')));
      successful(await collect(second.stream('Peer retained credential')));
      const credentials = endpoint
        .requests()
        .map((request) => request.authorization);
      expect(credentials[2]).not.toBe(credentials[0]);
      expect(credentials[3]).toBe(credentials[1]);
      expect(credentials.every((value) => typeof value === 'string')).toBe(
        true,
      );
    });
  });

  it('applies named tool selection to only the adopted session on the model wire', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const firstSettings = new SettingsService();
      const secondSettings = new SettingsService();
      const first = await adopt(firstSettings);
      const second = await adopt(secondSettings);
      await first.tools.setEnabled(['read_file']);
      await second.tools.setEnabled(['glob']);
      expect(firstSettings.get('tools.allowed')).toStrictEqual(['read_file']);
      expect(secondSettings.get('tools.allowed')).toStrictEqual(['glob']);
      await first.sessionClient.publishTools();
      await second.sessionClient.publishTools();
      successful(await collect(first.stream('Read-only tool selection')));
      successful(await collect(second.stream('Glob-only tool selection')));
      expect(
        endpoint
          .requests()
          .map((request) => request.tools?.map((tool) => tool.function.name)),
      ).toStrictEqual([['read_file'], ['glob']]);
      expect(firstSettings.get('tools.allowed')).toStrictEqual(['read_file']);
      expect(secondSettings.get('tools.allowed')).toStrictEqual(['glob']);
    });
  });

  it('publishes independent live task schema policy through each session settings owner', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const first = await adopt(new SettingsService());
      const second = await adopt(new SettingsService());
      first.setEphemeralSetting('subagents.async.enabled', false);
      second.setEphemeralSetting('subagents.async.enabled', true);
      await first.sessionClient.publishTools();
      await second.sessionClient.publishTools();
      successful(await collect(first.stream('Disabled async schema')));
      successful(await collect(second.stream('Enabled async schema')));
      first.setEphemeralSetting('subagents.async.enabled', true);
      second.setEphemeralSetting('subagents.async.enabled', false);
      await first.sessionClient.publishTools();
      await second.sessionClient.publishTools();
      successful(await collect(first.stream('Restored async schema')));
      successful(await collect(second.stream('Withdrawn async schema')));
      const properties = endpoint.requests().map((request) => {
        const task = request.tools?.find(
          (tool) => tool.function.name === 'task',
        );
        if (task === undefined)
          throw new Error('Missing task wire declaration');
        return z
          .object({ properties: z.record(z.unknown()) })
          .parse(task.function.parameters).properties;
      });
      expect(properties[0]).not.toHaveProperty('async');
      expect(properties[1]).toHaveProperty('async');
      expect(properties[2]).toHaveProperty('async');
      expect(properties[3]).not.toHaveProperty('async');
    });
  });

  it('uses each supplied settings identity for actual model parameters and future changes', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const firstSettings = new SettingsService();
      const secondSettings = new SettingsService();
      firstSettings.set('activeProvider', 'openai');
      secondSettings.set('activeProvider', 'openai');
      firstSettings.setProviderSetting('openai', 'model', 'settings-model');
      secondSettings.setProviderSetting('openai', 'model', 'settings-model');
      firstSettings.setProviderSetting('openai', 'temperature', 0.2);
      secondSettings.setProviderSetting('openai', 'temperature', 0.7);
      const first = await adopt(firstSettings);
      const second = await adopt(secondSettings);
      successful(await collect(first.stream('First settings request')));
      successful(await collect(second.stream('Second settings request')));
      firstSettings.setProviderSetting('openai', 'temperature', 0.4);
      successful(await collect(first.stream('Changed first settings request')));
      successful(
        await collect(second.stream('Retained second settings request')),
      );
      expect(
        endpoint.requests().map((request) => request.temperature),
      ).toStrictEqual([0.2, 0.7, 0.4, 0.7]);
    });
  });

  it('keeps public ephemeral changes local and preserves adopted stores after either facade closes', async () => {
    await withSharedConfig(async (_config, endpoint, adopt) => {
      const firstSettings = new SettingsService();
      const secondSettings = new SettingsService();
      const first = await adopt(firstSettings);
      const second = await adopt(secondSettings);
      first.setEphemeralSetting('maxOutputTokens', 73);
      second.setEphemeralSetting('maxOutputTokens', 109);
      expect(first.getEphemeralSetting('maxOutputTokens')).toBe(73);
      expect(second.getEphemeralSetting('maxOutputTokens')).toBe(109);
      first.setModelParam('temperature', 0.3);
      second.setModelParam('temperature', 0.8);
      await first.dispose();
      expect({
        provider: firstSettings.get('activeProvider'),
        model: firstSettings.getProviderSettings('openai').model,
        temperature: firstSettings.getProviderSettings('openai').temperature,
        output: firstSettings.get('maxOutputTokens'),
      }).toStrictEqual({
        provider: 'openai',
        model: 'settings-model',
        temperature: 0.3,
        output: 73,
      });
      successful(await collect(second.stream('Surviving settings request')));
      expect(
        endpoint.requests().map((request) => request.temperature),
      ).toStrictEqual([0.8]);
      await second.dispose();
      expect({
        provider: secondSettings.get('activeProvider'),
        model: secondSettings.getProviderSettings('openai').model,
        temperature: secondSettings.getProviderSettings('openai').temperature,
        output: secondSettings.get('maxOutputTokens'),
      }).toStrictEqual({
        provider: 'openai',
        model: 'settings-model',
        temperature: 0.8,
        output: 109,
      });
    });
  });
});
