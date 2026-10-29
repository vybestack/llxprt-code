/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { ModelRegistry } from '../../src/models/registry.js';

interface RegistryRoot {
  readonly registry: ModelRegistry;
  readonly requests: () => readonly string[];
}

/**
 * Two owners with their own transport, the way two agent roots have their own
 * proxy: each registry's constructor fetch reaches its own local server, which
 * serves the model list with that owner's context limit and logs the request.
 */
describe('ModelRegistry per-owner transport', () => {
  const servers: Server[] = [];
  const registries: ModelRegistry[] = [];

  beforeEach(() => {
    // The on-disk model cache is shared by design; start every test without it
    // so each registry's first load fetches through its own transport.
    rmSync(join(Storage.getGlobalCacheDir(), 'models.json'), { force: true });
  });

  afterEach(async () => {
    for (const registry of registries.splice(0)) registry.dispose();
    for (const server of servers.splice(0))
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  });

  async function openRoot(contextLimit: number): Promise<RegistryRoot> {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? '');
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          fake: {
            id: 'fake',
            name: 'Fixture provider',
            env: [],
            models: {
              'fake-model': {
                id: 'fake-model',
                name: 'fake-model',
                limit: { context: contextLimit, output: 4000 },
                release_date: '2026-01-01',
                open_weights: false,
                tool_call: true,
              },
            },
          },
        }),
      );
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected server address');
    const registry = new ModelRegistry((input, init) => {
      const target = new URL(String(input));
      return fetch(
        `http://127.0.0.1:${address.port}${target.pathname}${target.search}`,
        init,
      );
    });
    registries.push(registry);
    return { registry, requests: () => requests };
  }

  it('keeps each registry on its own transport and publishes to its own subscribers', async () => {
    const a = await openRoot(8000);
    const b = await openRoot(16000);
    const bUpdated = new Promise<void>((resolve) => {
      b.registry.on('models:updated', resolve);
    });
    await b.registry.initialize();
    await bUpdated;
    expect(await a.registry.refresh()).toBe(true);
    expect(a.registry.getById('fake/fake-model')?.contextWindow).toBe(8000);
    expect(b.registry.getById('fake/fake-model')?.contextWindow).toBe(16000);
    expect([a.requests().length, b.requests().length]).toStrictEqual([1, 1]);
  });

  it('keeps B refresh and publication usable after disposing A', async () => {
    const a = await openRoot(8000);
    const b = await openRoot(16000);
    let publications = 0;
    b.registry.on('models:updated', () => {
      publications += 1;
    });
    await b.registry.refresh();
    await b.registry.initialize();
    a.registry.dispose();
    expect(await b.registry.refresh()).toBe(true);
    expect(publications).toBe(2);
    expect([a.requests().length, b.requests().length]).toStrictEqual([0, 2]);
    expect(b.registry.getById('fake/fake-model')?.contextWindow).toBe(16000);
  });
});
