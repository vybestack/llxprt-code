/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Behavioral round-trip tests for the durable app-service subpath
 * (`@vybestack/llxprt-code-agents/app-service.js`). These exercise REAL backing
 * services (SettingsService, ProfileManager, SkillManager, MemoryTool) and
 * assert PERSISTED state — not spies. Every required durable command is proven
 * to perform a real data transformation that round-trips.
 *
 * The real backing services are constructed via `./helpers/app-service-fixtures`
 * (excluded from the consumer-facing deep-import boundary scan), so this
 * consumer-facing spec imports only the public subpath + relative helper.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  addMcpServer,
  removeMcpServer,
  mutateSettings,
  editMemory,
  saveCurrentProfile,
  listProfiles,
  deleteProfile,
  manageSkills,
  manageExtensions,
  getDiagnostics,
  getAbout,
  COMMAND_API_MAP,
} from '@vybestack/llxprt-code-agents/app-service.js';

import {
  createSettingsService,
  makeMcpServerConfig,
  makeProfile,
  makeExtensions,
  makeTempDir,
  createSkillManagerWithSeededSkill,
  type MCPServerConfig,
} from './helpers/app-service-fixtures.js';

describe('app-service durable round-trips @plan:PLAN-20260617-COREAPI.P27 @requirement:REQ-021', () => {
  let tempDirs: string[];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(async () => {
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('mcp add -> get -> remove round-trips against a real SettingsService @plan:PLAN-20260617-COREAPI.P27 @requirement:REQ-021', () => {
    const settingsService = createSettingsService();
    const config = makeMcpServerConfig();

    const added = addMcpServer({ settingsService, name: 'srv', config });
    expect(added.servers['srv']).toBe(config);

    const persisted = settingsService.get('mcpServers') as Record<
      string,
      MCPServerConfig
    >;
    expect(persisted['srv']).toBe(config);

    const removed = removeMcpServer({ settingsService, name: 'srv' });
    expect(removed.removed).toBe(true);
    expect(removed.servers['srv']).toBeUndefined();

    const afterRemove = settingsService.get('mcpServers') as Record<
      string,
      MCPServerConfig
    >;
    expect(Object.prototype.hasOwnProperty.call(afterRemove, 'srv')).toBe(
      false,
    );
  });

  it('removeMcpServer reports false for a missing server @plan:PLAN-20260617-COREAPI.P27 @requirement:REQ-021', () => {
    const settingsService = createSettingsService();
    const result = removeMcpServer({ settingsService, name: 'nope' });
    expect(result.removed).toBe(false);
  });

  it('mutateSettings persists changes and reads them back @plan:PLAN-20260617-COREAPI.P27 @requirement:REQ-021', async () => {
    const settingsService = createSettingsService();
    const result = await mutateSettings({
      settingsService,
      changes: { theme: 'dark', retries: 3 },
    });
    expect(result.settings['theme']).toBe('dark');
    expect(result.settings['retries']).toBe(3);
    expect(settingsService.get('theme')).toBe('dark');
    expect(settingsService.get('retries')).toBe(3);
  });

  it('editMemory appends to a real memory file (write -> read) @plan:PLAN-20260617-COREAPI.P27 @requirement:REQ-021', async () => {
    const dir = await makeTempDir('p27-memory-');
    tempDirs.push(dir);
    const memoryFilePath = path.join(dir, 'memory.md');

    const result = await editMemory({
      memoryFilePath,
      fact: 'durable fact one',
    });
    expect(result.written).toBe(true);
    expect(result.memoryFilePath).toBe(memoryFilePath);

    const contents = await fs.readFile(memoryFilePath, 'utf-8');
    expect(contents).toContain('durable fact one');

    await editMemory({ memoryFilePath, fact: 'durable fact two' });
    const updated = await fs.readFile(memoryFilePath, 'utf-8');
    expect(updated).toContain('durable fact one');
    expect(updated).toContain('durable fact two');
  });

  it('profiles save -> list -> delete round-trip against a real ProfileManager @plan:PLAN-20260617-COREAPI.P27 @requirement:REQ-021', async () => {
    const profilesDir = await makeTempDir('p27-profiles-');
    tempDirs.push(profilesDir);

    const profile = makeProfile('gpt-test');

    const saved = await saveCurrentProfile({
      profilesDir,
      name: 'demo',
      profile,
    });
    expect(saved.saved).toBe(true);

    const listed = await listProfiles({ profilesDir });
    expect(listed.profiles).toContain('demo');

    const savedFile = await fs.readFile(
      path.join(profilesDir, 'demo.json'),
      'utf-8',
    );
    expect((JSON.parse(savedFile) as { model: string }).model).toBe('gpt-test');

    const deleted = await deleteProfile({ profilesDir, name: 'demo' });
    expect(deleted.deleted).toBe(true);

    const afterDelete = await listProfiles({ profilesDir });
    expect(afterDelete.profiles).not.toContain('demo');
  });

  it('manageSkills lists real discovered skills and persists disable @plan:PLAN-20260617-COREAPI.P27 @requirement:REQ-021', async () => {
    const projectRoot = await makeTempDir('p27-skills-');
    tempDirs.push(projectRoot);
    const manager = await createSkillManagerWithSeededSkill(
      projectRoot,
      'tester',
    );

    const settingsService = createSettingsService();

    const listed = manageSkills({ manager, action: 'list', settingsService });
    const tester = listed.skills.find((s) => s.name === 'tester');
    expect(tester).toBeDefined();
    expect(tester?.disabled).toBe(false);

    const disabled = manageSkills({
      manager,
      action: 'disable',
      names: ['tester'],
      settingsService,
    });
    expect(disabled.disabled).toContain('tester');
    expect(settingsService.get('disabledSkills')).toStrictEqual(['tester']);
    const disabledTester = disabled.skills.find((s) => s.name === 'tester');
    expect(disabledTester?.disabled).toBe(true);

    const enabled = manageSkills({
      manager,
      action: 'enable',
      names: ['tester'],
      settingsService,
    });
    expect(enabled.disabled).not.toContain('tester');
    expect(settingsService.get('disabledSkills')).toStrictEqual([]);
  });

  it('manageExtensions lists real extensions and persists disable @plan:PLAN-20260617-COREAPI.P27 @requirement:REQ-021', () => {
    const extensions = makeExtensions();
    const loader = { getExtensions: () => extensions };
    const settingsService = createSettingsService();

    const listed = manageExtensions({
      loader,
      action: 'list',
      settingsService,
    });
    expect(listed.extensions.map((e) => e.name)).toStrictEqual([
      'ext-a',
      'ext-b',
    ]);
    expect(listed.extensions.every((e) => e.disabled === false)).toBe(true);

    const disabled = manageExtensions({
      loader,
      action: 'disable',
      names: ['ext-b'],
      settingsService,
    });
    expect(disabled.disabled).toStrictEqual(['ext-b']);
    expect(settingsService.get('disabledExtensions')).toStrictEqual(['ext-b']);

    const reListed = manageExtensions({
      loader,
      action: 'list',
      settingsService,
    });
    const extB = reListed.extensions.find((e) => e.name === 'ext-b');
    expect(extB?.disabled).toBe(true);
  });

  it('getDiagnostics and getAbout reflect real settings state @plan:PLAN-20260617-COREAPI.P27 @requirement:REQ-021', async () => {
    const settingsService = createSettingsService();
    await settingsService.switchProvider('anthropic');
    settingsService.setProviderSetting('anthropic', 'model', 'claude-test');
    settingsService.set('sandbox', 'docker');

    const diagnostics = await getDiagnostics({ settingsService });
    expect(diagnostics.provider).toBe('anthropic');
    expect(diagnostics.model).toBe('claude-test');
    expect(diagnostics.sandbox).toBe('docker');

    const about = await getAbout({ settingsService });
    expect(about.provider).toBe('anthropic');
    expect(about.model).toBe('claude-test');
    expect(about.sandbox).toBe('docker');
  });

  it('exposes the canonical COMMAND_API_MAP publicly @plan:PLAN-20260617-COREAPI.P27 @requirement:REQ-021', () => {
    expect(Array.isArray(COMMAND_API_MAP)).toBe(true);
    const subpathEntries = COMMAND_API_MAP.filter((e) => e.kind === 'subpath');
    expect(subpathEntries.length).toBeGreaterThan(0);
    for (const entry of subpathEntries) {
      expect(entry.target).toBe('@vybestack/llxprt-code-agents/app-service.js');
    }
  });
});
