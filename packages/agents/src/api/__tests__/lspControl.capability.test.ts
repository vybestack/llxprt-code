/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural suite proving LspControl depends on a narrow LSP capability
 * rather than the whole Config object.
 *
 * Why this is not mock theatre: nothing here is stubbed with a mocking
 * framework and no module is intercepted. Each test constructs a real
 * LspControl over a hand-written object implementing exactly the capability
 * LspControl needs, and asserts the real projection logic across all six of
 * its branches.
 *
 * Note on what enforces the narrowing: this package excludes test files from
 * `tsc`, so a type-level assertion here would not be checked. The binding
 * constraint is that `control/lspControl.ts` — which IS typechecked — no longer
 * imports `Config` at all. This suite's job is to prove the projection
 * behaviour is unchanged when driven through the narrow capability.
 *
 * The pre-existing `lspControl.behavior.test.ts` drives the same class through
 * the public agent root over a real Config, covering parity from the other
 * direction.
 */

import { describe, it, expect } from '../../testApi.js';
import type {
  LspConfig,
  ServerStatus,
} from '@vybestack/llxprt-code-ide-integration';
import {
  LspControl,
  type LspStatusClient,
  type LspStatusSource,
} from '../control/lspControl.js';

function serverConfig(id: string): LspConfig {
  return { servers: [{ id, command: `${id}-server` }] };
}

/** A source exposing only the two members LspControl reads from Config. */
function sourceOf(
  lspConfig: LspConfig | undefined,
  client: LspStatusClient | undefined,
): LspStatusSource {
  return {
    getLspConfig: () => lspConfig,
    getLspServiceClient: () => client,
  };
}

function clientOf(overrides: Partial<LspStatusClient>): LspStatusClient {
  return {
    isAlive: () => true,
    getUnavailableReason: () => undefined,
    status: async () => [],
    ...overrides,
  };
}

describe('LspControl capability dependency', () => {
  it('reports disabled with a reason when the source has no LSP config @scenario:unconfigured', async () => {
    const control = new LspControl({ config: sourceOf(undefined, undefined) });

    const snapshot = await control.status();

    expect(snapshot.disabled).toBe(true);
    expect(snapshot.servers).toEqual([]);
    expect(snapshot.unavailableReason).toBe('LSP not configured');
  });

  it('marks every configured server unavailable when no client exists @scenario:configured-without-client', async () => {
    const control = new LspControl({
      config: sourceOf(serverConfig('tsserver'), undefined),
    });

    const snapshot = await control.status();

    expect(snapshot.disabled).toBe(true);
    expect(snapshot.unavailableReason).toBe('LSP service unavailable');
    expect(snapshot.servers.length).toBe(1);
    expect(snapshot.servers[0].serverId).toBe('tsserver');
    expect(snapshot.servers[0].healthy).toBe(false);
    expect(snapshot.servers[0].state).toBe('broken');
  });

  it('propagates the client reason when the client is not alive @scenario:client-dead', async () => {
    const control = new LspControl({
      config: sourceOf(
        serverConfig('gopls'),
        clientOf({
          isAlive: () => false,
          getUnavailableReason: () => 'binary missing',
        }),
      ),
    });

    const snapshot = await control.status();

    expect(snapshot.disabled).toBe(true);
    expect(snapshot.unavailableReason).toBe('binary missing');
    expect(snapshot.servers[0].detail).toBe('binary missing');
  });

  it('projects live statuses onto the configured servers @scenario:healthy', async () => {
    const status: ServerStatus = {
      serverId: 'tsserver',
      healthy: true,
      state: 'ok',
      detail: 'ready',
    };
    const control = new LspControl({
      config: sourceOf(
        serverConfig('tsserver'),
        clientOf({ status: async () => [status] }),
      ),
    });

    const snapshot = await control.status();

    expect(snapshot.disabled).toBe(false);
    expect(snapshot.servers.length).toBe(1);
    expect(snapshot.servers[0].healthy).toBe(true);
    expect(snapshot.servers[0].state).toBe('ok');
    expect(snapshot.servers[0].detail).toBe('ready');
  });

  it('reports a configured server with no matching live status as unavailable @scenario:missing-status', async () => {
    const control = new LspControl({
      config: sourceOf(
        serverConfig('pyright'),
        clientOf({ status: async () => [] }),
      ),
    });

    const snapshot = await control.status();

    expect(snapshot.disabled).toBe(false);
    expect(snapshot.servers[0].serverId).toBe('pyright');
    expect(snapshot.servers[0].healthy).toBe(false);
    expect(snapshot.servers[0].detail).toBe('LSP status unavailable');
  });

  it('converts a throwing client into a disabled snapshot rather than propagating @scenario:client-throws', async () => {
    const control = new LspControl({
      config: sourceOf(
        serverConfig('rust-analyzer'),
        clientOf({
          status: async () => {
            throw new Error('transport closed');
          },
        }),
      ),
    });

    const snapshot = await control.status();

    expect(snapshot.disabled).toBe(true);
    expect(snapshot.unavailableReason).toContain('transport closed');
    expect(snapshot.servers[0].healthy).toBe(false);
    // readStatus maps the formatted error onto every configured server, so the
    // per-server detail must carry the reason too — not just the top-level
    // field. Without this the reason could stop propagating to servers and the
    // suite would still pass.
    expect(snapshot.servers[0].detail).toContain('transport closed');
  });
});
