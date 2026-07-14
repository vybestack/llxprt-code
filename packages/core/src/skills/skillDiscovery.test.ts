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
 * The CLI `skills list` command previously constructed a session MessageBus and
 * called `Config.initialize({ messageBus })` by hand — a runtime-assembly seam
 * that must live behind a public core API (the CLI is a client, not a co-owner
 * of runtime assembly). `discoverSkillsForConfig` OWNS that assembly: it builds
 * the one session bus internally (from the Config's policy engine) and drives
 * initialization so skill discovery runs, then returns the discovered skills.
 *
 * These assertions exercise a REAL Config with a REAL on-disk project skills
 * directory (no mock theater): the observable outcome is the set of discovered
 * skills, not any internal call shape.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Config } from '../config/config.js';
import type { ConfigParameters } from '../config/configTypes.js';
import { attachTestAgentFactories } from '../test-utils/config.js';
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

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skill-discovery-test-'),
    );
  });

  afterEach(async () => {
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
    // The discovery API owns Config.initialize; the agent-client factory is a
    // production wiring concern supplied by the composition root. The test
    // helper attaches a minimal factory so initialize() completes without a
    // provider, mirroring the CLI's fully-wired Config.
    attachTestAgentFactories(config);
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

    const skills = await discoverSkillsForConfig(config);

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

    const skills = await discoverSkillsForConfig(config);

    expect(skills).toStrictEqual([]);
  });

  it('drives Config.initialize exactly once so a second discovery call does not double-initialize', async () => {
    await writeProjectSkill(
      path.join(workspaceDir, '.llxprt', 'skills'),
      'alpha',
      'alpha-skill',
      'the alpha skill',
    );
    const config = buildConfig(true);

    const first = await discoverSkillsForConfig(config);
    expect(first.map((s) => s.name)).toContain('alpha-skill');

    // A second call must NOT throw "Config was already initialized"; the API
    // owns the initialize lifecycle idempotently and re-reads the discovered
    // skills from the already-initialized skill manager.
    const second = await discoverSkillsForConfig(config);
    expect(second.map((s) => s.name)).toContain('alpha-skill');
  });
});
