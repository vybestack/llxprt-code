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
import { OwnerView } from '../../__tests__/runtime-owner-bridge-views.fixture.js';
import { createSessionModelCommand } from '../../runtime/session-model-command.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { render } from 'ink-testing-library';

import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createRuntimeOwnerFeatures } from '../../__tests__/runtime-owner-features-fixture.js';
import { openBridgeRoot } from '../../__tests__/runtime-owner-bridge-route-b-root-fixture.js';
import { createSetCommandForTest } from '../../__tests__/set-command-test-owner.js';
import { createModelCommand } from '../commands/modelCommand.js';
import { registerKeyCommand } from '../../__tests__/credential-command-test-owner.js';
import { createProviderCommand } from '../commands/providerCommand.js';
import { bindProviderCommandOperations } from '../commands/providerCommandHost.js';
import { createProfileCommandForTest } from '../commands/__tests__/profile-command-test-owner.js';
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

  const firstCredentials = useOwnedCredentials();

  const secondCredentials = useOwnedCredentials();

  useFakeResponsesReplay('multi-turn-text.jsonl');

  const acquiredCleanup: Array<() => void | Promise<void>> = [];
  afterFixtureTest(async () => {
    fixtureFilesystem = undefined;
    await runCleanupSteps(acquiredCleanup.splice(0).reverse());
  });
  it('runs commands on independently owned APIs even when runtime labels match', async () => {
    const first = await openBridgeRoot({
      authority: firstCredentials().authority,
      label: 'same-label',
    });
    acquiredCleanup.push(first.close, () => first.agent.dispose());
    const second = await openBridgeRoot({
      authority: secondCredentials().authority,
      label: 'same-label',
    });
    acquiredCleanup.push(second.close, () => second.agent.dispose());
    const a = first.agent;
    const b = second.agent;
    const firstCallerSettingsOwner = first.settingsOwner;
    const secondCallerSettingsOwner = second.settingsOwner;
    const captured: { left?: RuntimeApi; right?: RuntimeApi } = {};
    const left = render(
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
        <OwnerView
          label="right"
          onApi={(api) => {
            captured.right = api;
          }}
        />
      </RuntimeContextProvider>,
    );
    try {
      if (!captured.left || !captured.right)
        throw new Error('Runtime owners unavailable');
      const leftApi = captured.left;
      const rightApi = captured.right;
      const leftSet = createSetCommandForTest(leftApi);
      const rightSet = createSetCommandForTest(rightApi);
      const leftModel = createModelCommand(
        (model) => leftApi.setActiveModel(model),
        async (provider, model) =>
          a.session.recordRecordingEvent({
            type: 'provider_switch',
            provider,
            model,
          }),
      );
      const rightModel = createModelCommand(
        (model) => rightApi.setActiveModel(model),
        async (provider, model) =>
          b.session.recordRecordingEvent({
            type: 'provider_switch',
            provider,
            model,
          }),
      );
      if (!leftModel.action || !rightModel.action)
        throw new Error('Missing bound model actions');
      const leftContext = createMockCommandContext({
        runtimeApi: captured.left,
      });
      const rightContext = createMockCommandContext({
        runtimeApi: captured.right,
      });
      await Promise.all([
        leftSet.action!(leftContext, 'context-limit 17001'),
        rightSet.action!(rightContext, 'context-limit 27002'),
      ]);
      expect(firstCallerSettingsOwner.readNamedParameter('context-limit')).toBe(
        17001,
      );
      expect(
        secondCallerSettingsOwner.readNamedParameter('context-limit'),
      ).toBe(27002);
      await Promise.all([
        leftModel.action(leftContext, 'model-left'),
        rightModel.action(rightContext, 'model-right'),
      ]);
      expect(a.getModel()).toBe('model-left');
      expect(b.getModel()).toBe('model-right');

      const recordProviderSwitch = (
        owner: typeof a,
        provider: string,
        model: string,
      ) =>
        owner.session.recordRecordingEvent({
          type: 'provider_switch',
          provider,
          model,
        });
      const leftProviderCommand = createProviderCommand(
        bindProviderCommandOperations(
          leftApi.getActiveProviderName.bind(leftApi),
          leftApi.providerStatus.bind(leftApi),
          leftApi.getActiveModelName.bind(leftApi),
          leftApi.getActiveProviderAliasConfig.bind(leftApi),
          (name, options) => a.setProvider(name, undefined, options),
          async () => {},
          (provider, model) => recordProviderSwitch(a, provider, model),
        ),
      );
      const rightProviderCommand = createProviderCommand(
        bindProviderCommandOperations(
          rightApi.getActiveProviderName.bind(rightApi),
          rightApi.providerStatus.bind(rightApi),
          rightApi.getActiveModelName.bind(rightApi),
          rightApi.getActiveProviderAliasConfig.bind(rightApi),
          (name, options) => b.setProvider(name, undefined, options),
          async () => {},
          (provider, model) => recordProviderSwitch(b, provider, model),
        ),
      );
      const leftKeyCommand = registerKeyCommand(leftContext);
      const rightKeyCommand = registerKeyCommand(rightContext);
      if (
        !leftKeyCommand.action ||
        !rightKeyCommand.action ||
        !leftProviderCommand.action ||
        !rightProviderCommand.action
      )
        throw new Error('Credential or provider command unavailable');
      await Promise.all([
        leftKeyCommand.action(leftContext, 'key-left'),
        rightKeyCommand.action(rightContext, 'key-right'),
      ]);
      expect(firstCallerSettingsOwner.readNamedParameter('auth-key')).toBe(
        'key-left',
      );
      expect(secondCallerSettingsOwner.readNamedParameter('auth-key')).toBe(
        'key-right',
      );
      const [leftProvider, rightProvider] = await Promise.all([
        leftProviderCommand.action(leftContext, 'fake'),
        rightProviderCommand.action(rightContext, 'fake'),
      ]);
      expect(leftProvider).toMatchObject({
        content: 'Already using provider: fake',
      });
      expect(rightProvider).toMatchObject({
        content: 'Already using provider: fake',
      });

      a.setDefaultProfileName('owner-left');
      b.setDefaultProfileName('owner-right');
      leftContext.services.agent = a;
      rightContext.services.agent = b;
      const leftProfileCommand = createProfileCommandForTest(leftContext);
      const rightProfileCommand = createProfileCommandForTest(rightContext);
      const leftSetDefault = leftProfileCommand.subCommands?.find(
        (command) => command.name === 'set-default',
      );
      const rightSetDefault = rightProfileCommand.subCommands?.find(
        (command) => command.name === 'set-default',
      );
      if (!leftSetDefault?.action || !rightSetDefault?.action)
        throw new Error('Profile command unavailable');
      await leftSetDefault.action(rightContext, 'none');
      expect(captured.left.getDefaultProfileName()).toBeNull();
      expect(captured.right.getDefaultProfileName()).toBe('owner-right');
      await rightSetDefault.action(rightContext, 'none');
      expect(captured.right.getDefaultProfileName()).toBeNull();

      firstCallerSettingsOwner.writeUserParameter('custom-headers', {
        'X-Left': 'one',
      });
      secondCallerSettingsOwner.writeUserParameter('custom-headers', {
        'X-Right': 'two',
      });
      const headerCompleterFor = (command: typeof leftSet) => {
        const unset = command.schema?.find(
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
        return headerNode.completer;
      };
      const leftCompleter = headerCompleterFor(leftSet);
      const rightCompleter = headerCompleterFor(rightSet);
      const tokens = {
        tokens: ['unset', 'custom-headers'],
        partialToken: 'X-',
        hasTrailingSpace: false,
        position: 2,
      };
      const [leftHeaders, rightHeaders] = await Promise.all([
        leftCompleter(leftContext, 'X-', tokens),
        rightCompleter(rightContext, 'X-', tokens),
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
      await first.close();
      await second.close();
    }
  }, 30000);
});
