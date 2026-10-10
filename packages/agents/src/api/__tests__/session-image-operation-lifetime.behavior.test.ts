/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { json } from 'node:stream/consumers';
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { runImageOperation } from '@vybestack/llxprt-code-core/services/image/imageOperationDispatch.js';
import { validatePngStructure } from '@vybestack/llxprt-code-core/services/image/ImageGenerationService.js';
import { CodexImageBackend } from '@vybestack/llxprt-code-providers/openai/codexImageBackend.js';
import { createAgent } from '../createAgent.js';
import { fromConfig } from '../fromConfig.js';
import type { ImageOperationRunner } from '@vybestack/llxprt-code-core/services/image/imageCapability.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  MemoryTokenStore,
  createTestProvider,
  makeToken,
} from './helpers/provider-auth-fixtures.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

function barrier(): { readonly promise: Promise<void>; release(): void } {
  let release = (): void => {
    throw new Error('Uninitialized image barrier');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface ImageWire {
  readonly endpoint: string;
  readonly backend: CodexImageBackend;
  readonly entered: Promise<void>;
  release(): void;
  requests(): number;
  records(): ReadonlyArray<{
    readonly authorization: string | undefined;
    readonly account: string | string[] | undefined;
    readonly path: string | undefined;
    readonly images: readonly string[];
  }>;
  rotateCredential(): void;
  stop(): Promise<void>;
}

async function imageWire(hold: boolean): Promise<ImageWire> {
  const entered = barrier();
  const response = barrier();
  let requests = 0;
  let credential = {
    accessToken: 'local-image-credential',
    accountId: 'local-image-account',
  };
  const records: Array<{
    readonly authorization: string | undefined;
    readonly account: string | string[] | undefined;
    readonly path: string | undefined;
    readonly images: readonly string[];
  }> = [];
  const server = createServer((request, reply) => {
    void json(request)
      .then(async (value: unknown): Promise<void> => {
        const body = z
          .object({
            prompt: z.string(),
            model: z.string(),
            images: z.array(z.object({ image_url: z.string() })).optional(),
          })
          .parse(value);
        if (
          (!(request.url ?? '').endsWith('/images/generations') &&
            !(request.url ?? '').endsWith('/images/edits')) ||
          request.headers.authorization !==
            `Bearer ${credential.accessToken}` ||
          request.headers['chatgpt-account-id'] !== credential.accountId
        ) {
          reply.writeHead(400).end('Unexpected image protocol');
          return;
        }
        records.push({
          authorization: request.headers.authorization,
          account: request.headers['chatgpt-account-id'],
          path: request.url,
          images: body.images?.map((image) => image.image_url) ?? [],
        });
        requests += 1;
        entered.release();
        if (hold) await response.promise;
        reply
          .writeHead(200, { 'content-type': 'application/json' })
          .end(
            JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }),
          );
      })
      .catch((cause: unknown) =>
        reply.destroy(new Error('Invalid image request', { cause })),
      );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing image socket');
  const backend = new CodexImageBackend({
    getBaseUrl: () => `http://127.0.0.1:${address.port}/backend-api/codex`,
    getCredential: async () => ({ ...credential }),
  });
  return {
    endpoint: `http://127.0.0.1:${address.port}/chatgpt.com/backend-api/codex`,
    backend,
    entered: entered.promise,
    release: response.release,
    requests: () => requests,
    records: () => [...records],
    rotateCredential: (): void => {
      credential = {
        accessToken: 'rotated-image-credential',
        accountId: 'rotated-image-account',
      };
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

async function withImageSession(
  hold: boolean,
  run: (session: {
    readonly config: Config;
    readonly directory: string;
    readonly wire: Awaited<ReturnType<typeof imageWire>>;
    readonly agent: Awaited<ReturnType<typeof fromConfig>>;
    readonly runner: ImageOperationRunner;
  }) => Promise<void>,
): Promise<void> {
  validatePngStructure(PNG);
  const directory = await mkdtemp(join(import.meta.dir, 'physical-workspace-'));
  const wire = await imageWire(hold);
  const config = new Config({
    sessionId: 'same-image-label',
    targetDir: directory,
    cwd: directory,
    provider: 'openai',
    model: 'gpt-5.6',
    debugMode: false,
    skillsSupport: false,
    enableHooks: false,
  });
  const runner: ImageOperationRunner = (input) =>
    runImageOperation(input, {
      workspaceRoot: directory,
      resolveBackend: () => wire.backend,
    });
  const agent = await fromConfig({
    config,
    settingsService: new SettingsService(),
    sessionId: 'same-image-label',
    activation: { authMode: 'none' },
    imageOperation: { run: runner },
  });
  try {
    await run({ config, directory, wire, agent, runner });
  } finally {
    wire.release();
    await agent.dispose();
    await wire.stop();
    await config.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('image operation authority and session lifetime', () => {
  it('keeps executable image fields and accessors off Config', async () => {
    await withImageSession(false, async ({ config }) => {
      expect('getRunImageOperation' in config).toBe(false);
      expect('getImageBackendResolver' in config).toBe(false);
      expect('runImageOperationCapability' in config).toBe(false);
      expect('imageBackendResolver' in config).toBe(false);
    });
  });

  it('closes image admission before a disposed facade can start physical provider work', async () => {
    await withImageSession(false, async ({ agent, directory, wire }) => {
      await agent.dispose();
      await expect(
        agent.sessionClient.runImageOperation({
          outputPath: 'closed.png',
          prompt: 'local protocol fixture',
        }),
      ).rejects.toThrow('abort');
      expect(wire.requests()).toBe(0);
      expect(await readdir(directory)).not.toContain('closed.png');
    });
  });

  it('cancels and joins an accepted physical request before session disposal resolves', async () => {
    await withImageSession(true, async ({ agent, directory, wire }) => {
      const work = agent.sessionClient
        .runImageOperation({
          outputPath: 'cancelled.png',
          prompt: 'held protocol fixture',
        })
        .then(
          () => 'published',
          () => 'cancelled',
        );
      await wire.entered;
      await agent.dispose();
      wire.release();
      expect(await work).toBe('cancelled');
      expect(await readdir(directory)).not.toContain('cancelled.png');
    });
  });

  it('persists validated PNG bytes at the explicit selected workspace path', async () => {
    await withImageSession(false, async ({ agent, directory, wire }) => {
      const runner = agent.sessionClient.runImageOperation;
      const result = await runner({
        prompt: 'local physical fixture',
        outputPath: 'selected.png',
      });
      const bytes = await readFile(join(directory, 'selected.png'));
      validatePngStructure(bytes);
      expect(bytes.equals(PNG)).toBe(true);
      expect(result.absoluteOutputPath).toBe(join(directory, 'selected.png'));
      expect(wire.requests()).toBe(1);
    });
  });
});

describe('public image ownership and wire protocol', () => {
  for (const order of ['first', 'peer']) {
    it(`keeps a borrowed caller image operation live after both facade close orders: ${order}`, async () => {
      await withImageSession(
        false,
        async ({ config, runner, agent, directory, wire }) => {
          const peer = await fromConfig({
            config,
            settingsService: new SettingsService(),
            sessionId: 'same-image-label',
            activation: { authMode: 'none' },
            imageOperation: { run: runner },
          });
          try {
            const closing = order === 'first' ? agent : peer;
            const surviving = order === 'first' ? peer : agent;
            await closing.dispose();
            await surviving.sessionClient.runImageOperation({
              prompt: 'surviving facade',
              outputPath: 'peer.png',
            });
            expect(
              (await readFile(join(directory, 'peer.png'))).equals(PNG),
            ).toBe(true);
            await surviving.dispose();
            await runner({
              prompt: 'caller-owned transport',
              outputPath: 'caller.png',
            });
            expect(
              (await readFile(join(directory, 'caller.png'))).equals(PNG),
            ).toBe(true);
            expect(wire.requests()).toBe(2);
          } finally {
            await peer.dispose();
          }
        },
      );
    });
  }

  it('releases transferred image resources after failed public construction', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'llxprt-session-image-failed-'),
    );
    const file = await open(join(directory, 'owned-resource'), 'w');
    try {
      const result = await createAgent({
        workingDir: directory,
        sessionId: 'invalid session label!',
        provider: 'openai',
        model: 'gpt-5.6',
        imageOperation: {
          ownership: 'agent',
          run: async () => {
            throw new Error('No image request expected');
          },
          dispose: () => file.close(),
        },
        settings: { model: 'forbidden-shadow' },
      }).then(
        () => 'constructed',
        () => 'failed',
      );
      expect(result).toBe('failed');
      await expect(
        file.writeFile('after failed construction'),
      ).rejects.toMatchObject({ code: 'EBADF' });
    } finally {
      await file.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('sends real edit input PNG bytes and pairs rotated credentials on the next admitted request', async () => {
    await withImageSession(false, async ({ agent, directory, wire }) => {
      await writeFile(join(directory, 'input.png'), PNG);
      const first = await agent.sessionClient.runImageOperation({
        prompt: 'edit protocol',
        inputPaths: ['input.png'],
        outputPath: 'edited.png',
      });
      wire.rotateCredential();
      await agent.sessionClient.runImageOperation({
        prompt: 'generate protocol',
        outputPath: 'rotated.png',
      });
      expect(first.operation).toBe('edit');
      expect((await readFile(join(directory, 'edited.png'))).equals(PNG)).toBe(
        true,
      );
      const records = wire.records();
      expect(records).toHaveLength(2);
      const edit = records[0];
      const generate = records[1];
      expect(edit.path).toEndWith('/images/edits');
      const input = edit.images[0];
      expect(Buffer.from(input.split(',')[1] ?? '', 'base64').equals(PNG)).toBe(
        true,
      );
      expect(generate.authorization).not.toBe(edit.authorization);
      expect(generate.account).not.toBe(edit.account);
      expect(generate.images).toHaveLength(0);
    });
  });

  it('rejects an outside workspace output before making a physical request', async () => {
    await withImageSession(false, async ({ agent, wire }) => {
      await expect(
        agent.sessionClient.runImageOperation({
          prompt: 'invalid destination',
          outputPath: '../outside.png',
        }),
      ).rejects.toThrow('within');
      expect(wire.requests()).toBe(0);
    });
  });
});

describe('selected image operation roots', () => {
  it('isolates same-Config same-label facades with distinct captured endpoints and output roots', async () => {
    await withImageSession(
      false,
      async ({ config, agent, directory, wire }) => {
        const other = await imageWire(false);
        const peerDirectory = await mkdtemp(join(directory, 'peer-'));
        const peer = await fromConfig({
          config,
          settingsService: new SettingsService(),
          sessionId: 'same-image-label',
          activation: { authMode: 'none' },
          imageOperation: {
            run: (input) =>
              runImageOperation(input, {
                workspaceRoot: peerDirectory,
                resolveBackend: () => other.backend,
              }),
          },
        });
        try {
          await agent.sessionClient.runImageOperation({
            prompt: 'first endpoint',
            outputPath: 'first.png',
          });
          await peer.sessionClient.runImageOperation({
            prompt: 'second endpoint',
            outputPath: 'second.png',
          });
          expect(
            (await readFile(join(directory, 'first.png'))).equals(PNG),
          ).toBe(true);
          expect(
            (await readFile(join(peerDirectory, 'second.png'))).equals(PNG),
          ).toBe(true);
          expect((await readdir(directory)).includes('second.png')).toBe(false);
          expect((await readdir(peerDirectory)).includes('first.png')).toBe(
            false,
          );
          expect(wire.requests()).toBe(1);
          expect(other.requests()).toBe(1);
          await agent.dispose();
          await peer.sessionClient.runImageOperation({
            prompt: 'surviving endpoint',
            outputPath: 'surviving.png',
          });
          expect(
            (await readFile(join(peerDirectory, 'surviving.png'))).equals(PNG),
          ).toBe(true);
          expect(wire.requests()).toBe(1);
        } finally {
          await peer.dispose();
          await other.stop();
        }
      },
    );
  });

  it('captures edit input paths at admission without retaining the caller array', async () => {
    await withImageSession(false, async ({ agent, directory, wire }) => {
      await writeFile(join(directory, 'input.png'), PNG);
      const inputs = ['input.png'];
      const operation = agent.sessionClient.runImageOperation({
        prompt: 'admitted inputs',
        outputPath: 'captured.png',
        inputPaths: inputs,
      });
      inputs.push('../not-admitted.png');
      await operation;
      expect(
        (await readFile(join(directory, 'captured.png'))).equals(PNG),
      ).toBe(true);
      expect(wire.records()[0].images).toHaveLength(1);
    });
  });

  it('releases a transferred physical resource once after normal facade teardown', async () => {
    await withImageSession(false, async ({ config, runner, directory }) => {
      const file = await open(join(directory, 'owned-lifetime'), 'w');
      const peer = await fromConfig({
        config,
        settingsService: new SettingsService(),
        activation: { authMode: 'none' },
        imageOperation: {
          run: runner,
          ownership: 'agent',
          dispose: () => file.close(),
        },
      });
      try {
        await peer.sessionClient.runImageOperation({
          prompt: 'owned image',
          outputPath: 'owned.png',
        });
        await peer.dispose();
        await peer.dispose();
        await expect(file.writeFile('closed resource')).rejects.toMatchObject({
          code: 'EBADF',
        });
        expect((await readFile(join(directory, 'owned.png'))).equals(PNG)).toBe(
          true,
        );
      } finally {
        await peer.dispose();
        await file.close();
      }
    });
  });
});

describe('default root image composition', () => {
  it('selects the active local Codex endpoint while resolving credentials from the live caller store', async () => {
    await withImageSession(false, async ({ config, directory, wire }) => {
      const store = new MemoryTokenStore();
      const oauth = new OAuthManager(store);
      oauth.registerProvider(createTestProvider('codex'));
      await oauth.toggleOAuthEnabled('codex');
      const firstCredential = {
        ...makeToken('local-image-credential'),
        account_id: 'local-image-account',
      };
      await store.saveToken('codex', firstCredential);
      const realFetch = globalThis.fetch;
      const transport = spyOn(globalThis, 'fetch').mockImplementation(
        (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (!url.startsWith(wire.endpoint))
            throw new Error(`Unexpected external image endpoint ${url}`);
          return realFetch(input, init);
        },
      );
      const selectedSettings = new SettingsService();
      selectedSettings.setProviderSetting('openai', 'base-url', wire.endpoint);
      const peer = await fromConfig({
        config,
        settingsService: selectedSettings,
        oauthManager: oauth,
        activation: {
          provider: 'openai',
          authMode: 'none',
          cliOverrides: { baseUrl: wire.endpoint },
        },
      });
      try {
        await peer.sessionClient.runImageOperation({
          prompt: 'root endpoint protocol',
          outputPath: 'default-root.png',
        });
        expect(
          (await readFile(join(directory, 'default-root.png'))).equals(PNG),
        ).toBe(true);
        expect(wire.records()[0].path).toContain(
          '/chatgpt.com/backend-api/codex/',
        );
        wire.rotateCredential();
        const secondCredential = {
          ...makeToken('rotated-image-credential'),
          account_id: 'rotated-image-account',
        };
        await store.saveToken('codex', secondCredential);
        await peer.sessionClient.runImageOperation({
          prompt: 'rotated root credentials',
          outputPath: 'default-rotated.png',
        });
        expect(
          (await readFile(join(directory, 'default-rotated.png'))).equals(PNG),
        ).toBe(true);
        expect(wire.records()[1].authorization).not.toBe(
          wire.records()[0].authorization,
        );
      } finally {
        await peer.dispose();
        transport.mockRestore();
      }
    });
  });
});
