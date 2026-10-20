import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers/providerFilePolicy.js';
import { createAgent, type Agent } from '../index.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { startLocalConnectProxy } from './helpers/local-connect-proxy.js';

class MemoryStore implements TokenStore {
  private readonly tokens = new Map<string, OAuthToken>();
  async getToken(provider: string): Promise<OAuthToken | null> {
    return this.tokens.get(provider) ?? null;
  }
  async saveToken(provider: string, token: OAuthToken): Promise<void> {
    this.tokens.set(provider, token);
  }
  async removeToken(provider: string): Promise<void> {
    this.tokens.delete(provider);
  }
  async listProviders(): Promise<string[]> {
    return [...this.tokens.keys()];
  }
  async listBuckets(): Promise<string[]> {
    return [];
  }
  async getBucketStats(): Promise<null> {
    return null;
  }
  async acquireAuthLock(): Promise<boolean> {
    return true;
  }
  async releaseAuthLock(): Promise<void> {}
  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }
  async releaseRefreshLock(): Promise<void> {}
}

function proxyConnections(
  proxy: Awaited<ReturnType<typeof startLocalConnectProxy>> | undefined,
): number {
  return proxy?.readConnections() ?? 0;
}

function maintenanceConnections(proxied: boolean, failed: boolean): number {
  if (!proxied) return 0;
  return failed ? 2 : 1;
}

describe('public Agent same-label Kimi files', () => {
  const credentials = useOwnedCredentials();
  const oldHome = process.env.LLXPRT_CONFIG_HOME;
  const oldFake = process.env.LLXPRT_FAKE_RESPONSES;
  let home: string;
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'runtime-owner-kimi-'));
    process.env.LLXPRT_CONFIG_HOME = home;
    delete process.env.LLXPRT_FAKE_RESPONSES;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = oldHome;
    if (oldFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = oldFake;
    await rm(home, { recursive: true, force: true });
  });
  it.each([
    ...[false, true].flatMap((adoptConfig) =>
      [false, true].flatMap((failDeletion) =>
        [false, true].map((proxied) => ({
          adoptConfig,
          failDeletion,
          proxied,
        })),
      ),
    ),
  ])(
    'keeps same-label Kimi uploads alive across caller scope and cleanup policy %j',
    async ({ failDeletion, adoptConfig, proxied }) => {
      const proxy = proxied ? await startLocalConnectProxy() : undefined;
      const agents: Agent[] = [];
      const configs: Config[] = [];
      const deleted: string[] = [];
      const requests: string[] = [];
      let deletionFailed = false;
      let uploaded = 0;
      let firstAttempts = 0;
      let releaseHeld: () => void = () => undefined;
      let enteredHeld: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        releaseHeld = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        enteredHeld = resolve;
      });
      const server = createServer((request, reply) => {
        const received = once(request, 'end');
        request.resume();
        void (async (): Promise<void> => {
          await received;
          const url = request.url ?? '';
          const owner =
            request.headers.authorization?.includes('test-key-1') === true
              ? 1
              : 0;
          requests.push(`${request.method} ${url} owner=${owner}`);
          if (url.includes('/files/') && request.method === 'DELETE') {
            const fileId = url.split('/').pop() ?? '';
            if (failDeletion && owner === 0 && !deletionFailed) {
              deletionFailed = true;
              reply.writeHead(400, { 'content-type': 'application/json' }).end(
                JSON.stringify({
                  error: { message: 'held cleanup failure' },
                }),
              );
              return;
            }
            deleted.push(fileId);
            reply
              .writeHead(200, { 'content-type': 'application/json' })
              .end(
                JSON.stringify({ id: fileId, object: 'file', deleted: true }),
              );
            return;
          }
          if (url.endsWith('/files')) {
            uploaded += 1;
            reply.writeHead(200, { 'content-type': 'application/json' }).end(
              JSON.stringify({
                id: `public-file-${owner}`,
                object: 'file',
                bytes: 5,
                created_at: 1,
                filename: 'clip.mp4',
                purpose: 'video',
                status: 'processed',
              }),
            );
            return;
          }
          if (url.includes('/chat/completions')) {
            if (owner === 0 && ++firstAttempts === 1) {
              requests.push('response 503 owner=0');
              reply
                .writeHead(503, { 'content-type': 'application/json' })
                .end(JSON.stringify({ error: { message: 'retryable' } }));
              return;
            }
            void (async (): Promise<void> => {
              if (owner === 1) {
                enteredHeld();
                await held;
              }
              requests.push(`response 200 owner=${owner}`);
              reply
                .writeHead(200, { 'content-type': 'text/event-stream' })
                .end(
                  `data: ${JSON.stringify({ id: 'chat', object: 'chat.completion.chunk', created: 1, model: 'kimi-k3', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                );
            })();
            return;
          }
          reply.writeHead(500).end('unexpected request');
        })();
      });
      server.on('clientError', (error, socket) => {
        const packet =
          'rawPacket' in error && Buffer.isBuffer(error.rawPacket)
            ? error.rawPacket.subarray(0, 48).toString('hex')
            : 'no-raw-packet';
        requests.push(`clientError ${error.message} ${packet}`);
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Missing HTTP server address');
      const endpoint = `http://127.0.0.1:${address.port}/v1`;
      const media = {
        speaker: 'human' as const,
        blocks: [
          { type: 'text' as const, text: 'describe clip' },
          {
            type: 'media' as const,
            encoding: 'base64' as const,
            mimeType: 'video/mp4',
            data: 'VklERU8=',
            filename: 'clip.mp4',
          },
        ],
      };
      try {
        for (const index of [0, 1]) {
          agents.push(
            await (async (): Promise<Agent> => {
              if (adoptConfig) {
                const config = new Config({
                  sessionId: 'distinct-caller-config-scope',
                  cwd: process.cwd(),
                  targetDir: process.cwd(),
                  debugMode: false,
                  provider: 'kimi',
                  model: 'kimi-k3',
                  proxy: proxy?.url,
                });
                configs.push(config);
                const settings = new SettingsService();
                settings.set('provider-files', 'session');
                settings.set('kimi.experimental-video', true);
                const fileOptions = {
                  maxFiles: 10,
                  maxBytes: 1024 * 1024,
                  proxy: proxy?.url,
                };
                const lifecycle = new ProviderFileLifecycle(fileOptions);
                fileOptions.proxy = 'http://127.0.0.1:1';
                return fromConfig(
                  config,
                  settings,
                  {
                    sessionId: 'same-kimi-label',
                    activation: {
                      provider: 'kimi',
                      model: 'kimi-k3',
                      cliOverrides: {
                        key: `test-key-${index}`,
                        baseUrl: endpoint,
                      },
                    },
                  },
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  lifecycle,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  credentials().authority,
                );
              }
              const options = {
                credentialAuthority: credentials().authority,
                provider: 'kimi',
                model: 'kimi-k3',
                proxy: proxy?.url,
                workingDir: process.cwd(),
                sessionId: 'same-kimi-label',
                tokenStore: new MemoryStore(),
                auth: { apiKey: `test-key-${index}`, baseUrl: endpoint },
              };
              return createAgent(options);
            })(),
          );
        }
        for (const agent of agents) {
          agent.setEphemeralSetting('provider-files', 'session');
          agent.setEphemeralSetting('kimi.experimental-video', true);
        }
        await agents[0].ide.setTrustedFolderLive(false);
        expect(agents[0].ide.isTrustedFolder()).toBe(false);
        expect(agents[1].ide.isTrustedFolder()).toBe(true);
        const first = agents[0].generate(media);
        const second = agents[1].generate(media);
        await Promise.race([
          entered,
          second.then(() => {
            throw new Error(
              'Second Agent finished before its held HTTP request',
            );
          }),
        ]);
        await first;
        expect(firstAttempts).toBeGreaterThan(1);
        expect(uploaded).toBe(2);
        const connectionsBeforeRelease = proxyConnections(proxy);
        const disposal = await agents[0].dispose().then(
          () => null,
          (error: unknown) => error,
        );
        expect(credentials().snapshot()).toStrictEqual(
          adoptConfig ? [1, 0] : [],
        );
        expect(configs.map((config) => config.getSessionId())).toStrictEqual(
          adoptConfig
            ? ['distinct-caller-config-scope', 'distinct-caller-config-scope']
            : [],
        );
        const stateBeforeRetry = agents.map(
          (owner) => owner.captureProviderFiles().retainedFiles,
        );
        const deletionBeforeRetry = [...deleted];
        const retried = await agents[0].retryProviderFileDeletions();
        expect(disposal === null ? '' : String(disposal)).toMatch(
          failDeletion ? /cleanup/ : /^$/,
        );
        expect(deletionBeforeRetry).toStrictEqual(
          failDeletion ? [] : ['public-file-0'],
        );
        expect(stateBeforeRetry).toStrictEqual(failDeletion ? [1, 1] : [0, 1]);
        expect(retried.failed).toBe(0);
        expect(proxyConnections(proxy) - connectionsBeforeRelease).toBe(
          maintenanceConnections(proxied, failDeletion),
        );
        expect(deleted).toStrictEqual(['public-file-0']);
        expect(
          agents.map((owner) => owner.captureProviderFiles().retainedFiles),
        ).toStrictEqual([0, 1]);
        releaseHeld();
        await second;
        expect(await agents[1].generate('continue')).toBe('ok');
        await expect(agents[0].generate(media)).rejects.toThrow(
          'Agent is closed',
        );
        const connectionsBeforePeerRelease = proxyConnections(proxy);
        await agents[1].dispose();
        expect(proxyConnections(proxy) - connectionsBeforePeerRelease).toBe(
          proxied ? 1 : 0,
        );
        expect(deleted).toStrictEqual(['public-file-0', 'public-file-1']);
        expect(credentials().snapshot()).toStrictEqual(
          adoptConfig ? [1, 1] : [],
        );
        expect(
          requests
            .filter((entry) => entry.includes('/chat/completions'))
            .sort(),
        ).toStrictEqual([
          'POST /v1/chat/completions owner=0',
          'POST /v1/chat/completions owner=0',
          'POST /v1/chat/completions owner=1',
          'POST /v1/chat/completions owner=1',
        ]);
        expect(requests).toContain('response 503 owner=0');
        expect(proxyConnections(proxy)).toBeGreaterThanOrEqual(proxied ? 4 : 0);
        expect(requests.some((entry) => entry.startsWith('clientError'))).toBe(
          false,
        );
      } catch (error) {
        throw new Error(`Kimi HTTP sequence: ${JSON.stringify(requests)}`, {
          cause: error,
        });
      } finally {
        releaseHeld();
        await Promise.allSettled(agents.map((agent) => agent.dispose()));
        await Promise.allSettled(configs.map((config) => config.dispose()));
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
        await proxy?.close();
      }
    },
  );
});
