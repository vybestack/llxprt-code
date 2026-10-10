/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { ListSubagentsTool } from '@vybestack/llxprt-code-tools';
import { SubagentManager } from '../config/subagentManager.js';
import { SubagentCatalog } from './subagentCatalog.js';

describe('SubagentCatalog with a resolved SubagentManager', () => {
  let directory: string;
  let manager: SubagentManager;
  let catalog: SubagentCatalog;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-catalog-'));
    manager = new SubagentManager(directory, new ProfileManager(directory));
    catalog = new SubagentCatalog(manager);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('lists sorted names with disk metadata taking precedence over settings and extensions', async () => {
    manager.registerExtensionSubagents('plugin', [
      { name: 'zeta', profile: 'extension', systemPrompt: 'Extension prompt' },
      {
        name: 'alpha',
        profile: 'extension',
        systemPrompt: 'Extension fallback',
      },
    ]);
    manager.registerSettingsSubagents({
      alpha: { profile: 'settings', systemPrompt: 'Settings prompt' },
      middle: { profile: 'settings', systemPrompt: 'Settings only' },
    });
    await writeFile(
      join(directory, 'alpha.json'),
      JSON.stringify({
        name: 'alpha',
        profile: 'disk',
        systemPrompt: '\n  First meaningful line\nSecond line',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-09-21T00:00:00Z',
      }),
    );

    expect(
      (await catalog.listSubagents()).map((agent) => agent.name),
    ).toStrictEqual(['alpha', 'middle', 'zeta']);
    expect(await catalog.getSubagentConfig('alpha')).toStrictEqual({
      name: 'alpha',
      instructions: '\n  First meaningful line\nSecond line',
      systemPrompt: '\n  First meaningful line\nSecond line',
      profile: 'disk',
      updatedAt: '2026-09-21T00:00:00Z',
    });
    const result = await new ListSubagentsTool(catalog).execute({});
    expect(result.metadata).toStrictEqual({ count: 3 });
    expect(result.returnDisplay).toContain(
      '**alpha** (profile: disk) — First meaningful line',
    );
    expect(result.returnDisplay).toContain(
      '**middle** (profile: settings) — Settings only',
    );
    expect(result.returnDisplay).toContain(
      '**zeta** (profile: extension) — Extension prompt',
    );
    expect(result.llmContent).toContain('"updatedAt": "2026-09-21T00:00:00Z"');
  });

  it('reflects subsequent changes on the same manager without reconstructing the catalog', async () => {
    expect(await catalog.listSubagents()).toStrictEqual([]);
    manager.registerSettingsSubagents({
      added: { profile: 'one', systemPrompt: 'Before' },
    });
    expect(await catalog.getSubagentConfig('added')).toMatchObject({
      profile: 'one',
      systemPrompt: 'Before',
    });
    manager.clearSettingsSubagents();
    manager.registerExtensionSubagents('plugin', [
      { name: 'added', profile: 'two', systemPrompt: 'After' },
    ]);
    expect(await catalog.getSubagentConfig('added')).toMatchObject({
      profile: 'two',
      systemPrompt: 'After',
    });
    expect(
      (await catalog.listSubagents()).map((agent) => agent.name),
    ).toStrictEqual(['added']);
  });

  it('reports corrupted disk metadata per entry without hiding healthy agents', async () => {
    manager.registerSettingsSubagents({
      broken: {
        profile: 'settings',
        systemPrompt: 'Should not mask disk error',
      },
      healthy: { profile: 'reviewer', systemPrompt: 'Review code' },
    });
    await writeFile(join(directory, 'broken.json'), '{bad json');

    const result = await new ListSubagentsTool(catalog).execute({});
    expect(result.metadata).toStrictEqual({ count: 2 });
    expect(result.returnDisplay).toContain('**broken**');
    expect(result.returnDisplay).toContain('corrupted');
    expect(result.returnDisplay).toContain(
      '**healthy** (profile: reviewer) — Review code',
    );
    expect(result.llmContent).toContain('"profile": "unknown"');
  });
});
