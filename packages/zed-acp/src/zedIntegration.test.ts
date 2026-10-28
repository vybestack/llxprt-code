import type { Agent } from '@vybestack/llxprt-code-agents';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
  vi,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useFakeResponsesReplay } from '../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { CredentialAuthority } from '../../providers/src/auth/proxy/credential-store-factory.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  captureZedHostInputs,
  captureZedSessionParameters,
} from './zed-session-agent.js';
import { unusedProfileApplication } from './test-profile-application.js';
import {
  ZedAgent as ZedAgentType,
  parseZedAuthMethodId,
} from './zedIntegration.js';
import { installZedDefinitionFixture } from './__tests__/definition-fixture.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { MCP_SESSION_APPROVAL_SOURCE } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const createFilesystem = installTestWorkspaceFilesystem();

const definitionFixture = installZedDefinitionFixture();

const mockCreateAgent = vi.fn();

const actual = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...actual,
  createAgentFromSettingsSnapshot: (
    ...args: Parameters<typeof actual.createAgentFromSettingsSnapshot>
  ) => mockCreateAgent(...args),
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
    const first = new Config(
      captureZedSessionParameters(
        base,
        'first-session',
        join(projectRoot, 'first'),
        captureZedHostInputs(base),
      ),
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
    const second = new Config(
      captureZedSessionParameters(
        base,
        'second-session',
        join(projectRoot, 'second'),
        captureZedHostInputs(base),
      ),
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
    mockCreateAgent.mockImplementation(actual.createAgentFromSettingsSnapshot);
  });

  it('creates independent Agent sessions with session-scoped configs', async () => {
    const capturedAgents: Agent[] = [];
    mockCreateAgent.mockImplementation(
      async (
        ...args: Parameters<typeof actual.createAgentFromSettingsSnapshot>
      ) => {
        const agent = await actual.createAgentFromSettingsSnapshot(...args);
        capturedAgents.push(agent);
        return agent;
      },
    );
    const baseConfig = new Config({
      sessionId: 'base',
      targetDir: projectRoot,
      cwd: projectRoot,
      model: 'test-model',
      provider: 'openai',
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
      () => new SettingsService({ sessionSource: settingsService }),
      undefined,
      definitionFixture(),
      undefined,
      { credentialAuthority: new CredentialAuthority() },
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
    expect(capturedAgents).toHaveLength(2);
    expect(capturedAgents[0].session.getSessionId()).toBe(
      firstSession.sessionId,
    );
    expect(capturedAgents[1].session.getSessionId()).toBe(
      secondSession.sessionId,
    );
    expect(capturedAgents[0].session.getSessionId()).not.toBe(
      capturedAgents[1].session.getSessionId(),
    );

    expect(capturedAgents[0].workspace.getWorkingDirectory()).toBe(
      join(projectRoot, 'first'),
    );
    expect(capturedAgents[1].workspace.getWorkingDirectory()).toBe(
      join(projectRoot, 'second'),
    );
    await capturedAgents[0].setProvider('anthropic', 'session-first-model');
    expect(capturedAgents[0].getProvider()).toBe('anthropic');
    expect(capturedAgents[1].getProvider()).not.toBe('anthropic');
    expect('providerManager' in baseConfig).toBe(false);
    expect(
      await capturedAgents[0].workspace.readTextFile(
        join(projectRoot, 'first', 'x'),
      ),
    ).toBe('client');
    expect(
      await capturedAgents[1].workspace.readTextFile(
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

  useFakeResponsesReplay('plain-text.jsonl');

  const builtCredentials = useOwnedCredentials();

  /** The selected model, read from the test-owned settings the preflight uses. */
  function selectedModel(settings: SettingsService): unknown {
    const provider = settings.get('activeProvider');
    if (typeof provider !== 'string') return undefined;
    return settings.getProviderSettings(provider).model;
  }

  let route: RouteBPreflight;
  let profiles: ProfileManager;
  let root: string;
  let agent: ZedAgentType;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'llxprt-zed-profile-owner-'));
    route = await openRouteBPreflight({
      authority: builtCredentials().authority,
      config: {
        workingDir: root,
        settings: { profileDirectory: join(root, 'profiles') },
      },
    });
    await route.prepare();
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
    const { ZedAgent } = await import('./zedIntegration.js');
    agent = new ZedAgent(
      route.config,
      undefined as never,
      route.preflight,
      () => {
        const session = new SettingsService();
        session.restoreFromStateSnapshot(
          route.preflight.captureSettingsSnapshot(),
        );
        return session;
      },
      undefined,
      { listProfiles: () => route.preflight.listProfiles() },
    );
  });

  afterEach(async () => {
    await route.close();
    await rm(root, { recursive: true, force: true });
  });

  it('loads profile when switching to a different profile', async () => {
    await agent.authenticate({ methodId: 'alpha' });
    await agent.authenticate({ methodId: 'beta' });

    expect(route.preflight.getCurrentProfileName()).toBe('beta');
    expect(selectedModel(route.settings)).toBe('beta-model');
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

    expect(route.preflight.getCurrentProfileName()).toBe('alpha');
    expect(selectedModel(route.settings)).toBe('updated-model');
  });

  it('loads profile when no active profile exists', async () => {
    expect(route.preflight.getCurrentProfileName()).toBeNull();
    await agent.authenticate({ methodId: 'alpha' });

    expect(route.preflight.getCurrentProfileName()).toBe('alpha');
    expect(selectedModel(route.settings)).toBe('alpha-model');
  });
});
