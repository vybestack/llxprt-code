/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { bindPolicyRulesReader } from './policyRulesReaderHost.js';
import { act } from 'react';
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createMockSettings, renderHook } from '../../__tests__/render.js';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import { RuntimeContextProvider } from '../contexts/RuntimeContext.js';
import { OAuthControlProvider } from '../contexts/OAuthControlContext.js';
import { buildSlashCommandRuntime } from '../cliUiRuntime.js';
import { useAppStores } from '../AppContainerRuntime.js';
import { useAppDialogs } from '../containers/AppContainer/hooks/useAppDialogs.js';

function unexpectedPrompt(): never {
  throw new Error('Manual dialog fixture must not generate a prompt');
}

describe('application dialog operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('lists captured definitions and replaces the mounted owner after retirement', async () => {
    const owner = await makeOwner('dialog-owner', undefined, undefined, true);
    const peer = await makeOwner('dialog-peer', undefined, undefined, true);
    await owner.workspace.profileWrites.saveProfile(
      'registered',
      owner.captureProfile(),
    );
    await peer.workspace.profileWrites.saveProfile(
      'registered',
      peer.captureProfile(),
    );
    await owner.workspace.subagentWrites.saveSubagent(
      'reviewer',
      'registered',
      'Review owned state',
    );
    const context = createMockCommandContext();
    const settings = createMockSettings({ folderTrust: false });
    const config = new Config({
      sessionId: 'dialog-host',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      debugMode: false,
      model: 'fake-model',
    });
    const runtime = buildSlashCommandRuntime(config, peer);
    const hook = renderHook(
      ({ current }) => {
        const stores = useAppStores(runtime);
        return useAppDialogs(
          Object.assign(
            {
              config: runtime,
              agent: peer,
              settings,
              store: stores.dialogStore,
              dialogs: stores.dialogOpeners,
              terminalStore: stores.terminalStore,
              settingsStore: stores.settingsStore,
              turnStore: stores.turnStore,
              appDispatch: () => {},
              handleNewMessage: () => {},
              runtime: context.runtimeApi,
              suppressStartupWelcome: true,
              shouldShowIdePrompt: false,
              currentIDE: undefined,
            },
            {
              recordRecordingEvent: current.session.recordRecordingEvent.bind(
                current.session,
              ),
              switchProviderAfterAuth: (provider: string) =>
                current.setProvider(provider, undefined, { autoOAuth: false }),
              listTools: current.tools.list.bind(current.tools),
              readProvider: current.getProvider.bind(current),
              readPromptClient: () => current.agentClient,
              createDetachedPromptClient:
                current.sessionClient.createDetachedAgentClient.bind(
                  current.sessionClient,
                ),
              readPolicyRules: bindPolicyRulesReader(current.policy, () =>
                runtime.getApprovalMode(),
              ),
              subagentDefinitions: current.workspace.subagentDefinitions,
              subagentWrites: current.workspace.subagentWrites,
              profileDefinitions: current.workspace.profileDefinitions,
              generatePrompt: unexpectedPrompt,
            },
          ),
        );
      },
      {
        initialProps: { current: owner },
        wrapper: ({ children }) => (
          <AppDispatchProvider value={() => {}}>
            <OAuthControlProvider control={context.oauthControl}>
              <RuntimeContextProvider
                agent={peer}
                owner={context.runtimeApi}
                requestFetch={context.runtimeApi.fetch}
              >
                {children}
              </RuntimeContextProvider>
            </OAuthControlProvider>
          </AppDispatchProvider>
        ),
      },
    );
    try {
      expect(await hook.result.current.listSubagentDefinitions()).toContain(
        'reviewer',
      );
      await owner.dispose();
      await peer.workspace.subagentWrites.saveSubagent(
        'survivor',
        'registered',
        'Review surviving state',
      );
      act(() => hook.rerender({ current: peer }));
      expect(await hook.result.current.listSubagentDefinitions()).toStrictEqual(
        ['survivor'],
      );
    } finally {
      hook.unmount();
      await config.dispose();
    }
  });
});
