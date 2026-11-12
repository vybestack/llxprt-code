/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core/config/config.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import {
  releaseHeldUnlessSettled,
  startNoAuthMcpFixture,
  type NoAuthMcpFixture,
} from './helpers/mcp-cutover-server-fixture.js';

const SOCKET_CLOSE_WAIT_MS = 2000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function socketsClosed(fixture: NoAuthMcpFixture): Promise<void> {
  const deadline = Date.now() + SOCKET_CLOSE_WAIT_MS;
  while (fixture.liveSockets() > 0 && Date.now() < deadline) await delay(5);
}

function extensionFor(fixture: NoAuthMcpFixture): LlxprtExtension {
  return {
    name: 'held-extension',
    version: '1.0.0',
    isActive: true,
    path: process.cwd(),
    contextFiles: [],
    mcpServers: { extended: { httpUrl: `${fixture.base}/mcp` } },
  };
}

async function withExtensionOwner(
  run: (owner: McpRuntimeOwner, fixture: NoAuthMcpFixture) => Promise<void>,
): Promise<void> {
  const fixture = await startNoAuthMcpFixture();
  const config = new Config({
    sessionId: 'mcp-owner-extension-retirement',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'test-model',
    debugMode: false,
    trustedFolder: true,
    mcpEnabled: true,
    enableExtensionReloading: true,
    mcpServers: { same: { httpUrl: `${fixture.base}/mcp` } },
  });
  const owner = await createTestMcpRuntime(
    {
      oauth: createTestOAuthBinding(),
      config,
    },
    {},
  );
  try {
    await owner.initialize();
    await owner.awaitDiscovery();
    await run(owner, fixture);
  } finally {
    await owner.dispose().catch(() => undefined);
    await fixture.close();
  }
}

function settlementOf(
  fixture: NoAuthMcpFixture,
  transition: Promise<void>,
  marker: string,
): Promise<'fulfilled' | 'rejected'> {
  return transition
    .then(
      () => 'fulfilled' as const,
      () => 'rejected' as const,
    )
    .then((outcome) => {
      fixture.events.push(marker);
      return outcome;
    });
}

function expectTransitionSettledBeforeRetirement(
  fixture: NoAuthMcpFixture,
  from: number,
): void {
  const events = fixture.events.slice(from);
  const settled = events.indexOf('extension-settled');
  expect(settled).toBeGreaterThanOrEqual(0);
  expect(events.indexOf('disposed')).toBeGreaterThan(settled);
  // session-1 is the workspace server connected before the extension
  // transition; its retirement must not begin while the transition is pending.
  expect(events.slice(0, settled)).not.toContain('delete:session-1');
  expect(events).toContain('delete:session-1');
}

describe('McpRuntimeOwner retirement with an accepted extension transition in flight', () => {
  it('an extension start whose server request is held settles before connection retirement and leaves no session or socket open', async () => {
    await withExtensionOwner(async (owner, fixture) => {
      fixture.hold('initialize');
      const first = fixture.events.length;
      const starting = settlementOf(
        fixture,
        owner.extensionOperations.load(extensionFor(fixture)),
        'extension-settled',
      );
      await fixture.waitUntilHeld('initialize');
      const disposing = owner
        .dispose()
        .then(() => fixture.events.push('disposed'));
      await releaseHeldUnlessSettled(fixture, 'initialize', starting);
      await disposing;
      await starting;
      await socketsClosed(fixture);

      expectTransitionSettledBeforeRetirement(fixture, first);
      expect(fixture.liveSockets()).toBe(0);
      expect(fixture.liveSessions()).toBe(0);
    });
  });

  it('an extension stop issued while its server request is held settles before connection retirement and leaves no session or socket open', async () => {
    await withExtensionOwner(async (owner, fixture) => {
      const extension = extensionFor(fixture);
      fixture.hold('initialize');
      await owner.extensionOperations.load(extension);
      await fixture.waitUntilHeld('initialize');
      const first = fixture.events.length;
      const stopping = settlementOf(
        fixture,
        owner.extensionOperations.unload(extension),
        'extension-settled',
      );
      const disposing = owner
        .dispose()
        .then(() => fixture.events.push('disposed'));
      await releaseHeldUnlessSettled(fixture, 'initialize', stopping);
      await disposing;
      await stopping;
      await socketsClosed(fixture);

      expectTransitionSettledBeforeRetirement(fixture, first);
      expect(fixture.liveSockets()).toBe(0);
      expect(fixture.liveSessions()).toBe(0);
    });
  });
});
