/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  bindHistoryTokenSubscription,
  bindRecordingHistorySubscription,
} from '../containers/AppContainer/hooks/historyTokenSubscriptions.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Config, coreEvents } from '@vybestack/llxprt-code-core';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  createMockSettings,
  renderHook,
  waitFor,
} from '../../__tests__/render.js';
import { useAppStores } from '../AppContainerRuntime.js';
import {
  buildSlashCommandRuntime,
  buildUiRuntimeFromSource,
} from '../cliUiRuntime.js';
import { RuntimeContextProvider } from '../../__tests__/runtime-context-fixture.js';
import { OAuthControlProvider } from '../contexts/OAuthControlContext.js';
import { SessionStatsProvider } from '../contexts/SessionContext.js';
import { initialAppState } from '../reducers/appReducer.js';
import { useAppBootstrap } from '../containers/AppContainer/hooks/useAppBootstrap.js';

describe('bootstrap captured operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('records feedback through the captured owner with a different session in legacy inputs', async () => {
    const owner = await makeOwner('bootstrap-owner');
    const peer = await makeOwner('bootstrap-peer');
    await writeFile(
      join(owner.workspace.getWorkingDirectory(), 'LLXPRT.md'),
      'Use the captured bootstrap workspace memory.',
    );
    await owner.memory.refresh();
    for (const current of [owner, peer]) {
      await current.setHistory([
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'bootstrap history'.repeat(current === owner ? 40 : 1),
            },
          ],
        },
      ]);
      await current.session.setRecording({ enabled: true });
    }
    await owner.agentClient.startChat(await owner.getHistory());
    await peer.agentClient.startChat(await peer.getHistory());
    const ownerHistory = owner.agentClient.getHistoryService();
    if (!ownerHistory) throw new Error('Missing bootstrap token history');
    await ownerHistory.waitForTokenUpdates();
    const ownerPath = owner.session.getRecording().path;
    const peerPath = peer.session.getRecording().path;
    if (!ownerPath || !peerPath)
      throw new Error('Missing bootstrap recordings');
    const config = new Config({
      sessionId: 'bootstrap-host',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      debugMode: false,
      model: 'fake-model',
    });
    const runtime = buildSlashCommandRuntime(config, peer);
    const uiRuntime = buildUiRuntimeFromSource(config, peer);
    const context = createMockCommandContext();
    const oauthControl = {
      ...context.oauthControl,
      attachProviderMessages: () => {},
      attachInteractiveAuthMessages: () => {},
      bindInteractiveAuthHost: () => {},
      unbindInteractiveAuthHost: () => {},
      cancelInteractiveAuth: () => 0,
    };
    const settings = createMockSettings({});
    const hook = renderHook(
      () => {
        const stores = useAppStores(runtime);
        const bootstrap = useAppBootstrap(
          Object.assign(
            {
              uiRuntime,
              agent: peer,
              settings,
              version: 'test',
              appState: initialAppState,
              appDispatch: () => {},
              terminalStore: stores.terminalStore,
              settingsStore: stores.settingsStore,
              turnStore: stores.turnStore,
              recordingOwner: 'agent' as const,
            },
            {
              triggerSessionStart: owner.hooks.triggerSessionStart.bind(
                owner.hooks,
              ),
              appendHistory: owner.addHistory.bind(owner),
              recordRecordingEvent: owner.session.recordRecordingEvent.bind(
                owner.session,
              ),
              metrics: owner.metrics,
              readLlxprtMdFileCount: owner.memory.getFileCount.bind(
                owner.memory,
              ),
              readCoreMemoryFileCount: owner.memory.getCoreFileCount.bind(
                owner.memory,
              ),
              readEmojiFilterMode: () => 'auto' as const,
              readTerminalBackground:
                uiRuntime.shell.getTerminalBackground.bind(uiRuntime.shell),
              readCurrentIde: () =>
                uiRuntime.ide.getIdeClient()?.getCurrentIde(),
              readIdeMode: uiRuntime.ide.getIdeMode.bind(uiRuntime.ide),
              registerIdeCleanup: () => {},
              readDebugMode: uiRuntime.app.getDebugMode.bind(uiRuntime.app),
              readTokenHistory: () =>
                peer.agentClient.getHistoryService() ?? null,
              subscribeHistoryTokens: bindHistoryTokenSubscription(
                () => owner.agentClient.getHistoryService() ?? null,
                new DebugLogger('bootstrap-owner-tokens'),
              ),
              subscribeRecordingHistory: bindRecordingHistorySubscription(
                () => owner.agentClient.getHistoryService() ?? null,
                new DebugLogger('bootstrap-owner-recording'),
              ),
              readProviderMetrics:
                owner.providerReads.getActiveProviderMetrics.bind(
                  owner.providerReads,
                ),
              readSessionTokenUsage:
                owner.providerReads.getSessionTokenUsage.bind(
                  owner.providerReads,
                ),
            },
          ),
        );
        return { bootstrap, settingsStore: stores.settingsStore };
      },
      {
        wrapper: ({ children }) => (
          <SessionStatsProvider metrics={owner.metrics}>
            <OAuthControlProvider control={oauthControl}>
              <RuntimeContextProvider
                agent={peer}
                owner={context.runtimeApi}
                requestFetch={context.runtimeApi.fetch}
              >
                {children}
              </RuntimeContextProvider>
            </OAuthControlProvider>
          </SessionStatsProvider>
        ),
      },
    );
    try {
      await waitFor(() =>
        expect(
          hook.result.current.settingsStore.store.getState().historyTokenCount,
        ).toBe(ownerHistory.getTotalTokens()),
      );
      await waitFor(() =>
        expect(
          hook.result.current.settingsStore.store.getState().llxprtMdFileCount,
        ).toBe(owner.memory.getFileCount()),
      );
      coreEvents.emitFeedback('warning', 'captured bootstrap feedback');
      await waitFor(async () =>
        expect(await readFile(ownerPath, 'utf8')).toContain(
          'captured bootstrap feedback',
        ),
      );
      expect(await readFile(peerPath, 'utf8')).not.toContain(
        'captured bootstrap feedback',
      );
      await hook.result.current.bootstrap.recordRecordingEvent({
        type: 'session_event',
        severity: 'warning',
        message: 'dialog recording operation',
      });
      await waitFor(async () =>
        expect(await readFile(ownerPath, 'utf8')).toContain(
          'dialog recording operation',
        ),
      );
      expect(await readFile(peerPath, 'utf8')).not.toContain(
        'dialog recording operation',
      );
    } finally {
      hook.unmount();
      await config.dispose();
    }
  });
});
