import {
  OwnerView,
  AliasRefreshView,
  ModelEventView,
} from './runtime-owner-bridge-views.fixture.js';
import { CredentialAuthority } from '../../../../providers/src/auth/proxy/credential-store-factory.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSessionModelCommand } from '../../runtime/session-model-command.js';

import { afterEach as afterFixtureTest, describe, expect, it } from 'bun:test';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
const makeFixtureFilesystem = installTestWorkspaceFilesystem();
let fixtureFilesystem: ReturnType<typeof makeFixtureFilesystem> | undefined;
function fixturePaths() {
  fixtureFilesystem ??= makeFixtureFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return fixtureFilesystem.paths;
}
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  configureProviderRuntimeFactories,
  NodeFileSystem,
  createProviderManager,
} from '@vybestack/llxprt-code-providers/composition.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React, { act, useEffect } from 'react';
import { Text } from 'ink';
import { Colors } from '../colors.js';
import { render } from 'ink-testing-library';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { SessionController } from '../containers/SessionController.js';
import { buildCliStyleConfig } from '../../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  createRuntimeOwnerFeatures,
  createProviderAliasRefresh,
} from '../../runtime/createRuntimeOwnerFeatures.js';
import { createOAuthControl } from '../../runtime/createOAuthControl.js';
import {
  OAuthControlProvider,
  useOAuthControl,
} from './OAuthControlContext.js';
import { authCommand } from '../commands/authCommand.js';
import { ProviderAliasRefreshProvider } from './ProviderAliasRefreshContext.js';
import { setCommand } from '../commands/setCommand.js';
import { modelCommand } from '../commands/modelCommand.js';
import { keyCommand } from '../commands/keyCommand.js';
import { providerCommand } from '../commands/providerCommand.js';
import { profileCommand } from '../commands/profileCommand.js';
import { RuntimeContextProvider, type RuntimeApi } from './RuntimeContext.js';

describe('interactive runtime owner bridge', () => {
  afterFixtureTest(() => {
    fixtureFilesystem = undefined;
  });
  it('keeps two mounted roots with identical runtime labels independent across updates and unmounts', async () => {
    const first = await buildCliStyleConfig('multi-turn-text.jsonl');
    const second = await buildCliStyleConfig('multi-turn-text.jsonl');
    const a = await fromConfig({
      settingsOwner: first.settingsOwner,
      settingsService: first.settingsService,
      providerManager: first.providerManager,
      config: first.config,
      messageBus: first.messageBus,
      mcpRuntime: first.mcpRuntime,
      sessionId: 'shared-bridge-label',
    });
    const b = await fromConfig({
      settingsOwner: second.settingsOwner,
      settingsService: second.settingsService,
      providerManager: second.providerManager,
      config: second.config,
      messageBus: second.messageBus,
      mcpRuntime: second.mcpRuntime,
      sessionId: 'shared-bridge-label',
    });
    first.settingsOwner.writeUserParameter('bridge-owner-key', 'first');
    second.settingsOwner.writeUserParameter('bridge-owner-key', 'second');
    first.settingsOwner.chooseModel('first-model');
    second.settingsOwner.chooseModel('second-model');
    const captured: { left?: RuntimeApi; right?: RuntimeApi } = {};
    const left = render(
      <RuntimeContextProvider
        requestFetch={a.sessionClient.fetch}
        agent={a}
        owner={createRuntimeOwnerFeatures(
          first.config,
          a.providerManager,
          fixturePaths().directories,
          createSessionModelCommand(a),
          first.settingsOwner,
          first.settingsService,
          a.workspace,
          a.modelParameters,
          a.settings,
          a.toolFormat,
          a.providerReads,
          a.auth.keys,
        )}
      >
        <SessionController
          config={composeFixtureRuntime(first.config, a, first.settingsOwner)}
        >
          <OwnerView
            label="left"
            onApi={(api) => {
              captured.left = api;
            }}
          />
          <ModelEventView />
        </SessionController>
      </RuntimeContextProvider>,
    );
    const right = render(
      <RuntimeContextProvider
        requestFetch={b.sessionClient.fetch}
        agent={b}
        owner={createRuntimeOwnerFeatures(
          second.config,
          b.providerManager,
          fixturePaths().directories,
          createSessionModelCommand(b),
          second.settingsOwner,
          second.settingsService,
          b.workspace,
          b.modelParameters,
          b.settings,
          b.toolFormat,
          b.providerReads,
          b.auth.keys,
        )}
      >
        <SessionController
          config={composeFixtureRuntime(second.config, b, second.settingsOwner)}
        >
          <OwnerView
            label="right"
            onApi={(api) => {
              captured.right = api;
            }}
          />
          <ModelEventView />
        </SessionController>
      </RuntimeContextProvider>,
    );
    try {
      expect(left.lastFrame()).toContain('left:fake:first-model:first');
      expect(right.lastFrame()).toContain('right:fake:second-model:second');
      if (!captured.left || !captured.right)
        throw new Error('Root callbacks unavailable');
      await captured.left.setActiveToolFormatOverride('openai');
      await captured.right.setActiveToolFormatOverride('kimi');
      expect((await captured.left.getActiveToolFormatState()).override).toBe(
        'openai',
      );
      expect((await captured.right.getActiveToolFormatState()).override).toBe(
        'kimi',
      );
      first.settingsOwner.chooseModel('first-event-model');
      second.settingsOwner.chooseModel('second-event-model');
      act(() => {
        first.settingsOwner.publishModelProfile({
          model: 'first-event-model',
          displayLabel: 'first-event-model',
        });
        second.settingsOwner.publishModelProfile({
          model: 'second-event-model',
          displayLabel: 'second-event-model',
        });
      });
      expect(left.lastFrame()).toContain('event-model:fake:first-event-model');
      expect(right.lastFrame()).toContain(
        'event-model:fake:second-event-model',
      );
      left.unmount();
      expect(
        (await captured.right.getActiveToolFormatState()).currentFormat,
      ).toBe('kimi');
      second.settingsOwner.chooseModel('updated-model');
      act(() =>
        second.settingsOwner.publishModelProfile({
          model: 'updated-model',
          displayLabel: 'updated-model',
        }),
      );
      right.rerender(
        <RuntimeContextProvider
          requestFetch={b.sessionClient.fetch}
          agent={b}
          owner={createRuntimeOwnerFeatures(
            second.config,
            b.providerManager,
            fixturePaths().directories,
            createSessionModelCommand(b),
            second.settingsOwner,
            second.settingsService,
            b.workspace,
            b.modelParameters,
            b.settings,
            b.toolFormat,
            b.providerReads,
            b.auth.keys,
          )}
        >
          <SessionController
            config={composeFixtureRuntime(
              second.config,
              b,
              second.settingsOwner,
            )}
          >
            <OwnerView label="right" />
            <ModelEventView />
          </SessionController>
        </RuntimeContextProvider>,
      );
      expect(right.lastFrame()).toContain('right:fake:updated-model:second');
      expect(right.lastFrame()).toContain('event-model:fake:updated-model');
    } finally {
      right.unmount();
      await a.dispose();
      await b.dispose();
      await first.config.dispose();
      await second.config.dispose();
      await first.cleanup();
      await second.cleanup();
    }
  }, 30000);
  it('runs commands on independently owned APIs even when runtime labels match', async () => {
    const first = await buildCliStyleConfig('multi-turn-text.jsonl');
    const second = await buildCliStyleConfig('multi-turn-text.jsonl');
    const a = await fromConfig({
      settingsOwner: first.settingsOwner,
      settingsService: first.settingsService,
      providerManager: first.providerManager,
      config: first.config,
      messageBus: first.messageBus,
      mcpRuntime: first.mcpRuntime,
      sessionId: 'same-label',
    });
    const b = await fromConfig({
      settingsOwner: second.settingsOwner,
      settingsService: second.settingsService,
      providerManager: second.providerManager,
      config: second.config,
      messageBus: second.messageBus,
      mcpRuntime: second.mcpRuntime,
      sessionId: 'same-label',
    });
    const captured: { left?: RuntimeApi; right?: RuntimeApi } = {};
    const left = render(
      <RuntimeContextProvider
        requestFetch={a.sessionClient.fetch}
        agent={a}
        owner={createRuntimeOwnerFeatures(
          first.config,
          a.providerManager,
          fixturePaths().directories,
          createSessionModelCommand(a),
          first.settingsOwner,
          first.settingsService,
          a.workspace,
          a.modelParameters,
          a.settings,
          a.toolFormat,
          a.providerReads,
          a.auth.keys,
        )}
      >
        <OwnerView
          label="left"
          onApi={(api) => {
            captured.left = api;
          }}
        />
      </RuntimeContextProvider>,
    );
    const right = render(
      <RuntimeContextProvider
        requestFetch={b.sessionClient.fetch}
        agent={b}
        owner={createRuntimeOwnerFeatures(
          second.config,
          b.providerManager,
          fixturePaths().directories,
          createSessionModelCommand(b),
          second.settingsOwner,
          second.settingsService,
          b.workspace,
          b.modelParameters,
          b.settings,
          b.toolFormat,
          b.providerReads,
          b.auth.keys,
        )}
      >
        <OwnerView
          label="right"
          onApi={(api) => {
            captured.right = api;
          }}
        />
      </RuntimeContextProvider>,
    );
    try {
      if (
        !captured.left ||
        !captured.right ||
        !setCommand.action ||
        !modelCommand.action
      )
        throw new Error('Commands or owners unavailable');
      const leftContext = createMockCommandContext({
        runtimeApi: captured.left,
      });
      const rightContext = createMockCommandContext({
        runtimeApi: captured.right,
      });
      await Promise.all([
        setCommand.action(leftContext, 'context-limit 17001'),
        setCommand.action(rightContext, 'context-limit 27002'),
      ]);
      expect(first.settingsOwner.readNamedParameter('context-limit')).toBe(
        17001,
      );
      expect(second.settingsOwner.readNamedParameter('context-limit')).toBe(
        27002,
      );
      await Promise.all([
        modelCommand.action(leftContext, 'model-left'),
        modelCommand.action(rightContext, 'model-right'),
      ]);
      expect(a.getModel()).toBe('model-left');
      expect(b.getModel()).toBe('model-right');

      if (!keyCommand.action || !providerCommand.action)
        throw new Error('Credential or provider command unavailable');
      await Promise.all([
        keyCommand.action(leftContext, 'key-left'),
        keyCommand.action(rightContext, 'key-right'),
      ]);
      expect(first.settingsOwner.readNamedParameter('auth-key')).toBe(
        'key-left',
      );
      expect(second.settingsOwner.readNamedParameter('auth-key')).toBe(
        'key-right',
      );
      const [leftProvider, rightProvider] = await Promise.all([
        providerCommand.action(leftContext, 'fake'),
        providerCommand.action(rightContext, 'fake'),
      ]);
      expect(leftProvider).toMatchObject({
        content: 'Already using provider: fake',
      });
      expect(rightProvider).toMatchObject({
        content: 'Already using provider: fake',
      });

      a.setDefaultProfileName('owner-left');
      b.setDefaultProfileName('owner-right');
      const setDefault = profileCommand.subCommands?.find(
        (command) => command.name === 'set-default',
      );
      if (!setDefault?.action) throw new Error('Profile command unavailable');
      leftContext.services.agent = a;
      rightContext.services.agent = b;
      await setDefault.action(leftContext, 'none');
      expect(captured.left.getDefaultProfileName()).toBeNull();
      expect(captured.right.getDefaultProfileName()).toBe('owner-right');
      await setDefault.action(rightContext, 'none');
      expect(captured.right.getDefaultProfileName()).toBeNull();

      first.settingsOwner.writeUserParameter('custom-headers', {
        'X-Left': 'one',
      });
      second.settingsOwner.writeUserParameter('custom-headers', {
        'X-Right': 'two',
      });
      const unset = setCommand.schema?.find(
        (node) => node.kind === 'literal' && node.value === 'unset',
      );
      if (unset?.kind !== 'literal')
        throw new Error('Unset schema unavailable');
      const keyNode = unset.next?.[0];
      if (keyNode?.kind !== 'value')
        throw new Error('Unset key schema unavailable');
      const headerNode = keyNode.next?.[0];
      if (headerNode?.kind !== 'value' || !headerNode.completer)
        throw new Error('Header completer unavailable');
      const tokens = {
        tokens: ['unset', 'custom-headers'],
        partialToken: 'X-',
        hasTrailingSpace: false,
        position: 2,
      };
      const [leftHeaders, rightHeaders] = await Promise.all([
        headerNode.completer(leftContext, 'X-', tokens),
        headerNode.completer(rightContext, 'X-', tokens),
      ]);
      expect(leftHeaders.map((header) => header.value)).toStrictEqual([
        'X-Left',
      ]);
      expect(rightHeaders.map((header) => header.value)).toStrictEqual([
        'X-Right',
      ]);
    } finally {
      left.unmount();
      right.unmount();
      await a.dispose();
      await b.dispose();
      await first.config.dispose();
      await second.config.dispose();
      await first.cleanup();
      await second.cleanup();
    }
  }, 30000);
  it('keeps alias commands and live provider status scoped across interleaved saves and sibling disposal', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'llxprt-alias-owner-'));
    const previousDataHome = process.env['LLXPRT_DATA_HOME'];
    const previousFakeResponses = process.env.LLXPRT_FAKE_RESPONSES;
    process.env['LLXPRT_DATA_HOME'] = dataDir;
    const first = await buildCliStyleConfig('multi-turn-text.jsonl');
    const second = await buildCliStyleConfig('multi-turn-text.jsonl');
    const a = await fromConfig({
      settingsOwner: first.settingsOwner,
      settingsService: first.settingsService,
      providerManager: first.providerManager,
      config: first.config,
      messageBus: first.messageBus,
      mcpRuntime: first.mcpRuntime,
      sessionId: 'alias-owner-shared-label',
    });
    const b = await fromConfig({
      settingsOwner: second.settingsOwner,
      settingsService: second.settingsService,
      providerManager: second.providerManager,
      config: second.config,
      messageBus: second.messageBus,
      mcpRuntime: second.mcpRuntime,
      sessionId: 'alias-owner-shared-label',
    });
    delete process.env.LLXPRT_FAKE_RESPONSES;
    if (
      !(first.providerManager instanceof ProviderManager) ||
      !(second.providerManager instanceof ProviderManager)
    )
      throw new Error('Expected concrete fixture owners');
    const runtimeId = 'alias-owner-shared-label';
    const firstManager = createProviderManager(
      first.settingsService,
      { runtimeId },
      first.config,
      new CredentialAuthority(),
      new NodeFileSystem(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      first.providerManager,
      undefined,
      undefined,
      undefined,
      false,
    ).manager;
    const secondManager = createProviderManager(
      second.settingsService,
      { runtimeId },
      second.config,
      new CredentialAuthority(),
      new NodeFileSystem(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      second.providerManager,
      undefined,
      undefined,
      undefined,
      false,
    ).manager;
    configureProviderRuntimeFactories(first.config, firstManager);
    configureProviderRuntimeFactories(second.config, secondManager);
    firstManager.setActiveProvider('openai');
    secondManager.setActiveProvider('openai');
    first.settingsOwner.writeUserParameter(
      'base-url',
      'https://left.example/v1',
    );
    second.settingsOwner.writeUserParameter(
      'base-url',
      'https://right.example/v1',
    );
    const captured: {
      left?: RuntimeApi;
      right?: RuntimeApi;
      leftRefresh?: () => Promise<void>;
      rightRefresh?: () => Promise<void>;
    } = {};
    const left = render(
      <ProviderAliasRefreshProvider
        refresh={createProviderAliasRefresh(a.providerManager)}
      >
        <RuntimeContextProvider
          requestFetch={a.sessionClient.fetch}
          agent={a}
          owner={createRuntimeOwnerFeatures(
            first.config,
            a.providerManager,
            fixturePaths().directories,
            createSessionModelCommand(a),
            first.settingsOwner,
            first.settingsService,
            a.workspace,
            a.modelParameters,
            a.settings,
            a.toolFormat,
            a.providerReads,
            a.auth.keys,
          )}
        >
          <OwnerView label="left" onApi={(api) => (captured.left = api)} />
          <AliasRefreshView
            onRefresh={(refresh) => (captured.leftRefresh = refresh)}
          />
        </RuntimeContextProvider>
      </ProviderAliasRefreshProvider>,
    );
    const right = render(
      <ProviderAliasRefreshProvider
        refresh={createProviderAliasRefresh(b.providerManager)}
      >
        <RuntimeContextProvider
          requestFetch={b.sessionClient.fetch}
          agent={b}
          owner={createRuntimeOwnerFeatures(
            second.config,
            b.providerManager,
            fixturePaths().directories,
            createSessionModelCommand(b),
            second.settingsOwner,
            second.settingsService,
            b.workspace,
            b.modelParameters,
            b.settings,
            b.toolFormat,
            b.providerReads,
            b.auth.keys,
          )}
        >
          <OwnerView label="right" onApi={(api) => (captured.right = api)} />
          <AliasRefreshView
            onRefresh={(refresh) => (captured.rightRefresh = refresh)}
          />
        </RuntimeContextProvider>
      </ProviderAliasRefreshProvider>,
    );
    try {
      const action = providerCommand.action;
      if (!captured.left || !captured.right || !action)
        throw new Error('Provider command or root APIs unavailable');
      if (!captured.leftRefresh || !captured.rightRefresh)
        throw new Error('Provider alias refresh unavailable');
      const leftContext = createMockCommandContext({
        runtimeApi: captured.left,
        refreshProviderAliases: captured.leftRefresh,
      });
      const rightContext = createMockCommandContext({
        runtimeApi: captured.right,
        refreshProviderAliases: captured.rightRefresh,
      });
      leftContext.services.config = composeFixtureRuntime(
        first.config,
        a,
        first.settingsOwner,
      );
      rightContext.services.config = composeFixtureRuntime(
        second.config,
        b,
        second.settingsOwner,
      );
      const initialLeft = new Set(captured.left.listProviders());
      const initialRight = new Set(captured.right.listProviders());
      first.settingsOwner.chooseModel('left-before-save');
      second.settingsOwner.chooseModel('right-before-save');
      expect(captured.left.providerStatus().modelName).toBe('left-before-save');
      expect(captured.right.providerStatus().modelName).toBe(
        'right-before-save',
      );
      const [leftSaved, rightSaved] = await Promise.all([
        Promise.resolve().then(() => action(leftContext, 'save left-owned')),
        Promise.resolve().then(() => action(rightContext, 'save right-owned')),
      ]);
      expect(leftSaved).toMatchObject({ messageType: 'info' });
      expect(rightSaved).toMatchObject({ messageType: 'info' });
      expect(new Set(firstManager.listProviders())).toStrictEqual(
        new Set([...initialLeft, 'left-owned']),
      );
      expect(new Set(secondManager.listProviders())).toStrictEqual(
        new Set([...initialRight, 'left-owned', 'right-owned']),
      );
      expect(captured.left.listProviders()).not.toContain('right-owned');
      expect(captured.left.listProviders()).toContain('left-owned');
      expect(captured.right.listProviders()).toContain('right-owned');
      first.settingsOwner.chooseModel('left-after-save');
      second.settingsOwner.chooseModel('right-after-save');
      expect(captured.left.providerStatus().modelName).toBe('left-after-save');
      expect(captured.right.providerStatus().modelName).toBe(
        'right-after-save',
      );
      left.unmount();
      await a.dispose();
      await first.config.dispose();
      await first.cleanup();
      const afterDispose = await action(
        rightContext,
        'save right-after-dispose',
      );
      expect(afterDispose).toMatchObject({ messageType: 'info' });
      expect(secondManager.listProviders()).toContain('right-after-dispose');
      expect(captured.right.listProviders()).toContain('right-after-dispose');
      second.settingsOwner.chooseModel('right-after-dispose');
      expect(captured.right.providerStatus().modelName).toBe(
        'right-after-dispose',
      );
      expect(firstManager.listProviders()).not.toContain('right-after-dispose');
    } finally {
      right.unmount();
      await b.dispose();
      await second.config.dispose();
      await second.cleanup();
      if (previousDataHome === undefined)
        delete process.env['LLXPRT_DATA_HOME'];
      else process.env['LLXPRT_DATA_HOME'] = previousDataHome;
      if (previousFakeResponses === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousFakeResponses;
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30000);
  it('isolates interleaved OAuth auth status in two same-label roots after one owner is disposed', async () => {
    const first = await buildCliStyleConfig('multi-turn-text.jsonl');
    const second = await buildCliStyleConfig('multi-turn-text.jsonl');
    const a = await fromConfig({
      settingsOwner: first.settingsOwner,
      settingsService: first.settingsService,
      providerManager: first.providerManager,
      config: first.config,
      messageBus: first.messageBus,
      mcpRuntime: first.mcpRuntime,
      sessionId: 'shared-oauth-label',
    });
    const b = await fromConfig({
      settingsOwner: second.settingsOwner,
      settingsService: second.settingsService,
      providerManager: second.providerManager,
      config: second.config,
      messageBus: second.messageBus,
      mcpRuntime: second.mcpRuntime,
      sessionId: 'shared-oauth-label',
    });
    const captured: {
      left?: ReturnType<typeof createOAuthControl>;
      right?: ReturnType<typeof createOAuthControl>;
    } = {};
    function OAuthView({
      side,
    }: {
      side: 'left' | 'right';
    }): React.JSX.Element {
      const control = useOAuthControl();
      useEffect(() => {
        captured[side] = control;
      }, [control, side]);
      return <Text color={Colors.Foreground}>oauth:{side}</Text>;
    }
    const left = render(
      <OAuthControlProvider
        control={createOAuthControl(
          () => first.runtime.oauthManager,
          a.providerManager,
        )}
      >
        <OAuthView side="left" />
      </OAuthControlProvider>,
    );
    const right = render(
      <OAuthControlProvider
        control={createOAuthControl(
          () => second.runtime.oauthManager,
          b.providerManager,
        )}
      >
        <OAuthView side="right" />
      </OAuthControlProvider>,
    );
    try {
      if (!captured.left || !captured.right || !authCommand.action)
        throw new Error('OAuth root unavailable');
      const leftControl = captured.left;
      const rightControl = captured.right;
      const initialLeft = await leftControl.getAuthStatus();
      const initialRight = await rightControl.getAuthStatus();
      expect(initialLeft).toStrictEqual(initialRight);
      const [enabledLeft, enabledRight] = await Promise.all([
        leftControl.toggleOAuthEnabled('codex'),
        rightControl.toggleOAuthEnabled('claudecode'),
      ]);
      expect(enabledLeft).toBe(true);
      expect(enabledRight).toBe(true);
      const [leftStatus, rightStatus] = await Promise.all([
        leftControl.getAuthStatus(),
        rightControl.getAuthStatus(),
      ]);
      expect(
        leftStatus.find((status) => status.provider === 'codex')?.oauthEnabled,
      ).toBe(true);
      expect(
        leftStatus.find((status) => status.provider === 'claudecode')
          ?.oauthEnabled,
      ).not.toBe(true);
      expect(
        rightStatus.find((status) => status.provider === 'claudecode')
          ?.oauthEnabled,
      ).toBe(true);
      expect(
        rightStatus.find((status) => status.provider === 'codex')?.oauthEnabled,
      ).not.toBe(true);
      const rightContext = createMockCommandContext({
        oauthControl: rightControl,
      });
      Object.defineProperty(rightContext, 'runtimeApi', {
        get: () => {
          throw new Error(
            'OAuth status must not resolve a generic runtime API',
          );
        },
      });
      const statusResult = await authCommand.action(rightContext, 'claudecode');
      expect(statusResult).toMatchObject({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('ENABLED'),
      });
      expect(JSON.stringify(statusResult)).not.toContain('access_token');
      expect(JSON.stringify(leftStatus)).not.toContain('access_token');
      expect(JSON.stringify(rightStatus)).not.toContain('access_token');
      left.unmount();
      await a.dispose();
      await first.config.dispose();
      await first.cleanup();
      const statusAfterDisposal = await rightControl.getAuthStatus();
      expect(
        statusAfterDisposal.find((status) => status.provider === 'claudecode')
          ?.oauthEnabled,
      ).toBe(true);
      expect(
        statusAfterDisposal.find((status) => status.provider === 'codex')
          ?.oauthEnabled,
      ).not.toBe(true);
    } finally {
      right.unmount();
      await b.dispose();
      await second.config.dispose();
      await second.cleanup();
    }
  }, 30000);
});
