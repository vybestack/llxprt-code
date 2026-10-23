/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { runtimeAppFixture } from '../../__tests__/runtime-context-fixture.js';
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  useCommandOwners,
  commandOwnerClient,
} from '../../__tests__/command-owner-fixture.js';
import { createMockSettings, render, waitFor } from '../../__tests__/render.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { SettingsContext } from '../contexts/SettingsContext.js';
import { AppWrapper } from '../App.js';
import {
  buildUiRuntimeFromSource,
  buildSlashCommandRuntime,
} from '../cliUiRuntime.js';

describe('application input producer', () => {
  const makeOwner = useCommandOwners();
  it('submits the startup question through the application composition', async () => {
    const owner = await makeOwner('app-producer-owner');
    await commandOwnerClient(owner).startChat(await owner.getHistory());
    const root = owner.workspace.getWorkingDirectory();
    const request = join(root, 'request.txt');
    await writeFile(request, 'actual application captured request');
    const config = new Config({
      sessionId: 'app-producer-source',
      storageRoot: join(root, 'host-state'),
      cwd: root,
      targetDir: root,
      debugMode: false,
      model: 'fake-model',
      question: '@' + request,
    });
    const app = renderApplication(
      owner,
      config,
      createMockCommandContext().runtimeApi,
    );
    try {
      await waitFor(async () => {
        expect(JSON.stringify(await owner.getHistory())).toContain(
          'actual application captured request',
        );
      });
    } finally {
      app.unmount();
      await config.dispose();
    }
  });
  it('saves profiles on the application owner despite a sibling runtime and survives sibling retirement', async () => {
    const owner = await makeOwner(
      'app-credential-owner',
      undefined,
      undefined,
      true,
    );
    const peer = await makeOwner(
      'app-credential-peer',
      undefined,
      undefined,
      true,
    );
    owner.setModelParam('temperature', 0.4375);
    const root = owner.workspace.getWorkingDirectory();
    const config = new Config({
      sessionId: 'app-credential-source',
      storageRoot: join(root, 'host-state'),
      cwd: root,
      targetDir: root,
      debugMode: false,
      model: 'fake-model',
      question: '/profile save model captured-root',
    });
    const context = createMockCommandContext({ services: { agent: peer } });
    const decoyRuntime = {
      ...context.runtimeApi,
      saveProfileSnapshot: peer.saveProfileSnapshot.bind(peer),
      deleteProfileByName: peer.deleteProfileByName.bind(peer),
      getEphemeralSettings: peer.getEphemeralSettings.bind(peer),
    };
    await peer.dispose();
    const app = renderApplication(owner, config, decoyRuntime);
    try {
      await waitFor(async () => {
        expect(
          await owner.workspace.profileDefinitions.loadProfile('captured-root'),
        ).toMatchObject({ modelParams: { temperature: 0.4375 } });
      });
      expect(
        JSON.stringify(await owner.workspace.profileDefinitions.listProfiles()),
      ).toContain('captured-root');
    } finally {
      app.unmount();
      await config.dispose();
    }
  });
});

function renderApplication(
  owner: Awaited<ReturnType<ReturnType<typeof useCommandOwners>>>,
  config: Config,
  runtimeApi: ReturnType<typeof createMockCommandContext>['runtimeApi'],
) {
  const oauthControl = owner.authentication;
  const selectedSettings = new SessionSettingsOwner(new SettingsService());
  selectedSettings.bindTelemetry(config);
  const uiRuntime = buildUiRuntimeFromSource(
    config,
    owner,
    undefined,
    selectedSettings,
  );
  const slashCommandRuntime = buildSlashCommandRuntime(
    config,
    owner,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    selectedSettings,
  );
  const settings = createMockSettings({
    folderTrust: false,
    ui: { theme: 'Default' },
  });
  return render(
    <SettingsContext.Provider value={settings}>
      <AppWrapper
        agent={owner}
        uiRuntime={uiRuntime}
        slashCommandRuntime={slashCommandRuntime}
        settings={createMockSettings({
          folderTrust: false,
          ui: { theme: 'Default' },
        })}
        version="test"
        {...runtimeAppFixture(owner, runtimeApi, owner.sessionClient.fetch)}
        providerAliasRefresh={async () => {}}
        oauthControl={oauthControl}
        suppressStartupWelcome
      />
    </SettingsContext.Provider>,
  );
}
