/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20270110-ISSUE2378.P03
 * @requirement:REQ-2378-003
 *
 * BEHAVIORAL tests for {@link discoverSkillsForConfig} (#2378).
 *
 * The CLI composition root supplies explicit workspace listing operations
 * and an initialization operation. The helper returns the discovered data
 * without acquiring Config or a runtime service.
 *
 * These assertions exercise a REAL Config with a REAL on-disk project skills
 * directory (no mock theater): the observable outcome is the set of discovered
 * skills, not any internal call shape.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Config } from '../config/config.js';
import type { ConfigParameters } from '../config/configTypes.js';
import { initializeTestMcpRuntime } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { discoverSkillsForConfig } from './skillDiscovery.js';

async function writeProjectSkill(
  projectSkillsDir: string,
  slug: string,
  name: string,
  description: string,
): Promise<void> {
  const skillDir = path.join(projectSkillsDir, slug);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---
name: ${name}
description: ${description}
---
Body for ${name}.
`,
  );
}

describe('discoverSkillsForConfig @plan:PLAN-20270110-ISSUE2378.P03 @requirement:REQ-2378-003', () => {
  let workspaceDir: string;
  let close: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skill-discovery-test-'),
    );
  });

  afterEach(async () => {
    await close?.();
    close = undefined;
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  function buildConfig(skillsSupport: boolean): Config {
    const params: ConfigParameters = {
      sessionId: 'skill-discovery-session',
      targetDir: workspaceDir,
      cwd: workspaceDir,
      debugMode: false,
      model: 'test-model',
      skillsSupport,
    };
    const config = new Config(params);
    return config;
  }

  it('discovers on-disk project skills through the owned initialization path', async () => {
    const projectSkillsDir = path.join(workspaceDir, '.llxprt', 'skills');
    await writeProjectSkill(
      projectSkillsDir,
      'alpha',
      'alpha-skill',
      'the alpha skill',
    );
    await writeProjectSkill(
      projectSkillsDir,
      'beta',
      'beta-skill',
      'the beta skill',
    );

    const config = buildConfig(true);
    const owner = await initializeTestMcpRuntime(config);
    close = async () => {
      await owner.dispose();
      await config.dispose();
    };

    const skills = await discoverSkillsForConfig(
      owner.workspaceSkills.operations,
      async () => {
        await owner.workspaceSkills.initialize();
      },
    );

    const names = skills.map((s) => s.name).sort();
    expect(names).toContain('alpha-skill');
    expect(names).toContain('beta-skill');

    const alpha = skills.find((s) => s.name === 'alpha-skill');
    expect(alpha?.description).toBe('the alpha skill');
    expect(alpha?.source).toBe('project');
  });

  it('returns an empty array when skills support is disabled', async () => {
    const projectSkillsDir = path.join(workspaceDir, '.llxprt', 'skills');
    await writeProjectSkill(
      projectSkillsDir,
      'alpha',
      'alpha-skill',
      'the alpha skill',
    );

    const config = buildConfig(false);
    const owner = await initializeTestMcpRuntime(config);
    close = async () => {
      await owner.dispose();
      await config.dispose();
    };

    const skills = await discoverSkillsForConfig(
      owner.workspaceSkills.operations,
      async () => {
        await owner.workspaceSkills.initialize();
      },
    );

    expect(skills).toStrictEqual([]);
  });

  it('retains the root initialization across repeated listing calls', async () => {
    await writeProjectSkill(
      path.join(workspaceDir, '.llxprt', 'skills'),
      'alpha',
      'alpha-skill',
      'the alpha skill',
    );
    const config = buildConfig(true);
    const owner = await initializeTestMcpRuntime(config);
    close = async () => {
      await owner.dispose();
      await config.dispose();
    };

    const first = await discoverSkillsForConfig(
      owner.workspaceSkills.operations,
      async () => {
        await owner.workspaceSkills.initialize();
      },
    );
    expect(first.map((s) => s.name)).toContain('alpha-skill');

    const second = await discoverSkillsForConfig(
      owner.workspaceSkills.operations,
      async () => {
        await owner.workspaceSkills.initialize();
      },
    );
    expect(second.map((s) => s.name)).toContain('alpha-skill');
  });
});
