/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
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
import { RuntimeContextProvider } from '../contexts/RuntimeContext.js';
import { OAuthControlProvider } from '../contexts/OAuthControlContext.js';
import { SessionStatsProvider } from '../contexts/SessionContext.js';
import { initialAppState } from '../reducers/appReducer.js';
import { useAppBootstrap } from '../containers/AppContainer/hooks/useAppBootstrap.js';

describe('bootstrap captured operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('records feedback through the captured owner with a different session in legacy inputs', async () => {
    const owner = await makeOwner('bootstrap-owner');
    const peer = await makeOwner('bootstrap-peer');
    for (const current of [owner, peer]) {
      await current.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'bootstrap history' }],
        },
      ]);
      await current.session.setRecording({ enabled: true });
    }
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
        return useAppBootstrap(
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
            },
          ),
        );
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
      coreEvents.emitFeedback('warning', 'captured bootstrap feedback');
      await waitFor(async () =>
        expect(await readFile(ownerPath, 'utf8')).toContain(
          'captured bootstrap feedback',
        ),
      );
      expect(await readFile(peerPath, 'utf8')).not.toContain(
        'captured bootstrap feedback',
      );
    } finally {
      hook.unmount();
      await config.dispose();
    }
  });
});
