/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillManager } from './skillManager.js';
import { Storage } from '../config/storage.js';
import type { GeminiCLIExtension } from '../config/config.js';
import {
  loadSkillsFromDir,
  getBuiltinSkillsDir,
  type SkillDefinition,
} from './skillLoader.js';

vi.mock('./skillLoader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./skillLoader.js')>();
  return {
    ...actual,
    loadSkillsFromDir: vi.fn(actual.loadSkillsFromDir),
    getBuiltinSkillsDir: vi.fn(actual.getBuiltinSkillsDir),
  };
});

describe('SkillManager', () => {
  let testRootDir: string;

  beforeEach(async () => {
    testRootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skill-manager-test-'),
    );
  });

  afterEach(async () => {
    await fs.rm(testRootDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should discover skills from built-in, extensions, user, and project with precedence', async () => {
    const userDir = path.join(testRootDir, 'user');
    const projectDir = path.join(testRootDir, 'project');
    await fs.mkdir(path.join(userDir, 'skill-a'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'skill-b'), { recursive: true });

    await fs.writeFile(
      path.join(userDir, 'skill-a', 'SKILL.md'),
      `---
name: skill-user
description: user-desc
---
`,
    );
    await fs.writeFile(
      path.join(projectDir, 'skill-b', 'SKILL.md'),
      `---
name: skill-project
description: project-desc
---
`,
    );

    const mockExtension: GeminiCLIExtension = {
      name: 'test-ext',
      version: '1.0.0',
      isActive: true,
      path: '/ext',
      contextFiles: [],
      id: 'ext-id',
      skills: [
        {
          name: 'skill-extension',
          description: 'ext-desc',
          location: '/ext/skills/SKILL.md',
          body: 'body',
        },
      ],
    };

    vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue(userDir);
    const storage = new Storage('/dummy');
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue(projectDir);
    vi.mocked(getBuiltinSkillsDir).mockReturnValue('/non-existent');

    const service = new SkillManager();
    await service.discoverSkills(storage, [mockExtension]);

    const skills = service.getSkills();
    // At least 3 skills (extension, user, project). Built-in may or may not exist.
    expect(skills.length).toBeGreaterThanOrEqual(3);
    const names = skills.map((s) => s.name);
    expect(names).toContain('skill-extension');
    expect(names).toContain('skill-user');
    expect(names).toContain('skill-project');
  });

  it('should respect precedence: Project > User > Extension > Built-in', async () => {
    const userDir = path.join(testRootDir, 'user');
    const projectDir = path.join(testRootDir, 'project');
    await fs.mkdir(path.join(userDir, 'skill'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'skill'), { recursive: true });

    await fs.writeFile(
      path.join(userDir, 'skill', 'SKILL.md'),
      `---
name: same-name
description: user-desc
---
`,
    );
    await fs.writeFile(
      path.join(projectDir, 'skill', 'SKILL.md'),
      `---
name: same-name
description: project-desc
---
`,
    );

    const mockExtension: GeminiCLIExtension = {
      name: 'test-ext',
      version: '1.0.0',
      isActive: true,
      path: '/ext',
      contextFiles: [],
      id: 'ext-id',
      skills: [
        {
          name: 'same-name',
          description: 'ext-desc',
          location: '/ext/skills/SKILL.md',
          body: 'body',
        },
      ],
    };

    vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue(userDir);
    const storage = new Storage('/dummy');
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue(projectDir);
    vi.mocked(getBuiltinSkillsDir).mockReturnValue('/non-existent');

    const service = new SkillManager();
    await service.discoverSkills(storage, [mockExtension]);

    const skills = service.getSkills();
    const sameNameSkill = skills.find((s) => s.name === 'same-name');
    expect(sameNameSkill).toBeDefined();
    expect(sameNameSkill!.description).toBe('project-desc');

    // Test User > Extension
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue('/non-existent');
    await service.discoverSkills(storage, [mockExtension]);
    const userSkill = service.getSkills().find((s) => s.name === 'same-name');
    expect(userSkill!.description).toBe('user-desc');
  });

  it('should discover built-in skills', async () => {
    const service = new SkillManager();
    const mockBuiltinSkill: SkillDefinition = {
      name: 'builtin-skill',
      description: 'builtin-desc',
      location: 'builtin-loc',
      body: 'builtin-body',
      source: 'builtin',
    };

    vi.mocked(loadSkillsFromDir).mockImplementation(async (_dir, source) => {
      if (source === 'builtin') {
        return [{ ...mockBuiltinSkill }];
      }
      return [];
    });

    const storage = new Storage('/dummy');
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue('/non-existent');
    vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue('/non-existent');

    await service.discoverSkills(storage);

    const skills = service.getSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('builtin-skill');
    expect(skills[0].source).toBe('builtin');
  });

  it('should filter disabled skills in getSkills but not in getAllSkills', async () => {
    const skillDir = path.join(testRootDir, 'skill1');
    await fs.mkdir(skillDir, { recursive: true });

    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: skill1
description: desc1
---
`,
    );

    const storage = new Storage('/dummy');
    vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue(testRootDir);
    vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue('/non-existent');
    vi.mocked(getBuiltinSkillsDir).mockReturnValue('/non-existent');

    const service = new SkillManager();
    await service.discoverSkills(storage);
    service.setDisabledSkills(['skill1']);

    expect(service.getSkills()).toHaveLength(0);
    expect(service.getAllSkills()).toHaveLength(1);
    expect(service.getAllSkills()[0].disabled).toBe(true);
  });

  describe('discoverBuiltinSkills', () => {
    it('discovers skills from nested directories using config.json', async () => {
      const builtinDir = path.join(testRootDir, 'builtin');
      const prCreatorDir = path.join(builtinDir, 'pr-creator');
      const nestedSkillDir = path.join(builtinDir, 'category', 'nested-skill');

      await fs.mkdir(prCreatorDir, { recursive: true });
      await fs.mkdir(nestedSkillDir, { recursive: true });

      // Create config.json files
      await fs.writeFile(
        path.join(prCreatorDir, 'config.json'),
        JSON.stringify({ name: 'pr-creator', description: 'PR creator skill' }),
      );
      await fs.writeFile(
        path.join(nestedSkillDir, 'config.json'),
        JSON.stringify({ name: 'nested-skill', description: 'Nested skill' }),
      );

      const service = new SkillManager();
      // Mock resolveBuiltinSkillsDir to return our test directory
      vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(builtinDir);

      const skills = await service.discoverBuiltinSkills();

      expect(skills).toHaveLength(2);
      expect(skills.map((s) => s.name)).toContain('pr-creator');
      expect(skills.map((s) => s.name)).toContain('nested-skill');
      expect(skills.every((s) => s.source === 'builtin')).toBe(true);
    });

    it('returns empty array when builtin directory does not exist', async () => {
      const service = new SkillManager();
      vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(
        '/non-existent-path',
      );

      const skills = await service.discoverBuiltinSkills();

      expect(skills).toHaveLength(0);
    });

    it('continues on malformed config.json and only loads valid skills', async () => {
      const builtinDir = path.join(testRootDir, 'builtin');
      const goodDir = path.join(builtinDir, 'good-skill');
      const badDir = path.join(builtinDir, 'bad-skill');

      await fs.mkdir(goodDir, { recursive: true });
      await fs.mkdir(badDir, { recursive: true });

      await fs.writeFile(
        path.join(goodDir, 'config.json'),
        JSON.stringify({ name: 'good-skill', description: 'Good skill' }),
      );
      await fs.writeFile(path.join(badDir, 'config.json'), 'not valid json');

      const service = new SkillManager();
      vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(builtinDir);

      const skills = await service.discoverBuiltinSkills();

      // Should only have the good skill, malformed one is silently skipped
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('good-skill');
    });

    it('loads skill body from SKILL.md when present', async () => {
      const builtinDir = path.join(testRootDir, 'builtin');
      const skillDir = path.join(builtinDir, 'test-skill');

      await fs.mkdir(skillDir, { recursive: true });

      await fs.writeFile(
        path.join(skillDir, 'config.json'),
        JSON.stringify({ name: 'test-skill', description: 'Test' }),
      );
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: Test
---
This is the skill body content.`,
      );

      const service = new SkillManager();
      vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(builtinDir);

      const skills = await service.discoverBuiltinSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].body).toBe('This is the skill body content.');
    });

    it('uses directory name when config.json lacks name field', async () => {
      const builtinDir = path.join(testRootDir, 'builtin');
      const skillDir = path.join(builtinDir, 'auto-named-skill');

      await fs.mkdir(skillDir, { recursive: true });

      await fs.writeFile(
        path.join(skillDir, 'config.json'),
        JSON.stringify({ description: 'Auto-named skill' }),
      );

      const service = new SkillManager();
      vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(builtinDir);

      const skills = await service.discoverBuiltinSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('auto-named-skill');
    });
  });

  describe('resolveBuiltinSkillsDir', () => {
    it('uses LLXPRT_CLI_ROOT environment variable when set and path exists', async () => {
      const builtinDir = path.join(testRootDir, 'skills', 'builtin');
      await fs.mkdir(builtinDir, { recursive: true });

      process.env.LLXPRT_CLI_ROOT = testRootDir;

      const service = new SkillManager();
      const resolved = service.resolveBuiltinSkillsDir();

      expect(resolved).toBe(builtinDir);

      delete process.env.LLXPRT_CLI_ROOT;
    });

    it('falls back to other strategies when LLXPRT_CLI_ROOT path does not exist', async () => {
      process.env.LLXPRT_CLI_ROOT = '/non-existent';

      const service = new SkillManager();
      const resolved = service.resolveBuiltinSkillsDir();

      // Should fall back to getBuiltinSkillsDir() result
      expect(resolved).toBeDefined();

      delete process.env.LLXPRT_CLI_ROOT;
    });
  });

  describe('user skills override builtin', () => {
    it('user skills override builtin skills with same name', async () => {
      const builtinDir = path.join(testRootDir, 'builtin');
      const userDir = path.join(testRootDir, 'user');

      await fs.mkdir(path.join(builtinDir, 'test-skill'), { recursive: true });
      await fs.mkdir(path.join(userDir, 'test-skill'), { recursive: true });

      // Create builtin skill
      await fs.writeFile(
        path.join(builtinDir, 'test-skill', 'config.json'),
        JSON.stringify({ name: 'test-skill', description: 'Builtin desc' }),
      );

      // Create user skill with same name
      await fs.writeFile(
        path.join(userDir, 'test-skill', 'SKILL.md'),
        `---
name: test-skill
description: User desc
---
`,
      );

      const service = new SkillManager();
      vi.spyOn(service, 'resolveBuiltinSkillsDir').mockReturnValue(builtinDir);
      vi.spyOn(Storage, 'getUserSkillsDir').mockReturnValue(userDir);

      const storage = new Storage('/dummy');
      vi.spyOn(storage, 'getProjectSkillsDir').mockReturnValue('/non-existent');

      await service.discoverSkills(storage);

      const skills = service.getSkills();
      const testSkill = skills.find((s) => s.name === 'test-skill');
      expect(testSkill).toBeDefined();
      expect(testSkill!.description).toBe('User desc');
      expect(testSkill!.source).toBe('user');
    });
  });
});
