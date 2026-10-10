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
          settingsService,
        }),
      );
      bootstraps.push({
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
            settingsService: item.settingsService,
            sessionSettingsOwner: item.settingsOwner,
            onActivationBootstrapReady: (operation) => {
              operation.takeSettingsOwner(item.settingsService);
            },
          },
          approvalMode: ApprovalMode.YOLO,
          interactive: true,
        });
        expect(item.runtimeState.registration?.config).toBe(config);
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
            item.runtimeState.providerManager,
            fixturePaths().directories,
            async () => {
              throw new Error(
                'Unexpected model mutation in CLI import boundary test',
              );
            },
            item.settingsOwner,
            item.settingsService,
            definitionFixture(),
          ).getActiveModelName(),
        ).toBe(item.model);
      }
      expect(bootstraps[0].runtimeState.providerManager).not.toBe(
        bootstraps[1].runtimeState.providerManager,
      );
      expect(
        bootstraps[0].settingsService.getProviderSettings('openai')['auth-key'],
      ).toBe('first-key');
      expect(
        bootstraps[1].settingsService.getProviderSettings('anthropic')[
          'auth-key'
        ],
      ).toBe('second-key');
      expect(bootstraps[0].runtimeState.runtimeMessageBus).not.toBe(
        bootstraps[1].runtimeState.runtimeMessageBus,
      );
    } finally {
      for (const item of bootstraps) {
        item.runtimeState.registration?.dispose();
        await item.settingsOwner.dispose();
      }
    }
  }, 30000);
});
