/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3379: `/skills reload` refreshed SkillManager but left the model's
 * view of the available skills frozen at whatever it was when the CLI started.
 * These tests pin the two steps that carry a reload through to the model:
 * rebuilding the skill activation tool, and pushing the refreshed tool
 * declarations into the live chat session.
 *
 * The mock harness mirrors config.d.test.ts so Config.initialize() can run
 * without touching the filesystem, git, telemetry or a real provider.
 */

import { describe, it, expect, vi } from 'bun:test';
import type { ConfigParameters } from './config.js';
import { Config } from './config.js';
import type { SkillDefinition } from '../skills/skillLoader.js';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import { initializeTestConfig } from '../test-utils/config.js';
import {
  buildFsMockBody,
  buildToolsMockBody,
  buildContentGeneratorMockBody,
  buildTelemetryMockBody,
  buildGitServiceMockBody,
  buildSettingsMockBody,
  buildIdeIntegrationMockBody,
  buildMemoryDiscoveryMockBody,
  buildEventsMockBody,
  buildFetchMockBody,
  type HoistedConfigMocks,
} from './configTestHarness.js';

// Hoisted mocks referenced by the mock factories below.
const hoistedConfigMocks = {
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
  setGlobalProxy: vi.fn(),
} as HoistedConfigMocks;
const __actual = { ...(await import('@vybestack/llxprt-code-mcp')) };
void vi.mock('@vybestack/llxprt-code-mcp', () => {
  const actual = __actual as Record<string, unknown>;
  return {
    ...actual,
    McpClientManager: vi.fn().mockImplementation(() => ({
      getMcpServers: vi.fn().mockReturnValue({}),
      getDiscoveryFailures: vi.fn().mockReturnValue(new Map<string, string>()),
      getDiscoveryState: vi.fn().mockReturnValue(MCPDiscoveryState.NOT_STARTED),
      whenDiscoverySettled: vi.fn().mockResolvedValue(undefined),
      restart: vi.fn().mockResolvedValue(undefined),
      restartServer: vi.fn().mockResolvedValue(undefined),
      reconcileConfiguredMcpServers: vi.fn().mockResolvedValue(undefined),
      getMcpInstructions: vi.fn().mockReturnValue(''),
      startConfiguredMcpServers: vi.fn().mockResolvedValue(undefined),
      onFolderTrustGained: vi.fn().mockResolvedValue(undefined),
      onFolderTrustRevoked: vi.fn().mockResolvedValue(undefined),
      quarantineForTrustRevocation: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

const __actual2 = { ...(await import('fs')) };
void vi.mock('fs', () => buildFsMockBody(__actual2));

const __actual3 = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () =>
  buildToolsMockBody(__actual3),
);

const __actual4 = { ...(await import('../core/contentGenerator.js')) };
void vi.mock('../core/contentGenerator.js', () =>
  buildContentGeneratorMockBody(__actual4),
);

void vi.mock('../telemetry/index.js', () => buildTelemetryMockBody());

void vi.mock('../services/gitService.js', () => buildGitServiceMockBody());

void vi.mock('@vybestack/llxprt-code-settings', () => buildSettingsMockBody());

const __actual5 = {
  ...(await import('@vybestack/llxprt-code-ide-integration')),
};
void vi.mock('@vybestack/llxprt-code-ide-integration', () =>
  buildIdeIntegrationMockBody(__actual5),
);

void vi.mock('../utils/memoryDiscovery.js', () =>
  buildMemoryDiscoveryMockBody(hoistedConfigMocks),
);

const __actual6 = { ...(await import('../utils/events.js')) };
void vi.mock('../utils/events.js', () =>
  buildEventsMockBody(__actual6, hoistedConfigMocks),
);

void vi.mock('../utils/fetch.js', () => buildFetchMockBody(hoistedConfigMocks));

/**
 * Issue #3379: the model only learns which skills exist from the skill
 * activation tool's declaration. Reloading skills has to rebuild that tool
 * and push the refreshed declarations into the live chat session, otherwise
 * a reloaded skill stays invisible to the model until the CLI restarts.
 */
describe('reloadSkills refreshes the model-facing skill surface @issue:3379', () => {
  interface RegistrarObservation {
    readonly skills: string[];
  }

  function skillDefinition(name: string): SkillDefinition {
    return {
      name,
      description: `${name} description`,
      location: `/skills/${name}/SKILL.md`,
      body: '',
      source: 'project',
    };
  }

  function buildParams(overrides: Partial<ConfigParameters>): ConfigParameters {
    return {
      sessionId: 'test-session',
      targetDir: '/tmp/test',
      debugMode: false,
      model: 'test-model',
      cwd: '/tmp/test',
      skillsSupport: true,
      ...overrides,
    };
  }

  it('rebuilds the activation tool from the post-reload skill set', async () => {
    const observations: RegistrarObservation[] = [];
    const config = new Config(
      buildParams({
        postSkillDiscoveryToolRegistrar: (_registry, skillService) => {
          observations.push({
            skills: skillService.listSkills().map((skill) => skill.name),
          });
        },
      }),
    );
    await initializeTestConfig(config);

    const skillManager = config.getSkillManager();
    vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);
    vi.spyOn(skillManager, 'getSkills').mockReturnValue([
      skillDefinition('alpha'),
      skillDefinition('beta'),
    ]);
    observations.length = 0;

    await config.reloadSkills();

    expect(observations).toEqual([{ skills: ['alpha', 'beta'] }]);
  });

  it('rebuilds the activation tool even when no skills remain', async () => {
    const observations: RegistrarObservation[] = [];
    const config = new Config(
      buildParams({
        postSkillDiscoveryToolRegistrar: (_registry, skillService) => {
          observations.push({
            skills: skillService.listSkills().map((skill) => skill.name),
          });
        },
      }),
    );
    await initializeTestConfig(config);

    const skillManager = config.getSkillManager();
    vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);
    vi.spyOn(skillManager, 'getSkills').mockReturnValue([]);
    observations.length = 0;

    await config.reloadSkills();

    expect(observations).toEqual([{ skills: [] }]);
  });

  it('does not rebuild the activation tool when skills support is off', async () => {
    const observations: RegistrarObservation[] = [];
    const config = new Config(
      buildParams({
        skillsSupport: false,
        postSkillDiscoveryToolRegistrar: (_registry, skillService) => {
          observations.push({
            skills: skillService.listSkills().map((skill) => skill.name),
          });
        },
      }),
    );
    await initializeTestConfig(config);

    const skillManager = config.getSkillManager();
    vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);

    await config.reloadSkills();

    expect(observations).toEqual([]);
  });

  it('pushes refreshed declarations to the chat session after rebuilding the tool', async () => {
    const sequence: string[] = [];
    const config = new Config(
      buildParams({
        postSkillDiscoveryToolRegistrar: () => {
          sequence.push('registrar');
        },
      }),
    );
    await initializeTestConfig(config);

    const skillManager = config.getSkillManager();
    vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);
    vi.spyOn(config.getAgentClient(), 'setTools').mockImplementation(
      async () => {
        sequence.push('setTools');
      },
    );
    sequence.length = 0;

    await config.reloadSkills();

    expect(sequence).toEqual(['registrar', 'setTools']);
  });

  it('completes without a chat session to refresh', async () => {
    const config = new Config(
      buildParams({
        postSkillDiscoveryToolRegistrar: () => {},
      }),
    );
    await initializeTestConfig(config);

    const skillManager = config.getSkillManager();
    vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);
    vi.spyOn(config.getAgentClient(), 'isInitialized').mockReturnValue(false);

    await expect(config.reloadSkills()).resolves.toBeUndefined();
  });

  it('propagates a rebuild failure instead of reporting a successful reload', async () => {
    let failOnRegister = false;
    const config = new Config(
      buildParams({
        postSkillDiscoveryToolRegistrar: () => {
          if (failOnRegister) {
            throw new Error('registration failed');
          }
        },
      }),
    );
    await initializeTestConfig(config);
    failOnRegister = true;

    const skillManager = config.getSkillManager();
    vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);

    await expect(config.reloadSkills()).rejects.toThrow('registration failed');
  });
});
