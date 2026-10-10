/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import { cliSkillOperations } from './configBuilder.js';

describe('CLI workspace skill policy refresh', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cli-skill-policy-'));
    await mkdir(join(directory, '.llxprt'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads changed physical settings through workspace operations without retaining a Config loader', async () => {
    const config = new Config({
      sessionId: 'cli-skill-policy',
      targetDir: directory,
      cwd: directory,
      model: 'policy-fixture',
      debugMode: false,
      adminSkillsEnabled: true,
      disabledSkills: [],
    });
    const operations = cliSkillOperations(config);
    const settings = join(directory, '.llxprt', 'settings.json');
    await writeFile(
      settings,
      JSON.stringify({
        skills: { disabled: ['alpha'] },
        admin: { skills: { enabled: false } },
      }),
    );
    const first = await operations.reloadPolicy();
    expect(first.adminSkillsEnabled).toBe(false);
    expect(first.disabledSkills).toStrictEqual(['alpha']);
    await writeFile(
      settings,
      JSON.stringify({ skills: { disabled: ['beta'] } }),
    );
    const next = await operations.reloadPolicy();
    expect(next.adminSkillsEnabled).toBe(true);
    expect(next.disabledSkills).toStrictEqual(['beta']);
    expect(config.getDisabledSkills()).toStrictEqual([]);
    expect('_onReload' in config).toBe(false);
    expect('getSkillSettingsReloader' in config).toBe(false);
  });
});
