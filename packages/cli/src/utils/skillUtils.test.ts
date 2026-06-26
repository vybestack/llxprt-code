/**
 * @license
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import archiver from 'archiver';
import { installSkill } from './skillUtils.js';

/**
 * Builds a self-contained `.skill` archive (a zip) containing a single skill
 * directory with a SKILL.md file, so the install test does not depend on any
 * checked-in fixture file.
 */
async function createSkillArchive(
  archivePath: string,
  skillName: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(archivePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.append(
      `---
name: ${skillName}
description: test skill
---
body`,
      { name: `${skillName}/SKILL.md` },
    );
    void archive.finalize();
  });
}

describe('skillUtils', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-utils-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should successfully install from a .skill file', async () => {
    const skillPath = path.join(tempDir, 'weather-skill.skill');
    await createSkillArchive(skillPath, 'weather-skill');

    const skills = await installSkill(
      skillPath,
      'workspace',
      undefined,
      () => {},
      async () => true,
    );
    expect(skills.length).toBeGreaterThan(0);
    expect(skills[0].name).toBe('weather-skill');

    // Verify it was copied to the workspace skills dir
    const installedPath = path.join(tempDir, '.llxprt/skills', 'weather-skill');
    const installedExists = await fs.stat(installedPath).catch(() => null);
    expect(installedExists?.isDirectory()).toBe(true);

    const skillMdExists = await fs
      .stat(path.join(installedPath, 'SKILL.md'))
      .catch(() => null);
    expect(skillMdExists?.isFile()).toBe(true);
  });

  it('should successfully install from a local directory', async () => {
    // Create a mock skill directory
    const mockSkillDir = path.join(tempDir, 'mock-skill-source');
    const skillSubDir = path.join(mockSkillDir, 'test-skill');
    await fs.mkdir(skillSubDir, { recursive: true });
    await fs.writeFile(
      path.join(skillSubDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: test\n---\nbody',
    );

    const skills = await installSkill(
      mockSkillDir,
      'workspace',
      undefined,
      () => {},
      async () => true,
    );
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe('test-skill');

    const installedPath = path.join(tempDir, '.llxprt/skills', 'test-skill');
    const installedExists = await fs.stat(installedPath).catch(() => null);
    expect(installedExists?.isDirectory()).toBe(true);
  });
});
