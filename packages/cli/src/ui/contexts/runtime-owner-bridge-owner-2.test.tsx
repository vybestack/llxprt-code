import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach as afterFixtureTest,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../../../agents/src/core/subagent-cleanup.js';
import {
  OwnerView,
  AliasRefreshView,
} from '../../__tests__/runtime-owner-bridge-views.fixture.js';
import { createSessionModelCommand } from '../../runtime/session-model-command.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { render } from 'ink-testing-library';

import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createRuntimeOwnerFeatures } from '../../__tests__/runtime-owner-features-fixture.js';
import { openBridgeRoot } from '../../__tests__/runtime-owner-bridge-route-b-root-fixture.js';
import { ProviderAliasRefreshProvider } from './ProviderAliasRefreshContext.js';
import { createProviderCommand } from '../commands/providerCommand.js';
import { bindProviderCommandOperations } from '../commands/providerCommandHost.js';
import {
  RuntimeContextProvider,
  type RuntimeApi,
} from '../../__tests__/runtime-context-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const makeFixtureFilesystem = installTestWorkspaceFilesystem();

let fixtureFilesystem: ReturnType<typeof makeFixtureFilesystem> | undefined;

function fixturePaths() {
  fixtureFilesystem ??= makeFixtureFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return fixtureFilesystem.paths;
}

const composeFixtureRuntime = installWorkspaceRuntimeFixture();

describe('interactive runtime owner bridge', () => {
  let promptDirectory: string;

  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;

  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });

  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const acquiredCleanup: Array<() => void | Promise<void>> = [];
  afterFixtureTest(async () => {
    fixtureFilesystem = undefined;
    await runCleanupSteps(acquiredCleanup.splice(0).reverse());
  });
  const firstCredentials = useOwnedCredentials();
  const secondCredentials = useOwnedCredentials();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('keeps alias commands and live provider status scoped across interleaved saves and sibling disposal', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'llxprt-alias-owner-'));
    const previousDataHome = process.env['LLXPRT_DATA_HOME'];
    process.env['LLXPRT_DATA_HOME'] = dataDir;
    acquiredCleanup.push(() => {
      if (previousDataHome === undefined) delete process.env.LLXPRT_DATA_HOME;
      else process.env.LLXPRT_DATA_HOME = previousDataHome;
      rmSync(dataDir, { recursive: true, force: true });
    });

    delete process.env.LLXPRT_FAKE_RESPONSES;
    const openai = { provider: 'openai', model: 'gpt-4o' };
    const first = await openBridgeRoot({
      authority: firstCredentials().authority,
      label: 'alias-owner-shared-label',
      config: openai,
      intent: openai,
    });
    acquiredCleanup.push(first.close, () => first.agent.dispose());
    const second = await openBridgeRoot({
      authority: secondCredentials().authority,
      label: 'alias-owner-shared-label',
      config: openai,
      intent: openai,
    });
    acquiredCleanup.push(second.close, () => second.agent.dispose());
    const a = first.agent;
    const b = second.agent;
    const firstCallerSettingsOwner = first.settingsOwner;
    const secondCallerSettingsOwner = second.settingsOwner;
    const firstCallerConfig = first.config;
    const secondCallerConfig = second.config;
    firstCallerSettingsOwner.writeUserParameter(
      'base-url',
      'https://left.example/v1',
    );
    secondCallerSettingsOwner.writeUserParameter(
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
        refresh={() => a.providerReads.refreshAliases()}
      >
        <RuntimeContextProvider
          requestFetch={a.sessionClient.fetch}
          agent={a}
          owner={createRuntimeOwnerFeatures(
            a.providerReads.inspection,
            fixturePaths().directories,
            createSessionModelCommand(a),
            firstCallerSettingsOwner,
            a.workspace,
            a.modelParameters,
            a.settings,
            a.toolFormat,
            a.providerReads,
            a.auth.keys,
            () => a.providerReads.readOpenAIInfo(),
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
        refresh={() => b.providerReads.refreshAliases()}
      >
        <RuntimeContextProvider
          requestFetch={b.sessionClient.fetch}
          agent={b}
          owner={createRuntimeOwnerFeatures(
            b.providerReads.inspection,
            fixturePaths().directories,
            createSessionModelCommand(b),
            secondCallerSettingsOwner,
            b.workspace,
            b.modelParameters,
            b.settings,
            b.toolFormat,
            b.providerReads,
            b.auth.keys,
            () => b.providerReads.readOpenAIInfo(),
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
      if (!captured.left || !captured.right)
        throw new Error('Provider command or root APIs unavailable');
      if (!captured.leftRefresh || !captured.rightRefresh)
        throw new Error('Provider alias refresh unavailable');
      const noRecording = async (): Promise<void> => {};
      const leftAction = createProviderCommand(
        bindProviderCommandOperations(
          captured.left.getActiveProviderName.bind(captured.left),
          captured.left.providerStatus.bind(captured.left),
          captured.left.getActiveModelName.bind(captured.left),
          captured.left.getActiveProviderAliasConfig.bind(captured.left),
          (name, options) => a.setProvider(name, undefined, options),
          captured.leftRefresh,
          noRecording,
        ),
      ).action;
      const rightAction = createProviderCommand(
        bindProviderCommandOperations(
          captured.right.getActiveProviderName.bind(captured.right),
          captured.right.providerStatus.bind(captured.right),
          captured.right.getActiveModelName.bind(captured.right),
          captured.right.getActiveProviderAliasConfig.bind(captured.right),
          (name, options) => b.setProvider(name, undefined, options),
          captured.rightRefresh,
          noRecording,
        ),
      ).action;
      if (!leftAction || !rightAction)
        throw new Error('Provider command actions unavailable');
      const leftContext = createMockCommandContext({
        runtimeApi: captured.left,
        refreshProviderAliases: captured.leftRefresh,
      });
      const rightContext = createMockCommandContext({
        runtimeApi: captured.right,
        refreshProviderAliases: captured.rightRefresh,
      });
      leftContext.services.config = composeFixtureRuntime(
        firstCallerConfig,
        a,
        firstCallerSettingsOwner,
      );
      rightContext.services.config = composeFixtureRuntime(
        secondCallerConfig,
        b,
        secondCallerSettingsOwner,
      );
      const initialLeft = new Set(captured.left.listProviders());
      const initialRight = new Set(captured.right.listProviders());
      firstCallerSettingsOwner.chooseModel('left-before-save');
      secondCallerSettingsOwner.chooseModel('right-before-save');
      expect(captured.left.providerStatus().modelName).toBe('left-before-save');
      expect(captured.right.providerStatus().modelName).toBe(
        'right-before-save',
      );
      const [leftSaved, rightSaved] = await Promise.all([
        Promise.resolve().then(() =>
          leftAction(leftContext, 'save left-owned'),
        ),
        Promise.resolve().then(() =>
          rightAction(rightContext, 'save right-owned'),
        ),
      ]);
      expect(leftSaved).toMatchObject({ messageType: 'info' });
      expect(rightSaved).toMatchObject({ messageType: 'info' });
      expect(new Set(a.providerReads.listProviders())).toStrictEqual(
        new Set([...initialLeft, 'left-owned']),
      );
      expect(new Set(b.providerReads.listProviders())).toStrictEqual(
        new Set([...initialRight, 'left-owned', 'right-owned']),
      );
      expect(captured.left.listProviders()).not.toContain('right-owned');
      expect(captured.left.listProviders()).toContain('left-owned');
      expect(captured.right.listProviders()).toContain('right-owned');
      firstCallerSettingsOwner.chooseModel('left-after-save');
      secondCallerSettingsOwner.chooseModel('right-after-save');
      expect(captured.left.providerStatus().modelName).toBe('left-after-save');
      expect(captured.right.providerStatus().modelName).toBe(
        'right-after-save',
      );
      left.unmount();
      await a.dispose();
      await first.close();
      const afterDispose = await rightAction(
        rightContext,
        'save right-after-dispose',
      );
      expect(afterDispose).toMatchObject({ messageType: 'info' });
      expect(b.providerReads.listProviders()).toContain('right-after-dispose');
      expect(captured.right.listProviders()).toContain('right-after-dispose');
      secondCallerSettingsOwner.chooseModel('right-after-dispose');
      expect(captured.right.providerStatus().modelName).toBe(
        'right-after-dispose',
      );
      expect(a.providerReads.listProviders()).not.toContain(
        'right-after-dispose',
      );
    } finally {
      right.unmount();
      await b.dispose();
      await second.close();
      if (previousDataHome === undefined)
        delete process.env['LLXPRT_DATA_HOME'];
      else process.env['LLXPRT_DATA_HOME'] = previousDataHome;
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30000);
});
