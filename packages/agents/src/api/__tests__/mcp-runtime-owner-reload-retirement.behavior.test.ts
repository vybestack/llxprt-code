/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  SessionSettingsOwner,
  type SessionMcpSettingsReads,
} from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import {
  startNoAuthMcpFixture,
  type NoAuthMcpFixture,
} from './helpers/mcp-cutover-server-fixture.js';

const BARRIER_MS = 20;
const SOCKET_CLOSE_WAIT_MS = 2000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reloadBinding(
  config: Config,
  reloaded: ReturnType<typeof serversFor>,
): { binding: SessionMcpSettingsReads; dispose: () => Promise<void> } {
  const settings = new SessionSettingsOwner(new SettingsService());
  settings.bindMcpSettings(
    {
      mcpServers: config.getMcpServers() ?? {},
      blockedMcpServers: [],
      settingsMcpServers: config.getMcpServers() ?? {},
    },
    async () => ({
      mcpServers: reloaded,
      blockedMcpServers: [],
      settingsMcpServers: reloaded,
    }),
  );
  const binding = settings.readMcpSettingsBinding();
  if (binding === undefined) throw new Error('Missing reload binding');
  return { binding, dispose: async () => settings.dispose() };
}

function serversFor(
  fixture: NoAuthMcpFixture,
  names: readonly string[],
): Record<string, { httpUrl: string }> {
  return Object.fromEntries(
    names.map((name) => [name, { httpUrl: `${fixture.base}/mcp` }]),
  );
}

async function socketsClosed(fixture: NoAuthMcpFixture): Promise<void> {
  const deadline = Date.now() + SOCKET_CLOSE_WAIT_MS;
  while (fixture.liveSockets() > 0 && Date.now() < deadline) await delay(5);
}

async function withReloadOwner(
  run: (owner: McpRuntimeOwner, fixture: NoAuthMcpFixture) => Promise<void>,
): Promise<void> {
  const fixture = await startNoAuthMcpFixture();
  const config = new Config({
    sessionId: 'mcp-owner-reload-retirement',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'test-model',
    debugMode: false,
    trustedFolder: true,
    mcpEnabled: true,
    mcpServers: serversFor(fixture, ['same']),
  });
  const reload = reloadBinding(config, serversFor(fixture, ['same', 'added']));
  const owner = await createTestMcpRuntime(
    { oauth: createTestOAuthBinding(), config },
    { mcpSettings: reload.binding },
  );
  try {
    await owner.initialize();
    await owner.awaitDiscovery();
    await run(owner, fixture);
  } finally {
    await owner.dispose().catch(() => undefined);
    await reload.dispose();
    await fixture.close();
  }
}

describe('McpRuntimeOwner retirement with a reload in flight (characterization)', () => {
  it.each(['initialize', 'resources/list'])(
    'a reload held on %s settles before connection retirement starts and leaves no session or socket open',
    async (method) => {
      await withReloadOwner(async (owner, fixture) => {
        fixture.hold(method);
        const first = fixture.events.length;
        const reloading = owner
          .reload()
          .then(
            () => 'fulfilled',
            () => 'rejected',
          )
          .then((result) => {
            fixture.events.push('reload-settled');
            return result;
          });
        await fixture.waitUntilHeld(method);
        const disposing = owner
          .dispose()
          .then(() => fixture.events.push('disposed'));
        await delay(BARRIER_MS);
        fixture.release(method);
        await disposing;
        const outcome = await reloading;
        await socketsClosed(fixture);
        const events = fixture.events.slice(first);
        const settled = events.indexOf('reload-settled');
        expect(outcome).toBe('rejected');
        expect(settled).toBeGreaterThanOrEqual(0);
        expect(events.indexOf('disposed')).toBeGreaterThan(settled);
        // session-1 is the connection that existed before the reload; the
        // reload's own cancelled connection may terminate its session earlier.
        expect(events.slice(0, settled)).not.toContain('delete:session-1');
        expect(events).toContain('delete:session-1');
        expect(fixture.liveSockets()).toBe(0);
        expect(fixture.liveSessions()).toBe(0);
      });
    },
  );
});
