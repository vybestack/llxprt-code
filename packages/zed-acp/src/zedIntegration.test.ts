/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { captureZedHostInputs } from './zed-session-agent.js';
const createFilesystem = installTestWorkspaceFilesystem();
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { unusedProfileApplication } from './test-profile-application.js';

import type { ZedAgent as ZedAgentType } from './zedIntegration.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { installZedDefinitionFixture } from './__tests__/definition-fixture.js';
const definitionFixture = installZedDefinitionFixture();
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { createZedSessionConfig } from './zed-session-agent.js';
import {
  buildCliStyleConfig,
  type BuiltCliConfig,
} from '../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { parseZedAuthMethodId } from './zedIntegration.js';
import { ApprovalMode, Config } from '@vybestack/llxprt-code-core';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { MCP_SESSION_APPROVAL_SOURCE } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';

const mockFromConfig = vi.fn();

const actual = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...actual,
  fromConfig: (...args: unknown[]) => mockFromConfig(...args),
}));

describe('zedIntegration auth method validation', () => {
  it('accepts known profile names', () => {
    expect(parseZedAuthMethodId('alpha', ['alpha', 'beta'])).toBe('alpha');
    expect(parseZedAuthMethodId('beta', ['alpha', 'beta'])).toBe('beta');
  });

  it('rejects unknown profile names', () => {
    expect(() => parseZedAuthMethodId('gamma', ['alpha', 'beta'])).toThrow(
      /Invalid enum value/,
    );
  });

  it('rejects selection when no profiles exist', () => {
    expect(() => parseZedAuthMethodId('alpha', [])).toThrow(
      /No profiles available for selection/,
    );
  });
});

describe('Zed session composition', () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'zed-filesystem-composition-'));
    await Promise.all(
      ['first', 'second'].map((name) => mkdir(join(projectRoot, name))),
    );
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  it('copies declarative host settings into independently owned Configs', async () => {
    const base = new Config({
      sessionId: 'base',
      targetDir: projectRoot,
      cwd: projectRoot,
      model: 'base-model',
      provider: 'fake',
      debugMode: false,
      coreTools: ['read_file'],
      mcpServers: { later: { command: 'echo' } },
      policyEngineConfig: {
        rules: [
          {
            toolName: 'host-rule',
            decision: PolicyDecision.DENY,
            source: 'host-policy',
          },
        ],
      },
    });
    const basePolicy = new RuntimePolicyOwner(base);
    const firstFileSystemService = {
      readTextFile: async () => 'first',
      writeTextFile: async () => undefined,
    };
    const secondFileSystemService = {
      readTextFile: async () => 'second',
      writeTextFile: async () => undefined,
    };
    const baseSettings = new SettingsService();
    baseSettings.set('fixture-marker', 'before');
    base.setApprovalMode(ApprovalMode.AUTO_EDIT);
    basePolicy.session.confirmation.addRule({
      toolName: 'session-only',
      decision: PolicyDecision.ALLOW,
      source: MCP_SESSION_APPROVAL_SOURCE,
    });
    const first = createZedSessionConfig(
      base,
      'first-session',
      join(projectRoot, 'first'),
      captureZedHostInputs(base),
    );
    const firstRoot = createFilesystem({
      targetDir: first.getTargetDir(),
      isTrusted: () => true,
      fileSystem: { service: firstFileSystemService, ownership: 'caller' },
    });
    const firstPolicy = new RuntimePolicyOwner(first);
    const firstSettings = new SettingsService({ sessionSource: baseSettings });
    firstSettings.restoreFromStateSnapshot(
      baseSettings.exportForStateSnapshot(),
    );
    baseSettings.set('fixture-marker', 'after');
    const second = createZedSessionConfig(
      base,
      'second-session',
      join(projectRoot, 'second'),
      captureZedHostInputs(base),
    );
    const secondRoot = createFilesystem({
      targetDir: second.getTargetDir(),
      isTrusted: () => true,
      fileSystem: { service: secondFileSystemService, ownership: 'caller' },
    });
    const secondPolicy = new RuntimePolicyOwner(second);
    const secondSettings = new SettingsService({ sessionSource: baseSettings });
    secondSettings.restoreFromStateSnapshot(
      baseSettings.exportForStateSnapshot(),
    );
    try {
      expect(first).toBeInstanceOf(Config);
      expect('createSessionConfig' in base).toBe(false);
      expect(second).toBeInstanceOf(Config);
      expect(first.getTargetDir()).toBe(join(projectRoot, 'first'));
      expect(second.getTargetDir()).toBe(join(projectRoot, 'second'));
      expect(
        await firstRoot.files.readTextFile(join(first.getTargetDir(), 'text')),
      ).not.toBe(
        await secondRoot.files.readTextFile(
          join(second.getTargetDir(), 'text'),
        ),
      );
      expect('getFileSystemService' in first).toBe(false);
      expect(firstSettings.get('fixture-marker')).toBe('before');
      expect(secondSettings.get('fixture-marker')).toBe('after');
      expect(firstSettings).not.toBe(baseSettings);
      expect(firstPolicy.session.decisions).not.toBe(
        secondPolicy.session.decisions,
      );
      expect(firstPolicy.session.inspection.getRules()).toStrictEqual([
        expect.objectContaining({ source: 'host-policy' }),
      ]);
      expect(first.getCoreTools()).toStrictEqual(['read_file']);
      expect(first.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);
      expect(first.getMcpServers()).toStrictEqual({
        later: { command: 'echo' },
      });
      expect(first.projectChatsDir).toBe(base.projectChatsDir);
    } finally {
      await Promise.all([first.dispose(), second.dispose(), base.dispose()]);
    }
  });
});

describe('ZedAgent.newSession', () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'zed-filesystem-sessions-'));
    await Promise.all(
      ['first', 'second'].map((name) => mkdir(join(projectRoot, name))),
    );
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  afterEach(() => {
    mockFromConfig.mockImplementation(actual.fromConfig);
  });

  it('creates independent Agent sessions with session-scoped configs', async () => {
    const capturedConfigs: Config[] = [];
    const capturedManagers: ProviderManager[] = [];
    const capturedOptions: Array<{
      config: Config;
      settingsService: SettingsService;
      sessionId?: string;
      filesystemOwner: WorkspaceFilesystemOwner;
    }> = [];
    mockFromConfig.mockImplementation(
      async (options: {
        config: Config;
        settingsService: SettingsService;
        sessionId?: string;
        filesystemOwner: WorkspaceFilesystemOwner;
      }) => {
        capturedOptions.push(options);
        capturedConfigs.push(options.config);
        const providerManager = new ProviderManager({
          config: options.config,
          settingsService: options.settingsService,
        });
        capturedManagers.push(providerManager);
        return {
          providerManager,
          getApprovalMode: () => 'default',
          setApprovalMode: vi.fn(),
          dispose: vi.fn().mockResolvedValue(undefined),
          async *stream() {},
          session: {
            getRecordingTitle: () => undefined,
            recordRecordingTitle: async () => undefined,
          },
          tools: { respondToConfirmation: vi.fn() },
        };
      },
    );
    const baseConfig = new Config({
      sessionId: 'base',
      targetDir: projectRoot,
      cwd: projectRoot,
      model: 'test-model',
      debugMode: false,
    });
    const settingsService = new SettingsService();
    const connection = {
      readTextFile: vi.fn(async (_params: { sessionId: string }) => ({
        content: 'client',
      })),
      writeTextFile: vi.fn(async () => undefined),
      sessionUpdate: vi.fn(async () => undefined),
    };
    const mod = await import('./zedIntegration.js');
    const zedAgent = new mod.ZedAgent(
      baseConfig,
      connection as never,
      unusedProfileApplication,
      new ProviderManager({
        config: baseConfig,
        settingsService,
      }),
      () => new SettingsService({ sessionSource: settingsService }),
      undefined,
      definitionFixture(),
    );

    await zedAgent.initialize({
      protocolVersion: '1',
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    } as never);
    const firstSession = await zedAgent.newSession({
      cwd: join(projectRoot, 'first'),
    } as never);
    const secondSession = await zedAgent.newSession({
      cwd: join(projectRoot, 'second'),
    } as never);
    expect(capturedOptions).toHaveLength(2);
    expect(capturedOptions[0].sessionId).toBe(firstSession.sessionId);
    expect(capturedOptions[1].sessionId).toBe(secondSession.sessionId);
    expect(capturedOptions[0].sessionId).not.toBe(capturedOptions[1].sessionId);
    expect('providerManager' in capturedConfigs[0]).toBe(false);
    expect('providerManager' in capturedConfigs[1]).toBe(false);

    expect(capturedConfigs).toHaveLength(2);
    expect(capturedConfigs[0]).not.toBe(capturedConfigs[1]);
    expect(capturedConfigs[0].getTargetDir()).toBe(join(projectRoot, 'first'));
    expect(capturedConfigs[1].getTargetDir()).toBe(join(projectRoot, 'second'));
    expect(capturedManagers).toHaveLength(2);
    expect(capturedManagers[0]).not.toBe(capturedManagers[1]);
    capturedOptions[0].settingsService.set('activeProvider', 'session-first');
    expect(capturedManagers[0].getActiveProviderName()).toBe('session-first');
    expect(capturedManagers[1].getActiveProviderName()).not.toBe(
      'session-first',
    );
    expect(capturedOptions[0].config).not.toBe(capturedOptions[1].config);
    expect('providerManager' in baseConfig).toBe(false);
    expect(
      await capturedOptions[0].filesystemOwner.files.readTextFile(
        join(projectRoot, 'first', 'x'),
      ),
    ).toBe('client');
    expect(
      await capturedOptions[1].filesystemOwner.files.readTextFile(
        join(projectRoot, 'second', 'x'),
      ),
    ).toBe('client');
    const firstRead = connection.readTextFile.mock.calls[0];
    const secondRead = connection.readTextFile.mock.calls[1];
    expect(firstRead).toBeDefined();
    expect(secondRead).toBeDefined();
    expect(firstRead[0].sessionId).not.toBe(secondRead[0].sessionId);
  });
});

describe('ZedAgent.authenticate credential cache', () => {
  let built: BuiltCliConfig;
  let profiles: ProfileManager;
  let root: string;
  let agent: ZedAgentType;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'llxprt-zed-profile-owner-'));
    built = await buildCliStyleConfig('plain-text.jsonl', {
      workingDir: root,
      settings: { profileDirectory: join(root, 'profiles') },
    });
    profiles = new ProfileManager(join(root, 'profiles'));
    for (const name of ['alpha', 'beta']) {
      await profiles.saveProfile(name, {
        version: 1,
        provider: 'fake',
        model: `${name}-model`,
        modelParams: {},
        ephemeralSettings: {},
      });
    }
    const config = built.config;
    const manager = built.providerManager;

    const application = actual.assembleProfileApplication(
      config,
      built.settingsService,
      manager,
      null,
      actual.assembleProviderSwitch(
        config,
        built.settingsService,
        manager,
        null,
        () => undefined,
        () => built.sessionClient.refreshAuth(),
        built.settingsOwner,
      ),
      built.settingsOwner,
      profiles,
    );
    const { ZedAgent } = await import('./zedIntegration.js');
    agent = new ZedAgent(
      config,
      undefined as never,
      application,
      manager,
      () => built.settingsOwner.createChildStore(),
      undefined,
      built.mcpRuntime.profileDefinitions,
    );
  });

  afterEach(async () => {
    await built.cleanup();
    await rm(root, { recursive: true, force: true });
  });

  it('loads profile when switching to a different profile', async () => {
    await agent.authenticate({ methodId: 'alpha' });
    await agent.authenticate({ methodId: 'beta' });

    expect(built.settingsService.getCurrentProfileName()).toBe('beta');
    expect(built.settingsOwner.readSelectedModel()).toBe('beta-model');
  });

  it('loads profile when re-authenticating same profile', async () => {
    await agent.authenticate({ methodId: 'alpha' });
    await profiles.saveProfile('alpha', {
      version: 1,
      provider: 'fake',
      model: 'updated-model',
      modelParams: {},
      ephemeralSettings: {},
    });
    await agent.authenticate({ methodId: 'alpha' });

    expect(built.settingsService.getCurrentProfileName()).toBe('alpha');
    expect(built.settingsOwner.readSelectedModel()).toBe('updated-model');
  });

  it('loads profile when no active profile exists', async () => {
    expect(built.settingsService.getCurrentProfileName()).toBeNull();
    await agent.authenticate({ methodId: 'alpha' });

    expect(built.settingsService.getCurrentProfileName()).toBe('alpha');
    expect(built.settingsOwner.readSelectedModel()).toBe('alpha-model');
  });
});
