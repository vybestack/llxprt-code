/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3383: extension-contributed skills are one of the sources
 * SkillManager reads, but ExtensionLoader reconciled MCP servers, subagents and
 * memory on load/unload without ever rediscovering skills. So an extension that
 * ships skills left both the discovered set and the model-facing activation
 * tool stale until someone ran `/skills reload`.
 *
 * These tests assert on the discovered skill set and on what the activation
 * tool was rebuilt from. That the rebuilt tool then reaches the provider
 * request is covered end to end in the agents package, in
 * skillReloadDeclaration.behavior.test.ts.
 *
 * The mock harness mirrors config.d.test.ts so Config.initialize() can run
 * without touching the filesystem, git, telemetry or a real provider.
 */

import { describe, it, expect, vi, type Mock } from 'bun:test';
import { Config } from './config.js';
import type { SkillDefinition } from '../skills/skillLoader.js';
import type { LlxprtExtension } from './configTypes.js';
import { SimpleExtensionLoader } from '../utils/extensionLoader.js';
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
      // ExtensionLoader drives these on every load/unload.
      startExtension: vi.fn().mockResolvedValue(undefined),
      stopExtension: vi.fn().mockResolvedValue(undefined),
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

interface RegistrarObservation {
  readonly skills: string[];
}

function extensionSkill(name: string): SkillDefinition {
  return {
    name,
    description: `The ${name} skill`,
    location: `memory://${name}/SKILL.md`,
    body: `${name} instructions`,
    source: 'extension',
  };
}

function skillExtension(
  name: string,
  skills: SkillDefinition[],
): LlxprtExtension {
  return {
    name,
    version: '1.0.0',
    isActive: true,
    path: `memory://${name}`,
    contextFiles: [],
    skills,
  };
}

interface Harness {
  readonly config: Config;
  readonly loader: SimpleExtensionLoader;
  readonly observations: RegistrarObservation[];
}

async function buildHarness(
  extensions: LlxprtExtension[] = [],
): Promise<Harness> {
  const observations: RegistrarObservation[] = [];
  const loader = new SimpleExtensionLoader(extensions);
  const config = new Config({
    sessionId: 'test-session',
    targetDir: '/tmp/test',
    debugMode: false,
    model: 'test-model',
    cwd: '/tmp/test',
    skillsSupport: true,
    enableExtensionReloading: true,
    extensionLoader: loader,
    postSkillDiscoveryToolRegistrar: (_registry, skillService) => {
      observations.push({
        skills: skillService.listSkills().map((skill) => skill.name),
      });
    },
  });
  await initializeTestConfig(config);
  // Real discovery would walk the filesystem for builtin/user/project skills;
  // the extension tier is the one under test, so only that is left live.
  vi.spyOn(config.getSkillManager(), 'discoverBuiltinSkills').mockResolvedValue(
    [],
  );
  observations.length = 0;
  return { config, loader, observations };
}

/** The most recent skill list the activation tool was rebuilt from. */
function lastRebuiltFrom(observations: RegistrarObservation[]): string[] {
  if (observations.length === 0) {
    throw new Error('the activation tool was never rebuilt');
  }
  return observations[observations.length - 1].skills;
}

function discoveredSkillNames(config: Config): string[] {
  return config
    .getSkillManager()
    .getSkills()
    .map((skill) => skill.name)
    .sort();
}

describe('extension load and unload refresh the skill surface @issue:3383', () => {
  it('discovers the skills an extension brings when it is loaded', async () => {
    const { config, loader, observations } = await buildHarness();

    await loader.loadExtension(
      skillExtension('pack', [extensionSkill('alpha')]),
    );

    expect(discoveredSkillNames(config)).toContain('alpha');
    expect(lastRebuiltFrom(observations)).toContain('alpha');
  });

  it('drops the skills an extension brought when it is unloaded', async () => {
    const extension = skillExtension('pack', [extensionSkill('alpha')]);
    const { config, loader, observations } = await buildHarness([extension]);
    expect(discoveredSkillNames(config)).toContain('alpha');

    await loader.unloadExtension(extension);

    expect(discoveredSkillNames(config)).not.toContain('alpha');
    expect(lastRebuiltFrom(observations)).not.toContain('alpha');
  });

  it('leaves the skill surface alone for an extension that ships no skills', async () => {
    const { loader, observations } = await buildHarness();

    await loader.loadExtension(skillExtension('no-skills', []));

    // Rediscovery is not free, so an extension with nothing to contribute must
    // not trigger one.
    expect(observations).toStrictEqual([]);
  });

  it('leaves the skill available after a restart', async () => {
    const extension = skillExtension('pack', [extensionSkill('alpha')]);
    const { config, observations } = await buildHarness([extension]);

    await config.getExtensionLoader().restartExtension(extension);

    expect(discoveredSkillNames(config)).toContain('alpha');
    // restartExtension awaits the stop before the start, so each transition
    // settles on its own and rediscovery runs twice; batching collapses
    // concurrent transitions, not sequential ones. The skill stays available
    // throughout, because a restart leaves the extension in the loader's list
    // and still active. Only unloadExtension removes it.
    expect(observations).toHaveLength(2);
    for (const observation of observations) {
      expect(observation.skills).toContain('alpha');
    }
  });

  it('still reconciles after a failed load, on the next transition', async () => {
    const { config, loader, observations } = await buildHarness();
    const manager = config.getMcpClientManager() as unknown as {
      startExtension: Mock<(extension: LlxprtExtension) => Promise<void>>;
    };
    manager.startExtension.mockRejectedValueOnce(new Error('mcp exploded'));

    // loadExtension adds to the collection before starting, so the skill is
    // already discoverable even though the transition failed.
    await expect(
      loader.loadExtension(skillExtension('pack', [extensionSkill('alpha')])),
    ).rejects.toThrow('mcp exploded');

    await loader.loadExtension(skillExtension('other', []));

    expect(discoveredSkillNames(config)).toContain('alpha');
    expect(lastRebuiltFrom(observations)).toContain('alpha');
  });

  it('retries on the next transition when the refresh itself fails', async () => {
    const { config, loader, observations } = await buildHarness();
    vi.spyOn(config, 'refreshSkills').mockRejectedValueOnce(
      new Error('discovery exploded'),
    );

    await expect(
      loader.loadExtension(skillExtension('pack', [extensionSkill('alpha')])),
    ).rejects.toThrow('discovery exploded');
    expect(observations).toStrictEqual([]);

    await loader.loadExtension(skillExtension('other', []));

    // The second extension ships no skills, so only the retained marker from
    // the failed refresh can explain a rebuild happening here.
    expect(lastRebuiltFrom(observations)).toContain('alpha');
  });

  it('rediscovers once for a batch of concurrent loads', async () => {
    const { config, loader, observations } = await buildHarness();

    await Promise.all([
      loader.loadExtension(skillExtension('one', [extensionSkill('alpha')])),
      loader.loadExtension(skillExtension('two', [extensionSkill('beta')])),
    ]);

    expect(discoveredSkillNames(config)).toStrictEqual(['alpha', 'beta']);
    expect(observations).toHaveLength(1);
  });
});
