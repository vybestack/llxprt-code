/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Text } from 'ink';
import {
  Config,
  IDEConnectionStatus,
  ToolConfirmationOutcome,
  type IdeContext,
} from '@vybestack/llxprt-code-core';
import { WorkspaceIdeOwner } from '@vybestack/llxprt-code-core/services/workspace-ide-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { assembleIdeControl } from '../../../../agents/src/api/control/ideControl.js';
import {
  setup,
  client,
  cleanup,
  installIdeCleanup,
} from '../../../../agents/src/api/__tests__/helpers/ide-companion.js';
import {
  renderHook,
  createMockSettings,
  renderWithProviders,
  waitFor,
} from '../../__tests__/render.js';
import { useIdeContextBridge } from '../containers/AppContainer/hooks/useIdeContextBridge.js';
import { useHostCommands } from './useHostCommands.js';
import { useIdeTrustListener } from './useIdeTrustListener.js';
import { ToolConfirmationMessage } from '../components/messages/ToolConfirmationMessage.js';
import { createCommandChangeSubscription } from '../../services/commandRegistryOperations.js';
import { CoreEvent, coreEvents } from '@vybestack/llxprt-code-core';
import { bindIdeCommand } from '../commands/ideCommandHost.js';
import { createIdeCommand } from '../commands/ideCommand.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';

async function workspace() {
  const config = new Config({
    sessionId: crypto.randomUUID(),
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'offline',
    debugMode: false,
  });
  const trust = new WorkspaceTrustLifecycle({ localTrust: true });
  const transport = await client();
  const owner = new WorkspaceIdeOwner(
    config,
    trust,
    trust,
    async () => transport,
  );
  const first = assembleIdeControl(trust, owner, () => ({}));
  const second = assembleIdeControl(trust, owner, () => ({}));
  cleanup.push(
    () => config.dispose(),
    () => trust.dispose(),
    () => owner.dispose(),
  );
  return { owner, trust, first, second, transport };
}

describe('ordinary IDE consumer subscriptions', () => {
  installIdeCleanup();

  it('subscribes before acquisition, retains full context, clears it and leaves the borrowed peer connected on unmount', async () => {
    const host = await setup();
    const { owner, first, second } = await workspace();
    const seen: Array<IdeContext | undefined> = [];
    const readIdeContext = first.readContext.bind(first);
    const subscribeIdeContext = first.subscribeContext.bind(first);
    const { unmount } = renderHook(() =>
      useIdeContextBridge({
        readIdeContext,
        subscribeIdeContext,
        setIdeContextState: (context) => seen.push(context),
      }),
    );
    expect(seen).toStrictEqual([undefined]);
    await owner.initialize();
    await first.setIdeClientConnected();
    await host.updateContext(0, {
      workspaceState: {
        openFiles: [
          {
            path: '/workspace/selected.ts',
            timestamp: 42,
            isActive: true,
            selectedText: 'selection',
            cursor: { line: 7, character: 3 },
          },
        ],
      },
    });
    await waitFor(() =>
      expect(seen.at(-1)?.workspaceState?.openFiles?.[0].cursor?.line).toBe(7),
    );
    expect(seen.at(-1)?.workspaceState?.openFiles?.[0].selectedText).toBe(
      'selection',
    );
    await first.setIdeClientDisconnected();
    await waitFor(() => expect(seen.at(-1)).toBeUndefined());
    await second.setIdeClientConnected();
    unmount();
    const count = seen.length;
    await host.updateContext(1, { workspaceState: { openFiles: [] } });
    await waitFor(() =>
      expect(second.readContext()?.workspaceState?.openFiles).toHaveLength(0),
    );
    expect(seen).toHaveLength(count);
    expect(second.readConnection().status).toBe(IDEConnectionStatus.Connected);
  });

  it('distinguishes absent and disconnected commands and awaits mode changes on the same transport', async () => {
    await setup();
    const { owner, first } = await workspace();
    const settings = createMockSettings({});
    const command = () =>
      createIdeCommand(
        bindIdeCommand(
          first.readConnection.bind(first),
          first.readContext.bind(first),
          first.setIdeMode.bind(first),
          first.setIdeClientConnected.bind(first),
          first.setIdeClientDisconnected.bind(first),
          settings,
          () => 0,
        ),
      );
    expect(command()).toBeNull();
    await owner.initialize();
    expect(command()?.subCommands?.map((item) => item.name)).toStrictEqual([
      'enable',
      'status',
      'install',
    ]);
    const enable = command()?.subCommands?.find(
      (item) => item.name === 'enable',
    );
    if (!enable?.action) throw new Error('Enable command missing');
    await enable.action(createMockCommandContext(), '');
    expect(first.readConnection().status).toBe(IDEConnectionStatus.Connected);
    expect(first.getIdeMode()).toBe(true);
    const disable = command()?.subCommands?.find(
      (item) => item.name === 'disable',
    );
    if (!disable?.action) throw new Error('Disable command missing');
    await disable.action(createMockCommandContext(), '');
    expect(first.readConnection().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
    expect(first.readConnection().details).toContain('disabled');
    expect(first.getIdeMode()).toBe(false);
  });

  it('renders raw unknown trust while effective local trust remains true and releases only its observation', async () => {
    const host = await setup();
    const { owner, first, second, trust } = await workspace();
    const readIdeWorkspaceTrust = first.readWorkspaceTrust.bind(first);
    const subscribeIdeWorkspaceTrust =
      first.subscribeWorkspaceTrust.bind(first);
    function Trust(): React.ReactNode {
      const { isIdeTrusted } = useIdeTrustListener(
        readIdeWorkspaceTrust,
        subscribeIdeWorkspaceTrust,
      );
      return <Text color="white">{String(isIdeTrusted)}</Text>;
    }
    const view = renderWithProviders(<Trust />);
    await waitFor(() => expect(view.lastFrame()).toContain('undefined'));
    await owner.initialize();
    await second.setIdeClientConnected();
    await waitFor(() => expect(view.lastFrame()).toContain('true'));
    await host.updateTrust(0, false);
    await waitFor(() => expect(view.lastFrame()).toContain('false'));
    await host.updateTrust(0, undefined);
    await waitFor(() => expect(view.lastFrame()).toContain('undefined'));
    await trust.whenSettled();
    expect(trust.isTrustedFolder()).toBe(true);
    view.unmount();
    expect(second.readConnection().status).toBe(IDEConnectionStatus.Connected);
  });
  it.each([
    ToolConfirmationOutcome.ProceedOnce,
    ToolConfirmationOutcome.Cancel,
  ])(
    'awaits the real diff close before reporting confirmation %s',
    async (outcome) => {
      const host = await setup(false, true);
      const { owner, first, transport } = await workspace();
      await owner.initialize();
      first.setIdeMode(true);
      await first.setIdeClientConnected();
      const opened = transport.openDiff('/workspace/confirm.ts', 'replacement');
      await host.diffOpened.promise;
      const confirmed: ToolConfirmationOutcome[] = [];
      const view = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={{
            type: 'edit',
            title: 'Confirm edit',
            fileName: 'confirm.ts',
            filePath: '/workspace/confirm.ts',
            fileDiff: '+replacement',
            originalContent: '',
            newContent: 'replacement',
            onConfirm: async (value) => {
              confirmed.push(value);
            },
          }}
          isTrustedFolder={true}
          readIdeMode={first.getIdeMode.bind(first)}
          readIdeDiffingEnabled={() => first.readConnection().diffingEnabled}
          subscribeIdeDiffing={(listener) =>
            first.subscribeConnection(() => listener())
          }
          resolveIdeDiff={first.resolveDiff.bind(first)}
          terminalWidth={100}
        />,
      );
      await waitFor(() => expect(view.lastFrame()).toContain('Allow once'));
      view.stdin.write(
        outcome === ToolConfirmationOutcome.Cancel ? '\u001B' : '\r',
      );
      await host.closeDiffEntered.promise;
      expect(confirmed).toStrictEqual([]);
      host.releaseCloseDiff.resolve();
      await waitFor(() => expect(confirmed).toStrictEqual([outcome]));
      const result = await opened;
      expect(result.status).toBe(
        outcome === ToolConfirmationOutcome.Cancel ? 'rejected' : 'accepted',
      );
      view.unmount();
      expect(first.readConnection().status).toBe(IDEConnectionStatus.Connected);
    },
  );

  it('reloads commands for live connection and folder changes and releases all registrations', async () => {
    await setup();
    const { owner, first } = await workspace();
    let reloads = 0;
    const mcp = new Set<() => void>();
    const subscribe = createCommandChangeSubscription(
      (listener) => first.subscribeConnection(() => listener()),
      (listener) => {
        mcp.add(listener);
        return () => {
          mcp.delete(listener);
        };
      },
    );
    const stop = subscribe(() => {
      reloads++;
    });
    await owner.initialize();
    await first.setIdeClientConnected();
    expect(reloads).toBe(2);
    coreEvents.emit(CoreEvent.FolderTrustChanged, true);
    expect(reloads).toBe(3);
    for (const listener of mcp) listener();
    expect(reloads).toBe(4);
    stop?.();
    await first.setIdeClientDisconnected();
    coreEvents.emit(CoreEvent.FolderTrustChanged, true);
    for (const listener of mcp) listener();
    expect(reloads).toBe(4);
    expect(mcp.size).toBe(0);
  });
  it('refreshes registered IDE choices on connection events without changing the host owner', async () => {
    await setup();
    const { owner, first } = await workspace();
    const settings = createMockSettings({});
    const register = (addItem: Parameters<typeof useHostCommands>[2]) =>
      createIdeCommand(
        bindIdeCommand(
          first.readConnection.bind(first),
          first.readContext.bind(first),
          first.setIdeMode.bind(first),
          first.setIdeClientConnected.bind(first),
          first.setIdeClientDisconnected.bind(first),
          settings,
          addItem,
        ),
      );
    const subscribe = (listener: () => void) =>
      first.subscribeConnection(() => listener());
    const hook = renderHook(() =>
      useHostCommands(null, settings, () => 0, register, subscribe),
    );
    expect(hook.result.current.ideCommand).toBeNull();
    await owner.initialize();
    await first.setIdeClientConnected();
    await waitFor(() =>
      expect(
        hook.result.current.ideCommand?.subCommands?.map((c) => c.name),
      ).toStrictEqual(['status', 'disable']),
    );
    await first.setIdeClientDisconnected();
    await waitFor(() =>
      expect(
        hook.result.current.ideCommand?.subCommands?.map((c) => c.name),
      ).toStrictEqual(['enable', 'status', 'install']),
    );
    hook.unmount();
    await first.setIdeClientConnected();
    expect(first.readConnection().status).toBe(IDEConnectionStatus.Connected);
  });
});
