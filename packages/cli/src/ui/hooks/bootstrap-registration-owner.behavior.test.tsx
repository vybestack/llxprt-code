/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Config, coreEvents } from '@vybestack/llxprt-code-core';
import { useOperationalOutput } from '../../__tests__/operational-output-fixture.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  createMockSettings,
  renderHook,
  waitFor,
} from '../../__tests__/render.js';
import { useAppStores } from '../AppContainerRuntime.js';
import { buildUiRuntimeFromSource } from '../../__tests__/ui-runtime-composition-fixture.js';
import { buildUiPortsForTest } from '../../__tests__/slash-command-runtime-fixture.js';
import { RuntimeContextProvider } from '../../__tests__/runtime-context-fixture.js';
import { OAuthControlProvider } from '../contexts/OAuthControlContext.js';
import { SessionStatsProvider } from '../contexts/SessionContext.js';
import { useBootstrapRuntime } from '../containers/AppContainer/hooks/useBootstrapRuntime.js';

describe('bootstrap captured operation ownership', () => {
  const makeOwner = useCommandOwners();
  useOperationalOutput();
  it('records feedback through the captured owner with a different session in legacy inputs', async () => {
    const owner = await makeOwner('bootstrap-owner');
    const peer = await makeOwner('bootstrap-peer');
    await writeFile(
      join(owner.workspace.getWorkingDirectory(), 'LLXPRT.md'),
      'Use the captured bootstrap workspace memory.',
    );
    await owner.memory.refresh();
    for (const current of [owner, peer]) {
      await current.session.replaceHistory([
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
    let ownerHistoryTokens = 0;
    const stopOwnerHistoryTokens = owner.session.subscribeHistoryTokens(
      (count) => {
        ownerHistoryTokens = count;
      },
    );
    await waitFor(() => expect(ownerHistoryTokens).toBeGreaterThan(0));
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
    const { containerRuntime } = buildUiPortsForTest(config, peer);
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
    for (const current of [owner, peer]) {
      current.metrics.setTokenTrackingMetrics({
        tokensPerMinute: 0,
        throttleWaitTimeMs: 91,
        timeToFirstToken: 23,
        tokensPerSecond: 7,
        sessionTokenUsage: {
          input: 12,
          output: 9,
          cache: 0,
          tool: 0,
          thought: 0,
          total: 21,
        },
      });
    }
    const readRecordingPath = () => owner.session.getRecording().path;
    const hook = renderHook(
      () => {
        const stores = useAppStores(containerRuntime);
        const bootstrap = useBootstrapRuntime(
          {
            version: 'test',
            settings,
            readJournal: () => ({
              appendDisplay: owner.session.appendDisplay.bind(owner.session),
              length: () => owner.session.getJournalLength(),
            }),
            readRecordingPath,
            readIdeMode: owner.ide.getIdeMode.bind(owner.ide),
            subscribeHistoryTokens: owner.session.subscribeHistoryTokens.bind(
              owner.session,
            ),
            readLlxprtMdFileCount: owner.memory.getFileCount.bind(owner.memory),
            readCoreMemoryFileCount: owner.memory.getCoreFileCount.bind(
              owner.memory,
            ),
            triggerSessionStart: owner.hooks.triggerSessionStart.bind(
              owner.hooks,
            ),
            appendHistory: owner.addHistory.bind(owner),
            recordRecordingEvent: owner.session.recordRecordingEvent.bind(
              owner.session,
            ),
            setTokenTrackingMetrics: owner.metrics.setTokenTrackingMetrics.bind(
              owner.metrics,
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
          settings.merged,
          stores,
          {
            emojiFilter: uiRuntime.ephemeral,
            getTerminalBackground: uiRuntime.shell.getTerminalBackground,
            getDebugMode: uiRuntime.app.getDebugMode,
            readCurrentIde: () => owner.ide.readConnection().currentIde,
          },
          (recording) =>
            owner.session.connectRecordingHistory(() => recording.current),
          'agent',
          undefined,
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
          owner.metrics.getMetrics().tokenTracking.sessionTokenUsage,
        ).toStrictEqual(owner.providerReads.getSessionTokenUsage()),
      );
      expect(
        peer.metrics.getMetrics().tokenTracking.sessionTokenUsage.total,
      ).not.toBe(owner.providerReads.getSessionTokenUsage().total);
      await waitFor(() =>
        expect(
          hook.result.current.settingsStore.store.getState().historyTokenCount,
        ).toBe(ownerHistoryTokens),
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
      await waitFor(() =>
        expect(
          hook.result.current.settingsStore.store
            .getState()
            .rawConsoleMessages.map((message) => message.content)
            .join('\n'),
        ).toContain('[SessionRecording] warning: dialog recording operation'),
      );
      expect(await readFile(ownerPath, 'utf8')).toContain(
        'dialog recording operation',
      );
      let modelRows = 0;
      for await (const row of owner.session.readInitializedHistory() ?? []) {
        modelRows++;
        expect(JSON.stringify(row)).not.toContain('dialog recording operation');
      }
      expect(modelRows).toBe(1);
      expect(await readFile(peerPath, 'utf8')).not.toContain(
        'dialog recording operation',
      );
    } finally {
      stopOwnerHistoryTokens();
      hook.unmount();
      await config.dispose();
    }
  });
});
