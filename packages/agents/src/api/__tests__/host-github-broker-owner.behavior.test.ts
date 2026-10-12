/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { json } from 'node:stream/consumers';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { GitHubBrokerClient } from '@vybestack/llxprt-code-tools';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { fromConfig } from '../fromConfig.js';
import type { Agent } from '../agent.js';

import { createAgent } from '../createAgent.js';
function barrier(): { promise: Promise<void>; release(): void } {
  let release = (): void => {
    throw new Error('Uninitialized barrier');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function reportWire(hold = false) {
  const entered = barrier();
  const response = barrier();
  const payload = z.object({
    op: z.enum(['issue.create', 'issue.view']),
    params: z.record(z.unknown()),
  });
  let accepted: readonly string[] = [];
  let credential: string | undefined = 'local-report-key';
  const server = createServer((request, reply) => {
    void json(request)
      .then(async (value: unknown): Promise<void> => {
        const body = payload.parse(value);
        if (request.headers.authorization !== 'Bearer local-report-key') {
          reply
            .writeHead(401)
            .end(JSON.stringify({ error: 'Report authorization revoked' }));
          return;
        }
        accepted = [...accepted, body.op];
        entered.release();
        if (hold) await response.promise;
        reply.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            number: accepted.length,
            title:
              typeof body.params.title === 'string'
                ? body.params.title.toUpperCase()
                : 'EXISTING REPORT',
            state: 'open',
          }),
        );
      })
      .catch((cause: unknown) =>
        reply.destroy(new Error('Invalid local report request', { cause })),
      );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing report socket');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const client: GitHubBrokerClient = {
    runOperation: async (op, params, signal) => {
      const reply = await fetch(endpoint, {
        method: 'POST',
        headers:
          credential === undefined
            ? {}
            : { authorization: `Bearer ${credential}` },
        body: JSON.stringify({ op, params }),
        signal,
      });
      const value: unknown = await reply.json();
      const data = z.record(z.unknown()).parse(value);
      if (!reply.ok) throw new Error(z.string().parse(data.error));
      return data;
    },
  };
  return {
    client,
    entered: entered.promise,
    release: response.release,
    accepted: () => accepted,
    revoke: (): void => {
      credential = undefined;
    },
    stop: async (): Promise<void> => {
      response.release();
      const closing = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await closing;
    },
  };
}

async function withConfig(
  run: (config: Config) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'github-host-owner-'));
  const config = new Config({
    sessionId: 'same-report-label',
    targetDir: directory,
    cwd: directory,
    provider: 'openai',
    model: 'gpt-5.6',
    debugMode: false,
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

function adopt(config: Config, client?: GitHubBrokerClient): Promise<Agent> {
  return fromConfig({
    config,
    settingsService: new SettingsService(),
    sessionId: 'same-report-label',
    activation: { authMode: 'none' },
    githubBrokerClient: client,
  });
}

function github(agent: Agent) {
  const tool = agent.tools.get('github');
  if (tool === undefined)
    throw new Error('Explicit host GitHub operation was not registered');
  return tool;
}

async function readReport(agent: Agent) {
  return github(agent).buildAndExecute(
    { op: 'issue.view', number: 1 },
    new AbortController().signal,
  );
}

describe('explicit host GitHub broker ownership', () => {
  it('does not retain a broker field or getter on Config', async () => {
    await withConfig(async (config) => {
      expect('getGitHubBrokerClient' in config).toBe(false);
      expect('githubBrokerClient' in config).toBe(false);
    });
  });

  for (const closeFirst of [true, false]) {
    it(`isolates same-label shared-Config report roots when closing ${closeFirst ? 'first' : 'second'}`, async () => {
      await withConfig(async (config) => {
        const firstWire = await reportWire();
        const secondWire = await reportWire();
        const owners: Agent[] = [];
        try {
          const first = await adopt(config, firstWire.client);
          owners.push(first);
          const second = await adopt(config, secondWire.client);
          owners.push(second);
          const invocation = github(first).build({
            op: 'issue.create',
            title: 'owner one',
          });
          expect(
            await invocation.shouldConfirmExecute(new AbortController().signal),
          ).toMatchObject({ type: 'info' });
          const created = await invocation.execute(
            new AbortController().signal,
          );
          expect(String(created.llmContent)).toContain('OWNER ONE');
          expect((await readReport(second)).error).toBeUndefined();
          expect(firstWire.accepted()).toStrictEqual(['issue.create']);
          expect(secondWire.accepted()).toStrictEqual(['issue.view']);
          const closed = closeFirst ? first : second;
          const peer = closeFirst ? second : first;
          const retained = github(closed).build({
            op: 'issue.view',
            number: 1,
          });
          const closing = closed.dispose();
          await expect(
            retained.execute(new AbortController().signal),
          ).rejects.toThrow('closed');
          await closing;
          expect((await readReport(peer)).error).toBeUndefined();
          const callerResult = await (
            closeFirst ? firstWire : secondWire
          ).client.runOperation(
            'issue.view',
            { number: 1 },
            new AbortController().signal,
          );
          expect(callerResult.number).toBe(2);
        } finally {
          await Promise.allSettled(owners.map((owner) => owner.dispose()));
          await firstWire.stop();
          await secondWire.stop();
        }
      });
    });
  }

  it('keeps caller authorization live and rejects malformed operations before reaching the server', async () => {
    await withConfig(async (config) => {
      const wire = await reportWire();
      let agent: Agent | undefined;
      try {
        agent = await adopt(config, wire.client);
        const tool = github(agent);
        await expect(
          tool.buildAndExecute(
            { op: 'issue.view', number: 0 },
            new AbortController().signal,
          ),
        ).rejects.toThrow('number');
        expect(wire.accepted()).toStrictEqual([]);
        expect((await readReport(agent)).error).toBeUndefined();
        wire.revoke();
        const rejected = await readReport(agent);
        expect(
          z.object({ message: z.string() }).parse(rejected.error).message,
        ).toContain('authorization revoked');
        expect(String(rejected.llmContent)).not.toContain('local-report-key');
        expect(wire.accepted()).toStrictEqual(['issue.view']);
      } finally {
        await agent?.dispose();
        await wire.stop();
      }
    });
  });

  it('returns the actual cancellation response and joins accepted report dispatch before disposal', async () => {
    await withConfig(async (config) => {
      const wire = await reportWire(true);
      let agent: Agent | undefined;
      try {
        agent = await adopt(config, wire.client);
        const tool = github(agent);
        const pending = tool.buildAndExecute(
          { op: 'issue.view', number: 1 },
          new AbortController().signal,
        );
        await wire.entered;
        const closing = agent.dispose();
        await expect(
          tool.buildAndExecute(
            { op: 'issue.view', number: 2 },
            new AbortController().signal,
          ),
        ).rejects.toThrow('closed');
        const result = await pending;
        expect(
          z.object({ message: z.string() }).parse(result.error).message,
        ).toContain('GitHub operation failed');
        expect(String(result.llmContent)).not.toContain('EXISTING REPORT');
        await closing;
        expect(wire.accepted()).toStrictEqual(['issue.view']);
      } finally {
        wire.release();
        await agent?.dispose();
        await wire.stop();
      }
    });
  });

  it('omits a missing broker and respects tool exclusions with an explicit broker', async () => {
    await withConfig(async (config) => {
      const missing = await adopt(config);
      try {
        expect(missing.tools.get('github')).toBeUndefined();
      } finally {
        await missing.dispose();
      }
      const wire = await reportWire();
      const settingsService = new SettingsService();
      settingsService.set('tools.disabled', ['github']);
      const excluded = await fromConfig({
        config,
        settingsService,
        githubBrokerClient: wire.client,
        activation: { authMode: 'none' },
      });
      try {
        expect(excluded.tools.get('github')).toBeUndefined();
        expect(wire.accepted()).toStrictEqual([]);
      } finally {
        await excluded.dispose();
        await wire.stop();
      }
    });
  });

  it('aggregates failed construction with explicitly transferred broker disposal and leaves the caller Config usable', async () => {
    await withConfig(async (config) => {
      const wire = await reportWire();
      const cleanupFailure = new Error('Owned report transport cleanup failed');
      let failure: unknown;
      try {
        await fromConfig({
          config,
          settingsService: new SettingsService(),
          sessionId: '',
          githubBrokerClient: wire.client,
          disposeGitHubBroker: async (): Promise<void> => {
            throw cleanupFailure;
          },
          activation: { authMode: 'none' },
        });
      } catch (error: unknown) {
        failure = error;
      }
      try {
        expect(failure).toBeInstanceOf(AggregateError);
        if (!(failure instanceof AggregateError))
          throw new Error('Missing aggregated bootstrap error');
        expect(failure.errors).toContain(cleanupFailure);
        const peer = await adopt(config, wire.client);
        try {
          expect((await readReport(peer)).error).toBeUndefined();
        } finally {
          await peer.dispose();
        }
      } finally {
        await wire.stop();
      }
    });
  });

  it('settles transferred transport failure once after session assembly fails while a shared-Config peer stays usable', async () => {
    await withConfig(async (config) => {
      const caller = await reportWire();
      const owned = await reportWire();
      const peer = await adopt(config, caller.client);
      const primary = new Error('Host report tool preparation failed');
      const cleanup = new Error('Transferred host report transport failed');
      try {
        let failure: unknown;
        try {
          await fromConfig({
            config,
            settingsService: new SettingsService(),
            activation: { authMode: 'none' },
            githubBrokerClient: owned.client,
            disposeGitHubBroker: async (): Promise<void> => {
              await owned.stop();
              throw cleanup;
            },
            prepareSessionTools: (): void => {
              throw primary;
            },
          });
        } catch (error: unknown) {
          failure = error;
        }
        const errors = (error: unknown): readonly unknown[] =>
          error instanceof AggregateError
            ? error.errors.flatMap(errors)
            : [error];
        expect(
          errors(failure).filter((error) => error === primary),
        ).toHaveLength(1);
        expect(
          errors(failure).filter((error) => error === cleanup),
        ).toHaveLength(1);
        expect((await readReport(peer)).error).toBeUndefined();
        await expect(
          owned.client.runOperation(
            'issue.view',
            { number: 1 },
            new AbortController().signal,
          ),
        ).rejects.toThrow('Unable to connect');
      } finally {
        await peer.dispose();
        await caller.stop();
      }
    });
  });

  it('assembles created roots with explicit transport transfer and closes the owned server exactly once', async () => {
    await withConfig(async (config) => {
      const wire = await reportWire();
      const agent = await createAgent({
        provider: 'openai',
        model: 'report-host-model',
        auth: {
          apiKey: 'local-provider-key',
          baseUrl: 'http://127.0.0.1:1/v1',
        },
        workingDir: config.getWorkingDir(),
        sessionId: 'created-report-host',
        harness: { includeProcessCwd: false },
        skillsSupport: false,
        mcpEnabled: false,
        telemetry: { enabled: false },
        githubBrokerClient: wire.client,
        disposeGitHubBroker: wire.stop,
      });
      try {
        expect((await readReport(agent)).error).toBeUndefined();
      } finally {
        await agent.dispose();
      }
      await agent.dispose();
      await expect(
        wire.client.runOperation(
          'issue.view',
          { number: 1 },
          new AbortController().signal,
        ),
      ).rejects.toThrow('Unable to connect');
    });
  });
});
