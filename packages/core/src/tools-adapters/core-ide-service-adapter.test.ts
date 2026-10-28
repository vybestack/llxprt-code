/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  IdeClient,
  IDEConnectionStatus,
} from '@vybestack/llxprt-code-ide-integration';
import { Config } from '../config/config.js';
import { WorkspaceIdeOwner } from '../services/workspace-ide-owner.js';
import { WorkspaceTrustLifecycle } from '../services/workspace-trust-lifecycle.js';
import { CoreIdeServiceAdapter } from './CoreIdeServiceAdapter.js';
import { IdeCompanion, deferred } from './__tests__/ide-companion.js';

const cleanup: Array<() => Promise<unknown>> = [];
const environment = new Map<string, string | undefined>();

function setEnvironment(name: string, value: string): void {
  if (!environment.has(name)) environment.set(name, process.env[name]);
  process.env[name] = value;
}

async function fixture(
  holdClose = false,
  holdOpen = false,
): Promise<{
  host: IdeCompanion;
  owner: WorkspaceIdeOwner;
  adapter: CoreIdeServiceAdapter;
  peer: () => Promise<WorkspaceIdeOwner>;
}> {
  const host = new IdeCompanion(holdClose, holdOpen);
  await host.start();
  cleanup.push(() => host.close());
  setEnvironment('TERM_PROGRAM', 'vscode');
  setEnvironment('LLXPRT_CODE_IDE_SERVER_PORT', String(host.port));
  setEnvironment('LLXPRT_CODE_IDE_WORKSPACE_PATH', process.cwd());
  const config = new Config({
    sessionId: 'core-ide-diff',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'offline',
    debugMode: false,
  });
  const trust = new WorkspaceTrustLifecycle({ localTrust: true });
  cleanup.push(
    () => config.dispose(),
    () => trust.dispose(),
  );
  async function peer(): Promise<WorkspaceIdeOwner> {
    const transport = await IdeClient.create();
    const owner = new WorkspaceIdeOwner(
      config,
      trust,
      trust,
      async () => transport,
    );
    cleanup.push(() => owner.dispose());
    return owner;
  }
  const owner = await peer();
  return {
    host,
    owner,
    adapter: new CoreIdeServiceAdapter(
      owner.openDiff.bind(owner),
      owner.readConnection.bind(owner),
    ),
    peer,
  };
}

const outcomes: Array<'accepted' | 'rejected'> = ['accepted', 'rejected'];

describe('Workspace-owned core IDE diffs', () => {
  afterEach(async (): Promise<void> => {
    try {
      for (const release of cleanup.reverse()) await release();
    } finally {
      cleanup.length = 0;
      for (const [name, value] of environment) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      environment.clear();
    }
  });

  it('preserves absent transport behavior before acquisition and without a workspace owner', async (): Promise<void> => {
    const { owner, adapter } = await fixture();
    const missing = new CoreIdeServiceAdapter(undefined, undefined);
    for (const service of [adapter, missing]) {
      expect(service.getConnectionStatus()).toBe('disconnected');
      await expect(
        service.applyDiff({ filePath: '/workspace/absent.ts', diff: 'draft' }),
      ).resolves.toStrictEqual({ status: 'rejected', content: undefined });
      await expect(
        service.openDiff({ filePath: '/workspace/absent.ts' }),
      ).rejects.toThrow('IDE client is not available');
    }
    await expect(owner.openDiff('/workspace/absent.ts')).rejects.toThrow(
      'IDE client is not available',
    );
  });

  for (const outcome of outcomes) {
    it(`returns the ${outcome} IDE decision and edited content through applyDiff without raw access`, async (): Promise<void> => {
      const { host, owner, adapter } = await fixture();
      await owner.initialize();
      expect(adapter.getConnectionStatus()).toBe('disconnected');
      const entered = deferred();
      let connectingStatus: string | undefined;
      const unsubscribe = owner.subscribeConnection((connection) => {
        expect<string | undefined>(adapter.getConnectionStatus()).toBe(
          connection.status,
        );
        if (connection.status === 'connecting') {
          connectingStatus = adapter.getConnectionStatus();
          entered.resolve();
        }
      });
      const connecting = owner.connect();
      await entered.promise;
      expect(connectingStatus).toBe('connecting');
      await connecting;
      unsubscribe();
      expect(adapter.getConnectionStatus()).toBe('connected');
      let settled = false;
      const applying = adapter
        .applyDiff({
          filePath: '/workspace/apply.ts',
          diff: 'const draft = 42;',
        })
        .then((result) => {
          settled = true;
          return result;
        });
      await host.diffOpened.promise;
      expect(settled).toBe(false);
      expect(host.requests[0]).toStrictEqual({
        name: 'openDiff',
        arguments: {
          filePath: '/workspace/apply.ts',
          newContent: 'const draft = 42;',
        },
      });
      await host.decide(0, '/workspace/apply.ts', outcome);
      expect(await applying).toStrictEqual(
        outcome === 'accepted'
          ? { status: 'accepted', content: 'const edited = 42;' }
          : { status: 'rejected', content: undefined },
      );
    });

    it(`awaits the actual close response before settling a CLI-${outcome} diff`, async (): Promise<void> => {
      const { host, owner, adapter } = await fixture(true);
      await owner.initialize();
      await owner.connect();
      let settled = false;
      const applying = adapter
        .applyDiff({ filePath: '/workspace/close.ts', diff: 'draft text' })
        .then((result) => {
          settled = true;
          return result;
        });
      await host.diffOpened.promise;
      const resolving = owner.resolveDiff('/workspace/close.ts', outcome);
      await host.closeEntered.promise;
      expect(settled).toBe(false);
      expect(host.requests[1]).toStrictEqual({
        name: 'closeDiff',
        arguments: {
          filePath: '/workspace/close.ts',
          suppressNotification: true,
        },
      });
      host.releaseClose.resolve();
      await resolving;
      expect(await applying).toStrictEqual(
        outcome === 'accepted'
          ? { status: 'accepted', content: 'edited text' }
          : { status: 'rejected', content: undefined },
      );
      expect(owner.readConnection().status).toBe(IDEConnectionStatus.Connected);
    });
  }

  it('opens optional-content diffs on the live owner acquired after adapter binding and awaits the decision', async (): Promise<void> => {
    const { host, owner, adapter } = await fixture();
    await owner.initialize();
    await owner.connect();
    let settled = false;
    const opening = adapter
      .openDiff({ filePath: '/workspace/open.ts', originalContent: 'old' })
      .then(() => {
        settled = true;
      });
    await host.diffOpened.promise;
    expect(settled).toBe(false);
    expect(host.requests[0]).toStrictEqual({
      name: 'openDiff',
      arguments: { filePath: '/workspace/open.ts' },
    });
    await host.decide(0, '/workspace/open.ts', 'rejected');
    await opening;
    expect(settled).toBe(true);
  });

  it('exposes owner diff results directly and leaves a sibling borrower usable', async (): Promise<void> => {
    const { host, owner, adapter } = await fixture();
    await owner.initialize();
    await owner.connect();
    const result = owner.openDiff('/workspace/direct.ts', 'draft direct');
    await host.diffOpened.promise;
    await host.decide(0, '/workspace/direct.ts', 'accepted');
    expect(await result).toStrictEqual({
      status: 'accepted',
      content: 'edited direct',
    });
    const sibling = new CoreIdeServiceAdapter(
      owner.openDiff.bind(owner),
      owner.readConnection.bind(owner),
    );
    expect(adapter.getConnectionStatus()).toBe('connected');
    expect(sibling.getConnectionStatus()).toBe('connected');
    const next = sibling.applyDiff({
      filePath: '/workspace/sibling.ts',
      diff: 'draft sibling',
    });
    await host.opened('/workspace/sibling.ts');
    await owner.resolveDiff('/workspace/sibling.ts', 'accepted');
    expect(await next).toStrictEqual({
      status: 'accepted',
      content: 'edited sibling',
    });
    expect(owner.readConnection().diffingEnabled).toBe(true);
  });

  it('settles a held diff and joins its SSE shutdown without disconnecting an independent owner', async (): Promise<void> => {
    const { host, owner, adapter, peer } = await fixture(false, true);
    await owner.initialize();
    await owner.connect();
    const other = await peer();
    await other.initialize();
    await other.connect();
    const applying = adapter.applyDiff({
      filePath: '/workspace/held.ts',
      diff: 'draft held',
    });
    await host.diffOpened.promise;
    const closing = owner.dispose();
    expect(await applying).toStrictEqual({
      status: 'rejected',
      content: undefined,
    });
    await closing;
    await host.sessions[0].streamClosed.promise;
    expect(() => owner.readConnection()).toThrow('disposed');
    expect(other.readConnection().status).toBe(IDEConnectionStatus.Connected);
    const pending = other.openDiff('/workspace/peer.ts', 'draft peer');
    await host.opened('/workspace/peer.ts');
    await other.resolveDiff('/workspace/peer.ts', 'rejected');
    expect(await pending).toStrictEqual({
      status: 'rejected',
      content: undefined,
    });
    expect(other.readConnection().status).toBe(IDEConnectionStatus.Connected);
  });

  it('propagates transport connection failures instead of manufacturing a rejected decision', async (): Promise<void> => {
    const { owner, adapter } = await fixture();
    await owner.initialize();
    await expect(
      owner.openDiff('/workspace/disconnected.ts', 'draft'),
    ).rejects.toThrow('IDE client is not connected');
    await expect(
      adapter.applyDiff({
        filePath: '/workspace/disconnected.ts',
        diff: 'draft',
      }),
    ).rejects.toThrow('IDE client is not connected');
    await expect(
      adapter.openDiff({ filePath: '/workspace/disconnected.ts' }),
    ).rejects.toThrow('IDE client is not connected');
    await owner.dispose();
    await expect(owner.openDiff('/workspace/closed.ts')).rejects.toThrow(
      'disposed',
    );
  });
});
