/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';

const mockGetBuiltinSkillsDir = vi.hoisted(() => vi.fn());

vi.mock('./skillLoader.js', (importOriginal) => {
  const actual = importOriginal() as typeof import('./skillLoader.js');
  mockGetBuiltinSkillsDir.mockImplementation(actual.getBuiltinSkillsDir);
  return {
    ...actual,
    loadSkillsFromDir: actual.loadSkillsFromDir,
    getBuiltinSkillsDir: mockGetBuiltinSkillsDir,
  };
});

const { SkillManager } = await import('./skillManager.js');

/**
 * Writes a SKILL.md file with valid YAML frontmatter into
 * `<base>/<skillDir>/SKILL.md`, creating the directories as needed.
 */
async function writeSkillFile(
  base: string,
  skillDir: string,
  name: string,
  description: string,
): Promise<void> {
  const dir = path.join(base, skillDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---
name: ${name}
description: ${description}
---
`,
  );
}

describe('SkillManager - .agents/skills alias discovery', () => {
  let testRootDir: string;

  beforeEach(async () => {
    testRootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skill-manager-alias-test-'),
    );
  });

  afterEach(async () => {
    await fs.rm(testRootDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('discovers a skill placed only in the user .agents/skills dir with source "user"', async () => {
    // Arrange: only the user agents dir has a skill; every other tier is empty.
    const userAgentDir = path.join(testRootDir, 'user-agents');
    await writeSkillFile(
      userAgentDir,
      'agent-only',
      'agent-only',
      'agents-user-desc',
    );

    vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue('/non-existent');
    vi.spyOn(Storage, 'getUserAgentSkillsDir').mockReturnValue(userAgentDir);
    mockGetBuiltinSkillsDir.mockReturnValue('/non-existent');

    const storage = new Storage('/dummy');
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue('/non-existent');
    vi.spyOn(storage, 'getProjectAgentSkillsDir').mockReturnValue(
      '/non-existent',
    );

    // Act
    const service = new SkillManager();
    vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(
      '/non-existent',
    );
    await service.discoverSkills(storage);

    // Assert
    const skill = service.getSkills().find((s) => s.name === 'agent-only');
    expect(skill).toBeDefined();
    expect(skill!.source).toBe('user');
    expect(skill!.description).toBe('agents-user-desc');
  });

  it('discovers a skill placed only in the project .agents/skills dir with source "project"', async () => {
    // Arrange: only the project agents dir has a skill.
    const projectAgentDir = path.join(testRootDir, 'project-agents');
    await writeSkillFile(
      projectAgentDir,
      'proj-agent-only',
      'proj-agent-only',
      'agents-project-desc',
    );

    vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue('/non-existent');
    vi.spyOn(Storage, 'getUserAgentSkillsDir').mockReturnValue('/non-existent');
    mockGetBuiltinSkillsDir.mockReturnValue('/non-existent');

    const storage = new Storage('/dummy');
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue('/non-existent');
    vi.spyOn(storage, 'getProjectAgentSkillsDir').mockReturnValue(
      projectAgentDir,
    );

    // Act
    const service = new SkillManager();
    vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(
      '/non-existent',
    );
    await service.discoverSkills(storage);

    // Assert
    const skill = service.getSkills().find((s) => s.name === 'proj-agent-only');
    expect(skill).toBeDefined();
    expect(skill!.source).toBe('project');
    expect(skill!.description).toBe('agents-project-desc');
  });

  it('at the user tier, .agents/skills overrides .llxprt/skills for the same skill name', async () => {
    // Arrange: same-named skill in BOTH user tiers; project tiers are empty.
    const userLlxprtDir = path.join(testRootDir, 'user-llxprt');
    const userAgentDir = path.join(testRootDir, 'user-agents');
    await writeSkillFile(userLlxprtDir, 'shared', 'shared', 'llxprt-user-desc');
    await writeSkillFile(userAgentDir, 'shared', 'shared', 'agents-user-desc');

    vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue(userLlxprtDir);
    vi.spyOn(Storage, 'getUserAgentSkillsDir').mockReturnValue(userAgentDir);
    mockGetBuiltinSkillsDir.mockReturnValue('/non-existent');

    const storage = new Storage('/dummy');
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue('/non-existent');
    vi.spyOn(storage, 'getProjectAgentSkillsDir').mockReturnValue(
      '/non-existent',
    );

    // Act
    const service = new SkillManager();
    vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(
      '/non-existent',
    );
    await service.discoverSkills(storage);

    // Assert: the .agents/skills version wins within the user tier.
    const skill = service.getSkills().find((s) => s.name === 'shared');
    expect(skill).toBeDefined();
    expect(skill!.description).toBe('agents-user-desc');
  });

  it('at the project tier, .agents/skills overrides .llxprt/skills for the same skill name', async () => {
    // Arrange: same-named skill in BOTH project tiers; a differently-named
    // user skill is also present to ensure the user tier still loads.
    const userLlxprtDir = path.join(testRootDir, 'user-llxprt');
    const userAgentDir = path.join(testRootDir, 'user-agents');
    const projectLlxprtDir = path.join(testRootDir, 'project-llxprt');
    const projectAgentDir = path.join(testRootDir, 'project-agents');

    await writeSkillFile(userLlxprtDir, 'other', 'other', 'other-user-desc');
    await writeSkillFile(
      projectLlxprtDir,
      'shared',
      'shared',
      'llxprt-project-desc',
    );
    await writeSkillFile(
      projectAgentDir,
      'shared',
      'shared',
      'agents-project-desc',
    );

    vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue(userLlxprtDir);
    vi.spyOn(Storage, 'getUserAgentSkillsDir').mockReturnValue(userAgentDir);
    mockGetBuiltinSkillsDir.mockReturnValue('/non-existent');

    const storage = new Storage('/dummy');
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue(projectLlxprtDir);
    vi.spyOn(storage, 'getProjectAgentSkillsDir').mockReturnValue(
      projectAgentDir,
    );

    // Act
    const service = new SkillManager();
    vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(
      '/non-existent',
    );
    await service.discoverSkills(storage);

    // Assert: the project .agents/skills version wins within the project tier,
    // and the unrelated user skill is still discovered.
    const skills = service.getSkills();
    const shared = skills.find((s) => s.name === 'shared');
    expect(shared).toBeDefined();
    expect(shared!.description).toBe('agents-project-desc');

    const other = skills.find((s) => s.name === 'other');
    expect(other).toBeDefined();
    expect(other!.source).toBe('user');
  });

  it('preserves cross-tier precedence: a .llxprt/skills project skill overrides a .agents/skills user skill', async () => {
    // Arrange: the user tier has a .agents/skills skill; the project tier has
    // a same-named .llxprt/skills skill. Project must win over user regardless
    // of which alias each comes from.
    const userAgentDir = path.join(testRootDir, 'user-agents');
    const projectLlxprtDir = path.join(testRootDir, 'project-llxprt');

    await writeSkillFile(userAgentDir, 'cross', 'cross', 'agents-user-desc');
    await writeSkillFile(
      projectLlxprtDir,
      'cross',
      'cross',
      'llxprt-project-desc',
    );

    vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue('/non-existent');
    vi.spyOn(Storage, 'getUserAgentSkillsDir').mockReturnValue(userAgentDir);
    mockGetBuiltinSkillsDir.mockReturnValue('/non-existent');

    const storage = new Storage('/dummy');
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue(projectLlxprtDir);
    vi.spyOn(storage, 'getProjectAgentSkillsDir').mockReturnValue(
      '/non-existent',
    );

    // Act
    const service = new SkillManager();
    vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(
      '/non-existent',
    );
    await service.discoverSkills(storage);

    // Assert: project tier (even via .llxprt/skills) beats user tier.
    const skill = service.getSkills().find((s) => s.name === 'cross');
    expect(skill).toBeDefined();
    expect(skill!.description).toBe('llxprt-project-desc');
    expect(skill!.source).toBe('project');
  });

  it('preserves cross-tier precedence: a .agents/skills project skill overrides a .llxprt/skills user skill', async () => {
    // Arrange: the user tier has a .llxprt/skills skill; the project tier has
    // a same-named .agents/skills skill. Project must win over user regardless
    // of which alias each comes from.
    const userLlxprtDir = path.join(testRootDir, 'user-llxprt');
    const projectAgentDir = path.join(testRootDir, 'project-agents');

    await writeSkillFile(userLlxprtDir, 'cross', 'cross', 'llxprt-user-desc');
    await writeSkillFile(
      projectAgentDir,
      'cross',
      'cross',
      'agents-project-desc',
    );

    vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue(userLlxprtDir);
    vi.spyOn(Storage, 'getUserAgentSkillsDir').mockReturnValue('/non-existent');
    mockGetBuiltinSkillsDir.mockReturnValue('/non-existent');

    const storage = new Storage('/dummy');
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue('/non-existent');
    vi.spyOn(storage, 'getProjectAgentSkillsDir').mockReturnValue(
      projectAgentDir,
    );

    // Act
    const service = new SkillManager();
    vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(
      '/non-existent',
    );
    await service.discoverSkills(storage);

    // Assert: project tier (even via .agents/skills) beats user tier.
    const skill = service.getSkills().find((s) => s.name === 'cross');
    expect(skill).toBeDefined();
    expect(skill!.description).toBe('agents-project-desc');
    expect(skill!.source).toBe('project');
  });
});
