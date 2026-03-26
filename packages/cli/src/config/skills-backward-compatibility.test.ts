/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadCliConfig, parseArguments } from './config.js';
import { isWorkspaceTrusted } from './trustedFolders.js';
import { loadServerHierarchicalMemory } from '@vybestack/llxprt-code-core';
import { type Settings, createTestMergedSettings } from './settings.js';
import { ExtensionStorage } from './extension.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

vi.mock('./trustedFolders.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./trustedFolders.js')>();
  return {
    ...actual,
    isWorkspaceTrusted: vi.fn().mockReturnValue(true),
    isFolderTrustEnabled: vi.fn().mockReturnValue(false),
  };
});

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    loadServerHierarchicalMemory: vi.fn(),
  };
});

async function buildConfig(
  settings: ReturnType<typeof createTestMergedSettings>,
) {
  process.argv = ['node', 'llxprt'];
  const argv = await parseArguments(settings);
  return loadCliConfig(
    settings,
    [],
    new ExtensionEnablementManager(
      ExtensionStorage.getUserExtensionsDir(),
      argv.extensions,
    ),
    'test-session',
    argv,
  );
}

describe('Agent Skills Backward Compatibility', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.mocked(loadServerHierarchicalMemory).mockResolvedValue({
      memoryContent: '',
      fileCount: 0,
      filePaths: [],
    });
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should default skillsSupport to true when no settings are present', async () => {
    const settings = createTestMergedSettings({});
    const config = await buildConfig(settings);
    expect(
      (
        config as unknown as { isSkillsSupportEnabled: () => boolean }
      ).isSkillsSupportEnabled(),
    ).toBe(true);
  });

  it('should prioritize skills.enabled=false from settings', async () => {
    const settings = createTestMergedSettings({
      skills: { enabled: false },
    } as unknown as Settings);
    const config = await buildConfig(settings);
    expect(
      (
        config as unknown as { isSkillsSupportEnabled: () => boolean }
      ).isSkillsSupportEnabled(),
    ).toBe(false);
  });

  it('should support legacy experimental.skills=true from settings', async () => {
    const settings = createTestMergedSettings({
      experimental: { skills: true },
    } as unknown as Settings);
    const config = await buildConfig(settings);
    expect(
      (
        config as unknown as { isSkillsSupportEnabled: () => boolean }
      ).isSkillsSupportEnabled(),
    ).toBe(true);
  });

  it('should prioritize legacy experimental.skills=true over new skills.enabled=false', async () => {
    const settings = createTestMergedSettings({
      skills: { enabled: false },
      experimental: { skills: true },
    } as unknown as Settings);
    const config = await buildConfig(settings);
    expect(
      (
        config as unknown as { isSkillsSupportEnabled: () => boolean }
      ).isSkillsSupportEnabled(),
    ).toBe(true);
  });

  it('should still be enabled by default if legacy experimental.skills is false (since new default is true)', async () => {
    const settings = createTestMergedSettings({
      experimental: { skills: false },
    } as unknown as Settings);
    const config = await buildConfig(settings);
    expect(
      (
        config as unknown as { isSkillsSupportEnabled: () => boolean }
      ).isSkillsSupportEnabled(),
    ).toBe(true);
  });
});
