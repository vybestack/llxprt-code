import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { AgentActivationOperation } from '@vybestack/llxprt-code-agents';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { assembleSettingsControl } from '../../../../agents/src/api/control/settings-control.js';
import { assembleToolFormatControl } from '../../../../agents/src/api/control/tool-format-control.js';
import { SessionProviderReads } from '@vybestack/llxprt-code-agents';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import { installDefinitionRuntimeFixture } from '../../__tests__/definition-runtime-fixture.js';
const definitionFixture = installDefinitionRuntimeFixture();

import {
  assembleWorkspaceMemory,
  ApprovalMode,
} from '@vybestack/llxprt-code-core';

import {
  afterEach as afterFixtureTest,
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';
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

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { parseArguments } from '../cliArgParser.js';
import { createTestMergedSettings } from '../settings.js';
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
} from '../profileBootstrap.js';
import { finalizeConfig } from '../postConfigRuntime.js';
import { createRuntimeOwnerFeatures } from '../../runtime/createRuntimeOwnerFeatures.js';

const originalArgv = process.argv;
const roots: string[] = [];

describe('CLI provider bootstrap across owners', () => {
  afterFixtureTest(() => {
    fixtureFilesystem = undefined;
  });
  afterEach(async () => {
    process.argv = originalArgv;
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('uses focused public provider imports at each CLI bootstrap and owner feature boundary', async () => {
    const files = [
      '../postConfigRuntime.ts',
      '../profileBootstrap.ts',
      '../../runtime/createRuntimeOwnerFeatures.ts',
      '../../ui/contexts/RuntimeContext.tsx',
    ];
    for (const file of files) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toContain(
        '@vybestack/llxprt-code-providers/runtime.js',
      );
    }
  });

  it('keeps same-label pre/post Config handles separate and reapplies CLI overrides after switching', async () => {
    const bootstraps = [];
    for (const [provider, model, key, contextLimit] of [
      ['openai', 'first-model', 'first-key', 100000],
      ['anthropic', 'second-model', 'second-key', 200000],
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), 'cli-provider-import-cut-'));
      roots.push(root);
      const settingsService = new SettingsService();
      const args = {
        profileName: null,
        profileJson: null,
        providerOverride: provider,
        modelOverride: model,
        keyOverride: key,
        keyfileOverride: null,
        keyNameOverride: null,
        baseurlOverride: null,
        setOverrides: [`context-limit=${contextLimit}`],
        debug: null,
      };
      const settingsOwner = new SessionSettingsOwner(settingsService);
      const runtimeState = await prepareRuntimeForProfile(
        parseBootstrapArgs(args, {
          runtimeId: 'shared-cli-label',
          credentialAuthority: new CredentialAuthority(),
          settingsService,
        }),
      );
      const foreground: {
        manager?: RuntimeProviderManager;
        activation?: AgentActivationOperation;
      } = {};
      bootstraps.push({
        foreground,
        provider,
        model,
        key,
        contextLimit,
        root,
        settingsService,
        settingsOwner,
        args,
        runtimeState,
      });
    }

    try {
      for (const item of bootstraps) {
        process.argv = [
          'bun',
          'llxprt',
          '--provider',
          item.provider,
          '--model',
          item.model,
          '--key',
          item.key,
          '--set',
          `context-limit=${item.contextLimit}`,
        ];
        const argv = await parseArguments({});
        const config = new Config({
          sessionId: `cli-${item.provider}`,
          debugMode: false,
          cwd: item.root,
          targetDir: item.root,
          model: item.model,
        });
        const trust = new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        });
        const filesystem = makeFixtureFilesystem({
          targetDir: item.root,
          isTrusted: () => trust.isTrustedFolder(),
        });
        await finalizeConfig({
          workspaceTrust: trust,
          trustCleanup: () => trust.dispose(),
          memory: assembleWorkspaceMemory(config, filesystem, trust),
          filesystem,
          config,
          runtimeState: item.runtimeState,
          bootstrapArgs: item.args,
          argv,
          settings: {},
          profileSettingsWithTools: {},
          profileLoadResult: {
            profileMergedSettings: createTestMergedSettings(),
            profileModel: undefined,
            profileProvider: undefined,
            profileModelParams: undefined,
            profileBaseUrl: undefined,
            loadedProfile: null,
            profileWarnings: [],
            profileToLoad: undefined,
          },
          providerModelResult: { provider: item.provider, model: item.model },
          defaultDisabledTools: [],
          runtimeOverrides: {
            credentialAuthority: new CredentialAuthority(),
            settingsService: item.settingsService,
            sessionSettingsOwner: item.settingsOwner,
            onProviderManagerReady: (manager) => {
              item.foreground.manager = manager;
            },
            onActivationBootstrapReady: (operation) => {
              item.foreground.activation = operation;
            },
          },
          approvalMode: ApprovalMode.YOLO,
          interactive: true,
        });
        const manager = item.foreground.manager;
        if (manager === undefined)
          throw new Error('Missing selected foreground manager');
        expect('registration' in item.runtimeState).toBe(false);
        expect('providerManager' in config).toBe(false);
        expect(item.settingsOwner.readNamedParameter('auth-key')).toBe(
          item.key,
        );
        expect(item.settingsOwner.readNamedParameter('context-limit')).toBe(
          item.contextLimit,
        );
        expect(
          createRuntimeOwnerFeatures(
            config,
            manager,
            fixturePaths().directories,
            async () => {
              throw new Error(
                'Unexpected model mutation in CLI import boundary test',
              );
            },
            item.settingsOwner,
            item.settingsService,
            definitionFixture(),
            {
              set: () => {
                throw new Error('Unexpected model parameter mutation');
              },
              clear: () => {
                throw new Error('Unexpected model parameter clear');
              },
            },
            assembleSettingsControl(
              item.settingsOwner.readNamedParameter.bind(item.settingsOwner),
              item.settingsOwner.captureNamedParameters.bind(
                item.settingsOwner,
              ),
              item.settingsOwner.writeUserParameter.bind(item.settingsOwner),
              item.settingsOwner.readSessionOverride.bind(item.settingsOwner),
              item.settingsOwner.writeSessionOverride.bind(item.settingsOwner),
              item.settingsOwner.clearSessionOverride.bind(item.settingsOwner),
              () => {},
              () => {},
            ),
            assembleToolFormatControl(
              item.settingsOwner.readToolFormat.bind(item.settingsOwner),
              item.settingsOwner.writeToolFormat.bind(item.settingsOwner),
              () => manager.getActiveProvider(),
              () => {},
              () => {},
            ),
            new SessionProviderReads(
              item.settingsOwner,
              manager,
              () => config.getModel(),
              (provider) => item.settingsService.getProviderSettings(provider),
            ),
          ).getActiveModelName(),
        ).toBe(item.model);
      }
      expect(bootstraps[0].foreground.manager).not.toBe(
        bootstraps[1].foreground.manager,
      );
      expect(
        bootstraps[0].settingsService.getProviderSettings('openai')['auth-key'],
      ).toBe('first-key');
      expect(
        bootstraps[1].settingsService.getProviderSettings('anthropic')[
          'auth-key'
        ],
      ).toBe('second-key');
      expect(bootstraps[0].foreground.activation?.messageBus).not.toBe(
        bootstraps[1].foreground.activation?.messageBus,
      );
    } finally {
      for (const item of bootstraps) {
        await item.foreground.activation?.dispose();
        await item.runtimeState.dispose();
        await item.settingsOwner.dispose();
      }
    }
  }, 30000);
});
