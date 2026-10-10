import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { json } from 'node:stream/consumers';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { fromConfig } from '../fromConfig.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { collect, successful } from './turn-revision-capture.fixture.js';

const wireSchema = z.object({
  model: z.string(),
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

async function startWire() {
  let requests: ReadonlyArray<z.infer<typeof wireSchema>> = [];
  const server = createServer((request, response) => {
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ data: [] }));
      return;
    }
    void json(request)
      .then((body: unknown) => {
        const captured = wireSchema.parse(body);
        requests = [...requests, captured];
        const chunk = {
          id: 'session-tool-wire',
          object: 'chat.completion.chunk',
          created: 1,
          model: captured.model,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'Physical response complete.',
              },
              finish_reason: 'stop',
            },
          ],
        };
        response
          .writeHead(200, { 'content-type': 'text/event-stream' })
          .end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
      })
      .catch((cause: unknown) =>
        response.destroy(
          new Error('Invalid physical model request', { cause }),
        ),
      );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing loopback address');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

async function startWorkspace(directory: string, jitContextEnabled = true) {
  const config = new Config(
    toConfigParameters({
      provider: 'openai',
      model: 'schema-alpha',
      settings: { jitContextEnabled },
      workingDir: directory,
      sessionId: 'shared-model-schema-label',
      folderTrust: true,
      mcpEnabled: false,
      skillsSupport: false,
      telemetry: { enabled: false },
      recording: { enabled: false },
      harness: {
        forceInteractive: false,
        forceConfirmations: false,
        includeProcessCwd: false,
      },
    }),
  );
  const policy = new RuntimePolicyOwner(config);
  const workspace = await McpRuntimeOwner.create(
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
  return { config, workspace };
}

function taskSchema(
  request: z.infer<typeof wireSchema>,
): Record<string, unknown> {
  const schema = request.tools?.find((entry) => entry.function.name === 'task')
    ?.function.parameters;
  if (schema === undefined)
    throw new Error('Missing actual TaskTool wire declaration');
  return z.object({ properties: z.record(z.unknown()) }).parse(schema)
    .properties;
}

describe('independent session model routing and schema refresh on a shared Config', () => {
  it('refreshes actual TaskTool schemas without routing a peer through the changed model', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shared-tool-model-'));
    const endpoint = await startWire();
    const { config, workspace } = await startWorkspace(directory);
    const sharedSettings = new SettingsService();
    const adopt = (model: string) =>
      fromConfig({
        ...createSessionSettingsFixture(config, sharedSettings),
        config,
        mcpRuntime: workspace,
        sessionId: 'shared-model-schema-label',
        activation: {
          provider: 'openai',
          model,
          cliOverrides: { key: 'local-model-only', baseUrl: endpoint.url },
        },
      });
    const first = await adopt('schema-alpha');
    const second = await adopt('schema-beta');
    try {
      expect(new Set([first.agentClient, second.agentClient]).size).toBe(2);
      expect(
        new Set([first.getMessageBus(), second.getMessageBus()]).size,
      ).toBe(2);
      successful(await collect(first.stream('First physical schema request')));
      successful(
        await collect(second.stream('Second physical schema request')),
      );
      expect(endpoint.requests().map((request) => request.model)).toStrictEqual(
        ['schema-alpha', 'schema-beta'],
      );
      expect(taskSchema(endpoint.requests()[0])).toHaveProperty('async');
      expect(taskSchema(endpoint.requests()[1])).toHaveProperty('async');
      first.setEphemeralSetting('subagents.async.enabled', false);
      await first.sessionClient.publishTools();
      await second.sessionClient.publishTools();
      await first.setModel('schema-gamma');
      successful(
        await collect(first.stream('Changed model with current schema')),
      );
      successful(
        await collect(second.stream('Unchanged peer with current schema')),
      );
      expect(endpoint.requests().map((request) => request.model)).toStrictEqual(
        ['schema-alpha', 'schema-beta', 'schema-gamma', 'schema-beta'],
      );
      expect(taskSchema(endpoint.requests()[2])).not.toHaveProperty('async');
      expect(taskSchema(endpoint.requests()[3])).not.toHaveProperty('async');
      await first.tools.setEnabled(['read_file']);
      await first.sessionClient.publishTools();
      await second.sessionClient.publishTools();
      successful(
        await collect(second.stream('Strict session whitelist refreshed')),
      );
      expect(
        endpoint.requests()[4].tools?.map((entry) => entry.function.name),
      ).toStrictEqual(['read_file']);
      expect(first.tools.get('task')).toBeUndefined();
      expect(second.tools.get('task')).toBeUndefined();
      await first.dispose();
      successful(
        await collect(
          second.stream('Peer retained after independent owner close'),
        ),
      );
      expect(endpoint.requests()[5].model).toBe('schema-beta');
    } finally {
      await first.dispose();
      await second.dispose();
      await workspace.dispose();
      await config.dispose();
      await endpoint.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('keeps independent current endpoints when peer activation changes shared configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shared-tool-endpoint-'));
    const endpointA = await startWire();
    const endpointB = await startWire();
    const { config, workspace } = await startWorkspace(directory);
    const first = await fromConfig({
      ...createSessionSettingsFixture(config),
      config,
      mcpRuntime: workspace,
      activation: {
        provider: 'openai',
        model: 'endpoint-alpha',
        cliOverrides: { key: 'local-model-only', baseUrl: endpointA.url },
      },
    });
    const second = await fromConfig({
      ...createSessionSettingsFixture(config),
      config,
      mcpRuntime: workspace,
      activation: {
        provider: 'openai',
        model: 'endpoint-beta',
        cliOverrides: { key: 'local-model-only', baseUrl: endpointB.url },
      },
    });
    try {
      successful(await collect(first.stream('Route first endpoint')));
      successful(await collect(second.stream('Route second endpoint')));
      expect(
        endpointA.requests().map((request) => request.model),
      ).toStrictEqual(['endpoint-alpha']);
      expect(
        endpointB.requests().map((request) => request.model),
      ).toStrictEqual(['endpoint-beta']);
      await first.setModel('endpoint-gamma');
      successful(await collect(second.stream('Route unchanged endpoint')));
      successful(await collect(first.stream('Route current first endpoint')));
      expect(
        endpointA.requests().map((request) => request.model),
      ).toStrictEqual(['endpoint-alpha', 'endpoint-gamma']);
      expect(
        endpointB.requests().map((request) => request.model),
      ).toStrictEqual(['endpoint-beta', 'endpoint-beta']);
    } finally {
      await first.dispose();
      await second.dispose();
      await workspace.dispose();
      await config.dispose();
      await endpointA.close();
      await endpointB.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('session instruction prompts on an adopted physical workspace', () => {
  for (const jitEnabled of [false, true]) {
    for (const firstClosed of ['first', 'second']) {
      it(`keeps current instruction payloads independent with ${firstClosed} facade disposed first and JIT ${jitEnabled}`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'shared-memory-wire-'));
        await mkdir(join(directory, '.git'));
        await writeFile(
          join(directory, 'LLXPRT.md'),
          'Public project instruction version one.',
        );
        const endpoint = await startWire();
        const { config, workspace } = await startWorkspace(
          directory,
          jitEnabled,
        );
        const adopt = () =>
          fromConfig({
            ...createSessionSettingsFixture(config),
            config,
            mcpRuntime: workspace,
            sessionId: 'shared-memory-label',
            activation: {
              provider: 'openai',
              model: 'memory-model',
              cliOverrides: { key: 'loopback-only', baseUrl: endpoint.url },
            },
          });
        const first = await adopt();
        const second = await adopt();
        try {
          await first.memory.refresh();
          first.memory.setMemory('First session instruction override.');
          successful(await collect(first.stream('Read first memory payload')));
          successful(await collect(second.stream('Read peer memory payload')));
          const firstBody = JSON.stringify(endpoint.requests()[0].messages);
          const peerBody = JSON.stringify(endpoint.requests()[1].messages);
          expect(firstBody).toContain('First session instruction override.');
          expect(peerBody).not.toContain('First session instruction override.');
          expect(peerBody).toContain('Public project instruction version one.');
          const survivor = firstClosed === 'first' ? second : first;
          await (firstClosed === 'first' ? first : second).dispose();
          await writeFile(
            join(directory, 'LLXPRT.md'),
            'Public project instruction version two.',
          );
          await survivor.memory.refresh();
          await survivor.sessionClient.refreshAuth();
          successful(
            await collect(survivor.stream('Read after facade disposal')),
          );
          const finalBody = JSON.stringify(endpoint.requests()[2].messages);
          expect(finalBody).toContain(
            'Public project instruction version two.',
          );
          expect(finalBody).not.toContain(
            'First session instruction override.',
          );
          expect(config.getProvidedInstructions()).toBe('');
        } finally {
          await first.dispose();
          await second.dispose();
          await workspace.dispose();
          await config.dispose();
          await endpoint.close();
          await rm(directory, { recursive: true, force: true });
        }
      });
    }
  }
});
