/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { MemoryTokenStore } from '../../../../providers/src/auth/__tests__/behavioral/test-utils.js';
import { createOAuthControl } from '../../runtime/createOAuthControl.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockSettings, render, waitFor } from '../../__tests__/render.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { AppWrapper } from '../App.js';
import {
  buildUiRuntimeFromSource,
  buildSlashCommandRuntime,
} from '../cliUiRuntime.js';

describe('application input producer', () => {
  const makeOwner = useCommandOwners();
  it('submits the startup question through the application composition', async () => {
    const owner = await makeOwner('app-producer-owner');
    await owner.agentClient.startChat(await owner.getHistory());
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
    const context = createMockCommandContext();
    const oauthManager = new OAuthManager(new MemoryTokenStore());
    const providers = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      new SettingsService(),
    );
    const oauthControl = createOAuthControl(() => oauthManager, providers);
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
    const app = render(
      <AppWrapper
        agent={owner}
        uiRuntime={uiRuntime}
        slashCommandRuntime={slashCommandRuntime}
        settings={createMockSettings({
          folderTrust: false,
          ui: { theme: 'Default' },
        })}
        version="test"
        runtimeOwner={{ create: () => context.runtimeApi }}
        providerAliasRefresh={async () => {}}
        oauthControl={oauthControl}
        suppressStartupWelcome
      />,
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
});
